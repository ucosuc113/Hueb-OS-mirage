function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('fantasmas');
  const S = M.util.score;
  const KEY = 'mirage.ghosts', TTL = 24 * 3600e3, MAX = 12, MIN_LIFE = 1500, RECENT = 30 * 60e3;

  let list = [], layer = null, dead = false, offMenu = [], down = null, tick = 0;
  const known = new Map();                                     // cell id → what the closing event will not tell us (appId, args…)
  const els = new Map();                                       // ghost id → element
  const byId = id => list.find(g => g.id === id);
  const lens = () => (M.lens.current?.id === 'mesa' ? M.lens.current : null);
  const sid = () => M.boot?.sessionCount || 0;                 // cell ids restart every session, so a parent is only valid in the same one
  const keyOf = (appId, args) => appId + '|' + JSON.stringify(args || {});
  const when = t => { const a = M.util.ago(t); return a === 'now' ? 'just now' : a + ' ago'; };
  const save = M.util.debounce(() => { if (!dead) Kernel.prefs.set(KEY, list).catch(() => { }); }, 500);
  const calm = async () => matchMedia('(prefers-reduced-motion: reduce)').matches || (await Kernel.prefs.get('app.config.anim', true)) === false;

  function prune() {
    const now = Date.now();
    list = list.filter(g => now - g.closedAt < TTL);
    if (list.length > MAX) list = list.slice(-MAX);
  }

  /* ── drawing: same torus rule as the cells and the scraps ── */
  function place(g) {
    const el = els.get(g.id), L = lens(); if (!el || !L) return;
    const o = L.near(g.rect), s = el.style;
    s.left = Math.round(g.rect.x + o.x) + 'px'; s.top = Math.round(g.rect.y + o.y) + 'px';
    s.width = Math.round(g.rect.w) + 'px'; s.height = Math.round(g.rect.h) + 'px';
  }
  const placeAll = () => list.forEach(place);

  function sync(born) {
    for (const g of list) {
      let el = els.get(g.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'ghost'; el.dataset.id = g.id;
        el.innerHTML = '<div class="gh-tag"><span class="gh-ico"></span><span class="gh-t"></span></div><div class="gh-ago"></div>';
        el.querySelector('.gh-ico').innerHTML = Kernel.icons.render(g.icon);
        el.querySelector('.gh-t').textContent = g.title;
        layer.appendChild(el); els.set(g.id, el);
        if (born === g.id) {                                   // it appears as the closing sheet finishes melting
          const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mo-close')) || 460;
          el.style.setProperty('--gh-delay', ms + 'ms'); el.classList.add('born');
          el.addEventListener('animationend', () => el.classList.remove('born'), { once: true });
        }
      }
      el.querySelector('.gh-ago').textContent = 'closed ' + when(g.closedAt);
      place(g);
    }
    for (const [id, el] of els) if (!byId(id)) { el.remove(); els.delete(id); }
  }

  /* ── following the cells ── */
  function forgetKey(key) {
    const n = list.length;
    list = list.filter(g => keyOf(g.appId, g.args) !== key);
    if (list.length !== n) { sync(); save(); }
  }
  function snap(id) {                                          // the closing event carries no args: remember them while the cell is alive
    const c = M.cells.get(id); if (!c) return;
    let args = {}; try { args = JSON.parse(JSON.stringify(c.args || {})); } catch { }
    known.set(id, { appId: c.appId, args, t0: c.createdAt || Date.now() });
    forgetKey(keyOf(c.appId, args));                           // opening it again, however it happens, retires its ghost
  }
  async function onRemoved(c) {
    const info = known.get(c.id); known.delete(c.id);
    if (!info || Date.now() - info.t0 < MIN_LIFE) return;
    const g = { id: M.util.uid('g'), appId: info.appId, args: info.args, title: c.title, icon: c.icon, rect: { ...c.rect }, parentId: c.parent || null, sid: sid(), closedAt: Date.now() };
    const quiet = await calm();
    forgetKey(keyOf(g.appId, g.args));                         // one ghost per app + arguments: the newest
    list.push(g); prune(); save(); sync(quiet ? null : g.id);
  }

  /* ── bringing one back ── */
  async function revive(id) {
    const g = byId(id); if (!g) return false;
    list = list.filter(x => x !== g); sync(); save();          // out first, so opening it is not mistaken for a duplicate
    const parent = g.sid === sid() && g.parentId && M.cells.get(g.parentId) ? g.parentId : null;
    try { await M.cells.open(g.appId, { args: g.args, rect: g.rect, parent }); return true; }
    catch (e) { list.push(g); sync(); save(); M.notify('Could not bring it back', e.message); return false; }
  }
  function forget(id) { list = list.filter(g => g.id !== id); sync(); save(); }

  /* ── right click ── */
  function unhook() { offMenu.forEach(f => f()); offMenu = []; }
  function hook(menu) {
    unhook();
    offMenu = [menu.provide('ghost', {
      rank: 10,
      match: t => lens() && t.closest?.('.ghost'),
      items: ({ hit }) => {
        const id = hit.closest('.ghost').dataset.id;
        return [
          { label: 'Bring back', hint: 'click', run: () => revive(id) },
          { label: 'Forget', run: () => forget(id) },
          { sep: true },
          { label: 'Forget all', danger: true, items: [{ label: `Yes, forget ${list.length}`, danger: true, run: () => { list = []; sync(); save(); } }] },
        ];
      },
    })];
  }

  /* ── Wish: `reopen` lists them all; a name finds one; an empty Wish shows the ones closed in the last half hour ── */
  function wishes(q) {
    const recent = [...list].sort((a, b) => b.closedAt - a.closedAt), all = /^(reopen|undo|back|closed)$/i.test(q);
    return recent.map((g, i) => {
      const s = !q ? (Date.now() - g.closedAt < RECENT && i < 3 ? .6 - i * .02 : 0) : all ? .9 - i * .01 : S(q, g.title) * .8;
      return s > .2 ? { title: `Reopen: ${g.title}`, hint: when(g.closedAt), sub: `┆ same place · closed ${when(g.closedAt)}`, icon: g.icon, group: 'Recently closed', score: s, run: () => revive(g.id),
        actions: [{ title: 'Bring back', run: () => revive(g.id) }, { title: 'Forget', run: () => forget(g.id) }] } : null;
    }).filter(Boolean);
  }

  const CSS = `
    #ghosts{position:absolute;left:0;top:0;width:0;height:0;z-index:4;display:none}
    .lens-mesa #ghosts{display:block}
    .ghost{position:absolute;overflow:hidden;cursor:pointer;color:var(--ink2);border:calc(var(--bw) / var(--k, 1)) dashed var(--line);
      transition:color .15s,border-color .15s,background-color .15s}
    .ghost:hover{color:var(--ink);border-color:var(--ink);background:var(--panel)}
    .ghost.born{animation:gh-in 420ms ease-out var(--gh-delay, 0ms) both}
    @keyframes gh-in{from{opacity:0}}
    /* the text keeps a constant size on screen, whatever the zoom of the table */
    .gh-tag{display:flex;align-items:center;gap:calc(8px / var(--k, 1));padding:calc(8px / var(--k, 1)) calc(10px / var(--k, 1));
      font:600 calc(11px / var(--k, 1))/1.2 var(--mono);letter-spacing:.08em;text-transform:uppercase}
    .gh-ico{display:inline-flex;flex:none;width:calc(14px / var(--k, 1));height:calc(14px / var(--k, 1));font-size:calc(14px / var(--k, 1));filter:grayscale(1)}
    .gh-ico svg{fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:square;stroke-linejoin:miter;width:1em;height:1em}
    .gh-t{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .gh-ago{padding:0 calc(10px / var(--k, 1));font:calc(10px / var(--k, 1))/1.4 var(--mono);letter-spacing:.04em}
  `;

  return {
    id: 'ui.fantasmas', name: 'Component · Ghosts',
    async start() {
      dead = false;
      ui.style(CSS);
      layer = document.createElement('div'); layer.id = 'ghosts';
      ui.mount('plane', layer);
      ui.on(layer, 'pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
      ui.on(layer, 'click', e => {
        const el = e.target.closest('.ghost'); if (!el) return;
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;   // that was a pan of the table, not a click
        revive(el.dataset.id);
      });

      ui.defer(M.bus.on('cell:added', c => snap(c.id)));
      ui.defer(M.bus.on('cell:removed', c => { onRemoved(c).catch(() => { }); }));
      ui.defer(M.bus.on('mesa:view', placeAll));
      ui.defer(M.bus.on('lens:changed', placeAll));
      ui.defer(M.intents.provide('ghosts', wishes));

      const api = { list: () => list.map(({ id, appId, title, icon, closedAt }) => ({ id, appId, title, icon, closedAt })), revive, forget: id => { forget(id); return true; } };
      ui.defer(M.svc.provide('ghosts', api));                  // for other components (Wish)
      ui.defer(M.api.register('ghosts', {                      // for cells (the Constellation)
        list: () => api.list(), revive: (ctx, id) => revive(id), forget: (ctx, id) => api.forget(id),
      }, { revive: 'system.config', forget: 'system.config' }));

      const m = M.svc.get('menu'); if (m) hook(m);
      ui.defer(M.bus.on('svc:provided', ({ name } = {}) => { if (name === 'menu') hook(M.svc.get('menu')); }));
      ui.defer(unhook);

      const saved = await Kernel.prefs.get(KEY, []);
      list = (Array.isArray(saved) ? saved : []).filter(g => g && g.id && g.appId && g.rect);
      prune(); sync();
      M.cells.each(c => snap(c.id));                           // cells that were already open when this module (re)started
      tick = setInterval(() => { prune(); sync(); }, 30000);   // keeps "closed 5 min ago" honest and drops the expired
    },
    stop() {
      clearInterval(tick);
      Kernel.prefs.set(KEY, list).catch(() => { });
      dead = true;
      els.clear(); known.clear();
      ui.dispose();
    },
  };
}