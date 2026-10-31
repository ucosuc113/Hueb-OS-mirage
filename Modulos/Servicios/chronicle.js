/* Service · CHRONICLE — time as the axis of the system.
   Listens to the Kernel and keeps a diary of everything that happens; it also stores
   recent versions of text files so you can go back. */
function registerService(Kernel) {
  const M = window.Mirage.init();
  const LOG_CAP = 500, REV_PATHS = 40, REV_KEEP = 6, REV_MAX = 12000;
  const quiet = p => /^\/device\/(system|temp|desktop)(\/|$)/.test(p || '');
  const base = p => String(p).split('/').pop();

  let log = [], revs = {}, offs = [];
  const persist = M.util.debounce(() => {
    Kernel.prefs.set('chronicle.log', log).catch(() => { });
    Kernel.prefs.set('chronicle.revs', revs).catch(() => { });
  }, 1500);

  /* Repeated events (e.g. autosave every 2 s) merge into a single line */
  function add(kind, text, extra = {}) {
    const last = log[log.length - 1];
    if (last && last.kind === kind && extra.path && last.path === extra.path && Date.now() - last.t < 30000) {
      last.t = Date.now(); last.n = (last.n || 1) + 1;
      M.bus.emit('chronicle:entry', last); persist(); return last;
    }
    const e = { id: M.util.uid('e'), t: Date.now(), kind, text, ...extra };
    log.push(e);
    if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP);
    M.bus.emit('chronicle:entry', e); persist();
    return e;
  }

  async function snap(path) {
    try {
      if (await Kernel.fs.isBinary(path)) return;
      const st = await Kernel.fs.stat(path);
      if (!st || st.size > REV_MAX) return;
      const content = await Kernel.fs.read(path);
      const list = revs[path] || (revs[path] = []);
      if (list.length && list[list.length - 1].content === content) return;
      list.push({ t: Date.now(), content });
      if (list.length > REV_KEEP) list.shift();
      const paths = Object.keys(revs);
      if (paths.length > REV_PATHS) {
        paths.sort((a, b) => revs[a][revs[a].length - 1].t - revs[b][revs[b].length - 1].t);
        delete revs[paths[0]];
      }
    } catch { /* the file may have been deleted between the event and the read */ }
  }

  const api = {
    log: (limit = 200) => log.slice(-limit).reverse(),
    paths: () => Object.keys(revs).map(p => ({ path: p, count: revs[p].length, last: revs[p][revs[p].length - 1].t })).sort((a, b) => b.last - a.last),
    revisions: (path) => (revs[path] || []).map(r => ({ t: r.t, size: r.content.length, content: r.content })).reverse(),
    async restore(path, t) {
      const r = (revs[path] || []).find(x => x.t === t);
      if (!r) throw new Error('that version no longer exists');
      await Kernel.fs.write(path, r.content);
      add('restore', `Restored ${base(path)} to ${new Date(t).toLocaleTimeString('en-GB')}`, { path });
      return true;
    },
  };

  let off;
  return {
    id: 'svc.chronicle', name: 'Service · Chronicle',
    async start() {
      log = await Kernel.prefs.get('chronicle.log', []);
      revs = await Kernel.prefs.get('chronicle.revs', {});
      const on = (ev, fn) => offs.push(Kernel.on(ev, fn));

      on('fs:write', ({ path }) => { if (quiet(path)) return; add('write', `Wrote ${base(path)}`, { path }); snap(path); });
      on('fs:remove', ({ path }) => { if (!quiet(path)) add('remove', `Deleted ${base(path)}`, { path }); });
      on('fs:mkdir', ({ path }) => { if (!quiet(path)) add('mkdir', `Created folder ${base(path)}`, { path }); });
      on('fs:move', ({ src, dst }) => {
        if (quiet(src) && quiet(dst)) return;
        if (revs[src]) { revs[dst] = revs[src]; delete revs[src]; }
        add('move', `Moved ${base(src)} → ${dst}`, { path: dst });
      });
      on('procs:spawn', ({ appId }) => { if (appId && !appId.startsWith('/') && M.boot) add('open', `Opened ${appId}`, { appId }); });
      on('procs:kill', ({ appId }) => { if (appId && !appId.startsWith('/') && M.boot) add('close', `Closed ${appId}`, { appId }); });
      on('notifications:push', (n) => { if (n.category !== 'mirage') add('notice', n.title); });
      on('users:login', (u) => add('login', `${u.name}'s session`));
      on('ready', (e) => add('boot', `System started · session #${e.sessionCount}${e.safeMode ? ' (safe mode)' : ''}`));

      off = M.svc.provide('chronicle', api);
    },
    stop() { offs.forEach(f => f()); offs = []; off && off(); persist(); },
  };
}
