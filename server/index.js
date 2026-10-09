// Schedly server: Groq + Hindsight memory, document extraction and MP4 transcription.
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Groq, { toFile } from 'groq-sdk';

// Load .env without requiring the optional dotenv package to be installed.
function loadEnvFile() {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  try {
    const contents = readFileSync(envPath, 'utf8');
    for (const rawLine of contents.split(/\\r?\\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^(?:export\\s+)?([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*)$/);
      if (!match) continue;
      const key = match[1];
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\\s+#.*$/, '').trim();
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') console.warn('Could not read .env file:', err.message);
  }
}
loadEnvFile();

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || 'qwen/qwen3-32b';
const WHISPER_MODEL = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';
const BANK_PREFIX = process.env.HINDSIGHT_BANK_PREFIX || 'schedly';
const FEEDBACK_FILE = path.join(__dirname, '..', 'data', 'feedback.jsonl');
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 100) * 1024 * 1024;

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const hindsightBase = String(process.env.HINDSIGHT_BASE_URL || '').replace(/\/+$/, '').replace(/\/v1\/default$/, '');
const hindsightKey = process.env.HINDSIGHT_API_KEY || '';
const hindsightConfigured = Boolean(hindsightBase);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD } });

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const bankId = (contactId) => `${BANK_PREFIX}-${String(contactId).replace(/[^a-zA-Z0-9_-]/g, '')}`;
const ensured = new Set();

