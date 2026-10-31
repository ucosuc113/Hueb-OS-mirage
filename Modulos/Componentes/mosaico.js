function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('mosaico');
  const TOP = 52, BOTTOM = 64, GAP = 12;
  let root, es, offs = [], order = [], offMenu = [];

  /* the visible cells, in the order the user arranged; the ones never moved keep their creation order, after the arranged ones */
  function sorted() {
    const list = [];
    M.cells.each(c => { if (c.state !== 'stowed') list.push(c); });
    const rank = c => { const i = order.indexOf(c.id); return i < 0 ? Infinity : i; };
    return list.map((c, k) => ({ c, k })).sort((a, b) => (rank(a.c) - rank(b.c)) || (a.k - b.k)).map(x => x.c);
  }

  function relayout() {
    const list = sorted();
    const n = list.length; if (!n) return;
    const W = innerWidth, H = innerHeight - TOP - BOTTOM;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * W / H))), rows = Math.ceil(n / cols);
    const w = (W - GAP * (cols + 1)) / cols, h = (H - GAP * (rows - 1)) / rows;
    list.forEach((c, i) => {
      const s = c.el.style, col = i % cols, row = Math.floor(i / cols);
      /* incomplete last row: the width is shared among the cells it has */
      const inRow = row === rows - 1 ? n - cols * (rows - 1) : cols;
      const ww = row === rows - 1 ? (W - GAP * (inRow + 1)) / inRow : w;
      s.left = GAP + col * (ww + GAP) + 'px'; s.top = TOP + row * (h + GAP) + 'px'; s.width = ww + 'px'; s.height = h + 'px';
    });
  }

  /* ── right click ── */
  function move(id, d) {
    const ids = sorted().map(c => c.id), i = ids.indexOf(id), j = Math.max(0, Math.min(ids.length - 1, i + d));
    if (i < 0 || i === j) return;
    ids.splice(j, 0, ids.splice(i, 1)[0]);
    order = ids; relayout();
  }
  function cellItems(id) {
    const ids = sorted().map(c => c.id), i = ids.indexOf(id);
    return [
      { label: 'Move earlier', disabled: i <= 0, run: () => move(id, -1) },
      { label: 'Move later', disabled: i < 0 || i >= ids.length - 1, run: () => move(id, 1) },
      { label: 'Make it first', disabled: i <= 0, run: () => move(id, -Infinity) },
      { label: 'Keep only this one', hint: 'stows the rest', disabled: ids.length < 2, run: () => ids.filter(x => x !== id).forEach(x => M.cells.stow(x)) },
    ];
  }
  const gapItems = () => [
    { label: 'Stow all', run: () => M.cells.list().forEach(c => M.cells.stow(c.id)) },
    { label: 'Reset the order', disabled: !order.length, run: () => { order = []; relayout(); } },
  ];
  const unhook = () => { offMenu.forEach(f => f()); offMenu = []; };
  function hook(menu) {
    unhook();
    offMenu = [menu.provide('mosaico-cell', {                        // a title bar: Mosaic's entries first, the cell's own follow
      rank: 15, inherit: true,
      match: t => M.lens.current?.id === 'mosaico' && t.closest?.('.cell-bar'),
      items: ({ hit }) => cellItems(hit.closest('.cell').dataset.cell),
    })];
  }

  const lens = {
    id: 'mosaico', name: 'Mosaic',
    enter() {
      root = document.getElementById('mirage-root');
      root.classList.add('lens-mosaico');
      document.getElementById('plane').style.transform = 'none';
      es = M.ui.scope('mosaico:lens');
      es.on(window, 'resize', relayout);
      offs.push(M.bus.on('cell:added', relayout), M.bus.on('cell:changed', relayout), M.bus.on('cell:removed', relayout));
      relayout();
    },
    leave() { offs.forEach(f => f()); offs = []; es?.dispose(); es = null; root?.classList.remove('lens-mosaico'); },
    place: relayout,
    fit(id) { M.cells.focus(id, { noFrameFocus: true }); },     // everything is already in view
    overview() { },
    menu: () => gapItems(),
  };

  let unreg;
  return {
    id: 'ui.lens.mosaico', name: 'Lens · Mosaic',
    start() {
      ui.style('.lens-mosaico .cell-grip{display:none}.lens-mosaico .cell-bar{cursor:default}.lens-mosaico #world::before{opacity:.25}');
      unreg = M.lens.register(lens);
      const m = M.svc.get('menu'); if (m) hook(m);
      ui.defer(M.bus.on('svc:provided', ({ name } = {}) => { if (name === 'menu') hook(M.svc.get('menu')); }));
      ui.defer(unhook);
    },
    stop() { unreg && unreg(); es?.dispose(); ui.dispose(); },
  };
}