/* Component · QUIRE LENS — a stack of "quires" where time is depth.
   A quire = a cell plus everything it opened (the Kernel's Procs tree), stapled together.
   · the quire you used last is on top; the others sink as you stop using them (strata)
   · inside a quire you turn pages (←/→); the page shown is the one focused most recently
   · the quires below peek out as tabs above the top sheet (title, pages, age)
   · ↓ brings the second quire up (like Alt-Tab), ↑ the deepest one; Esc fans everything out
   · the BINDER (left rail, Alt+B) lists the quires in stack order: same flat language as the cells
     (outline + opacity, never fills); the top one is framed and opens into its page index and actions
     (pin / sink / stow / close); a mark on the left fades as the quire goes stale;
     drag-and-drop staples pages or whole quires together
   · the spine only exists for quires with more than one page; otherwise the sheet takes its space
   Like every lens it only decides geometry: no iframe is created or moved, `rect` is never touched,
   and the Kernel's process tree is never changed (stapling is only a view over it).
   The Binder's bands are persistent elements updated in place (never rebuilt), which is what lets
   them animate: slide when reordered, fade their mark, fold their pages, collapse on exit. */
function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('quire');
  const E = M.util.esc;
  const PAD = 14, SPINE = 28, DX = 10, DY = 28, MAXV = 5, TOP0 = 34, BOTTOM = 40;
  const RAIL_OPEN = 204, RAIL_SHUT = 30, FRESH = 30 * 60 * 1000;
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const used = new Map();                   // cell id → last time it was focused
  const turned = new Map();                 // quire root id → page shown last time (for the page-turn animation)
  const tabs = new Map();                   // quire root id → tab element
  const rowEls = new Map();                 // quire root id → Binder band element
  const pins = new Set();                   // quire root ids kept near the top (this session)
  const bound = new Map();                  // cell id → root id it was stapled to (null = its own quire); this session
  let last = 0, shut = false, armed = null, armT = 0, dragging = null, lastOrder = '';
  const stamp = () => (last = Math.max(Date.now(), last + 1));
  const when = c => used.get(c.id) ?? c.createdAt ?? 0;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  let root, plane, world, es, layer, spine, hint, cap, binder, binderRows, newZone, offs = [], raf = 0, fan = false, ready = false;

  /* ── model ── */
  function rootOf(c, hops = 0) {
    let x = c, guard = 0;
    while (guard++ < 50) {
      if (bound.has(x.id)) {                               // stapled by hand: follow that, not the Kernel's tree
        const o = bound.get(x.id), t = o && M.cells.get(o);
        return t && hops < 4 ? rootOf(t, hops + 1) : x.id;
      }
      const p = x.parent && M.cells.get(x.parent);
      if (!p) return x.id;
      x = p;
    }
    return x.id;
  }
  function model() {
    const by = new Map();
    M.cells.each(c => {
      if (c.state === 'stowed') return;
      const r = rootOf(c);
      if (!by.has(r)) by.set(r, []);
      by.get(r).push(c);
    });
    const qs = [...by].map(([rootId, cells]) => {
      cells.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const cur = cells.reduce((a, b) => when(b) > when(a) ? b : a);
      return { root: rootId, cells, cur, last: when(cur), pinned: pins.has(rootId) };
    }).sort((a, b) => b.last - a.last);
    const [first, ...rest] = qs;                           // the top is always what you used last; pins come right after
    rest.sort((a, b) => (b.pinned - a.pinned) || (b.last - a.last));
    return first ? [first, ...rest] : [];
  }

  /* ── layout ── */
  const schedule = () => { if (!raf) raf = requestAnimationFrame(layout); };

  function place(c, r, show, z) {
    const s = c.el.style;
    s.left = r.x + 'px'; s.top = r.y + 'px'; s.width = r.w + 'px'; s.height = r.h + 'px';
    s.zIndex = z; s.visibility = show ? 'visible' : 'hidden'; s.pointerEvents = show ? '' : 'none';
    s.transformOrigin = 'left center';
  }

  function layout() {
    raf = 0;
    if (!layer) return;
    const qs = model(), n = qs.length, RAIL = shut ? RAIL_SHUT : RAIL_OPEN;
    if (!n) fan = false;
    root.classList.toggle('q-fan', fan);
    hint.hidden = n > 0; cap.hidden = !fan;
    renderBinder(qs);
    if (!n) { syncTabs([], 0, 0, 0, 0); spine.hidden = true; return; }
    if (fan) return layoutFan(qs, RAIL);

    const N = Math.min(n - 1, MAXV), pages = qs[0].cells.length;
    const left = RAIL + PAD + (pages > 1 ? SPINE : 0), top = TOP0 + N * DY;
    const w = Math.max(320, innerWidth - left - PAD), h = Math.max(200, innerHeight - top - BOTTOM);

    qs.forEach((q, j) => {
      const lvl = Math.min(j, N);
      /* every sheet shares the same bottom edge (the ones below are taller by exactly what they are raised)
         and recedes evenly on both sides, so the stack never sticks out past the top sheet */
      const r = { x: left + lvl * DX, y: top - lvl * DY, w: w - 2 * lvl * DX, h: h + lvl * DY };
      q.cells.forEach(c => place(c, r, c === q.cur && j <= N, 1000 - j * 2 - (c === q.cur ? 0 : 1)));
      const prev = turned.get(q.root);
      if (j === 0 && ready && prev && prev !== q.cur.id && !reduce())          // page turn: unfolds from the spine
        q.cur.el.animate([{ transform: 'scaleX(.04)' }, { transform: 'scaleX(1)' }], { duration: 240, easing: EASE });
      turned.set(q.root, q.cur.id);
    });

    syncTabs(qs.slice(1, N + 1), left, top, w, n - 1 - N);

    spine.hidden = false;                                                        // spine of the top quire: fades out with one page
    spine.classList.toggle('one', pages < 2);
    spine.style.left = (left - SPINE) + 'px'; spine.style.top = top + 'px'; spine.style.width = SPINE + 'px'; spine.style.height = h + 'px';
    spine.querySelector('.q-pg').textContent = pages > 1 ? `${qs[0].cells.indexOf(qs[0].cur) + 1}/${pages}` : '';
  }

  function layoutFan(qs, RAIL) {
    const n = qs.length, GAP = 12, T = 52, W = innerWidth - RAIL, H = innerHeight - T - BOTTOM;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * W / H))), rows = Math.ceil(n / cols);
    const h = (H - GAP * (rows - 1)) / rows;
    qs.forEach((q, j) => {
      const col = j % cols, row = Math.floor(j / cols);
      const inRow = row === rows - 1 ? n - cols * (rows - 1) : cols;
      const w = (W - GAP * (inRow + 1)) / inRow;
      const r = { x: Math.round(RAIL + GAP + col * (w + GAP)), y: Math.round(T + row * (h + GAP)), w: Math.round(w), h: Math.round(h) };
      q.cells.forEach(c => place(c, r, c === q.cur, 1000));
    });
    syncTabs([], 0, 0, 0, 0); spine.hidden = true;
  }

  /* tabs live as long as their quire does, so they slide to their new level instead of blinking */
  function syncTabs(list, left, top, w, more) {
    const keep = new Set();
    list.forEach((q, i) => {
      const j = i + 1;
      keep.add(q.root);
      let t = tabs.get(q.root), fresh = false;
      if (!t) {
        t = document.createElement('div'); t.className = 'q-tab';
        t.innerHTML = '<span class="q-t"></span><span class="q-n"></span><span class="q-a"></span><b class="q-more" data-q="fan" hidden></b>';
        layer.appendChild(t); tabs.set(q.root, t); fresh = true;
      }
      t.dataset.id = q.cur.id; t.style.setProperty('--d', j);
      t.style.left = (left + j * DX) + 'px'; t.style.top = (top - j * DY) + 'px'; t.style.width = (w - 2 * j * DX) + 'px'; t.style.height = DY + 'px';
      const title = (M.cells.get(q.root) || q.cur).title;
      t.title = title;
      t.querySelector('.q-t').textContent = title;
      t.querySelector('.q-n').textContent = q.cells.length > 1 ? q.cells.length + ' pages' : '';
      t.querySelector('.q-a').textContent = M.util.ago(q.last);
      const chip = t.querySelector('.q-more');
      chip.hidden = !(i === list.length - 1 && more > 0); chip.textContent = '+' + more;
      if (fresh && ready && !reduce())                       // a new tab rises from behind the sheet above it
        t.animate([{ transform: `translateY(${DY}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: EASE });
    });
    for (const [id, t] of tabs) if (!keep.has(id)) { t.remove(); tabs.delete(id); }
  }

  /* ── the Binder: the stack, read top to bottom ── */
  function buildRow() {
    const el = document.createElement('div'); el.className = 'q-q';
    el.style.setProperty('--f', '0');                     // the freshness mark is born faded and rises to its tone
    el.innerHTML =
      '<i class="q-mark"></i>' +
      '<div class="q-row" draggable="true"><span class="q-title"></span><span class="q-cnt"></span><span class="q-ago"></span></div>' +
      '<div class="q-body"><div class="q-in"><div class="q-pages"></div><div class="q-acts">' +
      '<button data-b="pin" title="Keep this quire near the top">pin</button><button data-b="sink" title="Send it to the bottom of the stack">sink</button>' +
      '<button data-b="stow" title="Put the whole quire in the pocket">stow</button><button data-b="close" title="Close every page of this quire">close</button>' +
      '</div></div></div>';
    return el;
  }

  function updateRow(el, q, j, fresh) {
    const inQ = new Set(q.cells.map(c => c.id));
    const depth = c => { let d = 0, x = c; while (x.parent && inQ.has(x.parent) && d < 8) { x = M.cells.get(x.parent); d++; } return d; };
    const f = Math.max(.08, 1 - (Date.now() - q.last) / FRESH).toFixed(3);

    el.dataset.root = q.root; el.dataset.id = q.cur.id; el._f = f;
    el.style.setProperty('--p', Math.min(q.cells.length, 8));               // collapsed rail: taller with more pages
    el.classList.toggle('top', j === 0); el.classList.toggle('pin', q.pinned); el.classList.toggle('multi', q.cells.length > 1);
    if (!fresh) el.style.setProperty('--f', f);                             // fresh bands fade in after being attached

    const row = el.querySelector('.q-row');
    row.dataset.drag = 'quire:' + q.root; row.dataset.id = q.cur.id; row.title = 'Bring to the top';
    el.title = (M.cells.get(q.root) || q.cur).title;
    el.querySelector('.q-title').textContent = el.title;
    el.querySelector('.q-cnt').textContent = q.cells.length > 1 ? q.cells.length + 'p' : '';
    el.querySelector('.q-ago').textContent = M.util.ago(q.last);

    const list = el.querySelector('.q-pages');                              // index lines: rebuilt only when pages really change
    const sig = q.cells.map(c => c.id + '|' + c.title + '|' + depth(c)).join(';');
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      list.innerHTML = q.cells.map((c, i) =>
        `<div class="q-page" draggable="true" data-drag="cell:${c.id}" data-id="${c.id}" style="--i:${depth(c)}">` +
        `<i class="q-pm"></i><span class="q-pt">${E(c.title)}</span><i class="q-lead"></i><span class="q-no">${i + 1}</span></div>`).join('');
    }
    list.querySelectorAll('.q-page').forEach(p => p.classList.toggle('cur', p.dataset.id === q.cur.id));

    el.querySelectorAll('.q-acts button').forEach(b => { b.dataset.root = q.root; });
    el.querySelector('[data-b=pin]').classList.toggle('on', q.pinned);
    const close = el.querySelector('[data-b=close]');
    close.textContent = armed === q.root ? 'sure?' : 'close'; close.classList.toggle('arm', armed === q.root);
  }

  function leaveRow(el) {
    el.classList.add('gone'); el.style.pointerEvents = 'none';
    if (reduce()) return el.remove();
    const h = el.offsetHeight;
    el.animate([{ height: h + 'px', minHeight: h + 'px', opacity: 1 }, { height: '0px', minHeight: '0px', opacity: 0 }], { duration: 220, easing: EASE }).onfinish = () => el.remove();
  }

  function renderBinder(qs) {
    if (dragging) return;                                  // never touch the rail under a drag
    binder.classList.toggle('shut', shut);
    const tog = binder.querySelector('[data-b=shut]');
    tog.textContent = shut ? '›' : '‹'; tog.title = (shut ? 'Open' : 'Collapse') + ' the Binder (Alt+B)';
    const np = qs.reduce((s, q) => s + q.cells.length, 0), bs = binder.querySelector('.q-bs');
    bs.textContent = qs.length; bs.title = `${qs.length} quire${qs.length === 1 ? '' : 's'} · ${np} page${np === 1 ? '' : 's'}`;

    const before = new Map();                              // positions before, to slide bands to their new place (FLIP)
    rowEls.forEach((el, id) => before.set(id, el.getBoundingClientRect().top));
    const order = qs.map(q => q.root).join(), reorder = lastOrder && lastOrder !== order;

    const ordered = [], born = new Set(), seen = new Set();
    qs.forEach((q, j) => {
      seen.add(q.root);
      let el = rowEls.get(q.root), fresh = false;
      if (!el) { el = buildRow(); rowEls.set(q.root, el); fresh = true; born.add(el); }
      updateRow(el, q, j, fresh);
      ordered.push(el);
    });
    for (const [id, el] of rowEls) if (!seen.has(id)) { rowEls.delete(id); leaveRow(el); }

    let ref = binderRows.firstElementChild;                // keyed reorder: only move what is out of place
    for (const el of ordered) {
      while (ref && ref !== el && ref.classList.contains('gone')) ref = ref.nextElementSibling;
      if (ref === el) ref = ref.nextElementSibling; else binderRows.insertBefore(el, ref || newZone);
    }

    void binderRows.offsetWidth;                           // new bands are in the DOM now: let them dry
    born.forEach(el => {
      el.style.setProperty('--f', el._f);
      if (ready && !reduce()) el.animate([{ transform: 'translateX(-14px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: EASE });
    });
    if (reorder && !reduce()) rowEls.forEach((el, id) => {
      if (born.has(el) || !before.has(id)) return;
      const dy = before.get(id) - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 280, easing: EASE });
    });
    lastOrder = order;
  }

  function setShut(v) {
    shut = !!v;
    Kernel.prefs.set('mirage.quire.rail', shut).catch(() => { });
    schedule();
  }

  function act(what, rootId) {
    if (what === 'shut') return setShut(!shut);
    if (what === 'fan') { fan = true; return schedule(); }
    const qs = model();
    if (what === 'reset') { pins.clear(); bound.clear(); return schedule(); }
    if (what === 'tidy') { qs.slice(1).forEach(q => q.cells.forEach(c => M.cells.stow(c.id))); return schedule(); }
    const q = qs.find(x => x.root === rootId);
    if (!q) return;
    if (what === 'pin') { pins.has(rootId) ? pins.delete(rootId) : pins.add(rootId); return schedule(); }
    if (what === 'sink') {
      q.cells.forEach(c => used.set(c.id, 0));
      const top = model()[0];
      if (top) M.cells.focus(top.cur.id, { noFrameFocus: true });
      return schedule();
    }
    if (what === 'stow') { q.cells.slice().forEach(c => M.cells.stow(c.id)); return schedule(); }
    if (what === 'close') {                                // two steps: the first click only arms the link
      if (armed !== rootId) { armed = rootId; clearTimeout(armT); armT = setTimeout(() => { armed = null; schedule(); }, 2500); return schedule(); }
      armed = null; clearTimeout(armT);
      q.cells.slice().forEach(c => M.cells.close(c.id));
    }
  }

  /* drag & drop: a page (or a whole quire) dropped on a quire is stapled to it; dropped on "own quire" it leaves */
  function onDragStart(e) {
    const el = e.target.closest('[data-drag]'); if (!el) return;
    dragging = el.dataset.drag;
    e.dataTransfer.setData('text/plain', dragging); e.dataTransfer.effectAllowed = 'move';
    binder.classList.add('drag');
  }
  function onDragOver(e) {
    if (!dragging) return;
    const t = e.target.closest('.q-q,.q-new');
    layer.querySelectorAll('.over').forEach(x => { if (x !== t) x.classList.remove('over'); });
    if (t) { e.preventDefault(); t.classList.add('over'); }
  }
  function onDrop(e) {
    const t = e.target.closest('.q-q,.q-new');
    if (!t || !dragging) return;
    e.preventDefault();
    const c = M.cells.get(dragging.split(':')[1]);
    if (c) {
      if (t.classList.contains('q-new')) bound.set(c.id, null);
      else {
        const target = M.cells.get(t.dataset.root);
        if (target && rootOf(c) !== rootOf(target)) bound.set(c.id, rootOf(target));
      }
    }
    onDragEnd();
  }
  function onDragEnd() {
    dragging = null;
    binder?.classList.remove('drag');
    layer?.querySelectorAll('.over').forEach(x => x.classList.remove('over'));
    schedule();
  }

  /* ── interaction ── */
  function page(dir) {
    const q = model()[0]; if (!q) return;
    const t = q.cells[Math.max(0, Math.min(q.cells.length - 1, q.cells.indexOf(q.cur) + dir))];
    if (t !== q.cur) M.cells.focus(t.id, { noFrameFocus: true });
  }
  function rotate(dir) {
    const qs = model(); if (qs.length < 2) return;
    M.cells.focus((dir > 0 ? qs[1] : qs[qs.length - 1]).cur.id, { noFrameFocus: true });
  }
  function onClick(e) {
    const b = e.target.closest('[data-b]');
    if (b) return act(b.dataset.b, b.dataset.root);
    if (e.target.closest('[data-q=fan]')) { fan = true; return schedule(); }
    const nav = e.target.closest('[data-q=prev],[data-q=next]');
    if (nav) return page(nav.dataset.q === 'prev' ? -1 : 1);
    const hit = e.target.closest('.q-page,.q-row') || (binder.classList.contains('shut') && e.target.closest('.q-q'));
    if (hit) { fan = false; M.cells.focus(hit.dataset.id, { noFrameFocus: true }); return schedule(); }
    const tab = e.target.closest('.q-tab');
    if (tab) M.cells.focus(tab.dataset.id, { noFrameFocus: true });
  }
  function onDown(e) {
    if (e.button !== 0 || !fan || e.target.closest('.q-tab,.q-binder')) return;
    const el = e.target.closest('.cell');
    if (el) { e.preventDefault(); M.cells.focus(el.dataset.cell, { noFrameFocus: true }); }
    fan = false; schedule();
  }
  function onKey(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyB') { e.preventDefault(); setShut(!shut); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { fan = !fan; schedule(); return; }
    if (fan) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); page(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); page(1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); rotate(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); rotate(-1); }
  }

  let offMenu = [];
  const unhook = () => { offMenu.forEach(f => f()); offMenu = []; };
  const titleOf = o => (M.cells.get(o.root) || o.cur).title;
  function stapleTo(cellId, targetRoot) {                          // the same as dropping it on that quire in the Binder
    const c = M.cells.get(cellId), target = M.cells.get(targetRoot);
    if (c && target && rootOf(c) !== rootOf(target)) { bound.set(cellId, rootOf(target)); schedule(); }
  }
  function quireItems(rootId) {
    const all = model(), q = all.find(x => x.root === rootId); if (!q) return [];
    const rest = all.filter(o => o.root !== rootId);
    return [
      { label: 'Bring to top', disabled: all[0].root === rootId, run: () => { fan = false; M.cells.focus(q.cur.id, { noFrameFocus: true }); schedule(); } },
      { label: q.pinned ? 'Unpin' : 'Pin', hint: 'near the top', run: () => act('pin', rootId) },
      { label: 'Sink', hint: 'to the bottom', run: () => act('sink', rootId) },
      { sep: true },
      { label: 'Staple into', disabled: !rest.length, items: rest.map(o => ({ label: titleOf(o), run: () => stapleTo(rootId, o.root) })) },
      { label: 'Stow quire', run: () => act('stow', rootId) },
      { label: q.cells.length > 1 ? `Close ${q.cells.length} pages` : 'Close', danger: true,
        items: [{ label: 'Yes, close it', danger: true, run: () => q.cells.slice().forEach(c => M.cells.close(c.id)) }] },
    ];
  }
  function pageItems(cellId, full = true) {
    const c = M.cells.get(cellId); if (!c) return [];
    const all = model(), rootId = rootOf(c), q = all.find(x => x.root === rootId), rest = all.filter(o => o.root !== rootId);
    const unstaple = { label: 'Own quire', hint: 'unstaple', disabled: !(q && q.cells.length > 1), run: () => { bound.set(cellId, null); schedule(); } };
    const staple = { label: 'Staple to', disabled: !rest.length, items: rest.map(o => ({ label: titleOf(o), run: () => stapleTo(cellId, o.root) })) };
    if (!full) return [unstaple, staple].filter(i => !i.disabled);   // on a title bar: only what makes sense right now
    return [
      { label: 'Turn to this page', disabled: !!q && q.cur.id === cellId, run: () => { fan = false; M.cells.focus(cellId, { noFrameFocus: true }); schedule(); } },
      unstaple, staple, { sep: true },
      { label: 'Stow page', run: () => M.cells.stow(cellId) },
      { label: 'Close page', danger: true, run: () => M.cells.close(cellId) },
    ];
  }
  const binderItems = () => [
    { label: 'Fan out', hint: 'Esc', run: () => act('fan') },
    { label: 'Tidy', hint: 'keep the top one', run: () => act('tidy') },
    { label: 'Reset pins and staples', run: () => act('reset') },
    { sep: true },
    { label: shut ? 'Open the Binder' : 'Collapse the Binder', hint: 'Alt+B', run: () => act('shut') },
  ];
  function hook(menu) {
    unhook();
    const here = () => M.lens.current?.id === 'quire';
    offMenu = [
      menu.provide('quire', {                                        // the Binder, the tabs and the spine: nobody adds to them
        rank: 10,
        match: t => here() && t.closest?.('.q-binder, .q-tab, .q-spine'),
        items: ({ target }) => {
          const pg = target.closest('.q-page'), row = target.closest('.q-q'), tab = target.closest('.q-tab');
          if (pg) return pageItems(pg.dataset.id);
          if (row) return quireItems(row.dataset.root);
          if (tab) { const c = M.cells.get(tab.dataset.id); return c ? quireItems(rootOf(c)) : []; }
          if (target.closest('.q-spine')) return [{ label: 'Previous page', hint: '←', run: () => page(-1) }, { label: 'Next page', hint: '→', run: () => page(1) }];
          return binderItems();
        },
      }),
      menu.provide('quire-cell', {                                   // a title bar: Quire's entries first, the cell's own follow
        rank: 15, inherit: true,
        match: t => here() && t.closest?.('.cell-bar'),
        items: ({ hit }) => pageItems(hit.closest('.cell').dataset.cell, false),
      }),
    ];
  }


  const lens = {
    id: 'quire', name: 'Quire',
    enter() {
      root = document.getElementById('mirage-root'); plane = document.getElementById('plane'); world = document.getElementById('world');
      root.classList.add('lens-quire');
      plane.style.transform = 'translate(0px,0px)';       // keeps the cells' z-index inside the plane (under the chrome)
      es = M.ui.scope('quire:lens');
      layer = document.createElement('div'); layer.className = 'q-layer';
      hint = document.createElement('div'); hint.className = 'q-hint'; hint.hidden = true;
      hint.innerHTML = '<b>Quire</b><span>no cells yet · <kbd>Ctrl</kbd> <kbd>Space</kbd></span>';
      cap = document.createElement('div'); cap.className = 'q-cap'; cap.hidden = true;
      cap.textContent = 'pick a quire · Esc to cancel';
      spine = document.createElement('div'); spine.className = 'q-spine'; spine.hidden = true;
      spine.innerHTML = '<button data-q="prev" title="Previous page (←)">‹</button><span class="q-pg"></span><button data-q="next" title="Next page (→)">›</button>';
      binder = document.createElement('div'); binder.className = 'q-binder';
      binder.innerHTML =
        '<div class="q-bh"><span class="q-bt">Binder</span><span class="q-bs"></span><button data-b="shut"></button></div>' +
        '<div class="q-rows"><div class="q-new">drop here · own quire</div></div>' +
        '<div class="q-bf"><button data-b="fan" title="See every quire (Esc)">fan</button><button data-b="tidy" title="Stow every quire except the top one">tidy</button>' +
        '<button data-b="reset" title="Undo pins and manual stapling">reset</button></div>';
      binderRows = binder.querySelector('.q-rows'); newZone = binder.querySelector('.q-new');
      layer.append(hint, cap, spine, binder);
      es.mount('world', layer);
      es.on(layer, 'click', onClick);
      es.on(layer, 'dragstart', onDragStart);
      es.on(layer, 'dragover', onDragOver);
      es.on(layer, 'drop', onDrop);
      es.on(layer, 'dragend', onDragEnd);
      es.on(world, 'pointerdown', onDown);
      es.on(window, 'keydown', onKey);
      es.on(window, 'resize', schedule);
      offs.push(
        M.bus.on('cell:added', schedule), M.bus.on('cell:changed', schedule),
        M.bus.on('cell:removed', c => { used.delete(c.id); bound.delete(c.id); pins.delete(c.id); schedule(); }),
        M.bus.on('cell:focused', c => { used.set(c.id, stamp()); schedule(); }),
      );
      const timer = setInterval(schedule, 30000); offs.push(() => clearInterval(timer));   // refreshes ages and band tones
      if (M.cells.focusedId) used.set(M.cells.focusedId, stamp());
      ready = false; lastOrder = ''; layout(); ready = true;
    },
    leave() {
      offs.forEach(f => f()); offs = []; cancelAnimationFrame(raf); raf = 0; clearTimeout(armT); armed = null; dragging = null;
      M.cells.each(c => { const s = c.el.style; s.visibility = ''; s.pointerEvents = ''; s.transformOrigin = ''; s.zIndex = c.z; });
      root?.classList.remove('lens-quire', 'q-fan');
      if (plane) plane.style.transform = 'none';
      es?.dispose(); es = null; layer = null; binder = null; tabs.clear(); rowEls.clear(); fan = false;
    },
    place: schedule,
    suggest() { let n = 0; M.cells.each(() => n++); return { x: 60 + n * 32, y: 70 + n * 32 }; },   // only matters when going back to the Table
    fit(id) { if (M.cells.get(id)) { fan = false; M.cells.focus(id, { noFrameFocus: true }); schedule(); } },
    overview() { fan = true; schedule(); },
    menu: () => binderItems(),
  };

  let unreg;
  return {
    id: 'ui.lens.quire', name: 'Lens · Quire',
    start() {
      ui.style(`
        .lens-quire .cell{transition:left .26s ${EASE},top .26s ${EASE},width .26s ${EASE}}
        .lens-quire .cell-grip{display:none}
        .lens-quire .cell-bar{cursor:default}
        .lens-quire #world::before{opacity:.25}
        .lens-quire.q-fan .cell iframe{pointer-events:none}
        .q-layer{position:absolute;inset:0;z-index:3;pointer-events:none}
        .q-hint{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:8px;
          text-align:center;color:var(--ink2);font:11px/1.4 var(--mono);letter-spacing:.06em}
        .q-hint[hidden],.q-cap[hidden],.q-spine[hidden],.q-more[hidden]{display:none}
        .q-hint b{font:600 20px/1 var(--mono);letter-spacing:.5em;padding-left:.5em;text-transform:uppercase;color:var(--ink);margin-bottom:10px}
        .q-hint kbd{font:inherit;border:var(--bw) solid var(--line);padding:0 5px;border-radius:2px}
        .q-cap{position:absolute;left:0;right:0;top:34px;text-align:center;font:11px/18px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink2)}
        .q-tab{position:absolute;display:flex;align-items:center;gap:12px;padding:0 12px;background:var(--cell-bg);color:var(--ink);cursor:pointer;pointer-events:auto;
          border:var(--bw) solid var(--edge);border-bottom:0;font:11px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;
          transition:left .26s ${EASE},top .26s ${EASE}}
        .q-tab:hover{background:var(--ink);color:var(--bg)}
        .q-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:calc(1 - var(--d, 1) * .13)}
        .q-n,.q-a{color:var(--ink2);white-space:nowrap} .q-tab:hover .q-n,.q-tab:hover .q-a{color:inherit;opacity:.65}
        .q-more{padding:0 6px;border:var(--bw) solid currentColor;font-weight:600}

        /* spine: only for quires with more than one page; page buttons and where you are */
        .q-spine{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;pointer-events:auto;
          border:var(--bw) solid var(--line);border-right:0;font:10px/1 var(--mono);color:var(--ink2);
          transition:left .26s ${EASE},top .26s ${EASE},opacity .2s}
        .q-spine.one{opacity:0;pointer-events:none}
        .q-spine button{width:100%;padding:6px 0;border:0;background:none;color:var(--ink);cursor:pointer;font:16px/1 var(--mono)}
        .q-spine button:hover{background:var(--ink);color:var(--bg)}
        .q-pg{padding:6px 0;writing-mode:vertical-rl;letter-spacing:.1em}

        /* Binder: the stack read top to bottom, in the same flat language as the cells */
        .q-binder{position:absolute;left:0;top:30px;bottom:40px;width:${RAIL_OPEN}px;display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;
          background:var(--panel-solid);border-right:var(--bw) solid var(--line);font:11px/1.3 var(--mono);color:var(--ink);transition:width .26s ${EASE}}
        .q-binder.shut{width:${RAIL_SHUT}px}
        .q-binder button{border:0;background:none;color:inherit;cursor:pointer;font:inherit;padding:0}
        .q-bh{display:flex;align-items:center;gap:8px;height:34px;flex:none;padding:0 6px 0 12px;border-bottom:var(--bw) solid var(--line);
          letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}
        .q-bh button{width:22px;height:22px;flex:none;font-size:16px;transition:background .15s,color .15s}
        .q-bh button:hover{background:var(--ink);color:var(--bg)}
        .q-bt{font-weight:600}
        .q-bs{margin-left:auto;color:var(--ink2);letter-spacing:.04em}
        .q-rows{flex:1;display:flex;flex-direction:column;gap:2px;padding:10px;overflow-y:auto;overflow-x:hidden}

        /* a band: outlined, never filled; the top quire is framed, the rest recede to ink2;
           the mark on the left fades as the quire goes stale */
        .q-q{position:relative;flex:none;border:var(--bw) solid transparent;color:var(--ink2);
          transition:border-color .2s,background-color .2s,color .2s}
        .q-q:hover{color:var(--ink);background:var(--panel)}
        .q-q.top{color:var(--ink);border-color:var(--ink)}
        .q-mark{position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--ink);opacity:calc(.12 + var(--f, 0) * .88);transition:opacity .6s}
        .q-row{display:flex;align-items:baseline;gap:8px;padding:9px 10px 9px 13px;cursor:pointer}
        .q-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:uppercase;letter-spacing:.08em}
        .q-q.top .q-title{font-weight:600}
        .q-title::before{content:"";display:inline-block;vertical-align:middle;width:0;height:6px;margin:-2px 0 0;background:currentColor;transition:width .2s ${EASE},margin .2s ${EASE}}
        .q-q.pin .q-title::before{width:6px;margin-right:7px}
        .q-cnt,.q-ago{white-space:nowrap;color:var(--ink2);font-size:10px}
        .q-cnt:empty{display:none}
        .q-body{display:grid;grid-template-rows:0fr;transition:grid-template-rows .26s ${EASE}}
        .q-q.top .q-body{grid-template-rows:1fr}
        .q-in{min-height:0;overflow:hidden}
        .q-q:not(.multi) .q-pages{display:none}
        .q-pages{padding:0 0 6px}
        .q-page{display:flex;align-items:center;gap:8px;padding:3px 10px 3px calc(13px + var(--i, 0) * 12px);cursor:pointer;color:var(--ink2);transition:color .15s}
        .q-page:hover,.q-page.cur{color:var(--ink)}
        .q-pm{display:block;width:6px;height:6px;flex:none;border:var(--bw) solid currentColor;transition:background .2s}
        .q-page.cur .q-pm{background:currentColor}
        .q-pt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .q-lead{flex:1;min-width:12px;height:0;border-bottom:var(--bw) dotted currentColor;opacity:.4;transform:translateY(3px)}
        .q-no{color:var(--ink2);font-size:10px}
        .q-acts{display:flex;border-top:var(--bw) solid var(--line)}
        .q-acts button{flex:1;padding:7px 0;color:var(--ink2);letter-spacing:.04em;transition:background .15s,color .15s}
        .q-acts button + button{border-left:var(--bw) solid var(--line)}
        .q-acts button:hover{background:var(--ink);color:var(--bg)}
        .q-acts button.on,.q-acts button.arm{color:var(--ink);font-weight:600}
        .q-new{display:none;margin:4px 0;padding:12px 8px;border:var(--bw) dashed var(--edge);text-align:center;color:var(--ink2);letter-spacing:.06em;text-transform:uppercase}
        .q-binder.drag .q-new{display:block}
        .q-q.over,.q-new.over{border:var(--bw) dashed var(--ink);color:var(--ink)}
        .q-bf{display:flex;gap:10px;flex:none;padding:10px 12px;border-top:var(--bw) solid var(--line);letter-spacing:.06em}
        .q-bf button{color:var(--ink2)}
        .q-bf button:hover{color:var(--ink);text-decoration:underline}
        .q-bf button + button::before{content:"·";margin-right:10px;color:var(--ink2);text-decoration:none;display:inline-block}

        /* collapsed: one block per quire, as tall as it has pages, as solid as it is fresh */
        .q-binder.shut .q-bh{padding:0;justify-content:center}
        .q-binder.shut .q-bt,.q-binder.shut .q-bs,.q-binder.shut .q-bf,.q-binder.shut .q-new,
        .q-binder.shut .q-row,.q-binder.shut .q-body{display:none}
        .q-binder.shut .q-rows{padding:10px 7px;gap:4px}
        .q-binder.shut .q-q{border:0;background:none;min-height:calc(6px + var(--p, 1) * 6px);cursor:pointer}
        .q-binder.shut .q-mark{width:auto;right:0;opacity:calc(.12 + var(--f, 0) * .4)}
        .q-binder.shut .q-q.top .q-mark,.q-binder.shut .q-q:hover .q-mark{opacity:1}
      `);
      unreg = M.lens.register(lens);
      const m = M.svc.get('menu'); if (m) hook(m);
      ui.defer(M.bus.on('svc:provided', ({ name } = {}) => { if (name === 'menu') hook(M.svc.get('menu')); }));
      ui.defer(unhook);
      Kernel.prefs.get('mirage.quire.rail', false).then(v => { shut = !!v; schedule(); }).catch(() => { });
    },
    stop() { unreg && unreg(); es?.dispose(); ui.dispose(); },
  };
}