function hsHeaders(extra = {}) {
  return { Accept: 'application/json', 'Content-Type': 'application/json', ...(hindsightKey ? { Authorization: `Bearer ${hindsightKey}` } : {}), ...extra };
}
async function hsFetch(pathname, options = {}) {
  if (!hindsightConfigured) throw new Error('HINDSIGHT_BASE_URL is not configured.');
  const res = await fetch(`${hindsightBase}${pathname}`, {
    ...options,
    headers: { ...hsHeaders(), ...(options.headers || {}) },
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
  if (!res.ok) throw new Error(`Hindsight ${res.status}: ${data.detail?.[0]?.msg || data.detail || data.error || text || 'request failed'}`);
  return data;
}
async function ensureBank(contact) {
  const id = bankId(contact.id);
  if (ensured.has(id)) return id;
  await hsFetch(`/v1/default/banks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: `${contact.name} (${contact.co || 'contact'})`,
      background: `Memory of every interaction with ${contact.name}, ${contact.role || ''} at ${contact.co || ''}: meetings, promises made by each side, open issues, preferences.`,
    }),
  });
  ensured.add(id);
  return id;
}
async function recall(contact, query) {
  const id = await ensureBank(contact);
  const res = await hsFetch(`/v1/default/banks/${encodeURIComponent(id)}/memories/recall`, {
    method: 'POST',
    body: JSON.stringify({ query, budget: 'mid', max_tokens: 4096 }),
  });
  return (res.results || []).map((r) => r.text).filter(Boolean);
}
async function retain(contact, content, options = {}) {
  const id = await ensureBank(contact);
  const item = { content: String(content) };
  if (options.context) item.context = options.context;
  if (options.timestamp) item.timestamp = new Date(options.timestamp).toISOString();
  if (options.metadata) item.metadata = options.metadata;
  return hsFetch(`/v1/default/banks/${encodeURIComponent(id)}/memories`, {
    method: 'POST',
    body: JSON.stringify({ items: [item] }),
  });
}

function parseJson(text) {
  const clean = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Model did not return JSON');
  return JSON.parse(clean.slice(start, end + 1));
}

async function llm(messages, { json = false, maxTokens = 1800 } = {}) {
  if (!groq) throw new Error('GROQ_API_KEY is not configured.');
  let lastErr;
  for (const model of [...new Set([MODEL, FALLBACK_MODEL].filter(Boolean))]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const useFormat = json && attempt === 0;
        const r = await groq.chat.completions.create({
          model, messages, temperature: 0.2, max_completion_tokens: maxTokens,
          ...(useFormat ? { response_format: { type: 'json_object' } } : {}),
        });
        const text = r.choices?.[0]?.message?.content || '';
        return json ? parseJson(text) : text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      } catch (e) {
        lastErr = e;
        await sleep(300 * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

const arr = (v) => (Array.isArray(v) ? v.map((x) => typeof x === 'string' ? x : x?.t || JSON.stringify(x)).filter(Boolean) : []);
const memoryBlock = (mem) => (mem.length ? mem.map((m, i) => `[${i + 1}] ${m}`).join('\n') : '(no matching Hindsight memories)');
function localContext(contact, history = [], meetings = [], tasks = []) {
  const h = Array.isArray(history) ? history : [];
  const ms = Array.isArray(meetings) ? meetings : [];
  const ts = Array.isArray(tasks) ? tasks : [];
  return [
    `Contact profile: ${contact.name}, ${contact.role || ''} at ${contact.co || ''}. Email: ${contact.email || ''}. Phone: ${contact.phone || ''}. Style: ${contact.style || ''}. Discussion points: ${(contact.points || []).join('; ')}`,
    ...h.slice(0, 20).map((x) => `Previous interaction ${x.date || ''}: ${x.title || 'Interaction'} — ${x.text || ''}`),
    ...ms.slice(0, 20).map((x) => `Meeting ${x.when || x.at || ''}: ${x.agenda || ''}`),
    ...ts.slice(0, 30).map((x) => `Commitment: ${x.who || ''} — ${x.t || ''} — due ${x.due || 'no date'} — ${x.status || (x.done ? 'Completed' : 'Open')}`),
  ].filter(Boolean);
}

function fail(res, status, message) { return res.status(status).json({ error: message }); }

/* ---------------- routes ---------------- */
app.get('/api/health', (req, res) => res.json({
  ok: Boolean(groq),
  groq: Boolean(groq),
  hindsight: hindsightConfigured,
  model: MODEL,
  memory: hindsightConfigured ? 'hindsight-rest' : null,
}));

/* Contact profile/history synchronization. The browser remains the source of truth;
   this route mirrors it into Hindsight so AI can recall it after reloads. */
app.post('/api/contact-sync', async (req, res) => {
  if (!groq && !hindsightConfigured) return res.json({ ok: true, memorySaved: false });
  const { contact, history = [], meetings = [], tasks = [] } = req.body || {};
  if (!contact?.id || !contact?.name) return fail(res, 400, 'contact is required');
  if (!hindsightConfigured) return res.json({ ok: true, memorySaved: false, warning: 'Hindsight is not configured.' });
  try {
    await ensureBank(contact);
    const context = localContext(contact, history, meetings, tasks).join('\n');
    await retain(contact, context, { context: 'contact profile and synced local history' });
    return res.json({ ok: true, memorySaved: true });
  } catch (e) {
    console.error('[contact-sync]', e);
    return res.json({ ok: true, memorySaved: false, warning: 'Contact saved locally; Hindsight sync failed.' });
  }
});

/* Ask about a contact. Hindsight is preferred, but the complete browser-supplied
   contact history is also grounded into the prompt so a temporary memory outage
   never turns into the old "couldn't reach memory" dead end. */
app.post('/api/ask', async (req, res) => {
  const { contact, question, history = [], meetings = [], tasks = [] } = req.body || {};
  if (!contact?.id || !question) return fail(res, 400, 'contact and question are required');
  if (!groq) return fail(res, 503, 'GROQ_API_KEY is not configured. Add it to .env and restart the server.');
  try {
    let mem = [];
    let memorySource = 'local contact history';
    if (hindsightConfigured) {
      try {
        mem = await recall(contact, `Everything about ${contact.name}: previous meetings, discussion points, commitments, deadlines, preferences, unresolved issues. Question: ${question}`);
        if (mem.length) memorySource = 'Hindsight + local contact history';
      } catch (e) {
        console.error('[ask:hindsight]', e.message);
      }
    }
    const context = [...mem, ...localContext(contact, history, meetings, tasks)];
    if (!context.length) return res.json({ answer: `I do not have any stored history for ${contact.name} yet, so I will not guess.`, source: 'No stored contact data' });
    const answer = await llm([
      { role: 'system', content: 'Answer about one business contact using ONLY the supplied stored context. Never invent facts, dates, names or numbers. Prefer previous meeting details, commitments and contact profile. If the answer is absent, say so plainly. Be concise but useful (3–6 sentences).' },
      { role: 'user', content: `Contact: ${contact.name}, ${contact.role || ''} at ${contact.co || ''}.\nStored context:\n${memoryBlock(context)}\n\nQuestion: ${question}` },
    ]);
    res.json({ answer, source: memorySource });
  } catch (e) {
    console.error('[ask]', e);
    fail(res, 502, `AI contact memory failed: ${e.message}`);
  }
});

/* Meeting brief with both Hindsight recall and local history grounding. */
app.post('/api/brief', async (req, res) => {
  const { contact, meeting, history = [], meetings = [], openTasks = [] } = req.body || {};
  if (!contact?.id || !meeting) return fail(res, 400, 'contact and meeting are required');
  if (!groq) return fail(res, 503, 'GROQ_API_KEY is not configured. Add it to .env and restart the server.');
  try {
    let mem = [];
    if (hindsightConfigured) {
      try { mem = await recall(contact, `Everything about ${contact.name}: past meetings, what was discussed, promises made by either side, unresolved issues, preferences. Upcoming agenda: ${meeting.agenda}`); }
      catch (e) { console.error('[brief:hindsight]', e.message); }
    }
    const context = [...mem, ...localContext(contact, history, meetings, openTasks)];
    const out = await llm([
      { role: 'system', content: 'Prepare a meeting brief using ONLY stored context and open commitments. Return JSON with keys: who (string), prev (string), you (array), them (array), pending (array), discuss (array of 3), qs (array of 3–5). Use empty arrays when nothing is known. Do not invent.' },
      { role: 'user', content: `Contact: ${contact.name}, ${contact.role || ''} at ${contact.co || ''}. Style: ${contact.style || 'unknown'}.\nUpcoming meeting: ${meeting.when} — ${meeting.agenda}\nOpen commitments: ${JSON.stringify(openTasks)}\nStored context:\n${memoryBlock(context)}` },
    ], { json: true });
    res.json({ brief: {
      who: String(out.who || 'No profile stored yet.'), prev: String(out.prev || 'No previous meeting stored.'),
      you: arr(out.you), them: arr(out.them), pending: arr(out.pending), discuss: arr(out.discuss).slice(0, 3), qs: arr(out.qs).slice(0, 5),
    }});
  } catch (e) {
    console.error('[brief]', e);
    fail(res, 502, `Could not generate the brief: ${e.message}`);
  }
});

/* Meeting-note extraction. Memory persistence is best-effort so a Hindsight outage
   cannot discard the extracted meeting notes or commitments. */
app.post('/api/extract', async (req, res) => {
  const { contact, meeting, notes, source = 'notes', consent } = req.body || {};
  if (!contact?.id || !notes) return fail(res, 400, 'contact and notes are required');
  if (source === 'recording' && !consent) return fail(res, 403, 'Recording consent is required.');
  if (!groq) return fail(res, 503, 'GROQ_API_KEY is not configured. Add it to .env and restart the server.');
  try {
    const today = new Date().toISOString().slice(0, 10);
    const out = await llm([
      { role: 'system', content: `You are a meeting-notes analyst. Today is ${today}. Read ALL supplied source content. Return JSON with keys: summary (string: 3–6 sentence summary of the important content), disc (array of {t:string} discussion points), commit (array of {t:string,who:string,due:string|null}), follow (array of {t:string}). Use ONLY what the source says. Capture concrete decisions, concerns, requirements, blockers, dates, owners and next steps. Do not turn every sentence into a commitment. "You" means the user writing the notes; otherwise use the contact's name.` },
      { role: 'user', content: `Contact: ${contact.name} (${contact.co || ''}). Meeting: ${meeting?.when} — ${meeting?.agenda}\n\nSOURCE CONTENT:\n${String(notes).slice(0, 60000)}` },
    ], { json: true, maxTokens: 2400 });
    const extracted = {
      summary: String(out.summary || ''),
      disc: (out.disc || []).map((d) => ({ t: String(d?.t || d) })).filter((d) => d.t),
      commit: (out.commit || []).map((c) => ({ t: String(c?.t || c), who: String(c?.who || 'You'), due: c?.due ? String(c.due) : null })).filter((c) => c.t),
      follow: (out.follow || []).map((f) => ({ t: String(f?.t || f) })).filter((f) => f.t),
    };
    let memorySaved = false;
    if (hindsightConfigured) {
      try {
        await retain(contact, `Meeting with ${contact.name} on ${meeting?.when} about "${meeting?.agenda}". Summary: ${extracted.summary}. Discussion points: ${extracted.disc.map((d) => d.t).join('; ')}. Commitments: ${extracted.commit.map((c) => `${c.who} will ${c.t}${c.due ? ` by ${c.due}` : ''}`).join('; ')}. Follow-ups: ${extracted.follow.map((f) => f.t).join('; ')}`, {
          context: `meeting ${source}`, timestamp: new Date(), metadata: { meetingId: String(meeting?.id || ''), source },
        });
        memorySaved = true;
      } catch (e) { console.error('[extract:hindsight]', e.message); }
    }
    res.json({ extracted, memorySaved });
  } catch (e) {
    console.error('[extract]', e);
    fail(res, 502, `Could not extract the meeting content: ${e.message}`);
  }
});

