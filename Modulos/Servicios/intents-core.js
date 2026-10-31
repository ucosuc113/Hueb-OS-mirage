/* Service · CORE WISHES — the intent providers that ship with the system.
   There is no start menu: everything the system can do comes in through here.
   Any other module can add its own with Mirage.intents.provide(). */
function registerService(Kernel) {
  const M = window.Mirage.init();
  const S = M.util.score;
  const offs = [];

  const SAFE_MATH = /^[\d\s+\-*/().,%^]+$/;
  function calc(q) {
    if (!SAFE_MATH.test(q) || !/[+\-*/%^]/.test(q.replace(/^\s*-/, '')) || !/\d/.test(q)) return null;
    try {
      const v = Function('"use strict";return (' + q.replace(/,/g, '.').replace(/\^/g, '**') + ')')();
      return typeof v === 'number' && isFinite(v) ? v : null;
    } catch { return null; }
  }
  const quiet = p => /^\/device\/(system|temp|desktop)(\/|$)/.test(p);
  const verb = (q, ...names) => { const m = q.match(new RegExp('^(?:' + names.join('|') + ')\\s+(.+)$', 'i')); return m ? m[1].trim() : null; };

  /* 1 · Apps */
  offs.push(M.intents.provide('apps', (q) => M.catalog.list().map(a => {
    const hay = [a.name, a.id, a.category, a.description, ...a.keywords];
    const score = q ? Math.max(...hay.map((t, i) => S(q, t) * (i === 0 ? 1 : 0.8))) : 0.5;
    return score > 0.2 ? {
      title: a.name, hint: a.userApp ? 'user cell' : a.description || a.category, icon: a.icon, group: 'Cells', score,
      run: () => M.cells.open(a.id),
    } : null;
  }).filter(Boolean)));

  /* 2 · Files: search by name under /device */
  offs.push(M.intents.provide('files', async (q) => {
    if (q.length < 2) return [];
    const nodes = await Kernel.db.list(Kernel.STORES.FS);
    return nodes.filter(n => n.type !== 'shortcut' && !quiet(n.id) && n.id !== '/device')
      .map(n => ({ n, s: S(q, n.name) })).filter(x => x.s > 0.3).sort((a, b) => b.s - a.s).slice(0, 5)
      .map(({ n, s }) => ({
        title: n.name, hint: n.id, group: 'Files', score: s * 0.85,
        run: () => n.type === 'dir' ? M.cells.open('files', { args: { startPath: n.id } }) : Kernel.openFile(n.id),
      }));
  }));

  /* 3 · Verbs and math */
  offs.push(M.intents.provide('verbs', async (q) => {
    const out = [];
    const v = calc(q);
    if (v !== null) out.push({ title: `= ${v}`, hint: 'Enter copies the result', group: 'Math', score: 0.95, run: () => navigator.clipboard?.writeText(String(v)).catch(() => { }) });

    const note = verb(q, 'note', 'n');
    if (note) out.push({ title: `Note: ${note}`, hint: 'creates a file in /device/docs', group: 'Actions', score: 0.97, run: async () => {
      const path = `/device/docs/note-${Date.now().toString(36)}.txt`;
      await Kernel.fs.write(path, note);
      M.notify('Note saved', path);
    } });

    const lens = verb(q, 'lens', 'view');
    if (lens) for (const l of M.lens.list()) if (S(lens, l.id) > 0.3 || S(lens, l.name) > 0.3)
      out.push({ title: `Lens: ${l.name}`, group: 'Actions', score: 0.96, run: () => M.lens.use(l.id) });

    const mood = verb(q, 'mood', 'light', 'theme');
    if (mood) { const svc = M.svc.get('mood'); if (svc) for (const m of svc.list()) if (S(mood, m.id) > 0.3 || S(mood, m.name) > 0.3)
      out.push({ title: `Mood: ${m.name}`, group: 'Actions', score: 0.96, run: () => svc.set(m.id) }); }

    const inst = verb(q, 'install');
    if (inst) out.push({ title: `Install cell from ${inst}`, hint: 'copies the .html to /device/apps and registers it', group: 'Actions', score: 0.96, run: async () => {
      const mf = await M.catalog.install(inst);
      M.notify('Cell installed', `${mf.name || mf.id} is now in the Wish`);
    } });

    if (/^(overview|see all|view all|all)$/i.test(q)) out.push({ title: 'See the whole world', group: 'Actions', score: 0.96, run: () => M.lens.current?.overview?.() });
    if (/^(close all|clear)$/i.test(q)) out.push({ title: 'Close all cells', group: 'Actions', score: 0.96, run: () => M.cells.list().forEach(c => M.cells.close(c.id)) });
    if (/^(reload|restart) ?(shell|interface)?$/i.test(q)) out.push({ title: 'Reload the interface', hint: 'restarts the components without restarting the Kernel', group: 'Actions', score: 0.96, run: async () => {
      for (const m of Kernel.modules.list('componente')) await Kernel.modules.restart(m.path);
    } });
    if (/^(time|date|clock)$/i.test(q)) out.push({ title: new Date().toLocaleString('en-GB'), group: 'Info', score: 0.9 });
    return out;
  }));

  return { id: 'svc.intents-core', name: 'Service · Core wishes', start() { }, stop() { offs.forEach(f => f()); } };
}
