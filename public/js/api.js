/* Schedly API layer.
   Live mode uses the Node server for Groq + Hindsight. Local browser state is always
   the source of truth for contacts/meetings/tasks, so user-entered data survives reloads. */
(function () {
  const CFG = window.SCHEDLY_CONFIG || { mode: 'auto', apiBase: '' };
  const D = window.SCHEDLY_DATA;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let live = false;

  async function post(path, body) {
    const res = await fetch(CFG.apiBase + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function postFile(path, formData) {
    const res = await fetch(CFG.apiBase + path, { method: 'POST', body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return data;
  }

  const localFallback = {
    async generateBrief(meeting, contact, ctx) {
      await wait(150);
      const history = contact.history || [];
      const tasks = (ctx.tasks || []).filter((t) => t.cid === contact.id && t.status !== 'Completed');
      const latest = history[0];
      return {
        who: `${contact.name} is ${contact.role || 'a contact'} at ${contact.co || 'their organisation'}. ${contact.style || ''}`.trim(),
        prev: latest ? `${latest.date || 'Previous meeting'} — ${latest.title || 'Interaction'}: ${latest.text}` : 'No previous meeting is stored yet.',
        you: tasks.filter((t) => t.who === 'You').map((t) => `${t.t}${t.due ? ` (due ${t.due})` : ''}`),
        them: tasks.filter((t) => t.who !== 'You').map((t) => `${t.t}${t.due ? ` (due ${t.due})` : ''}`),
        pending: tasks.map((t) => `${t.t}${t.due ? ` (due ${t.due})` : ''}`),
        discuss: [
          ...(contact.points || []).slice(0, 3),
          ...(history[0] ? [history[0].title] : []),
        ].slice(0, 3),
        qs: [
          `What is the latest status on ${contact.name}'s open items?`,
          'What changed since our last meeting?',
          'What should we agree on next?',
        ],
      };
    },

    async askHistory(question, contact, ctx) {
      await wait(150);
      const q = question.toLowerCase();
      const history = contact.history || [];
      const tasks = (ctx.tasks || []).filter((t) => t.cid === contact.id && t.status !== 'Completed');
      if (/who|about|role|company|style|prefer|contact/.test(q)) {
        return { a: `${contact.name} is ${contact.role || 'a contact'} at ${contact.co || 'their organisation'}. ${contact.email ? `Email: ${contact.email}. ` : ''}${contact.style || ''}`.trim(), src: 'Contact profile' };
      }
      if (/previous|last|history|meeting|happened/.test(q)) {
        if (!history.length) return { a: `No previous meetings or interactions are stored for ${contact.name} yet.`, src: 'Interaction history' };
        return { a: history.slice(0, 8).map((h) => `${h.date || ''} — ${h.title || 'Interaction'}: ${h.text}`).join(' '), src: 'Interaction history' };
      }
      if (/promis|commit|owe|follow/.test(q)) {
        if (!tasks.length) return { a: `There are no open commitments or follow-ups stored for ${contact.name}.`, src: 'Commitment tracker' };
        return { a: tasks.map((t) => `${t.who} — ${t.t}${t.due ? `, due ${t.due}` : ''}`).join('; '), src: 'Commitment tracker' };
      }
      if (/discuss|next|focus|agenda/.test(q)) {
        return { a: (contact.points || []).slice(0, 5).join('; ') || 'No discussion points have been stored yet.', src: 'Contact profile' };
      }
      return { a: `I could not find a stored answer for that yet. I can use ${history.length} interaction(s) and ${tasks.length} open item(s) already stored for ${contact.name}.`, src: 'Stored contact data' };
    },

    async extractFromNotes(text, meeting, contact) {
      await wait(250);
      const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
      const out = { summary: '', disc: [], commit: [], follow: [] };
      if (!sentences.length) return out;
      out.summary = sentences.slice(0, 4).join(' ').slice(0, 1000);
      const first = (contact.name || '').split(' ')[0].toLowerCase();
      for (const s of sentences) {
        const due = (s.match(/\b(\d{1,2}\s(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/i) || [])[1]
          || (s.match(/\b\d{4}-\d{2}-\d{2}\b/) || [])[0] || null;
        if (/\b(will|promise[sd]?|send|share|deliver|owe|by|commit(?:ted)?|deadline)\b/i.test(s)) {
          const theirs = new RegExp(`\\b(they|she|he|${first})\\b`, 'i').test(s);
          out.commit.push({ t: s.replace(/[.!]$/, ''), who: theirs ? contact.name : 'You', due });
        } else if (/\b(follow[ -]?up|book|schedule|check in|remind|next step)\b/i.test(s)) {
          out.follow.push({ t: s.replace(/[.!]$/, '') });
        } else {
          out.disc.push({ t: s.replace(/[.!]$/, '') });
        }
      }
      if (!out.disc.length && sentences.length) out.disc = sentences.slice(0, 5).map((t) => ({ t: t.replace(/[.!]$/, '') }));
      return out;
    },

    async transcribe() {
      throw new Error('Recording transcription needs the Schedly server with Groq configured.');
    },
    async readDocument() {
      throw new Error('PDF/Word extraction needs the Schedly server. Start the server and configure Groq/Hindsight.');
    },
    async syncContact() { return { ok: true }; },
    async sendFeedback(payload) {
      await wait(100);
      try {
        const list = JSON.parse(localStorage.getItem('schedly-feedback') || '[]');
        list.push(payload);
        localStorage.setItem('schedly-feedback', JSON.stringify(list));
      } catch (_) {}
      return { ok: true };
    },
  };

  const server = {
    async generateBrief(meeting, contact, ctx) {
      const r = await post('/api/brief', {
        contact: pick(contact),
        meeting: { id: meeting.id, when: meeting.whenLabel, agenda: meeting.agenda },
        history: contact.history || [],
        meetings: ctx.meetings || [],
        openTasks: ctx.tasks.filter((t) => t.cid === contact.id && t.status !== 'Completed')
          .map((t) => ({ t: t.t, who: t.who, due: t.due, status: t.status })),
      });
      return r.brief;
    },
    async askHistory(question, contact, ctx) {
      const r = await post('/api/ask', {
        contact: pick(contact),
        question,
        history: contact.history || [],
        meetings: (ctx.meetings || []).filter((m) => m.cid === contact.id),
        tasks: (ctx.tasks || []).filter((t) => t.cid === contact.id),
      });
      return { a: r.answer, src: r.source || 'Hindsight + stored contact history' };
    },
    async extractFromNotes(text, meeting, contact, opts) {
      const r = await post('/api/extract', {
        contact: pick(contact),
        meeting: { id: meeting.id, when: meeting.whenLabel, agenda: meeting.agenda },
        notes: text,
        source: opts.source || 'notes',
        consent: !!opts.consent,
      });
      return r.extracted;
    },
    async transcribe(file, consent) {
      if (!consent) throw new Error('Recording consent is required before transcription.');
      const fd = new FormData();
      fd.append('recording', file, file.name);
      fd.append('consent', 'true');
      const r = await postFile('/api/transcribe', fd);
      return r.text;
    },
    async readDocument(file) {
      const fd = new FormData();
      fd.append('document', file, file.name);
      return (await postFile('/api/read-document', fd)).text;
    },
    async syncContact(contact, meetings, tasks) {
      return post('/api/contact-sync', {
        contact: pick(contact),
        history: contact.history || [],
        meetings: (meetings || []).filter((m) => m.cid === contact.id),
        tasks: (tasks || []).filter((t) => t.cid === contact.id),
      });
    },
    async sendFeedback(payload) { return post('/api/feedback', payload); },
  };

  function pick(c) {
    return {
      id: c.id, name: c.name, co: c.co, role: c.role, email: c.email,
      phone: c.phone, style: c.style, points: c.points || [],
    };
  }

  window.SchedlyAPI = {
    async init() {
      if (CFG.mode === 'mock') { live = false; return 'mock'; }
      try {
        const res = await fetch(CFG.apiBase + '/api/health', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        live = !!(res.ok && data.ok);
      } catch (_) { live = false; }
      if (CFG.mode === 'live') live = true;
      return live ? 'live' : 'mock';
    },
    get mode() { return live ? 'live' : 'mock'; },
    generateBrief: (...a) => (live ? server : localFallback).generateBrief(...a),
    askHistory: (...a) => (live ? server : localFallback).askHistory(...a),
    extractFromNotes: (...a) => (live ? server : localFallback).extractFromNotes(...a),
    transcribe: (...a) => (live ? server : localFallback).transcribe(...a),
    readDocument: (...a) => (live ? server : localFallback).readDocument(...a),
    syncContact: (...a) => (live ? server : localFallback).syncContact(...a),
    sendFeedback: (...a) => (live ? server : localFallback).sendFeedback(...a),
  };
})();
