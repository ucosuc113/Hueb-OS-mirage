/* ═══════════════════════════════════════════════════════════════
   MIRAGE · L2 · CELL HOST
   A cell = a Kernel process (Procs) + an isolated iframe + a card
   in the DOM. This file owns all three and keeps them in sync:
   killing the process closes the card and vice versa.
   Geometry is NOT decided here (that belongs to the active lens).
═══════════════════════════════════════════════════════════════ */
;(function (global) {
  'use strict';
  const M = global.Mirage = global.Mirage || {};
  const U = M.util;
  let K = null;

  const cells = new Map();          // id → celda interna
  let seq = 0, zTop = 10, focusedId = null;

  const SANDBOX_TRUSTED   = 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads';
  const SANDBOX_UNTRUSTED = 'allow-scripts allow-forms allow-modals allow-downloads';   // opaque origin: IPC only

  const textCache = {};
  async function fetchText(url) {
    if (!textCache[url]) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('could not read ' + url); textCache[url] = await r.text(); }
    return textCache[url];
  }

  const pub = c => ({
    id: c.id, appId: c.appId, pid: c.pid, title: c.title, icon: c.icon, state: c.state,
    rect: { ...c.rect }, parent: c.parent, trusted: c.trusted, z: c.z, focused: c.id === focusedId,
  });
  const send = (c, event, data) => { try { c.frame?.contentWindow?.postMessage({ mirage: 1, t: 'event', event, data }, '*'); } catch { } };

  /* ── DOM of a cell ── */
  function buildEl(c) {
    const el = document.createElement('section');
    el.className = 'cell'; el.dataset.cell = c.id;
    el.innerHTML =
      '<header class="cell-bar"><span class="cell-ico"></span><span class="cell-title"></span>' +
      '<span class="cell-btns"><button data-act="fit" title="Enter / fit">□</button>' +
      '<button data-act="stow" title="Put in the pocket">–</button>' +
      '<button data-act="close" title="Close">×</button></span></header>' +
      '<div class="cell-body"><iframe></iframe><div class="cell-bubble"><span class="b-ico"></span><span class="b-title"></span></div></div>' +
      '<i class="cell-grip"></i>';
    return el;
  }
  function paint(c) {
    const ico = K.icons.render(c.icon);          // no size: the CSS sizes it (1em)
    c.el.querySelector('.cell-ico').innerHTML = ico;
    c.el.querySelector('.cell-title').textContent = c.title;
    c.el.querySelector('.b-ico').innerHTML = ico;
    c.el.querySelector('.b-title').textContent = c.title;
  }

  /* ── srcdoc: the app's HTML + <base> + tokens + kit + SDK ──
     srcdoc is used (not navigation): iframe navigation does not go through the
     bootloader's Service Worker, but fetch() does — see ARCHITECTURE.md. */
  async function buildSrcdoc(app) {
    const [html, sdk, kit] = await Promise.all([M.loadAppHtml(app), fetchText('./mirage/sdk.js'), fetchText('./mirage/kit.css')]);
    const base = new URL(String(app.entry).startsWith('fs:') ? './' : app.entry, document.baseURI).href;
    const inject = `<base href="${U.esc(base)}"><style id="mirage-tokens">${M.tokens.css}</style><style>${kit}</style><script>${sdk}<\/script>`;
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + inject) : inject + html;
  }

  function defaultRect(app) { return { x: 0, y: 0, w: app.meta?.winWidth || 640, h: app.meta?.winHeight || 460 }; }
  const persist = U.debounce(() => {
    if (!K || !M.boot || M.boot.safeMode) return;
    const list = [...cells.values()];
    K.prefs.set('mirage.session', {
      cells: list.map(c => ({ appId: c.appId, rect: c.rect, state: c.state, args: c.args, p: c.parent ? list.findIndex(x => x.id === c.parent) : null })),
    }).catch(() => { });
  }, 700);

  /* ── Public cell API ── */
  M.cells = {
    each: fn => cells.forEach(fn),
    get: id => cells.get(id),
    list: () => [...cells.values()].map(pub),
    byPid: pid => [...cells.values()].find(c => c.pid === pid),
    get focusedId() { return focusedId; },

    async open(appId, opts = {}) {
      const app = await K.apps.get(appId);
      if (!app) throw new Error(`cells.open: app '${appId}' does not exist`);

      if (app.singleton) {
        const ex = [...cells.values()].find(c => c.appId === appId);
        if (ex) { this.unstow(ex.id); this.focus(ex.id); if (opts.args) send(ex, 'args', opts.args); M.lens.current?.fit?.(ex.id); return ex; }
      }

      const parent = opts.parent ? cells.get(opts.parent) : null;
      const proc = K.procs.spawn(appId, {
        title: app.name || appId, icon: app.icon, parentPid: parent ? parent.pid : null,
        cwd: opts.args?.startPath || '/device',
      });
      const c = {
        id: 'c' + (++seq), appId, pid: proc.pid, title: app.name || appId, icon: app.icon || '▪',
        args: opts.args || {}, trusted: !!app.meta?.systemApp, parent: parent?.id || null,
        state: 'open', rect: opts.rect ? { ...opts.rect } : defaultRect(app), z: ++zTop,
        el: null, frame: null, subs: new Set(), createdAt: Date.now(),
      };
      if (!opts.rect) { const p = M.lens.current?.suggest?.(c, parent); if (p) { c.rect.x = p.x; c.rect.y = p.y; } }

      let srcdoc;
      try { srcdoc = await buildSrcdoc(app); }
      catch (e) { K.procs.kill(proc.pid, { force: true }); M.notify(`Could not open ${app.name || appId}`, e.message, '⚠'); throw e; }

      c.el = buildEl(c);
      paint(c);
      document.getElementById('plane').appendChild(c.el);
      c.frame = c.el.querySelector('iframe');
      c.frame.setAttribute('sandbox', c.trusted ? SANDBOX_TRUSTED : SANDBOX_UNTRUSTED);
      cells.set(c.id, c);
      K.procs.update(proc.pid, { window: { id: c.id } });
      c.frame.srcdoc = srcdoc;

      M.lens.current?.place?.(c);
      c.el.style.zIndex = c.z;
      M.bus.emit('cell:added', pub(c));
      if (!opts.restore) this.focus(c.id);
      persist();
      return c;
    },

    focus(id, { noFrameFocus } = {}) {
      const c = cells.get(id); if (!c) return false;
      if (c.state === 'stowed') this.unstow(id);
      c.z = ++zTop; c.el.style.zIndex = c.z;
      const changed = focusedId !== id;
      focusedId = id;
      cells.forEach(o => o.el.classList.toggle('focused', o.id === id));
      if (!noFrameFocus) { try { c.frame.contentWindow.focus(); } catch { } }
      if (changed) M.bus.emit('cell:focused', pub(c));
      return true;
    },

    stow(id) {
      const c = cells.get(id); if (!c || c.state === 'stowed') return false;
      c.state = 'stowed'; c.el.classList.add('stowed');
      if (focusedId === id) { focusedId = null; const top = [...cells.values()].filter(o => o.state !== 'stowed').sort((a, b) => b.z - a.z)[0]; if (top) this.focus(top.id, { noFrameFocus: true }); }
      M.lens.current?.place?.(c);
      M.bus.emit('cell:changed', pub(c)); persist(); return true;
    },

    unstow(id) {
      const c = cells.get(id); if (!c || c.state !== 'stowed') return false;
      c.state = 'open'; c.el.classList.remove('stowed');
      M.lens.current?.place?.(c);
      M.bus.emit('cell:changed', pub(c)); persist(); return true;
    },

    /* Close = kill the process; the procs:kill listener destroys the card
       (and its children's, because Procs.kill cascades). */
    close(id) {
      const c = cells.get(id); if (!c) return false;
      K.procs.kill(c.pid, { force: true });
      if (cells.has(id)) this._destroy(c);
      return true;
    },

    _destroy(c) {
      if (!cells.has(c.id)) return;
      cells.delete(c.id);
      try { c.frame.srcdoc = ''; } catch { }
      c.el.remove();
      if (focusedId === c.id) focusedId = null;
      M.bus.emit('cell:removed', pub(c));
      persist();
    },

    /* For whoever changes rect/title from outside (lenses, apps) */
    touch(id) { const c = cells.get(id); if (c) { M.bus.emit('cell:changed', pub(c)); persist(); } },
    setTitle(id, title) {
      const c = cells.get(id); if (!c) return;
      c.title = String(title || c.title).slice(0, 80);
      paint(c); K.procs.update(c.pid, { title: c.title }); this.touch(id);
    },
    setIcon(id, icon) { const c = cells.get(id); if (!c) return; c.icon = icon; paint(c); K.procs.update(c.pid, { icon }); this.touch(id); },

    async restore() {
      const s = await K.prefs.get('mirage.session', null);
      if (!s?.cells?.length) return 0;
      const ids = [];
      for (const [i, d] of s.cells.entries()) {
        try {
          const c = await this.open(d.appId, { args: d.args, rect: d.rect, parent: d.p != null ? ids[d.p] : null, restore: true });
          ids[i] = c.id;
          if (d.state === 'stowed') this.stow(c.id);
        } catch (e) { console.warn('[Mirage:cells] restore:', d.appId, e.message); }
      }
      return ids.length;
    },

    _start(kernel) {
      K = kernel;

      /* A process killed from outside (Constellation, Procs.kill) closes its cell */
      K.on('procs:kill', ({ pid }) => { const c = this.byPid(pid); if (c) this._destroy(c); });

      /* Files, shortcuts, etc. ask for apps through this Kernel event */
      K.on('shell:launch', ({ appId, filePath, startPath }) => {
        this.open(appId, { args: { filePath, startPath } }).catch(e => console.warn('[Mirage:cells] shell:launch:', e.message));
      });

      /* Compatibility: the Kernel expects a window "driver" */
      K.windows.registerDriver({
        list: () => this.list(),
        getState: pid => { const c = this.byPid(pid); return c ? pub(c) : null; },
        focus: pid => { const c = this.byPid(pid); return c ? this.focus(c.id) : false; },
        minimize: pid => { const c = this.byPid(pid); return c ? this.stow(c.id) : false; },
        close: pid => { const c = this.byPid(pid); return c ? this.close(c.id) : false; },
      });

      /* A click inside an iframe does not bubble to the parent: it is detected through the focus change */
      global.addEventListener('blur', () => setTimeout(() => {
        const a = document.activeElement;
        if (a && a.tagName === 'IFRAME') { const c = [...cells.values()].find(x => x.frame === a); if (c && c.id !== focusedId) this.focus(c.id, { noFrameFocus: true }); }
      }, 0));

      /* Card bar actions (independent of the lens) */
      document.addEventListener('click', e => {
        const btn = e.target.closest?.('.cell [data-act]');
        const bubble = e.target.closest?.('.cell-bubble');
        const el = e.target.closest?.('.cell');
        if (!el) return;
        const id = el.dataset.cell;
        if (btn) { const act = btn.dataset.act; if (act === 'close') this.close(id); else if (act === 'stow') this.stow(id); else if (act === 'fit') M.lens.current?.fit?.(id); }
        else if (bubble) { this.focus(id, { noFrameFocus: true }); M.lens.current?.fit?.(id); }
      });

      /* Every token change reaches the cells; so does any topic they subscribe to */
      M.bus.on('tokens', ({ css }) => cells.forEach(c => send(c, 'tokens', { css })));
      M.bus.on('*', (topic, data) => cells.forEach(c => { if (c.subs.has(topic)) send(c, topic, data); }));

      global.addEventListener('message', onMessage);
    },
  };

  /* ── IPC: every call from a cell arrives here ── */
  function cellBySource(src) { for (const c of cells.values()) if (c.frame && c.frame.contentWindow === src) return c; return null; }

  async function onMessage(ev) {
    const d = ev.data;
    if (!d || d.mirage !== 1) return;
    const c = cellBySource(ev.source);
    if (!c) return;                                   // only cells the shell opened are served
    if (d.t === 'ready') {
      c.frame.contentWindow.postMessage({ mirage: 1, t: 'hello', data: { cellId: c.id, appId: c.appId, args: c.args, trusted: c.trusted, css: M.tokens.css, theme: M.tokens.vars } }, '*');
    } else if (d.t === 'key') {
      M.bus.emit('key:' + d.key, { cell: c.id });
    } else if (d.t === 'call') {
      const reply = (ok, v) => ev.source.postMessage({ mirage: 1, t: 'ret', id: d.id, ok, [ok ? 'result' : 'error']: v }, '*');
      try { reply(true, await M.api.call({ cell: c, appId: c.appId, trusted: c.trusted }, d.method, d.params || [])); }
      catch (e) { reply(false, String(e?.message || e)); }
    }
  }

  /* Topics a cell may subscribe to */
  async function topicAllowed(c, topic) {
    if (topic.startsWith('k:fs:')) return M.caps.has(c, 'fs.read');
    if (topic.startsWith('k:prefs:') || topic.startsWith('k:users:')) return c.trusted;
    return /^(k:|cell:|chronicle:|lens:|catalog:)/.test(topic);
  }
  M.api.register('events', {
    async sub(ctx, topic) { if (await topicAllowed(ctx.cell, String(topic))) ctx.cell.subs.add(String(topic)); return true; },
    async unsub(ctx, topic) { ctx.cell.subs.delete(String(topic)); return true; },
  });
})(window);
