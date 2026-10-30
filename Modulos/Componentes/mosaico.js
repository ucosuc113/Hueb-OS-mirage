/* Componente · LENTE MOSAICO
   La prueba de que la capa de lentes funciona: las mismas celdas (sin recargar
   ni un iframe), pero dispuestas en una rejilla automática, estilo "tiling". */
function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('mosaico');
  const TOP = 52, BOTTOM = 64, GAP = 12;
  let root, es, offs = [];

  function relayout() {
    const list = [];
    M.cells.each(c => { if (c.state !== 'stowed') list.push(c); });
    const n = list.length; if (!n) return;
    const W = innerWidth, H = innerHeight - TOP - BOTTOM;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * W / H))), rows = Math.ceil(n / cols);
    const w = (W - GAP * (cols + 1)) / cols, h = (H - GAP * (rows - 1)) / rows;
    list.forEach((c, i) => {
      const s = c.el.style, col = i % cols, row = Math.floor(i / cols);
      /* última fila incompleta: se reparte el ancho entre las que hay */
      const inRow = row === rows - 1 ? n - cols * (rows - 1) : cols;
      const ww = row === rows - 1 ? (W - GAP * (inRow + 1)) / inRow : w;
      s.left = GAP + col * (ww + GAP) + 'px'; s.top = TOP + row * (h + GAP) + 'px'; s.width = ww + 'px'; s.height = h + 'px';
    });
  }

  const lens = {
    id: 'mosaico', name: 'Mosaico',
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
    fit(id) { M.cells.focus(id, { noFrameFocus: true }); },     // ya está todo a la vista
    overview() { },
  };

  let unreg;
  return {
    id: 'ui.lens.mosaico', name: 'Lente · Mosaico',
    start() {
      ui.style('.lens-mosaico .cell-grip{display:none}.lens-mosaico .cell-bar{cursor:default}.lens-mosaico #world::before{opacity:.25}');
      unreg = M.lens.register(lens);
    },
    stop() { unreg && unreg(); es?.dispose(); ui.dispose(); },
  };
}
