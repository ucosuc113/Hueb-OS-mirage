/* Componente · LENTE MESA
   Un plano infinito: sin escritorio, sin ventanas, sin barra de tareas.
   · arrastrar el fondo = desplazarse   · rueda = zoom hacia el cursor
   · lejos (zoom < 0.45) las celdas colapsan a burbujas (zoom semántico)
   · los "hilos" unen cada celda con el proceso que la abrió (Procs del Kernel)
   · Esc = ver todo, ⤢ / doble clic en la barra = entrar a una celda */
function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('mesa');
  const clamp = M.util.clamp;
  const MINK = 0.12, MAXK = 2.5, GRID = 48, TOP = 48;
  /* Mundo en bucle (toro): salir por un borde = entrar por el opuesto.
     Múltiplos de GRID para que la retícula de puntos no salte al dar la vuelta. */
  const WRAP_W = GRID * 160, WRAP_H = GRID * 120;   // 7680 × 5760 unidades de mundo
  const SEAM = 1200;                                 // celda más grande que no "salta" a la vista al cruzar la costura
  const mod = (v, m) => ((v % m) + m) % m;
  const minK = () => Math.max(MINK, innerWidth / (WRAP_W - SEAM), (innerHeight - TOP) / (WRAP_H - SEAM));
  const centerY = () => (innerHeight + TOP) / 2;

  let root, world, plane, svg, hint, es;
  let view = { x: 0, y: 0, k: 1 };
  let drag = null, offs = [], animTimer = null;
  const saveView = M.util.debounce(() => Kernel.prefs.set('mirage.mesa.view', view).catch(() => { }), 800);

  function applyView() {
    view.k = Math.max(view.k, minK());
    /* re-centra: el punto bajo el centro de la pantalla se mantiene dentro de [0, WRAP).
       Es un desplazamiento de un número entero de "vueltas", así que la imagen no cambia. */
    const cx = (innerWidth / 2 - view.x) / view.k, cy = (centerY() - view.y) / view.k;
    view.x += (cx - mod(cx, WRAP_W)) * view.k;
    view.y += (cy - mod(cy, WRAP_H)) * view.k;

    plane.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`;
    const g = GRID * view.k;
    world.style.setProperty('--grid', g + 'px');
    world.style.setProperty('--gx', (view.x % g) + 'px');
    world.style.setProperty('--gy', (view.y % g) + 'px');
    root.style.setProperty('--k', view.k);
    root.classList.toggle('far', view.k < 0.45);
    M.cells.each(placeEl); threads();     // cada celda salta a su copia más cercana
    saveView();
  }

  /* Desfase (múltiplo de la vuelta) que deja la celda en la copia más cercana al centro de la pantalla */
  function wrapOff(c) {
    const cx = (innerWidth / 2 - view.x) / view.k, cy = (centerY() - view.y) / view.k;
    return {
      x: Math.round((cx - (c.rect.x + c.rect.w / 2)) / WRAP_W) * WRAP_W,
      y: Math.round((cy - (c.rect.y + c.rect.h / 2)) / WRAP_H) * WRAP_H,
    };
  }
  function disp(c) { const o = wrapOff(c); return { x: c.rect.x + o.x, y: c.rect.y + o.y, w: c.rect.w, h: c.rect.h }; }
  function placeEl(c) {
    const o = c._o = wrapOff(c), s = c.el.style;
    s.left = c.rect.x + o.x + 'px'; s.top = c.rect.y + o.y + 'px';
    s.width = c.rect.w + 'px'; s.height = c.rect.h + 'px'; s.zIndex = c.z;
  }
  function animate() { plane.classList.add('anim'); clearTimeout(animTimer); animTimer = setTimeout(() => plane.classList.remove('anim'), 560); }

  function fitRect(r, pad = 56) {
    const vw = innerWidth, vh = innerHeight - TOP;
    view.k = clamp(Math.min((vw - pad * 2) / r.w, (vh - pad) / r.h), minK(), 1.6);
    view.x = vw / 2 - (r.x + r.w / 2) * view.k;
    view.y = TOP + vh / 2 - (r.y + r.h / 2) * view.k;
    animate(); applyView();
  }
  function visibleCells() { const l = []; M.cells.each(c => { if (c.state !== 'stowed') l.push(c); }); return l; }
  function overview() {
    const l = visibleCells();
    if (!l.length) { view = { x: innerWidth / 2, y: innerHeight / 2, k: 1 }; animate(); applyView(); return; }
    const R = l.map(disp);
    const x0 = Math.min(...R.map(r => r.x)), y0 = Math.min(...R.map(r => r.y));
    const x1 = Math.max(...R.map(r => r.x + r.w)), y1 = Math.max(...R.map(r => r.y + r.h));
    fitRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 70);
  }
  function zoomAt(mx, my, f) {
    const k2 = clamp(view.k * f, minK(), MAXK), r = k2 / view.k;
    view.x = mx - (mx - view.x) * r; view.y = my - (my - view.y) * r; view.k = k2;
    applyView();
  }

  function place(c) { placeEl(c); threads(); updateHint(); }

  function threads() {
    if (!svg) return;
    let d = '';
    const seg = (ax, ay, bx, by) => {
      const dx = Math.max(80, Math.abs(bx - ax) * 0.5);
      return `<path d="M${ax} ${ay} C${ax + dx} ${ay},${bx - dx} ${by},${bx} ${by}"/><path class="dot" d="M${bx} ${by}h0"/>`;
    };
    M.cells.each(c => {
      const p = c.parent && M.cells.get(c.parent);
      if (!p || c.state === 'stowed' || p.state === 'stowed') return;
      const a = disp(p), b = disp(c);
      const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
      const sx = Math.round((ax - bx) / WRAP_W) * WRAP_W, sy = Math.round((ay - by) / WRAP_H) * WRAP_H;
      d += seg(ax, ay, bx + sx, by + sy);              // padre → copia más cercana del hijo
      if (sx || sy) d += seg(ax - sx, ay - sy, bx, by); // copia del padre → hijo (el otro lado de la costura)
    });
    svg.innerHTML = d;
  }
  function updateHint() { if (hint) hint.hidden = visibleCells().length > 0; }

  /* ── interacción ── */
  function onDown(e) {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.target.closest('[data-act]') || e.target.closest('#chrome > *, #overlay > *')) return;
    const el = e.target.closest('.cell');
    if (el) {
      const c = M.cells.get(el.dataset.cell);
      M.cells.focus(c.id, { noFrameFocus: true });
      if (e.target.closest('.cell-grip')) drag = { t: 'size', c, sx: e.clientX, sy: e.clientY, w: c.rect.w, h: c.rect.h };
      else if (e.target.closest('.cell-bar')) drag = { t: 'move', c, sx: e.clientX, sy: e.clientY, x: c.rect.x, y: c.rect.y };
      else return;
    } else {
      if (!e.target.closest('#world')) return;
      drag = { t: 'pan', sx: e.clientX, sy: e.clientY, x: view.x, y: view.y };
      world.classList.add('panning');
    }
    root.classList.add('dragging');
    e.preventDefault();
  }
  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (drag.t === 'pan') { view.x = drag.x + dx; view.y = drag.y + dy; applyView(); }
    else if (drag.t === 'move') { drag.c.rect.x = drag.x + dx / view.k; drag.c.rect.y = drag.y + dy / view.k; place(drag.c); }
    else { drag.c.rect.w = Math.max(260, drag.w + dx / view.k); drag.c.rect.h = Math.max(160, drag.h + dy / view.k); place(drag.c); }
  }
  function onUp() {
    if (!drag) return;
    if (drag.t === 'move') {                       // la posición guardada vuelve a [0, WRAP); la vista no cambia
      drag.c.rect.x = mod(drag.c.rect.x, WRAP_W); drag.c.rect.y = mod(drag.c.rect.y, WRAP_H);
      place(drag.c);
    }
    if (drag.t !== 'pan') M.cells.touch(drag.c.id);
    drag = null; root.classList.remove('dragging'); world.classList.remove('panning');
  }
  function onWheel(e) {
    if (e.target.closest('#chrome > *, #overlay > *')) return;
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)));
  }
  function onDbl(e) {
    const bar = e.target.closest('.cell-bar');
    if (bar && !e.target.closest('[data-act]')) { lens.fit(bar.closest('.cell').dataset.cell); return; }
    if (e.target.closest('#world') && !e.target.closest('.cell')) overview();
  }
  function onKey(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const cx = innerWidth / 2, cy = innerHeight / 2;
    if (e.key === 'Escape') overview();
    else if (e.key === '+' || e.key === '=') zoomAt(cx, cy, 1.2);
    else if (e.key === '-') zoomAt(cx, cy, 1 / 1.2);
    else if (e.key === '0') { view.k = 1; animate(); applyView(); }
    else if (e.key.startsWith('Arrow')) {
      const s = 80; if (e.key === 'ArrowLeft') view.x += s; if (e.key === 'ArrowRight') view.x -= s; if (e.key === 'ArrowUp') view.y += s; if (e.key === 'ArrowDown') view.y -= s;
      applyView(); e.preventDefault();
    }
  }

  const lens = {
    id: 'mesa', name: 'Mesa',
    async enter() {
      root = document.getElementById('mirage-root'); world = document.getElementById('world'); plane = document.getElementById('plane');
      view = await Kernel.prefs.get('mirage.mesa.view', null) || { x: innerWidth / 2 - 320, y: 90, k: 1 };
      root.classList.add('lens-mesa');
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('style', 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:1');
      plane.prepend(svg);
      hint = document.createElement('div');
      hint.className = 'mesa-hint';
      hint.innerHTML = '<b>Mirage</b><span><kbd>Ctrl</kbd> <kbd>Espacio</kbd> o escribe para pedir algo</span><span>arrastra el fondo · rueda = zoom · <kbd>Esc</kbd> ver todo</span>';
      es = M.ui.scope('mesa:lens');          // todo lo de la lente muere con leave()
      es.mount('world', hint);
      es.on(world, 'pointerdown', onDown);
      es.on(window, 'pointermove', onMove);
      es.on(window, 'pointerup', onUp);
      es.on(world, 'wheel', onWheel, { passive: false });
      es.on(world, 'dblclick', onDbl);
      es.on(window, 'keydown', onKey);
      es.on(window, 'resize', applyView);
      offs.push(
        M.bus.on('cell:added', c => { place(M.cells.get(c.id)); }),
        M.bus.on('cell:changed', c => { const x = M.cells.get(c.id); x && place(x); }),
        M.bus.on('cell:removed', () => { threads(); updateHint(); }),
      );
      applyView(); M.cells.each(place); threads(); updateHint();
    },
    leave() {
      offs.forEach(f => f()); offs = [];
      root?.classList.remove('lens-mesa', 'far', 'dragging'); root?.style.removeProperty('--k');
      plane.style.transform = 'none'; plane.classList.remove('anim');
      world.style.removeProperty('--grid'); world.style.removeProperty('--gx'); world.style.removeProperty('--gy');
      svg?.remove(); es?.dispose(); es = null; drag = null;
    },
    place,
    suggest(c, parent) {
      if (parent) {
        let sib = 0; M.cells.each(o => { if (o.parent === parent.id) sib++; });   // los hermanos se escalonan
        const pd = disp(parent);                                                  // junto a donde ves al padre
        return { x: pd.x + pd.w + 70 + sib * 36, y: pd.y + 30 + sib * 56 };
      }
      const n = visibleCells().length;
      return { x: (innerWidth / 2 - view.x) / view.k - c.rect.w / 2 + n * 28, y: (innerHeight / 2 - view.y) / view.k - c.rect.h / 2 + n * 28 - 20 };
    },
    fit(id) { const c = M.cells.get(id); if (c) { M.cells.focus(id, { noFrameFocus: true }); fitRect(disp(c)); } },
    overview,
  };
// lol
  let unreg;
  return {
    id: 'ui.lens.mesa', name: 'Lente · Mesa',
    start() {
      ui.style(`
        .mesa-hint{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:8px;
          text-align:center;color:var(--ink2);pointer-events:none;font:11px/1.4 var(--mono);letter-spacing:.06em}
        .mesa-hint[hidden]{display:none}
        .mesa-hint b{font:600 20px/1 var(--mono);letter-spacing:.5em;padding-left:.5em;text-transform:uppercase;color:var(--ink);margin-bottom:10px}
        .mesa-hint kbd{font:inherit;border:var(--bw) solid var(--line);padding:0 5px;border-radius:2px}
        /* hilos: 2 px reales del monitor a cualquier zoom (non-scaling-stroke) */
        #world svg path{fill:none;stroke:var(--ink);stroke-width:2;stroke-dasharray:2 8;opacity:.45;vector-effect:non-scaling-stroke}
        #world svg path.dot{stroke-width:10;stroke-linecap:square;stroke-dasharray:none;opacity:.7}
      `);
      unreg = M.lens.register(lens);
    },
    stop() { unreg && unreg(); es?.dispose(); ui.dispose(); },
  };
}
