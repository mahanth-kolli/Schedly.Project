/* Schedly — UI.
   User data is persisted locally; AI calls are routed through the server when configured. */
(function () {
  const D = window.SCHEDLY_DATA;
  const API = window.SchedlyAPI;
  const root = document.getElementById('app');
  const STORE = 'schedly-user-data-v2';

  const S = {
    mode: 'mock', view: 'dash', mid: null, cid: null, scopeCid: null,
    contacts: [], meetings: [], tasks: [], briefs: {}, briefAt: {}, briefLoading: false, briefErr: '',
    speaking: false, chat: {}, chatText: '', asking: false, contactSearch: '',
    filter: 'All', showArchive: false, addOpen: false, add: { t: '', who: 'You', cid: '', due: '' },
    contactEditing: null, contactFormOpen: false, contactsSearch: '', addContactSearch: '', meetingContactSearch: '',
    notesMid: null, notesMeetingSearch: '', notesText: '', consent: false, extracting: false, extracted: null,
    notesMsg: '', notesErr: '', savedFor: '', meetingFormOpen: false,
    meetingForm: { cid: '', dateTime: '', agenda: '' },
    fb: false, fbSent: false, fbSending: false, fbErr: '', rating: 4, cat: 'Idea', fbText: '', fbEmail: '',
    voice: false, voiceMsg: '',
  };

  function loadData() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) {}
    const source = saved || { contacts: D.CONTACTS, meetings: D.MEETINGS, tasks: D.TASKS };
    S.contacts = JSON.parse(JSON.stringify(source.contacts || []));
    S.meetings = JSON.parse(JSON.stringify(source.meetings || []));
    S.tasks = JSON.parse(JSON.stringify(source.tasks || []));
    S.cid = S.contacts[0]?.id || null;
    S.scopeCid = S.cid;
    S.add.cid = S.cid || '';
    S.meetingForm.cid = S.cid || '';
    S.briefs = {};
    S.chat = {};
  }

  function persist() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        contacts: S.contacts, meetings: S.meetings, tasks: S.tasks,
      }));
    } catch (_) {}
  }

  loadData();

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lcFirst = (s) => s ? s.charAt(0).toLowerCase() + s.slice(1) : '';
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const fmtDay = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  const fmtTime = (d) => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const contactById = (id) => S.contacts.find((c) => c.id === id);
  const CHIP = { Upcoming: 'chip-up', Completed: 'chip-done', Missed: 'chip-missed', Pending: 'chip-pend', Overdue: 'chip-over', 'Due soon': 'chip-pend' };
  const chip = (status, label) => `<span class="chip ${CHIP[status] || 'chip-pend'}">${esc(label || status)}</span>`;
  const MIC = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path></svg>';
  const CONTACT_PICKER_LIMIT = 8;
  let contactSearchTimer = null;
  const CLOSE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';
  }
  function parseDue(str) {
    if (!str) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const d = new Date(`${str} ${new Date().getFullYear()}`);
    if (isNaN(d)) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function isoLocal(dt) {
    const d = new Date(dt);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function nextMeeting(ms) { return ms.find((m) => m.status === 'Upcoming') || ms[ms.length - 1] || null; }
  function countdown(at) {
    if (!at) return 'No meeting';
    const ms = at - new Date();
    if (ms <= 0) return 'Past';
    const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
    if (h >= 24) return `In ${Math.floor(h / 24)}d ${h % 24}h`;
    return `In ${h}h ${m}m`;
  }

  function meetingsView() {
    const now = new Date();
    return S.meetings.map((m) => {
      const c = contactById(m.cid);
      if (!c) return null;
      const at = new Date(m.at);
      const status = at > now ? 'Upcoming' : (m.outcome || 'Completed');
      return { ...m, at, status, who: c.name, first: c.name.split(' ')[0], co: c.co, role: c.role, init: c.init || initials(c.name),
        date: fmtDate(at), time: fmtTime(at), whenLabel: `${fmtDate(at)}, ${fmtTime(at)}` };
    }).filter(Boolean).sort((a, b) => a.at - b.at);
  }

  function tasksView() {
    const today = startOfDay(new Date());
    return S.tasks.map((t) => {
      const due = t.due ? new Date(t.due + 'T00:00:00') : null;
      const status = t.done ? 'Completed' : (due && due < today ? 'Overdue' : 'Pending');
      const c = contactById(t.cid);
      return { ...t, dueDate: due, dueLabel: due ? fmtDay(due) : 'No date', status, contactName: c ? c.name : '—',
        to: t.who === 'You' ? (c ? c.name : '—') : 'You' };
    }).filter((t) => !!contactById(t.cid));
  }

  function alertsView(tasks, ms) {
    const soon = new Date(); soon.setDate(soon.getDate() + 2);
    const out = [];
    for (const t of tasks) {
      if (t.status === 'Completed') continue;
      const mt = ms.find((m) => m.cid === t.cid && m.status === 'Upcoming');
      const whoLine = t.contactName + (mt ? ` · meeting ${mt.date}, ${mt.time}` : '');
      if (t.status === 'Overdue') {
        out.push({ level: 'Overdue', cid: t.cid, who: whoLine,
          text: t.who === 'You' ? `You promised to ${lcFirst(t.t)} by ${t.dueLabel}. Its status is still pending.` :
            `${t.who} promised to ${lcFirst(t.t)} by ${t.dueLabel}. It hasn’t arrived yet.` });
      } else if (t.who === 'You' && t.dueDate && t.dueDate <= soon) {
        out.push({ level: 'Due soon', cid: t.cid, who: whoLine,
          text: `${t.t} is due ${t.dueLabel}${mt ? `, before your meeting on ${mt.date}` : ''}.` });
      }
    }
    return out.sort((a, b) => (a.level === 'Overdue' ? 0 : 1) - (b.level === 'Overdue' ? 0 : 1));
  }

  /* ---------------- render ---------------- */
  function render(focusBind) {
    const ms = meetingsView(), tasks = tasksView(), alerts = alertsView(tasks, ms);
    if (!S.mid && ms.length) S.mid = nextMeeting(ms).id;
    if (!S.notesMid && ms.length) S.notesMid = nextMeeting(ms).id;
    if (!S.cid && S.contacts.length) S.cid = S.contacts[0].id;
    if (!S.scopeCid && S.contacts.length) S.scopeCid = S.contacts[0].id;
    if (S.add.cid && !contactById(S.add.cid)) S.add.cid = S.contacts[0]?.id || '';
    const views = { dash, contacts, prep, tracker, assistant, notes };
    root.innerHTML = header() + `<main class="main" id="main">${views[S.view]({ ms, tasks, alerts })}</main>` + voiceBar() + feedback();
    const box = root.querySelector('.msgs'); if (box) box.scrollTop = box.scrollHeight;
    if (focusBind) { const focusEl = root.querySelector(`[data-bind=\"${focusBind}\"]`); if (focusEl) { focusEl.focus(); const end = focusEl.value?.length || 0; try { focusEl.setSelectionRange(end, end); } catch (_) {} } }
  }

  function header() {
    const NAV = [['dash', 'Dashboard'], ['contacts', 'Contacts'], ['prep', 'Meeting Prep'], ['tracker', 'Task Tracker'], ['assistant', 'AI Contact Memory'], ['notes', 'Meeting Notes']];
    return `<header class="top">
      <div class="brand"><span class="logo" aria-hidden="true"><span></span></span><span class="h3 brand-name">Schedly</span></div>
      <nav class="nav" aria-label="Sections">${NAV.map(([v, l]) => `<button class="navb ${S.view === v ? 'on' : ''}" data-action="go" data-view="${v}" ${S.view === v ? 'aria-current="page"' : ''}>${l}</button>`).join('')}</nav>
      <div class="top-actions">
        <button class="btn2 plain icon" data-action="voice" aria-label="${S.voice ? 'Stop listening' : 'Voice meeting prep'}" aria-pressed="${S.voice}">${MIC}</button>
        <button class="btn2 plain" data-action="openFb">Give feedback</button>
      </div>
    </header>`;
  }

  function emptyCard(title, text, action, label) {
    return `<section class="card empty-state"><h2 class="h3" style="font-size:18px">${esc(title)}</h2><p class="bp muted">${esc(text)}</p>${action ? `<button class="btn" data-action="${esc(action)}">${esc(label)}</button>` : ''}</section>`;
  }

  /* ----- 1. Dashboard ----- */
  function dash({ ms, tasks, alerts }) {
    if (!S.contacts.length) {
      return `<div class="stack">${emptyCard('Your Schedly workspace is ready', 'There is no demo data. Add your first contact to start building meeting memory, commitments and AI briefs.', 'newContact', 'Add your first contact')}</div>`;
    }
    const next = nextMeeting(ms);
    const pending = tasks.filter((t) => t.status === 'Pending').length;
    const overdue = tasks.filter((t) => t.status === 'Overdue').length;
    const top = alerts[0];
    return `<div class="bento">
      <section class="card hero" aria-labelledby="next-h">
        ${next ? `<div class="row-between"><span class="lbl">Next up · ${esc(next.date)}, ${esc(next.time)}</span>${chip(next.status, countdown(next.at))}</div>
        <div><h1 class="h3 hero-name" id="next-h">${esc(next.who)}</h1><div class="muted" style="font-size:15px;margin-top:8px">${esc(next.role)}${next.co ? `, ${esc(next.co)}` : ''} · ${esc(next.agenda)}</div></div>
        <div class="points"><div class="lbl">Talking points from memory</div>
          ${(S.briefs[next.id]?.qs || []).slice(0, 3).map((q, i) => `<div class="point"><b>${i + 1}</b><span>${esc(q)}</span></div>`).join('') || '<div class="muted small">Open Meeting Prep to generate talking points.</div>'}
        </div>
        <div class="wrap" style="margin-top:auto"><button class="btn" data-action="prep" data-id="${next.id}">Prepare for meeting</button><button class="btn2" data-action="voice">${MIC}${S.voice ? 'Stop listening' : 'Voice prep'}</button></div>`
        : `<h1 class="h3 hero-name">No meetings yet</h1><p class="bp muted">Add a meeting from Meeting Notes whenever you schedule one.</p><button class="btn" data-action="go" data-view="notes">Add meeting details</button>`}
      </section>
      <section class="card" style="display:flex;flex-direction:column;justify-content:space-between;gap:12px">
        <div class="lbl">Commitments</div><div class="grid2" style="gap:12px"><div><div class="h3 big">${pending}</div><div class="muted" style="font-size:13px;margin-top:4px">Pending</div></div><div><div class="h3 big" style="color:var(--terracotta-deep)">${overdue}</div><div class="muted" style="font-size:13px;margin-top:4px">Overdue</div></div></div>
        <button class="btn2" data-action="go" data-view="tracker">Open tracker</button>
      </section>
      <section class="card alert-card" aria-label="Most urgent follow-up">${top
        ? `<span>${chip(top.level)}</span><div style="font-size:16px;font-weight:600;line-height:1.4">${esc(top.text)}</div><div class="muted small" style="margin-top:auto">${esc(top.who)}</div>`
        : `<span>${chip('Completed', 'All clear')}</span><div style="font-size:16px;font-weight:600">No overdue commitments.</div>`}</section>
      <section class="card span2" style="padding:18px 22px">
        <div class="row-between" style="margin-bottom:8px"><h2 class="h3" style="font-size:17px">Upcoming & recent meetings</h2><span class="muted small">${ms.length} total</span></div>
        ${ms.length ? ms.map((m) => `<div class="meet-row"><span class="av" aria-hidden="true">${esc(m.init)}</span><div style="min-width:0"><div style="font-weight:600;font-size:14px">${esc(m.who)}${m.co ? ` · ${esc(m.co)}` : ''}</div><div class="muted small">${esc(m.date)}, ${esc(m.time)} · ${esc(m.agenda)}</div></div>${chip(m.status)}<button class="btn2 sm" data-action="prep" data-id="${m.id}">Prepare</button></div>`).join('') : '<div class="muted small">No meetings recorded yet.</div>'}
      </section>
      <section class="card span2" style="display:flex;flex-direction:column;gap:14px">
        <div class="row-between"><h2 class="h3" style="font-size:17px">Ask contact memory</h2>${chip('Completed', 'Grounded')}</div>
        <form class="wrap" data-form="askDash" style="flex-wrap:nowrap"><input id="dash-ask" class="inp soft" data-bind="chatText" value="${esc(S.chatText)}" placeholder="${S.scopeCid && contactById(S.scopeCid) ? `Ask about ${esc(contactById(S.scopeCid).name)}` : 'Ask about a contact'}"><button class="btn" type="submit" ${!S.scopeCid ? 'disabled' : ''}>Ask</button></form>
        <div class="wrap">${D.SUGGESTED_QUESTIONS.map((q, i) => `<button class="pill" data-action="suggest" data-i="${i}" data-go="1" ${!S.scopeCid ? 'disabled' : ''}>${esc(q)}</button>`).join('')}</div>
      </section>
      <section class="card" style="display:flex;flex-direction:column;gap:10px"><h2 class="h3" style="font-size:17px">Just finished a meeting?</h2><div class="muted" style="font-size:13px;line-height:1.5">Drop notes, PDF/Word transcript, or an MP4 recording. The agent extracts discussion points, commitments and follow-ups.</div><button class="btn terra" style="margin-top:auto" data-action="go" data-view="notes">Add meeting notes</button></section>
      <section class="card" style="display:flex;flex-direction:column;gap:6px"><h2 class="h3" style="font-size:17px;margin-bottom:4px">People</h2>${S.contacts.slice(0, 6).map((c) => `<button class="rowbtn" style="padding:4px" data-action="openContact" data-id="${c.id}"><span class="av sm">${esc(c.init || initials(c.name))}</span><span style="font-size:13px;font-weight:600">${esc(c.name)}</span></button>`).join('')}</section>
    </div>`;
  }

  function filteredContacts(query, limit = CONTACT_PICKER_LIMIT) {
    const q = String(query || '').trim().toLowerCase();
    const list = q
      ? S.contacts.filter((c) => `${c.name || ''} ${c.role || ''} ${c.co || ''} ${c.email || ''} ${c.phone || ''}`.toLowerCase().includes(q))
      : S.contacts;
    return list.slice(0, limit);
  }

  function contactPicker({ label, searchKey, searchValue, selectedId, action, bindKey, placeholder }) {
    const selected = contactById(selectedId);
    const matches = filteredContacts(searchValue);
    return `<div class="contact-picker">
      <label class="fl">${esc(label)}
        <input class="inp contact-search-input" data-bind="${esc(searchKey)}" value="${esc(searchValue || '')}" placeholder="${esc(placeholder || 'Search contacts by name, designation or company…')}" autocomplete="off" spellcheck="false">
      </label>
      <div class="contact-results" role="listbox" aria-label="Contact search results">
        ${matches.map((c) => `<button type="button" class="contact-result ${c.id === selectedId ? 'selected' : ''}" data-action="${esc(action)}" data-id="${esc(c.id)}" role="option" aria-selected="${c.id === selectedId ? 'true' : 'false'}">
          <span class="av sm">${esc(c.init || initials(c.name))}</span>
          <span class="contact-result-copy"><strong>${esc(c.name)}</strong><span class="muted small">${esc(c.role || 'Designation not provided')}${c.co ? ` · ${esc(c.co)}` : ''}</span></span>
          ${c.id === selectedId ? '<span class="contact-picked">Selected</span>' : ''}
        </button>`).join('') || '<div class="muted small contact-no-results">No matching contacts.</div>'}
      </div>
      ${selected ? `<div class="selected-contact"><span class="av sm">${esc(selected.init || initials(selected.name))}</span><div><div class="lbl">Selected contact</div><strong>${esc(selected.name)}</strong><div class="muted small">${esc(selected.role || 'Designation not provided')}${selected.co ? ` · ${esc(selected.co)}` : ''}</div></div></div>` : '<div class="muted small">Choose a contact from the results above.</div>'}
    </div>`;
  }

  /* ----- 2. Contacts ----- */
  function contactForm(c) {
    const x = c || { id: '', name: '', co: '', role: '', email: '', phone: '', style: '', points: [], history: [] };
    return `<form class="card stack" data-form="contact" style="gap:14px">
      <div class="row-between"><div><h2 class="h3" style="font-size:18px">${c ? 'Edit contact' : 'Add contact'}</h2><div class="muted small">Every field you enter is saved and remains editable.</div></div><button type="button" class="btn2 icon" data-action="cancelContact">${CLOSE}</button></div>
      <div class="grid2">
        <label class="fl">Full name<input class="inp" data-bind="contact.name" value="${esc(x.name)}" required></label>
        <label class="fl">Company / organisation<input class="inp" data-bind="contact.co" value="${esc(x.co)}"></label>
        <label class="fl">Role / title<input class="inp" data-bind="contact.role" value="${esc(x.role)}"></label>
        <label class="fl">Email<input class="inp" type="email" data-bind="contact.email" value="${esc(x.email)}"></label>
        <label class="fl">Phone<input class="inp" data-bind="contact.phone" value="${esc(x.phone)}"></label>
        <label class="fl">Communication style<textarea class="inp" rows="2" data-bind="contact.style">${esc(x.style)}</textarea></label>
      </div>
      <label class="fl">Important discussion points <span class="muted small">(one per line)</span><textarea class="inp" rows="4" data-bind="contact.points">${esc((x.points || []).join('\n'))}</textarea></label>
      <div class="wrap"><button class="btn" type="submit">${c ? 'Save changes' : 'Create contact'}</button><button type="button" class="btn2" data-action="cancelContact">Cancel</button></div>
    </form>`;
  }

  function contacts({ ms }) {
    if (!S.contacts.length && !S.contactFormOpen) {
      return `<div class="stack"><div class="row-between"><h1 class="h3">Contacts</h1><button class="btn" data-action="newContact">Add contact</button></div>${emptyCard('No contacts yet', 'Add a contact to start storing meeting history and AI memory.', 'newContact', 'Add contact')}</div>`;
    }
    const c = contactById(S.cid) || S.contacts[0];
    if (c && S.cid !== c.id) S.cid = c.id;
    const count = c ? ms.filter((m) => m.cid === c.id).length : 0;
    return `<div class="split">
      <div class="card contacts-sidebar" style="padding:10px;display:flex;flex-direction:column;gap:4px">
        <div class="row-between" style="padding:10px 12px 6px"><div class="lbl">Contacts</div><button class="btn2 sm" data-action="newContact">Add</button></div>
        <input class="inp contact-sidebar-search" data-bind="contactsSearch" value="${esc(S.contactsSearch)}" placeholder="Search contacts…" autocomplete="off" spellcheck="false">
        <div class="contact-sidebar-results">
          ${filteredContacts(S.contactsSearch, 50).map((x) => `<button class="rowbtn ${x.id === c?.id ? 'on' : ''}" data-action="pickContact" data-id="${x.id}" aria-current="${x.id === c?.id ? 'true' : 'false'}"><span class="av">${esc(x.init || initials(x.name))}</span><span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span style="font-weight:600;font-size:14px">${esc(x.name)}</span><span class="muted small">${esc(x.role || 'Designation not provided')}${x.co ? ` · ${esc(x.co)}` : ''}</span></span></button>`).join('') || '<div class="muted small" style="padding:12px">No matching contacts.</div>'}
        </div>
      </div>
      <div class="stack" style="min-width:0">
        ${S.contactFormOpen ? contactForm(S.contactEditing) : c ? `<div class="card" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><span class="av lg">${esc(c.init || initials(c.name))}</span><div style="flex-grow:1;min-width:200px"><h1 class="h3" style="font-size:26px">${esc(c.name)}</h1><div class="muted" style="font-size:14px;margin-top:4px">${esc(c.role || '')}${c.co ? ` · ${esc(c.co)}` : ''}</div><div style="font-size:13px;margin-top:8px;display:flex;gap:16px;flex-wrap:wrap">${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}${c.phone ? `<span>${esc(c.phone)}</span>` : ''}</div></div><div class="wrap"><button class="btn" data-action="askAbout" data-id="${c.id}">Ask AI about ${esc(c.name.split(' ')[0])}</button><button class="btn2" data-action="addMeetingForContact" data-id="${c.id}">Add meeting details</button><button class="btn2" data-action="editContact" data-id="${c.id}">Edit</button><button class="btn2" data-action="deleteContact" data-id="${c.id}">Delete</button></div></div>
        <div class="card"><div class="lbl">Preferences & communication style</div><p class="bp">${esc(c.style || 'Not provided.')}</p></div><div class="grid2"><div class="card"><div class="lbl">Important discussion points</div>${c.points?.length ? `<ul class="l" style="margin-top:10px">${c.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '<p class="bp muted">None stored yet.</p>'}</div><div class="card interaction-history-card"><div class="lbl">Interaction history · ${c.history.length} entries · ${count} scheduled meeting(s)</div>${c.history.length ? `<div class="stack" style="gap:14px;margin-top:14px">${c.history.map((h) => `<div class="hist"><div class="muted" style="font-size:13px;font-weight:600">${esc(h.date || '')}</div><div><div style="font-weight:600;font-size:14px">${esc(h.title || 'Interaction')}</div><div class="muted" style="font-size:13px;margin-top:3px;line-height:1.45">${esc(h.text || '')}</div></div></div>`).join('')}</div>` : '<p class="bp muted">No previous meetings or interactions stored yet.</p>'}</div></div>`
        : contactForm(S.contactEditing)}
      </div>
    </div>`;
  }

  /* ----- 3. Meeting prep ----- */
  function prep({ ms, alerts }) {
    const m = ms.find((x) => x.id === S.mid);
    if (!m) return `<div class="stack"><div class="row-between"><h1 class="h3">Meeting Prep</h1><button class="btn" data-action="go" data-view="notes">Add meeting details</button></div>${emptyCard('No meeting selected', 'Create a meeting from Meeting Notes, then come back here for an AI brief.')}</div>`;
    const b = S.briefs[m.id];
    const a = alerts.find((x) => x.cid === m.cid);
    const alertText = a ? a.text : m.status === 'Completed' ? `Meeting completed. Add notes to update ${m.first}’s memory.` : `No overdue commitments with ${m.first}.`;
    const list = (arr) => (arr?.length ? `<ul class="l" style="margin-top:10px">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="bp muted">Nothing recorded.</p>');
    return `<div class="stack">
      <div class="wrap"><span class="lbl">Select meeting</span>${ms.map((x) => `<button class="pill ${x.id === S.mid ? 'on' : ''}" data-action="pickMeeting" data-id="${x.id}">${esc(x.who)} · ${esc(x.date)}</button>`).join('')}</div>
      <div class="banner">${chip(a ? a.level : m.status, 'Follow-up')}<span>${esc(alertText)}</span></div>
      <div class="card row-between" style="flex-wrap:wrap"><div><div class="lbl">AI meeting brief</div><h1 class="h3" style="font-size:26px;margin-top:6px">${esc(m.who)}, ${esc(m.co || '')}</h1><div class="muted" style="font-size:14px;margin-top:4px">${esc(m.date)} at ${esc(m.time)} · ${esc(m.agenda)}</div></div><div class="wrap">${chip(m.status)}<button class="btn2" data-action="listen" ${b ? '' : 'disabled'}>${MIC}${S.speaking ? 'Stop reading' : 'Listen to brief'}</button><button class="btn" data-action="regen" ${S.briefLoading ? 'disabled' : ''}>${S.briefLoading ? 'Generating…' : 'Regenerate'}</button></div></div>
      ${S.briefErr ? `<div class="banner"><span class="error">Couldn’t generate the brief: ${esc(S.briefErr)}</span></div>` : ''}
      ${!b ? `<div class="card muted">${S.briefLoading ? 'Recalling contact history and writing the brief…' : 'Generate the brief to see previous meetings, commitments and talking points.'}</div>` : `<div class="grid3"><div class="card"><div class="lbl">Who they are</div><p class="bp">${esc(b.who)}</p></div><div class="card"><div class="lbl">Previous meeting</div><p class="bp">${esc(b.prev)}</p></div><div class="card"><div class="lbl">Pending follow-ups</div>${list(b.pending)}</div><div class="card"><div class="lbl">You promised</div>${list(b.you)}</div><div class="card"><div class="lbl">${esc(m.first)} promised</div>${list(b.them)}</div><div class="card"><div class="lbl">Discuss next</div>${list(b.discuss)}</div></div><div class="card"><div class="lbl">Suggested questions & talking points</div><div class="grid2" style="gap:10px;margin-top:12px">${(b.qs || []).map((q, i) => `<div class="qi"><span class="qn">${i + 1}</span><span>${esc(q)}</span></div>`).join('')}</div><div class="muted small" style="margin-top:14px">Built from ${esc(m.first)}’s stored contact history, previous meetings and open commitments.</div></div>`}
    </div>`;
  }

  /* ----- 4. Tracker ----- */
  function tracker({ tasks }) {
    const activeTasks = tasks.filter((t) => !t.archived);
    const archivedTasks = tasks.filter((t) => t.archived);
    const count = (f) => f === 'All' ? activeTasks.length : activeTasks.filter((t) => t.status === f).length;
    const rows = activeTasks.filter((t) => S.filter === 'All' || t.status === S.filter).sort((a, b) => ({ Overdue: 0, Pending: 1, Completed: 2 }[a.status] - { Overdue: 0, Pending: 1, Completed: 2 }[b.status]) || ((a.dueDate || 0) - (b.dueDate || 0)));
    const taskRows = (items, archived = false) => items.map((t) => `<div class="trow"><span style="font-weight:600">${esc(t.t)}</span><span>${esc(t.who)}</span><span class="muted">${esc(t.to)}</span><span>${esc(t.dueLabel)}</span><span>${chip(t.status)}</span><span>${archived ? '<span class="muted small">Archived</span>' : `<button class="btn2 sm" data-action="toggleRemind" data-id="${t.id}">${t.remind ? 'On' : 'Off'}</button>`}</span><span>${archived ? `<button class="btn2 sm" data-action="restoreTask" data-id="${t.id}">Restore</button>` : `<button class="btn2 sm" data-action="toggleDone" data-id="${t.id}">${t.done ? 'Reopen' : 'Mark done'}</button> ${t.done ? `<button class="btn2 sm" data-action="archiveTask" data-id="${t.id}">Archive</button>` : ''}`}</span></div>`).join('') || '<div class="trow"><span class="muted">Nothing here.</span></div>';
    return `<div class="stack"><div class="row-between" style="flex-wrap:wrap"><div class="wrap">${['All', 'Pending', 'Overdue', 'Completed'].map((f) => `<button class="pill ${S.filter === f ? 'on' : ''}" data-action="filter" data-f="${f}">${f} · ${count(f)}</button>`).join('')}</div><div class="wrap"><button class="btn2" data-action="toggleArchiveView">${S.showArchive ? 'Hide archive' : `Archive · ${archivedTasks.length}`}</button><button class="btn" data-action="toggleAdd">${S.addOpen ? 'Cancel' : 'Add commitment'}</button></div></div>
      ${S.addOpen ? `<form class="card addform" data-form="add"><label class="fl">Commitment<input class="inp" data-bind="add.t" value="${esc(S.add.t)}" required></label>${contactPicker({ label: 'Contact', searchKey: 'addContactSearch', searchValue: S.addContactSearch, selectedId: S.add.cid, action: 'pickAddContact', bindKey: 'add.cid' })}<label class="fl">Responsible<select class="inp" data-bind="add.who"><option value="You">You</option><option value="Contact">The contact</option></select></label><label class="fl">Due date<input class="inp" type="date" data-bind="add.due" value="${esc(S.add.due)}"></label><button class="btn" type="submit">Save</button></form>` : ''}
      <div class="card table" role="table"><div class="trow th"><span>Commitment</span><span>Responsible</span><span>Owed to</span><span>Due</span><span>Status</span><span>Reminder</span><span></span></div>${taskRows(rows)}</div>
      ${S.showArchive ? `<section class="card stack"><div class="row-between"><div><h2 class="h3" style="font-size:18px">Archived completed tasks</h2><p class="muted small">Completed tasks stay here until you restore them.</p></div></div><div class="card table" role="table"><div class="trow th"><span>Commitment</span><span>Responsible</span><span>Owed to</span><span>Due</span><span>Status</span><span>Reminder</span><span></span></div>${taskRows(archivedTasks, true)}</div></section>` : ''}
      <div class="banner">${chip('Overdue', 'Reminder')}<span>Overdue items and anything due in the next 2 days are pinned to the relevant contact’s brief.</span></div></div>`;
  }

  /* ----- 5. AI contact memory ----- */
  function assistant({ ms, tasks }) {
    const c = contactById(S.scopeCid);
    if (!c) return `<div class="stack">${emptyCard('AI Contact Memory', 'Select or add a contact first.', 'goContacts', 'Open Contacts')}</div>`;
    const msgs = S.chat[c.id] || [];
    const open = tasks.filter((t) => t.cid === c.id && t.status !== 'Completed').length;
    const q = S.contactSearch.trim().toLowerCase();
    const matches = q ? S.contacts.filter((x) => `${x.name} ${x.co} ${x.email}`.toLowerCase().includes(q)).slice(0, 8) : S.contacts.slice(0, 8);
    return `<div class="assistant-layout">
      <section class="card chatbox" aria-label="AI contact memory">
        <div class="row-between"><div><h1 class="h3" style="font-size:20px">AI Contact Memory</h1><div class="muted small" style="margin-top:4px">Ask about previous meetings, commitments, preferences and stored history for the selected person.</div></div>${S.mode === 'live' ? chip('Completed', 'AI connected') : ''}</div>
        <div class="contact-memory-picker">
          <label class="fl">Search and select a contact<input class="inp contact-search-input" data-bind="contactSearch" value="${esc(S.contactSearch)}" placeholder="Search by name, designation, company or email" autocomplete="off" spellcheck="false"></label>
          <div class="contact-results compact" role="listbox" aria-label="AI contact search results">${matches.map((x) => `<button type="button" class="contact-result ${x.id === c.id ? 'selected' : ''}" data-action="pickScope" data-id="${x.id}" role="option" aria-selected="${x.id === c.id ? 'true' : 'false'}"><span class="av sm">${esc(x.init || initials(x.name))}</span><span class="contact-result-copy"><strong>${esc(x.name)}</strong><span class="muted small">${esc(x.role || 'Designation not provided')}${x.co ? ` · ${esc(x.co)}` : ''}</span></span>${x.id === c.id ? '<span class="contact-picked">Selected</span>' : ''}</button>`).join('') || '<div class="muted small contact-no-results">No matching contacts.</div>'}</div>
          <div class="selected-contact memory-selected"><div><div class="lbl">Selected contact</div><h2 class="h3" style="font-size:18px;margin-top:3px">${esc(c.name)}</h2><div class="muted small">${esc(c.role || 'Designation not provided')}${c.co ? ` · ${esc(c.co)}` : ''}</div><div class="muted small" style="margin-top:4px">${c.history.length} interaction(s) · ${open} open commitment(s)</div></div><button class="btn2 sm" data-action="editContact" data-id="${c.id}">Edit</button></div>
        </div>
        <div class="msgs" aria-live="polite">${msgs.length ? msgs.map((x) => `<div class="bu">${esc(x.q)}</div>${x.pending ? '<div class="ba typing">Searching previous meetings and memory…</div>' : `<div class="ba">${esc(x.a)}<div class="src">Source · ${esc(x.src)}</div></div>`}`).join('') : `<div class="muted" style="margin:auto;text-align:center;max-width:400px;font-size:14px;line-height:1.5">The AI can use ${c.history.length} stored interaction(s), ${ms.filter((m) => m.cid === c.id).length} meeting(s), and ${open} open commitment(s). Ask about the person to begin.</div>`}</div>
        <div class="wrap">${D.SUGGESTED_QUESTIONS.map((x, i) => `<button class="pill" data-action="suggest" data-i="${i}" ${S.asking ? 'disabled' : ''}>${esc(x)}</button>`).join('')}</div>
        <form class="wrap" data-form="ask" style="flex-wrap:nowrap"><input id="chat-in" class="inp" data-bind="chatText" value="${esc(S.chatText)}" placeholder="Ask about this contact’s history…" autocomplete="off"><button class="btn2 icon" type="button" data-action="voice" aria-label="Ask by voice">${MIC}</button><button class="btn" type="submit" ${S.asking ? 'disabled' : ''}>Ask</button></form>
      </section>
      <div class="assistant-below"><div class="card"><div class="lbl">Stored contact context</div><p class="bp">${esc(c.style || 'No communication style stored.')}</p>${c.points?.length ? `<ul class="l" style="margin-top:10px">${c.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</div><div class="card previous-meetings"><div class="lbl">Previous meetings</div>${c.history.length ? `<ul class="l" style="margin-top:10px">${c.history.slice(0, 8).map((h) => `<li><strong>${esc(h.date || '')}</strong> — ${esc(h.title || 'Interaction')}: ${esc(h.text || '')}</li>`).join('')}</ul>` : '<p class="bp muted">No previous meetings stored.</p>'}</div></div>
    </div>`;
  }

  /* ----- 6. Meeting notes ----- */
  function notes({ ms }) {
    const m = ms.find((x) => x.id === S.notesMid) || ms[0];
    const x = S.extracted;
    const addMeeting = S.meetingForm;
    return `<div class="stack">
      <div class="notes-layout">
        <form class="card stack" style="gap:14px" data-form="extract">
          <div class="row-between"><div><h1 class="h3" style="font-size:18px">Post-meeting memory update</h1><div class="muted small">Add notes or upload source material; the agent will read it, summarize it and extract discussion points.</div></div><button type="button" class="btn2 sm" data-action="toggleMeetingForm">${S.meetingFormOpen ? 'Hide meeting details' : '+ Add meeting details'}</button></div>
          ${ms.length ? `<div class="contact-picker meeting-picker"><label class="fl">Search meeting details<input class="inp" data-bind="notesMeetingSearch" value="${esc(S.notesMeetingSearch || '')}" placeholder="Search by contact, designation, company or agenda…" autocomplete="off"></label><div class="contact-results meeting-results" role="listbox" aria-label="Meeting search results">${ms.filter((y) => `${y.who} ${y.role || ''} ${y.co || ''} ${y.agenda || ''} ${y.date || ''}`.toLowerCase().includes((S.notesMeetingSearch || '').trim().toLowerCase())).slice(0, 10).map((y) => `<button type="button" class="contact-result ${y.id === m?.id ? 'selected' : ''}" data-action="pickNotesMeeting" data-id="${y.id}" role="option" aria-selected="${y.id === m?.id ? 'true' : 'false'}"><span class="av sm">${esc(y.init || initials(y.who))}</span><span class="contact-result-copy"><strong>${esc(y.who)}${y.role ? ` · ${esc(y.role)}` : ''}</strong><span class="muted small">${esc(y.co || '')}${y.co ? ' · ' : ''}${esc(y.date)} · ${esc(y.agenda || 'Meeting')}</span></span>${y.id === m?.id ? '<span class="contact-picked">Selected</span>' : ''}</button>`).join('') || '<div class="muted small contact-no-results">No matching meetings.</div>'}</div><div class="selected-contact"><div><div class="lbl">Selected meeting</div><strong>${esc(m.who)}${m.role ? ` · ${esc(m.role)}` : ''}</strong><div class="muted small">${esc(m.co || '')}${m.co ? ' · ' : ''}${esc(m.date)} · ${esc(m.agenda || 'Meeting')}</div></div></div></div>` : '<div class="banner"><span>No meeting exists yet. Add meeting details below before saving notes.</span></div>'}
          ${S.meetingFormOpen ? `<div class="card meeting-details-form" style="padding:14px;background:var(--soft);border-color:transparent">${contactPicker({ label: 'Contact', searchKey: 'meetingContactSearch', searchValue: S.meetingContactSearch, selectedId: addMeeting.cid, action: 'pickMeetingContact', bindKey: 'meetingForm.cid' })}<div class="grid2" style="margin-top:12px"><label class="fl">Date & time<input class="inp" type="datetime-local" data-bind="meetingForm.dateTime" value="${esc(addMeeting.dateTime || isoLocal(new Date()))}"></label><label class="fl">Meeting agenda<input class="inp" data-bind="meetingForm.agenda" value="${esc(addMeeting.agenda)}" placeholder="e.g. Project review and next steps"></label></div><button type="button" class="btn2" style="margin-top:10px" data-action="addMeetingFromNotes">Add meeting</button></div>` : ''}
          <label class="fl">Notes or transcript<textarea class="inp" rows="9" data-bind="notesText" placeholder="Paste meeting notes here, or upload a PDF/Word transcript or MP4 recording.">${esc(S.notesText)}</textarea>
          <div class="wrap">
            <label class="btn2" style="cursor:pointer">Upload transcript (PDF/Word)<input type="file" class="sr-only" data-file="document" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label>
            <label class="btn2" style="cursor:pointer">Upload recording / video (MP4)<input type="file" class="sr-only" data-file="recording" accept="video/mp4,.mp4"></label>
          </div>
          <label class="check"><input type="checkbox" data-bind="consent" ${S.consent ? 'checked' : ''}><span>Everyone on the call consented to recording. Allow automatic transcription and extraction from the MP4 recording.</span></label>
          ${S.notesErr ? `<div class="error" role="alert">${esc(S.notesErr)}</div>` : ''}${S.notesMsg ? `<div class="muted small">${esc(S.notesMsg)}</div>` : ''}
          <button class="btn" type="submit" ${S.extracting || !m ? 'disabled' : ''}>${S.extracting ? 'Reading & extracting…' : 'Extract & save to memory'}</button>
        </form>
        <section class="card stack" style="min-width:0">
          <div class="row-between"><div><h2 class="h3" style="font-size:18px">Extracted by the agent</h2><div class="muted small">Discussion points and important meeting outcomes appear here after extraction.</div></div>${x ? chip('Completed', 'Saved') : ''}</div>
          ${!x ? '<p class="bp muted" style="margin:0">Upload a PDF/Word transcript or MP4 recording, or paste notes. Schedly will read the source content and turn the important points into meeting notes.</p>' : `<div class="card" style="padding:14px;background:var(--soft);border-color:transparent"><div class="lbl">Meeting summary</div><p class="bp" style="margin-top:6px">${esc(x.summary || 'No separate summary was returned; see the discussion points below.')}</p></div><div><div class="h4">Discussion points</div>${x.disc?.length ? `<ul class="l">${x.disc.map((d) => `<li>${esc(d.t)}</li>`).join('')}</ul>` : '<div class="muted small">None found.</div>'}</div><div><div class="h4">Commitments & deadlines</div><div class="stack" style="gap:8px">${x.commit?.map((d) => `<div class="exr"><span>${esc(d.t)}</span><span class="muted">${esc(d.who)} · due ${esc(d.due || 'TBD')}</span></div>`).join('') || '<div class="muted small">None found.</div>'}</div></div><div><div class="h4">Follow-up tasks</div>${x.follow?.length ? `<ul class="l">${x.follow.map((d) => `<li>${esc(d.t)}</li>`).join('')}</ul>` : '<div class="muted small">None found.</div>'}</div><div class="banner ok">${chip('Completed', 'Saved')}<span>Added to ${esc(S.savedFor)}’s history and local workspace${S.mode === 'live' ? ' and sent to Hindsight memory' : ''}.</span></div>`}
        </section>
      </div>
    </div>`;
  }

  /* ----- overlays ----- */
  function voiceBar() {
    if (!S.voice) return '';
    return `<div class="voicebar" role="status"><span class="vdot"></span><span style="font-size:14px">${esc(S.voiceMsg || 'Listening…')}</span><button class="btn terra" style="border-radius:99px" data-action="voice">Stop</button></div>`;
  }
  function feedback() {
    if (!S.fb) return '';
    return `<div class="scrim" data-action="scrim"><div class="card modal" role="dialog" aria-modal="true"><div class="row-between" style="align-items:flex-start"><div><h2 class="h3" style="font-size:22px">Suggestions & feedback</h2></div><button class="btn2 icon" data-action="closeFb">${CLOSE}</button></div>
      ${S.fbSent ? `<div class="stack"><p class="bp">Thanks! Your feedback reached the developer.</p><button class="btn" data-action="closeFb">Back to dashboard</button></div>` : `<form class="stack" data-form="feedback"><div><div class="lbl">How useful is this dashboard?</div><div class="wrap" style="gap:2px;margin-top:6px">${[1,2,3,4,5].map((n) => `<button type="button" class="star ${n <= S.rating ? 'on' : ''}" data-action="rate" data-n="${n}">★</button>`).join('')}</div></div><div><div class="lbl">Type</div><div class="wrap" style="margin-top:8px">${['Idea','Bug','UI / UX','Other'].map((c) => `<button type="button" class="pill ${S.cat === c ? 'on' : ''}" data-action="cat" data-c="${c}">${c}</button>`).join('')}</div></div><label class="fl">Your suggestion<textarea class="inp" rows="4" data-bind="fbText" required>${esc(S.fbText)}</textarea></label><label class="fl">Email for a reply (optional)<input class="inp" type="email" data-bind="fbEmail" value="${esc(S.fbEmail)}"></label>${S.fbErr ? `<div class="error">${esc(S.fbErr)}</div>` : ''}<button class="btn" type="submit" ${S.fbSending ? 'disabled' : ''}>${S.fbSending ? 'Sending…' : 'Send to developer'}</button></form>`}
    </div></div>`;
  }

  /* ---------------- actions ---------------- */
  async function ensureBrief(id, force) {
    if (!id) return;
    if (S.briefs[id] && !force) { render(); return; }
    const ms = meetingsView(), m = ms.find((x) => x.id === id);
    if (!m) return;
    const c = contactById(m.cid);
    S.briefLoading = true; S.briefErr = ''; if (force) delete S.briefs[id]; render();
    try {
      S.briefs[id] = await API.generateBrief(m, c, { tasks: tasksView(), meetings: ms });
      S.briefAt[id] = new Date();
    } catch (e) { S.briefErr = e.message; }
    S.briefLoading = false; render();
  }

  async function ask(question) {
    const q = (question || '').trim();
    if (!q || S.asking || !S.scopeCid) return;
    const c = contactById(S.scopeCid), list = (S.chat[c.id] = S.chat[c.id] || []);
    const item = { q, pending: true }; list.push(item); S.chatText = ''; S.asking = true; render();
    try {
      const r = await API.askHistory(q, c, { tasks: tasksView(), meetings: meetingsView() });
      item.a = r.a; item.src = r.src;
    } catch (e) {
      item.a = `I couldn’t reach the AI service just now. Your stored contact history is still safe. ${e.message}`;
      item.src = 'Service error';
    }
    item.pending = false; S.asking = false; render();
  }

  function speakBrief() {
    if (!('speechSynthesis' in window)) { alertInline('Text-to-speech is not supported in this browser.'); return; }
    if (S.speaking) { speechSynthesis.cancel(); S.speaking = false; render(); return; }
    const m = meetingsView().find((x) => x.id === S.mid), b = S.briefs[S.mid];
    if (!m || !b) return;
    const text = [`Brief for your meeting with ${m.who} of ${m.co || ''}, ${m.date} at ${m.time}.`, b.who, `Previous meeting: ${b.prev}`, b.you?.length ? `You promised: ${b.you.join('. ')}.` : '', b.pending?.length ? `Pending: ${b.pending.join('. ')}.` : '', `Discuss: ${(b.discuss || []).join('. ')}.`, `Questions: ${(b.qs || []).join(' ')}`].join(' ');
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en-IN'; u.rate = 1.02;
    u.onend = u.onerror = () => { S.speaking = false; render(); };
    S.speaking = true; render(); speechSynthesis.cancel(); speechSynthesis.speak(u);
  }

  function alertInline(msg) {
    S.voice = true; S.voiceMsg = msg; render();
    setTimeout(() => { if (S.voiceMsg === msg) { S.voice = false; render(); } }, 3500);
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  function toggleVoice() {
    if (S.voice) { try { rec?.stop(); } catch (_) {} S.voice = false; render(); return; }
    if (!SR) { alertInline('Voice input is not supported here. Use Chrome or Edge with microphone permission enabled.'); return; }
    rec = new SR(); rec.lang = 'en-IN'; rec.interimResults = true; rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = (e) => {
      const txt = Array.from(e.results).map((r) => r[0].transcript).join('');
      S.voiceMsg = `“${txt}”`; if (e.results[e.results.length - 1].isFinal) finalText = txt; render();
    };
    rec.onerror = (e) => { S.voiceMsg = `Microphone error: ${e.error}. Check browser microphone permission.`; render(); };
    rec.onend = async () => {
      S.voice = false; render();
      const t = finalText.trim(); if (!t) return;
      if (/\b(brief|prepare|prep|next meeting)\b/i.test(t)) {
        const next = nextMeeting(meetingsView());
        if (!next) { alertInline('There is no meeting to prepare for yet. Add meeting details first.'); return; }
        S.view = 'prep'; S.mid = next.id; await ensureBrief(next.id); speakBrief();
      } else { S.view = 'assistant'; render(); await ask(t); }
    };
    S.voice = true; S.voiceMsg = 'Listening… try “Brief me on my next meeting”'; render();
    try { rec.start(); } catch (_) { S.voice = false; alertInline('Could not start the microphone. Check browser permission.'); }
  }

  async function extract() {
    S.notesErr = ''; S.notesMsg = '';
    const text = S.notesText.trim();
    if (!text) { S.notesErr = 'Add notes or upload a PDF/Word transcript or MP4 recording first.'; render(); return; }
    const m = meetingsView().find((x) => x.id === S.notesMid);
    if (!m) { S.notesErr = 'Add meeting details first so the notes can be linked to a contact.'; render(); return; }
    const c = contactById(m.cid);
    S.extracting = true; S.extracted = null; render();
    try {
      const x = await API.extractFromNotes(text, m, c, { consent: S.consent, source: S.notesSource || 'notes' });
      (x.commit || []).forEach((k, i) => S.tasks.push({ id: `t${Date.now()}${i}`, t: k.t, who: k.who === 'You' ? 'You' : c.name, cid: c.id, due: parseDue(k.due), done: false, remind: true }));
      c.history.unshift({ date: fmtDay(new Date()), title: `Meeting notes: ${m.agenda}`, text: x.summary || (x.disc || []).map((d) => d.t).join('. ') || text.slice(0, 500) });
      if (x.disc?.length) c.points = [...new Set([...(c.points || []), ...x.disc.map((d) => d.t)])].slice(0, 20);
      delete S.briefs[m.id];
      S.extracted = { summary: x.summary || '', disc: x.disc || [], commit: x.commit || [], follow: x.follow || [] };
      S.savedFor = c.name;
      persist();
      API.syncContact(c, S.meetings, S.tasks).catch(() => {});
      S.notesMsg = 'Content read successfully. Important discussion points and commitments were extracted.';
    } catch (e) { S.notesErr = e.message; }
    S.extracting = false; render();
  }

  async function handleFile(input) {
    const file = input.files?.[0]; if (!file) return;
    S.notesErr = ''; S.notesMsg = '';
    const kind = input.dataset.file;
    const lower = file.name.toLowerCase();
    try {
      if (kind === 'document') {
        if (!/\.(pdf|doc|docx)$/i.test(lower)) throw new Error('Please upload a PDF or Word document (.pdf, .doc, .docx).');
        S.notesMsg = `Reading ${file.name}…`; render();
        S.notesText = await API.readDocument(file);
        S.notesSource = 'document';
        S.notesMsg = `Read ${file.name}. Review the extracted text, then click Extract & save to memory.`;
      } else if (kind === 'recording') {
        if (!/\.mp4$/i.test(lower)) throw new Error('Please upload an MP4 video recording.');
        if (!S.consent) throw new Error('Tick the consent box before uploading an MP4 recording.');
        S.notesMsg = `Transcribing ${file.name}…`; render();
        S.notesText = await API.transcribe(file, S.consent);
        S.notesSource = 'recording';
        S.notesMsg = `Transcribed ${file.name}. Review the transcript, then click Extract & save to memory.`;
      }
    } catch (e) { S.notesErr = e.message; S.notesMsg = ''; }
    render();
    input.value = '';
  }

  function startNewContact() {
    S.contactEditing = null; S.contactFormOpen = true; S.view = 'contacts'; render();
  }

  function editContact(id) {
    const c = contactById(id); if (!c) return;
    S.cid = id; S.contactEditing = JSON.parse(JSON.stringify(c)); S.contactFormOpen = true; S.view = 'contacts'; render();
  }

  function deleteContact(id) {
    const c = contactById(id); if (!c) return;
    if (!confirm(`Delete ${c.name} and their local contact history, meetings and commitments?`)) return;
    S.contacts = S.contacts.filter((x) => x.id !== id);
    S.meetings = S.meetings.filter((m) => m.cid !== id);
    S.tasks = S.tasks.filter((t) => t.cid !== id);
    S.cid = S.contacts[0]?.id || null; S.scopeCid = S.cid; S.notesMid = null; S.mid = null;
    persist(); render();
  }

  function saveContactFromForm() {
    const c = S.contactEditing || {};
    const name = String(c.name || '').trim();
    if (!name) { alertInline('Full name is required.'); return; }
    c.name = name; c.co = String(c.co || '').trim(); c.role = String(c.role || '').trim();
    c.email = String(c.email || '').trim(); c.phone = String(c.phone || '').trim(); c.style = String(c.style || '').trim();
    c.points = String(c.points || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    c.init = initials(c.name);
    if (!c.id) {
      c.id = `c_${Date.now()}`; c.history = [];
      S.contacts.push(c); S.cid = c.id; S.scopeCid = c.id;
    } else {
      const i = S.contacts.findIndex((x) => x.id === c.id); if (i >= 0) S.contacts[i] = { ...S.contacts[i], ...c };
      S.scopeCid = c.id;
    }
    persist(); S.contactFormOpen = false; S.contactEditing = null;
    API.syncContact(contactById(c.id), S.meetings, S.tasks).catch(() => {});
    render();
  }

  function addMeetingFromNotes() {
    if (!S.meetingForm.cid) { S.notesErr = 'Select a contact for the meeting.'; render(); return; }
    if (!S.meetingForm.dateTime || !S.meetingForm.agenda.trim()) { S.notesErr = 'Add the meeting date/time and agenda.'; render(); return; }
    const m = { id: `m_${Date.now()}`, cid: S.meetingForm.cid, at: new Date(S.meetingForm.dateTime).toISOString(), agenda: S.meetingForm.agenda.trim(), outcome: '' };
    S.meetings.push(m); S.notesMid = m.id; S.mid = m.id; S.meetingFormOpen = false; S.notesErr = '';
    persist(); render();
  }

  /* ---------------- events ---------------- */
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]'); if (!el || el.disabled) return;
    const a = el.dataset.action, id = el.dataset.id;
    if (a === 'scrim' && e.target !== el) return;
    switch (a) {
      case 'go': S.view = el.dataset.view; if (S.view === 'prep' && S.mid) ensureBrief(S.mid); else render(); window.scrollTo(0, 0); break;
      case 'goContacts': S.view = 'contacts'; render(); break;
      case 'newContact': startNewContact(); break;
      case 'cancelContact': S.contactFormOpen = false; S.contactEditing = null; render(); break;
      case 'editContact': editContact(id); break;
      case 'deleteContact': deleteContact(id); break;
      case 'openContact': S.cid = id; S.view = 'contacts'; render(); break;
      case 'pickContact': S.cid = id; S.contactsSearch = ''; render(); break;
      case 'pickAddContact': S.add.cid = id; S.addContactSearch = ''; render(); break;
      case 'pickMeetingContact': S.meetingForm.cid = id; S.meetingContactSearch = ''; render(); break;
      case 'addMeetingForContact': S.meetingForm.cid = id; S.meetingFormOpen = true; S.meetingContactSearch = contactById(id)?.name || ''; S.view = 'notes'; render(); break;
      case 'askAbout': S.scopeCid = id; S.view = 'assistant'; S.contactSearch = ''; render(); break;
      case 'pickScope': S.scopeCid = id; S.contactSearch = ''; S.chatText = ''; render(); break;
      case 'prep': S.mid = id; S.view = 'prep'; ensureBrief(id); window.scrollTo(0, 0); break;
      case 'pickMeeting': S.mid = id; S.notesMid = S.notesMid || id; if ('speechSynthesis' in window) speechSynthesis.cancel(); S.speaking = false; ensureBrief(id); break;
      case 'regen': ensureBrief(S.mid, true); break;
      case 'listen': speakBrief(); break;
      case 'voice': toggleVoice(); break;
      case 'suggest': if (el.dataset.go) S.view = 'assistant'; ask(D.SUGGESTED_QUESTIONS[+el.dataset.i]); break;
      case 'filter': S.filter = el.dataset.f; render(); break;
      case 'toggleArchiveView': S.showArchive = !S.showArchive; render(); break;
      case 'archiveTask': { const t = S.tasks.find((x) => x.id === id); if (t && t.done) t.archived = true; persist(); render(); break; }
      case 'restoreTask': { const t = S.tasks.find((x) => x.id === id); if (t) t.archived = false; persist(); render(); break; }
      case 'pickNotesMeeting': S.notesMid = id; S.mid = id; S.extracted = null; S.notesErr = ''; S.notesMeetingSearch = ''; render(); break;
      case 'toggleAdd': S.addOpen = !S.addOpen; render(); break;
      case 'toggleDone': { const t = S.tasks.find((x) => x.id === id); if (t) t.done = !t.done; persist(); render(); break; }
      case 'toggleRemind': { const t = S.tasks.find((x) => x.id === id); if (t) t.remind = !t.remind; persist(); render(); break; }
      case 'toggleMeetingForm': S.meetingFormOpen = !S.meetingFormOpen; if (S.meetingFormOpen && !S.meetingForm.cid) { S.meetingForm.cid = S.cid || S.contacts[0]?.id || ''; S.meetingContactSearch = contactById(S.meetingForm.cid)?.name || ''; } render(); break;
      case 'addMeetingFromNotes': addMeetingFromNotes(); break;
      case 'openFb': S.fb = true; S.fbSent = false; S.fbErr = ''; render(); break;
      case 'closeFb': case 'scrim': S.fb = false; render(); break;
      case 'rate': S.rating = +el.dataset.n; render(); break;
      case 'cat': S.cat = el.dataset.c; render(); break;
    }
  });

  root.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault();
    switch (f.dataset.form) {
      case 'ask': await ask(S.chatText); break;
      case 'askDash': S.view = 'assistant'; await ask(S.chatText); break;
      case 'extract': await extract(); break;
      case 'contact': saveContactFromForm(); break;
      case 'add': {
        if (!S.add.t.trim() || !S.add.cid) return;
        const c = contactById(S.add.cid);
        S.tasks.push({ id: `t${Date.now()}`, t: S.add.t.trim(), who: S.add.who === 'You' ? 'You' : c.name, cid: c.id, due: S.add.due || null, done: false, remind: true });
        S.add = { t: '', who: 'You', cid: c.id, due: '' }; S.addOpen = false; persist(); render(); break;
      }
      case 'feedback': {
        if (!S.fbText.trim()) { S.fbErr = 'Please write a suggestion first.'; render(); return; }
        S.fbSending = true; S.fbErr = ''; render();
        try { await API.sendFeedback({ rating: S.rating, category: S.cat, message: S.fbText.trim(), email: S.fbEmail.trim() || null, view: S.view, at: new Date().toISOString() }); S.fbSent = true; S.fbText = ''; S.fbEmail = ''; }
        catch (err) { S.fbErr = err.message; }
        S.fbSending = false; render(); break;
      }
    }
  });

  function setNested(key, value) {
    const [rootKey, child] = key.split('.');
    if (rootKey === 'contact') { if (!S.contactEditing) S.contactEditing = {}; S.contactEditing[child] = value; }
    else if (rootKey === 'meetingForm') S.meetingForm[child] = value;
    else if (rootKey === 'add') S.add[child] = value;
    else S[key] = value;
  }
  function bind(el) {
    const key = el.dataset.bind; if (!key) return;
    const val = el.type === 'checkbox' ? el.checked : el.value;
    setNested(key, val); return true;
  }
  root.addEventListener('input', (e) => {
    if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') return;
    bind(e.target);
    const key = e.target.dataset.bind;
    if (['contactSearch', 'contactsSearch', 'addContactSearch', 'meetingContactSearch', 'notesMeetingSearch'].includes(key)) {
      clearTimeout(contactSearchTimer);
      contactSearchTimer = setTimeout(() => render(key), 120);
    }
  });
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.file) { handleFile(el); return; }
    if (bind(el) && (el.dataset.rerender || el.dataset.bind === 'notesMid' || el.type === 'checkbox')) { if (el.dataset.bind === 'notesMid') S.extracted = null; render(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.fb) { S.fb = false; render(); } });

  render();
  API.init().then((mode) => { S.mode = mode; render(); if (mode === 'live') { const n = nextMeeting(meetingsView()); if (n) ensureBrief(n.id); } });
})();