/* PDF/DOC/DOCX -> text. Uses mature system converters so no extra npm package
   is required in the project. */
app.post('/api/read-document', upload.single('document'), async (req, res) => {
  if (!req.file) return fail(res, 400, 'No document uploaded.');
  const ext = path.extname(req.file.originalname || '').toLowerCase();
  if (!['.pdf', '.doc', '.docx'].includes(ext)) return fail(res, 400, 'Only PDF and Word documents (.pdf, .doc, .docx) are accepted.');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'schedly-doc-'));
  const input = path.join(tempDir, `input${ext}`);
  const output = path.join(tempDir, 'output.txt');
  try {
    await fs.writeFile(input, req.file.buffer);
    let text = '';
    if (ext === '.pdf') {
      await execFileAsync('pdftotext', ['-layout', input, output], { timeout: 30000 });
      text = await fs.readFile(output, 'utf8');
    } else if (ext === '.doc') {
      const r = await execFileAsync('antiword', [input], { timeout: 30000 });
      text = r.stdout;
    } else {
      const r = await execFileAsync('unzip', ['-p', input, 'word/document.xml'], { timeout: 30000 });
      text = r.stdout.replace(/<w:tab[^>]*\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
    }
    if (!text.trim()) return fail(res, 422, 'The document did not contain readable text.');
    res.json({ text: text.slice(0, 60000), filename: req.file.originalname });
  } catch (e) {
    console.error('[read-document]', e);
    fail(res, 502, `Could not read ${req.file.originalname}. Make sure it is a valid PDF or Word document.`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

/* MP4 -> audio -> Groq Whisper. Consent is required and the original MP4 is
   converted server-side so Whisper receives a predictable audio format. */
app.post('/api/transcribe', upload.single('recording'), async (req, res) => {
  if (!groq) return fail(res, 503, 'GROQ_API_KEY is not configured. Add it to .env and restart the server.');
  if (req.body?.consent !== 'true') return fail(res, 403, 'Recording consent is required.');
  if (!req.file) return fail(res, 400, 'No MP4 recording uploaded.');
  if (!/\.mp4$/i.test(req.file.originalname || '')) return fail(res, 400, 'Only MP4 recordings are accepted.');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'schedly-media-'));
  const input = path.join(tempDir, 'meeting.mp4');
  const audio = path.join(tempDir, 'meeting.mp3');
  try {
    await fs.writeFile(input, req.file.buffer);
    await execFileAsync('ffmpeg', ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', audio], { timeout: 120000 });
    const buffer = await fs.readFile(audio);
    const file = await toFile(buffer, 'meeting.mp3');
    const t = await groq.audio.transcriptions.create({ file, model: WHISPER_MODEL });
    if (!t.text?.trim()) return fail(res, 422, 'The MP4 did not produce any spoken transcript.');
    res.json({ text: t.text, filename: req.file.originalname });
  } catch (e) {
    console.error('[transcribe]', e);
    fail(res, 502, `MP4 transcription failed: ${e.message}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

/* Feedback */
app.post('/api/feedback', async (req, res) => {
  const { rating, category, message, email, view, at } = req.body || {};
  if (!message || String(message).length > 5000) return fail(res, 400, 'Message is required (max 5000 chars).');
  const entry = { rating: Number(rating) || null, category: String(category || 'Other'), message: String(message), email: email ? String(email) : null, view: view || null, at: at || new Date().toISOString() };
  await fs.mkdir(path.dirname(FEEDBACK_FILE), { recursive: true });
  await fs.appendFile(FEEDBACK_FILE, JSON.stringify(entry) + '\n');
  if (process.env.FEEDBACK_WEBHOOK_URL) fetch(process.env.FEEDBACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `Schedly feedback (${entry.category}, ${entry.rating}/5): ${entry.message}` }) }).catch(() => {});
  res.json({ ok: true });
});
app.get('/api/feedback', async (req, res) => {
  if (!process.env.FEEDBACK_ADMIN_KEY || req.query.key !== process.env.FEEDBACK_ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const raw = await fs.readFile(FEEDBACK_FILE, 'utf8').catch(() => '');
  res.json(raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)));
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`Schedly running on http://localhost:${PORT}`);
    console.log(`  Groq: ${groq ? 'configured' : 'MISSING'}`);
    console.log(`  Hindsight: ${hindsightConfigured ? hindsightBase : 'MISSING (AI will still use local contact history)'}`);
  });
}
export { app };
