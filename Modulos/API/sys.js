/* API · sys / store / notify / chronicle — el resto de la superficie pública. */
function registerAPI(Kernel) {
  const M = window.Mirage.init();
  const offs = [];
  const plainProc = ({ children, window: w, ...p }) => ({ ...p, children: [...(children || [])], window: w?.id || null });

  const sys = {
    async info() {
      return {
        kernel: Kernel.version, build: Kernel.build.buildId, mirage: M.version,
        uptime: Kernel.uptimeSeconds, session: Kernel.session, user: await Kernel.users.current(),
        safeMode: Kernel.safeMode, apps: M.catalog.list().length, cells: M.cells.list().length,
      };
    },
    procs: () => Kernel.procs.list().map(plainProc),
    async kill(ctx, pid) {
      if (!(await Kernel.permissions.canKillProcess(pid))) throw new Error('ese proceso está protegido');
      return Kernel.procs.kill(pid);
    },
    modules: () => Kernel.modules.list(),
    async restartModule(ctx, path) { return !!(await Kernel.modules.restart(path)); },
    appearance() {
      const mood = M.svc.get('mood');
      return { mood: mood?.get(), moods: mood?.list() || [], lens: M.lens.current?.id, lenses: M.lens.list() };
    },
    async setMood(ctx, id) { await (await M.svc.need('mood')).set(id); return true; },
    async setLens(ctx, id) { await M.lens.use(id); return true; },
    async grants() {
      const all = (await Kernel.prefs.get('permissions.apps', null)) || {};
      return Object.entries(all).map(([appId, g]) => ({ appId, name: M.catalog.get(appId)?.name || appId, granted: g.granted || [], requested: g.requested || [] }));
    },
    async revoke(ctx, appId, perm) { await Kernel.permissions.revokeAppPermission(appId, perm); return true; },
    profile: () => Kernel.users.current(),
    updateProfile: (ctx, patch) => Kernel.users.updateProfile({ name: String(patch.name || '').slice(0, 40) || undefined, avatar: patch.avatar || undefined }),
  };
  const sysPerms = { kill: 'proc.kill', restartModule: 'system.config', setMood: 'system.config', setLens: 'system.config', revoke: 'system.config', updateProfile: 'system.config' };

  /* store: preferencias privadas de cada app (clave prefijada con su id) */
  const k = (ctx, key) => `app.${ctx.appId}.${String(key).slice(0, 80)}`;
  const store = {
    get: (ctx, key, def = null) => Kernel.prefs.get(k(ctx, key), def),
    async set(ctx, key, val) { await Kernel.prefs.set(k(ctx, key), val); return true; },
    async del(ctx, key) { await Kernel.prefs.delete(k(ctx, key)); return true; },
  };

  const notify = {
    async send(ctx, { title, body, icon } = {}) {
      const n = await Kernel.notifications.push({ title: String(title || ''), body: String(body || ''), icon: icon || M.catalog.get(ctx.appId)?.icon || '', appId: ctx.appId, category: 'app' });
      return n.id;
    },
    list: (ctx, limit = 20) => Kernel.notifications.list({ limit }),
  };

  const chron = {
    log: async (ctx, limit) => (await M.svc.need('chronicle')).log(limit),
    paths: async () => (await M.svc.need('chronicle')).paths(),
    revisions: async (ctx, path) => (await M.svc.need('chronicle')).revisions(path),
    restore: async (ctx, path, t) => (await M.svc.need('chronicle')).restore(path, t),
  };

  return {
    id: 'api.sys', name: 'API · Sistema',
    start() {
      offs.push(
        M.api.register('sys', sys, sysPerms),
        M.api.register('store', store),
        M.api.register('notify', notify, { send: 'notifications.send' }),
        M.api.register('chronicle', chron, { log: 'fs.read', paths: 'fs.read', revisions: 'fs.read', restore: 'fs.write' }),
      );
    },
    stop() { offs.forEach(f => f()); offs.length = 0; },
  };
}
