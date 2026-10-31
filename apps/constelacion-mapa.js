/* Constellation · MAP — cells, threads, files and time as a force graph. Loaded by constelacion.html.
   · square = a cell (dashed outline when it is in the pocket) · small dashed rectangle = a file (double outline: pinned on the table)
   · dashed line ending in a square = a thread (who opened whom) · dotted line = "this cell has that file open"
   · time is the radius: what happened just now sits near the centre, older things drift out to the rim (rings: 5 min · 30 min · 2 h)
   Drag a node to hold it in place (double click releases it) · drag the background to pan · wheel to zoom · right click for its menu. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const cv = $('map'), box = $('mapbox'), tip = $('tip'), info = $('mapinfo'), g = cv.getContext('2d');
  const R0 = 56, R1 = 250, TAU = 25 * 60e3, UNKNOWN = 2 * 3600e3, MAX_RECENT = 12;
  const HALF = { cell: [9, 9], file: [5, 6.5], svc: [3, 3] };
  const RINGS = [[5 * 60e3, '5 min'], [30 * 60e3, '30 min'], [2 * 3600e3, '2 h']];
  const mono = 'ui-monospace,"Cascadia Mono",Consolas,monospace';
  const base = p => String(p).split('/').pop();
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const ago = t => { const s = (Date.now() - t) / 1000 | 0; return s < 60 ? s + 's' : s < 3600 ? (s / 60 | 0) + 'm' : (s / 3600 | 0) + 'h'; };
  const radiusOf = age => R0 + (R1 - R0) * (1 - Math.exp(-age / TAU));
  const fadeOf = age => .4 + .6 * Math.exp(-age / (45 * 60e3));
  const ageOf = n => Date.now() - (n.t || Date.now() - UNKNOWN);

  let nodes = new Map(), edges = [], view = { x: 0, y: 0, k: 1 }, alpha = 1, raf = 0;
  let showSvc = false, showFiles = true, hover = null, drag = null, fitted = false, C = null, flashT = 0;

  /* ── colours come from the tokens, so the map follows the mood ── */
  function colors() {
    if (C) return C;
    const s = getComputedStyle(document.documentElement), v = k => s.getPropertyValue(k).trim();
    return (C = { ink: v('--ink'), ink2: v('--ink2'), line: v('--line'), edge: v('--edge'), cell: v('--cell-bg'), bw: parseFloat(v('--bw')) || 2 });
  }

  /* ── data → graph. Nodes keep their position between refreshes (they are keyed). ── */
  async function load() {
    if (box.hidden) return;
    let procs, cells, scraps, log;
    try {
      [procs, cells, scraps, log] = await Promise.all([
        Mirage.sys.procs(), Mirage.cell.list(),
        Mirage.scraps.list().catch(() => []), Mirage.chronicle.log(250).catch(() => []),
      ]);
    } catch { return; }

    const byCell = new Map(cells.map(c => [c.id, c])), old = nodes, next = new Map(), byPid = new Map();
    edges = [];
    const put = (key, props) => {
      let n = old.get(key);
      if (!n) { const a = Math.random() * 6.283, r = 40 + Math.random() * 60; n = { key, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, fixed: false }; }
      Object.assign(n, props); next.set(key, n); return n;
    };

    for (const p of procs) {                                    // cells (they have a window) and, if asked, services
      if (!p.window && !showSvc) continue;
      const c = p.window ? byCell.get(p.window) : null;
      byPid.set(p.pid, put('p' + p.pid, p.window
        ? { type: 'cell', pid: p.pid, cellId: p.window, label: p.title, appId: p.appId, t: p.spawnedAt, prot: !!p.protected, stowed: c?.state === 'stowed', file: c?.file || null }
        : { type: 'svc', pid: p.pid, label: p.title || p.appId || 'pid ' + p.pid, t: p.spawnedAt, prot: true }));
    }
    for (const p of procs) {                                    // threads: who opened whom
      const a = p.parentPid != null && byPid.get(p.parentPid), b = byPid.get(p.pid);
      if (a && b) edges.push({ a, b, kind: 'thread' });
    }

    if (showFiles) {                                            // files: pinned, open in a cell, or written recently
      const files = new Map();
      const want = (path, patch) => { const f = files.get(path) || { t: null, pinned: false }; files.set(path, Object.assign(f, patch)); };
      for (const s of scraps) if (s.path) want(s.path, { pinned: true });
      for (const n of byPid.values()) if (n.file) want(n.file, {});
      const seen = new Set(); let extra = 0;
      for (const e of log) {                                    // newest first
        if (!e.path || seen.has(e.path)) continue;
        seen.add(e.path);
        if (e.kind !== 'write' && e.kind !== 'move') continue;  // a file whose latest entry is "removed" is not drawn
        if (files.has(e.path)) want(e.path, { t: e.t });
        else if (extra < MAX_RECENT) { want(e.path, { t: e.t }); extra++; }
      }
      for (const [path, f] of files) {
        const n = put('f' + path, { type: 'file', path, label: base(path), t: f.t, pinned: f.pinned });
        for (const c of byPid.values()) if (c.file === path) edges.push({ a: c, b: n, kind: 'uses' });
      }
    }

    const changed = next.size !== old.size || [...next.keys()].some(k => !old.has(k));
    nodes = next;
    if (hover) hover = nodes.get(hover.key) || null;
    refreshInfo();
    if (!fitted && nodes.size) { fitted = true; setTimeout(fit, 700); }
    kick(changed ? .6 : .12);
  }

  function refreshInfo() {
    let c = 0, f = 0;
    for (const n of nodes.values()) { if (n.type === 'cell') c++; else if (n.type === 'file') f++; }
    info.textContent = `${c} cells · ${f} files · ${edges.filter(e => e.kind === 'thread').length} threads`;
  }
  function flash(s) { info.textContent = s; clearTimeout(flashT); flashT = setTimeout(refreshInfo, 3000); }

  /* ── simulation: repulsion, springs on the edges, and a pull toward the ring that matches the age ── */
  function step() {
    const list = [...nodes.values()], n = list.length, now = Date.now();
    for (let i = 0; i < n; i++) {
      const p = list[i];
      for (let j = i + 1; j < n; j++) {
        const q = list[j];
        let dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 > 90000) continue;                               // beyond 300 px they do not feel each other
        if (d2 < 4) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 4; }
        const d = Math.sqrt(d2), f = 3800 / d2 * alpha, fx = dx / d * f, fy = dy / d * f;
        p.vx -= fx; p.vy -= fy; q.vx += fx; q.vy += fy;
      }
    }
    for (const e of edges) {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.hypot(dx, dy) || 1;
      const f = (d - (e.kind === 'thread' ? 95 : 70)) * .04 * alpha, fx = dx / d * f, fy = dy / d * f;
      e.a.vx += fx; e.a.vy += fy; e.b.vx -= fx; e.b.vy -= fy;
    }
    for (const p of list) {
      const r = Math.hypot(p.x, p.y) || 1, want = radiusOf(now - (p.t || now - UNKNOWN)), f = (want - r) * .05 * alpha;
      p.vx += p.x / r * f; p.vy += p.y / r * f;
      if (p.fixed || (drag && p === drag.node)) { p.vx = p.vy = 0; continue; }
      p.vx *= .8; p.vy *= .8;
      const sp = Math.hypot(p.vx, p.vy); if (sp > 14) { p.vx *= 14 / sp; p.vy *= 14 / sp; }
      p.x += p.vx; p.y += p.vy;
    }
    alpha *= .988;
  }
  function frame() {
    raf = 0;
    if (box.hidden) return;
    step(); draw();
    if (alpha > .02 || drag) raf = requestAnimationFrame(frame);
  }
  function kick(a) { alpha = Math.max(alpha, a); if (!raf && !box.hidden) raf = requestAnimationFrame(frame); }

  /* ── drawing: world space for shapes (constant 2 px lines), screen space for text ── */
  function neighbours(n) {
    const s = new Set([n]);
    for (const e of edges) { if (e.a === n) s.add(e.b); else if (e.b === n) s.add(e.a); }
    return s;
  }
  function draw() {
    const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const c = colors(), k = view.k, lw = c.bw / k, near = hover ? neighbours(hover) : null;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.save(); g.translate(w / 2 + view.x, h / 2 + view.y); g.scale(k, k);
    g.lineWidth = lw;

    g.globalAlpha = 1; g.strokeStyle = c.line; g.setLineDash([3 / k, 7 / k]);       // the rings of time
    for (const [ms] of RINGS) { g.beginPath(); g.arc(0, 0, radiusOf(ms), 0, 6.2832); g.stroke(); }

    for (const e of edges) {
      g.globalAlpha = (near && !(near.has(e.a) && near.has(e.b)) ? .12 : 1) * Math.min(fadeOf(ageOf(e.a)), fadeOf(ageOf(e.b)));
      g.strokeStyle = e.kind === 'thread' ? c.ink2 : c.edge;
      g.setLineDash(e.kind === 'thread' ? [2 / k, 7 / k] : [1 / k, 5 / k]);
      g.beginPath(); g.moveTo(e.a.x, e.a.y); g.lineTo(e.b.x, e.b.y); g.stroke();
      if (e.kind === 'thread') {                                                    // the square dot, on the edge of the child
        const dx = e.a.x - e.b.x, dy = e.a.y - e.b.y, d = Math.hypot(dx, dy) || 1, o = HALF.cell[0] + 5, s = 3 / k;
        g.setLineDash([]); g.fillStyle = c.ink2; g.fillRect(e.b.x + dx / d * o - s, e.b.y + dy / d * o - s, s * 2, s * 2);
      }
    }

    for (const n of nodes.values()) {
      const [hw, hh] = HALF[n.type], on = n === hover;
      g.globalAlpha = (near && !near.has(n) ? .15 : 1) * (on ? 1 : fadeOf(ageOf(n)));
      if (n.type === 'svc') { g.fillStyle = c.ink2; g.fillRect(n.x - hw, n.y - hh, hw * 2, hh * 2); continue; }
      g.fillStyle = on ? c.ink : c.cell; g.strokeStyle = c.ink; g.lineWidth = lw;
      g.setLineDash(n.stowed || n.type === 'file' ? [3 / k, 3 / k] : []);
      g.fillRect(n.x - hw, n.y - hh, hw * 2, hh * 2); g.strokeRect(n.x - hw, n.y - hh, hw * 2, hh * 2);
      if (n.pinned) { const p = 3 / k; g.strokeRect(n.x - hw - p, n.y - hh - p, (hw + p) * 2, (hh + p) * 2); }
      if (n.fixed) { g.setLineDash([]); g.fillStyle = c.ink; g.fillRect(n.x - 1.5 / k, n.y - hh - 7 / k, 3 / k, 3 / k); }
    }
    g.restore();

    g.setLineDash([]); g.textAlign = 'center';
    g.font = '9px ' + mono; g.fillStyle = c.ink2; g.globalAlpha = 1;
    for (const [ms, label] of RINGS) g.fillText(label, w / 2 + view.x, h / 2 + view.y - radiusOf(ms) * k - 4);
    g.font = '10px ' + mono; g.fillStyle = c.ink;
    for (const n of nodes.values()) {
      const on = n === hover, show = n.type === 'cell' || on || (near && near.has(n) && n.type !== 'svc') || (n.type === 'file' && k >= .8);
      if (!show || (n.type === 'svc' && !on)) continue;
      g.globalAlpha = (near && !near.has(n) ? .15 : 1) * (on ? 1 : fadeOf(ageOf(n)));
      g.fillText(cut(n.label, 22), w / 2 + view.x + n.x * k, h / 2 + view.y + (n.y + HALF[n.type][1]) * k + 13);
    }
    g.globalAlpha = 1;
  }

  /* ── view ── */
  const world = (cx, cy) => { const r = cv.getBoundingClientRect(); return { x: (cx - r.left - r.width / 2 - view.x) / view.k, y: (cy - r.top - r.height / 2 - view.y) / view.k }; };
  function hit(x, y) {
    let best = null, bd = 1e9; const pad = 6 / view.k;
    for (const n of nodes.values()) {
      const dx = Math.abs(x - n.x), dy = Math.abs(y - n.y);
      if (dx <= HALF[n.type][0] + pad && dy <= HALF[n.type][1] + pad && dx + dy < bd) { best = n; bd = dx + dy; }
    }
    return best;
  }
  function fit() {
    const list = [...nodes.values()];
    if (!list.length) { view = { x: 0, y: 0, k: 1 }; return draw(); }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const n of list) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
    const w = cv.clientWidth, h = cv.clientHeight, pad = 70;
    const k = Math.min(2, Math.max(.25, Math.min((w - pad * 2) / Math.max(60, x1 - x0), (h - pad * 2) / Math.max(60, y1 - y0))));
    view = { k, x: -(x0 + x1) / 2 * k, y: -(y0 + y1) / 2 * k };
    draw();
  }

  /* ── interaction ── */
  function activate(n) {
    if (n.type === 'cell') Mirage.cell.focus(n.cellId).catch(e => flash(e.message));
    else if (n.type === 'file') Mirage.fs.open(n.path).catch(e => flash(e.message));
  }
  function showTip(n, e) {
    if (!n) { tip.hidden = true; return; }
    const lines = n.type === 'cell'
      ? [n.label, `${n.appId} · pid ${n.pid}`, `opened ${ago(n.t)} ago${n.stowed ? ' · in the pocket' : ''}`, n.file || '']
      : n.type === 'file' ? [n.label, n.path, n.t ? `written ${ago(n.t)} ago` : '', n.pinned ? 'pinned on the table' : '']
        : [n.label, 'service · pid ' + n.pid];
    tip.textContent = lines.filter(Boolean).join('\n'); tip.hidden = false;
    const r = box.getBoundingClientRect();
    tip.style.left = Math.max(4, Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 6)) + 'px';
    tip.style.top = Math.max(4, Math.min(e.clientY - r.top + 14, r.height - tip.offsetHeight - 6)) + 'px';
  }
  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;                                 // the right button is for the menu
    const p = world(e.clientX, e.clientY), n = hit(p.x, p.y);
    drag = { node: n, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, ox: n ? n.x : 0, oy: n ? n.y : 0, moved: false };
    cv.setPointerCapture(e.pointerId); tip.hidden = true;
  });
  cv.addEventListener('pointermove', e => {
    if (drag) {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; cv.classList.add('dragging'); }
      if (drag.moved) {
        if (drag.node) { drag.node.x = drag.ox + dx / view.k; drag.node.y = drag.oy + dy / view.k; drag.node.fixed = true; kick(.3); }
        else { view.x = drag.vx + dx; view.y = drag.vy + dy; draw(); }
      }
      return;
    }
    const p = world(e.clientX, e.clientY), n = hit(p.x, p.y);
    if (n !== hover) { hover = n; draw(); }
    showTip(n, e);
  });
  const release = () => {
    if (!drag) return;
    const d = drag; drag = null; cv.classList.remove('dragging');
    if (d.node && !d.moved) activate(d.node);                   // a click, not a drag
    else if (d.node) kick(.3);
  };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', release);
  cv.addEventListener('pointerleave', () => { if (!drag && hover) { hover = null; tip.hidden = true; draw(); } });
  cv.addEventListener('dblclick', e => {
    const p = world(e.clientX, e.clientY), n = hit(p.x, p.y);
    if (n && n.fixed) { n.fixed = false; kick(.5); }
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
    const k2 = Math.min(3, Math.max(.2, view.k * Math.exp(-e.deltaY * .0015))), q = k2 / view.k;
    view.x = mx - (mx - view.x) * q; view.y = my - (my - view.y) * q; view.k = k2;
    draw();
  }, { passive: false });

  Mirage.contextMenu(ev => {
    const p = world(ev.clientX, ev.clientY), n = hit(p.x, p.y);
    if (!n) return [
      { label: showSvc ? 'Hide services' : 'Show services', run: () => $('bs').click() },
      { label: showFiles ? 'Hide files' : 'Show files', run: () => $('bf').click() },
      { label: 'Fit to view', run: fit },
    ];
    const hold = { label: n.fixed ? 'Release' : 'Hold in place', run: () => { n.fixed = !n.fixed; kick(.3); } };
    if (n.type === 'cell') return [
      { label: 'Focus', run: () => activate(n) },
      ...(n.file ? [{ label: 'Open its file', run: () => Mirage.fs.open(n.file).catch(e => flash(e.message)) }] : []),
      hold, { sep: true },
      n.prot ? { label: 'Protected', disabled: true }
        : { label: 'Close', danger: true, items: [{ label: 'Yes, close it', danger: true, run: () => Mirage.sys.kill(n.pid).then(load).catch(e => flash(e.message)) }] },
    ];
    if (n.type === 'file') return [
      { label: 'Open', run: () => activate(n) },
      { label: 'Pin to the table', run: () => Mirage.scraps.pin(n.path).then(load).catch(e => flash(e.message)) },
      hold,
    ];
    return [{ label: 'Service · ' + n.label, disabled: true }];
  });

  /* ── tabs and toolbar ── */
  function show(tab) {
    const map = tab === 'map';
    box.hidden = !map; $('list').hidden = map;
    $('tm').classList.toggle('on', map); $('tl').classList.toggle('on', !map);
    if (map) { load(); kick(.3); } else if (window.render) window.render();
  }
  $('tm').onclick = () => show('map');
  $('tl').onclick = () => show('list');
  $('bs').onclick = () => { showSvc = !showSvc; $('bs').classList.toggle('on', showSvc); load(); };
  $('bf').onclick = () => { showFiles = !showFiles; $('bf').classList.toggle('on', showFiles); load(); };
  $('bfit').onclick = fit;

  /* ── live: the same events the list used, plus cells and the chronicle; a slow tick keeps the ages honest ── */
  let refreshT = 0;
  const refresh = () => { clearTimeout(refreshT); refreshT = setTimeout(load, 250); };
  Mirage.ready.then(() => {
    for (const t of ['k:procs:spawn', 'k:procs:kill', 'cell:added', 'cell:removed', 'cell:changed', 'chronicle:entry']) Mirage.on(t, refresh);
    Mirage.on('tokens', () => { C = null; draw(); });
    setInterval(() => { if (!box.hidden && !document.hidden) load(); }, 5000);
    new ResizeObserver(() => draw()).observe(box);
    show('map');
  });
})();