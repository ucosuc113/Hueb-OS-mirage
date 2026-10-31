/* ═══════════════════════════════════════════════════════════════
   MIRAGE · L1 · SUBSTRATE
   Runtime with no visual opinions. Defines the 8 "organs" everything else
   rests on: bus, svc, intents, api, caps, tokens, ui, lens
   (+ catalog). It draws nothing by itself: that belongs to layers L3/L4.
   Loaded BEFORE Kernel.js; only touches window.Kernel inside init().
═══════════════════════════════════════════════════════════════ */
;(function (global) {
  'use strict';
  const M = global.Mirage = global.Mirage || {};
  M.version = '0.1.0';
  M.kernel  = null;
  let K = null;

  /* ── util ───────────────────────────────────────────── */
  const U = M.util = {
    esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    uid: (p = 'm') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
    ago(ts) {
      const s = Math.max(0, (Date.now() - ts) / 1000 | 0);
      if (s < 45) return 'now';
      if (s < 3600) return Math.round(s / 60) + ' min';
      if (s < 86400) return Math.round(s / 3600) + ' h';
      return Math.round(s / 86400) + ' d';
    },
    /* Fuzzy score 0..1 of q inside t */
    score(q, t) {
      q = String(q || '').toLowerCase().trim(); t = String(t || '').toLowerCase();
      if (!q) return 0.1;
      if (t === q) return 1;
      if (t.startsWith(q)) return 0.9;
      const i = t.indexOf(q);
      if (i >= 0) return Math.max(0.5, 0.75 - i * 0.01);
      let qi = 0;
      for (const c of t) if (c === q[qi]) qi++;
      return qi === q.length ? 0.35 : 0;
    },
    parseManifest(html) {
      const m = String(html).match(/<script[^>]+id=["']wos-manifest["'][^>]*>([\s\S]*?)<\/script>/i);
      if (!m) return null;
      try { return JSON.parse(m[1].trim()); } catch { return null; }
    },
  };

  /* ── 1. bus: pub/sub propio. Los eventos del Kernel entran como "k:<evento>" ── */
  const topics = new Map();
  M.bus = {
    on(t, fn) {
      if (!topics.has(t)) topics.set(t, new Set());
      topics.get(t).add(fn);
      return () => topics.get(t)?.delete(fn);
    },
    once(t, fn) { const off = this.on(t, d => { off(); fn(d); }); return off; },
    emit(t, d) {
      for (const fn of [...(topics.get(t) || [])]) { try { fn(d); } catch (e) { console.error('[Mirage:bus]', t, e); } }
      for (const fn of [...(topics.get('*') || [])]) { try { fn(t, d); } catch (e) { console.error('[Mirage:bus]*', e); } }
    },
  };
  const KERNEL_TOPICS = [
    'fs:write', 'fs:remove', 'fs:mkdir', 'fs:move',
    'procs:spawn', 'procs:kill', 'procs:update',
    'notifications:push', 'notifications:read',
    'users:login', 'users:profileChanged', 'prefs:change',
    'apps:registered', 'apps:unregistered',
    'permissions:granted', 'permissions:revoked',
    'modules:started', 'modules:stopped',
  ];

  /* ── 2. svc: service locator with waiting ──
     Kernel modules load in arbitrary order; nobody assumes another one
     has already started: ask with `await Mirage.svc.need('name')`. */
  const svcs = new Map(), waiters = new Map();
  M.svc = {
    provide(name, impl) {
      svcs.set(name, impl);
      (waiters.get(name) || []).forEach(w => { clearTimeout(w.t); w.res(impl); });
      waiters.delete(name);
      M.bus.emit('svc:provided', { name });
      return () => { if (svcs.get(name) === impl) { svcs.delete(name); M.bus.emit('svc:withdrawn', { name }); } };
    },
    get: name => svcs.get(name),
    list: () => [...svcs.keys()],
    need(name, ms = 8000) {
      if (svcs.has(name)) return Promise.resolve(svcs.get(name));
      return new Promise((res, rej) => {
        const w = { res, t: setTimeout(() => rej(new Error(`svc.need('${name}'): did not show up within ${ms}ms`)), ms) };
        if (!waiters.has(name)) waiters.set(name, []);
        waiters.get(name).push(w);
      });
    },
  };

  /* ── 3. intents: what the user "wishes". Anyone can provide results. ──
     provider(query) → [{ title, hint?, icon?, score?, group?, run() }] */
  const providers = new Map();
  M.intents = {
    provide(id, fn) { providers.set(id, fn); return () => providers.delete(id); },
    async query(text) {
      const out = [];
      await Promise.all([...providers].map(async ([id, fn]) => {
        try { (await fn(String(text || '').trim()) || []).forEach(r => out.push({ provider: id, score: 0.3, ...r })); }
        catch (e) { console.warn(`[Mirage:intents] ${id}:`, e); }
      }));
      return out.sort((a, b) => b.score - a.score).slice(0, 14);
    },
    async run(result) { if (typeof result?.run === 'function') return result.run(); },
  };

  /* ── 4. api: public surface for cells. Everything goes through caps ── */
  const apis = new Map();
  M.api = {
    register(ns, methods, perms = {}) { apis.set(ns, { methods, perms }); return () => { if (apis.get(ns)?.methods === methods) apis.delete(ns); }; },
    list: () => [...apis].map(([ns, a]) => ({ ns, methods: Object.keys(a.methods).filter(m => !m.startsWith('_')) })),
    async call(ctx, method, params = []) {
      const [ns, fn] = String(method).split('.');
      const a = apis.get(ns);
      if (!a || !fn || fn.startsWith('_') || typeof a.methods[fn] !== 'function') throw new Error(`API not available: ${method}`);
      const perm = a.perms[fn];
      if (perm) await M.caps.require(ctx.cell, perm);
      return a.methods[fn](ctx, ...params);
    },
  };

  /* ── 5. caps: capabilities. User role ∩ the cell's covenant ── */
  M.caps = {
    DESC: {
      'fs.read'            : 'read your files',
      'fs.write'           : 'create and modify files',
      'fs.delete'          : 'delete files',
      'notifications.send' : 'send you alerts',
      'proc.kill'          : 'close processes',
      'system.config'      : 'change the system settings',
      'app.install'        : 'install cells',
    },
    async has(cell, perm) {
      if (!(await K.permissions.currentUserHas(perm))) return false;
      return !!cell.trusted || K.permissions.appHas(cell.appId, perm);
    },
    async require(cell, perm) {
      if (await this.has(cell, perm)) return true;
      // The user's role does not allow it: no covenant can fix that
      if (!(await K.permissions.currentUserHas(perm))) throw new Error(`Permission denied (role): ${perm}`);
      const pact = await M.svc.need('covenant', 1500).catch(() => null);
      const verdict = pact ? await pact.ask(cell, perm) : 'deny';
      if (verdict === 'always') { await K.permissions.grantAppPermission(cell.appId, perm); return true; }
      if (verdict === 'once') return true;
      await K.permissions.requestAppPermission(cell.appId, perm);
      throw new Error(`Permission denied: ${perm}`);
    },
  };

  /* ── 6. tokens: live design variables (written by the "mood" service) ── */
  M.tokens = {
    vars: {}, css: '', base: {},
    /* `bw` (border) = 2 REAL monitor pixels: 2 / devicePixelRatio CSS pixels. */
    set(vars) {
      this.base = vars;
      this.vars = {
        font: 'ui-sans-serif,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
        mono: 'ui-monospace,"Cascadia Mono",Consolas,monospace',
        ...vars, bw: (2 / (global.devicePixelRatio || 1)) + 'px',
      };
      this.css = ':root{' + Object.entries(this.vars).map(([k, v]) => `--${k}:${v}`).join(';') + `;color-scheme:${vars.scheme || 'dark'}}`;
      for (const [k, v] of Object.entries(this.vars)) document.documentElement.style.setProperty('--' + k, v);
      M.bus.emit('tokens', { css: this.css });
    },
  };
  /* If the user changes the browser zoom the DPR changes: borders are recalculated */
  let lastDpr = global.devicePixelRatio;
  global.addEventListener('resize', () => { if (global.devicePixelRatio !== lastDpr) { lastDpr = global.devicePixelRatio; M.tokens.set(M.tokens.base); } });

  /* ── 7. ui: fixed layers + scope with automatic cleanup ──
     UI modules mount on #world / #chrome / #overlay and, when stopped
     (Kernel.modules.stop/restart), dispose() leaves the DOM exactly as it was. */
  M.ui = {
    layer: name => document.getElementById(name),
    scope(owner) {
      const els = new Set(), offs = new Set();
      return {
        style(css) { const s = document.createElement('style'); s.dataset.owner = owner; s.textContent = css; document.head.appendChild(s); els.add(s); return s; },
        mount(layer, el) { document.getElementById(layer).appendChild(el); els.add(el); return el; },
        on(target, ev, fn, opts) { target.addEventListener(ev, fn, opts); offs.add(() => target.removeEventListener(ev, fn, opts)); },
        defer(fn) { offs.add(fn); },
        dispose() {
          offs.forEach(f => { try { f(); } catch { } }); offs.clear();
          els.forEach(e => e.remove()); els.clear();
        },
      };
    },
  };

  /* ── 8. lens: the way cells are laid out in the world ──
     A lens does NOT create or move iframes (moving them would reload them): it only
     decides geometry. Contract: { id, name, icon, enter(), leave(),
     place(cell), suggest?(cell,parent), fit?(id), overview?() } */
  M.lens = {
    _all: new Map(), current: null,
    register(l) {
      const prev = this.current;
      this._all.set(l.id, l);
      M.bus.emit('lens:registered', { id: l.id });
      if (prev && prev.id === l.id) { try { prev.leave?.(); } catch { } this.current = null; this.use(l.id, { force: true }); }
      else if (this._want === l.id) { this._want = null; this.use(l.id); }     // the lens that was restarting is back
      return () => {
        if (this._all.get(l.id) !== l) return;
        const wasCurrent = this.current === l;
        if (wasCurrent) { try { l.leave?.(); } catch { } this.current = null; this._want = l.id; }
        this._all.delete(l.id);
        /* If the lens does not come back (module really stopped), fall back to another after a moment */
        if (wasCurrent) setTimeout(() => {
          if (this.current || !M.kernel?.bootComplete) return;
          const next = [...this._all.keys()][0];
          this._want = null; if (next) this.use(next);
        }, 2500);
        M.bus.emit('lens:unregistered', { id: l.id });
      };
    },
    list: () => [...M.lens._all.values()].map(l => ({ id: l.id, name: l.name, icon: l.icon })),
    async use(id, { force } = {}) {
      const l = this._all.get(id);
      if (!l) throw new Error(`lens.use: '${id}' does not exist`);
      if (this.current === l && !force) return l;
      try { this.current?.leave?.(); } catch (e) { console.error(e); }
      this.current = l;
      document.getElementById('mirage-root').dataset.lens = id;
      await l.enter?.();
      M.cells.each(c => l.place?.(c));
      await K.prefs.set('mirage.lens', id);
      M.bus.emit('lens:changed', { id });
      return l;
    },
    async restore() {
      const want = await K.prefs.get('mirage.lens', 'mesa');
      const id = this._all.has(want) ? want : [...this._all.keys()][0];
      if (id) await this.use(id);
    },
  };

  /* ── catalog: Kernel apps + whatever else their manifest says ──
     The Kernel only keeps a few manifest fields; here the full
     HTML is read to learn `intents`, `permissions`, etc. */
  async function loadAppHtml(app) {
    if (String(app.entry).startsWith('fs:')) return K.fs.read(app.entry.slice(3));
    const r = await fetch(app.entry, { cache: 'no-store' });
    if (!r.ok) throw new Error(`could not read ${app.entry}`);
    return r.text();
  }
  M.loadAppHtml = loadAppHtml;

  const USER_APPS_DIR = '/device/apps';
  async function registerFromHtml(html, entry, sourceFile) {
    const mf = U.parseManifest(html);
    if (!mf || !mf.id) throw new Error('the file has no wos-manifest manifest with an id');
    const existing = await K.apps.get(mf.id);
    if (existing?.meta?.systemApp) throw new Error(`'${mf.id}' is a system app and cannot be replaced`);
    await K.apps.register({
      id: mf.id, name: mf.name || mf.id, version: mf.version || '0.1.0', icon: mf.icon || '▪',
      category: mf.category || 'utility', singleton: !!mf.singleton, entry,
      meta: {
        description: mf.description || '', winWidth: mf.winWidth || 640, winHeight: mf.winHeight || 460,
        author: mf.author || '', sourceFile, systemApp: false, protected: false, userApp: true,
      },
    });
    return mf;
  }

  M.catalog = {
    apps: new Map(),
    get: id => M.catalog.apps.get(id),
    list: () => [...M.catalog.apps.values()],
    /* A user cell is an .html with a manifest inside /device/apps */
    async install(path) {
      const html = await K.fs.read(path);
      const target = `${USER_APPS_DIR}/${K.fs.basename(path)}`;
      if (K.fs.normalize(path) !== target) await K.fs.write(target, html);
      const mf = await registerFromHtml(html, 'fs:' + target, K.fs.basename(target));
      await this.refresh();
      return mf;
    },
    async refresh() {
      let entries = [];
      try { entries = await K.fs.readdir(USER_APPS_DIR); } catch { }
      for (const e of entries) {
        if (e.type !== 'file' || !/\.html?$/i.test(e.name)) continue;
        try { await registerFromHtml(await K.fs.read(e.id), 'fs:' + e.id, e.name); }
        catch (err) { console.warn(`[Mirage:catalog] ${e.name}:`, err.message); }
      }
      this.apps.clear();
      const list = await K.apps.list();
      await Promise.all(list.map(async a => {
        let mf = null;
        try { mf = U.parseManifest(await loadAppHtml(a)); } catch { }
        this.apps.set(a.id, {
          id: a.id, name: a.name || a.id, icon: a.icon || '▪', category: a.category || 'utility',
          description: a.meta?.description || '', singleton: !!a.singleton, entry: a.entry,
          trusted: !!a.meta?.systemApp, userApp: !!a.meta?.userApp,
          keywords: mf?.keywords || [], permissions: mf?.permissions || [],
        });
      }));
      M.bus.emit('catalog:changed');
    },
  };

  /* ── misc ── */
  M.notify = (title, body = '', icon = '') =>
    K.notifications.push({ title, body, icon, category: 'mirage' }).catch(() => { });

  let resolveReady;
  M.ready = new Promise(r => { resolveReady = r; });
  M.boot = null;

  async function onKernelReady(ev) {
    M.boot = ev;
    try {
      await M.catalog.refresh();
      await M.lens.restore();
      if (!ev.safeMode && M.lens.current) await M.cells.restore();
    } catch (e) { console.error('[Mirage] post-ready:', e); }
    M.bus.emit('ready', ev);
    resolveReady(ev);
  }

  /* init() is idempotent: Ignition calls it and so does every module on startup,
     so the load order between scripts, Kernel and modules stops mattering. */
  M.init = function () {
    if (K) return M;
    K = M.kernel = global.Kernel;
    if (!K) throw new Error('Mirage.init: Kernel.js is not loaded');
    for (const t of KERNEL_TOPICS) K.on(t, d => M.bus.emit('k:' + t, d));
    M.cells._start(K);
    K.on('ready', onKernelReady);
    if (K.bootComplete) onKernelReady(K.session);
    return M;
  };
})(window);
