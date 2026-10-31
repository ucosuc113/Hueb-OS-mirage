function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('papeleta');
  const E = M.util.esc;
  const OPEN = 340, CLOSE = 200, SUB = 140, EDGE = 6;               // ms at 1× speed
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const host = document.createElement('div');
  host.id = 'papeleta';
  let on = true, speed = 1, levels = [], ctx = null, subT = 0;

  const live = () => on && !reduce.matches;
  async function load() {
    on = (await Kernel.prefs.get('app.config.anim', true)) !== false;
    speed = +(await Kernel.prefs.get('app.config.speed', 1)) || 1;
    host.style.setProperty('--pa-open', OPEN / speed + 'ms');
    host.style.setProperty('--pa-close', CLOSE / speed + 'ms');
  }

  /* no leading / trailing / doubled separators, and a sane length */
  function tidy(items) {
    const out = [];
    for (const it of items || []) {
      if (!it) continue;
      if (it.sep) { if (out.length && !out[out.length - 1].sep) out.push(it); continue; }
      out.push(it);
    }
    while (out.length && out[out.length - 1].sep) out.pop();
    return out.slice(0, 40);
  }

  function build(items) {
    const sheet = document.createElement('div');
    sheet.className = 'pa-sheet';
    if (items.some(i => i.icon)) sheet.classList.add('has-ico');
    if (items.some(i => i.checked || i.danger)) sheet.classList.add('has-mk');
    const ul = document.createElement('ul');
    ul.className = 'pa-list';
    let n = 0;
    for (const it of items) {
      const li = document.createElement('li');
      if (it.sep) { li.className = 'pa-sep'; ul.lastElementChild?.classList.add('nb'); }
      else {
        li.className = 'pa-item' + (it.disabled ? ' off' : '') + (it.danger ? ' danger' : '') + (it.checked ? ' chk' : '');
        li.style.setProperty('--i', n++);
        li.innerHTML = '<i class="pa-mk"></i><span class="pa-ico">' + (it.icon ? Kernel.icons.render(it.icon) : '') + '</span>' +
          '<span class="pa-t">' + E(it.label) + '</span><span class="pa-h">' + (it.items ? '›' : E(it.hint || '')) + '</span>';
        li._it = it;
      }
      ul.appendChild(li);
    }
    ul.lastElementChild?.classList.add('nb');
    sheet.appendChild(ul);
    return sheet;
  }

  /* One sheet. The corner under the cursor is the crease: it opens toward the side that has room. */
  function openLevel(items, x, y, depth, anchor) {
    retireFrom(depth);
    const sheet = build(items);
    host.appendChild(sheet);
    const w = sheet.offsetWidth, h = sheet.offsetHeight;
    let left = x, top = y, west = false, north = false;
    if (anchor) {                                                    // a submenu hangs beside its parent line
      left = anchor.right - 2; top = anchor.top - 2;
      if (left + w > innerWidth - EDGE) { left = anchor.left - w + 2; west = true; }
    } else if (left + w > innerWidth - EDGE) { left = x - w; west = true; }
    if (top + h > innerHeight - EDGE) { top = (anchor ? anchor.bottom + 2 : y) - h; north = true; }
    sheet.style.left = Math.max(EDGE, left) + 'px';
    sheet.style.top = Math.max(EDGE, top) + 'px';
    sheet.classList.add(north ? (west ? 'pa-br' : 'pa-bl') : (west ? 'pa-tr' : 'pa-tl'));
    if (west) sheet.classList.add('rtl');
    levels[depth] = { sheet, sel: -1 };
    if (live()) {
      sheet.classList.add('opening');
      setTimeout(() => sheet.classList.remove('opening'), OPEN / speed + 60);
      setTimeout(() => sheet.classList.add('live'), 110 / speed);    // clickable once it is mostly open
    } else sheet.classList.add('live');
    return levels[depth];
  }

  function retire(lv) {
    const s = lv.sheet;
    if (!s.isConnected) return;
    s.classList.remove('opening', 'live');
    if (!live()) return s.remove();
    s.classList.add('closing');
    setTimeout(() => s.remove(), CLOSE / speed + 40);
  }
  function retireFrom(depth) {
    clearTimeout(subT);
    for (let i = levels.length - 1; i >= depth; i--) if (levels[i]) retire(levels[i]);
    levels.length = Math.min(levels.length, depth);
  }
  function refocus() { const c = M.cells.get(M.cells.focusedId); if (c) try { c.frame.contentWindow.focus(); } catch { } }
  function hide(restore) { retireFrom(0); ctx = null; if (restore) refocus(); }
  function hideNow() { clearTimeout(subT); host.querySelectorAll('.pa-sheet').forEach(s => s.remove()); levels = []; ctx = null; }

  async function show(items, point, opts) {
    items = tidy(items);
    if (!items.length) return false;
    hideNow();
    ctx = opts || {};
    const a = document.activeElement;
    if (a && a.tagName === 'IFRAME') a.blur();                       // so the keys reach the shell, not a cell
    openLevel(items, point.x, point.y, 0);
    return true;
  }

  /* ── selection and activation ── */
  const rowsOf = lv => [...lv.sheet.querySelectorAll('.pa-item')];
  function select(lv, i) {
    const rows = rowsOf(lv);
    rows.forEach((r, k) => r.classList.toggle('on', k === i));
    lv.sel = i;
    rows[i]?.scrollIntoView({ block: 'nearest' });
  }
  async function openSub(lv, li) {
    const it = li._it, depth = levels.indexOf(lv) + 1;
    if (!depth) return null;
    const sub = tidy(typeof it.items === 'function' ? await it.items(ctx) : it.items);
    if (!sub.length || levels[depth - 1] !== lv) return null;
    return openLevel(sub, 0, 0, depth, li.getBoundingClientRect());
  }
  function activate(lv, li) {
    const it = li && li._it;
    if (!it || it.disabled) return;
    if (it.items) { openSub(lv, li); return; }
    const c = ctx;
    hide(true);
    if (it.run) Promise.resolve().then(() => it.run(c)).catch(e => M.notify('The action failed', e.message));
  }

  ui.on(host, 'pointerover', e => {
    const li = e.target.closest('.pa-item'); if (!li) return;
    const lv = levels.find(l => l.sheet.contains(li)); if (!lv) return;
    const i = rowsOf(lv).indexOf(li);
    if (i === lv.sel) return;
    select(lv, i);
    clearTimeout(subT);
    const depth = levels.indexOf(lv);
    subT = setTimeout(() => { if (li._it.items && !li._it.disabled) openSub(lv, li); else retireFrom(depth + 1); }, SUB);
  });
  ui.on(host, 'click', e => {
    const li = e.target.closest('.pa-item'); if (!li) return;
    const lv = levels.find(l => l.sheet.contains(li));
    if (lv) activate(lv, li);
  });

  /* Capture phase: while open the slip keeps the keys (except Ctrl/Alt+Space, which belong to the Wish) */
  ui.on(window, 'keydown', e => {
    if (!levels.length) return;
    if (e.ctrlKey || e.metaKey || e.altKey) { if ((e.ctrlKey || e.altKey) && e.code === 'Space') hide(); return; }
    const lv = levels[levels.length - 1], rows = rowsOf(lv), k = e.key;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const step = d => {
      const n = rows.length; if (!n) return;
      let i = lv.sel < 0 && d < 0 ? 0 : lv.sel;
      for (let t = 0; t < n; t++) { i = (i + d + n) % n; if (!rows[i]._it.disabled) break; }
      select(lv, i);
    };
    if (k === 'Escape') { stop(); levels.length > 1 ? retireFrom(levels.length - 1) : hide(true); }
    else if (k === 'ArrowLeft') { stop(); if (levels.length > 1) retireFrom(levels.length - 1); }
    else if (k === 'ArrowDown') { stop(); step(1); }
    else if (k === 'ArrowUp') { stop(); step(-1); }
    else if (k === 'ArrowRight') { stop(); const li = rows[lv.sel]; if (li?._it.items && !li._it.disabled) openSub(lv, li).then(s => s && select(s, 0)); }
    else if (k === 'Enter' || k === ' ') { stop(); activate(lv, rows[lv.sel]); }
    else if (k === 'Tab') hide();
    else if (k.length === 1) {                                       // type-ahead
      stop();
      const at = Math.max(0, lv.sel + 1), order = [...rows.slice(at), ...rows.slice(0, at)];
      const hit = order.find(r => !r._it.disabled && String(r._it.label).toLowerCase().startsWith(k.toLowerCase()));
      if (hit) select(lv, rows.indexOf(hit));
    }
  }, true);

  /* Anything that is not the slip closes it */
  ui.on(document, 'pointerdown', e => { if (levels.length && !e.target.closest('.pa-sheet')) hide(); }, true);
  ui.on(document, 'wheel', e => { if (levels.length && !e.target.closest('.pa-sheet')) hide(); }, { passive: true, capture: true });
  ui.on(window, 'blur', () => hide());                               // a click inside a cell (iframe)
  for (const t of ['lens:changed', 'lock:changed', 'key:wish', 'key:menu', 'cell:removed']) ui.defer(M.bus.on(t, () => hide()));
  ui.defer(M.bus.on('k:prefs:change', ({ key }) => { if (String(key).startsWith('app.config.')) load(); }));

  const CSS = `
    #papeleta{position:absolute;left:0;top:0;width:0;height:0;z-index:40;--pa-open:${OPEN}ms;--pa-close:${CLOSE}ms}
    .pa-sheet{position:absolute;min-width:190px;max-width:320px;max-height:calc(100vh - 12px);overflow-y:auto;pointer-events:none;
      background:var(--panel-solid);color:var(--ink);border:var(--bw) solid var(--ink);font:12px/1 var(--mono)}
    .pa-sheet.live{pointer-events:auto}
    .pa-list{list-style:none;margin:0;padding:0}
    .pa-item{position:relative;display:flex;align-items:center;gap:10px;height:32px;padding:0 12px;cursor:pointer;user-select:none;white-space:nowrap}
    .pa-item::after{content:"";position:absolute;left:0;right:0;bottom:0;border-bottom:var(--bw) dashed var(--line);pointer-events:none}
    .pa-item.nb::after{display:none}
    .pa-item.on{background:var(--ink);color:var(--bg)}
    .pa-item.off{opacity:.4;cursor:default}
    .pa-sep{height:0;border-top:var(--bw) solid var(--ink)}
    .pa-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;letter-spacing:.04em}
    .pa-h{color:var(--ink2);font-size:11px} .pa-item.on .pa-h{color:inherit;opacity:.65}
    .pa-mk{display:none;width:6px;height:6px;flex:none} .has-mk .pa-mk{display:block}
    .pa-item.chk .pa-mk{background:currentColor}
    .pa-item.danger .pa-mk{border:var(--bw) solid currentColor}
    .pa-ico{display:none;width:16px;height:16px;flex:none;font-size:16px;align-items:center;justify-content:center;filter:grayscale(1)} .has-ico .pa-ico{display:inline-flex}
    .pa-ico svg{fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:square;stroke-linejoin:miter;width:1em;height:1em}

    /* the corner under the cursor: dot (--k0) → crease (--k1) → open sheet */
    .pa-tl{--k0:inset(0 calc(100% - 4px) calc(100% - 4px) 0);--k1:inset(0 calc(100% - 2px) 0 0)}
    .pa-tr{--k0:inset(0 0 calc(100% - 4px) calc(100% - 4px));--k1:inset(0 0 0 calc(100% - 2px))}
    .pa-bl{--k0:inset(calc(100% - 4px) calc(100% - 4px) 0 0);--k1:inset(0 calc(100% - 2px) 0 0)}
    .pa-br{--k0:inset(calc(100% - 4px) 0 0 calc(100% - 4px));--k1:inset(0 0 0 calc(100% - 2px))}
    .pa-sheet.opening{animation:pa-open var(--pa-open) both}
    .pa-sheet.closing{animation:pa-close var(--pa-close) both;pointer-events:none}
    @keyframes pa-open{
      0%  {clip-path:var(--k0);animation-timing-function:ease-out}
      16% {clip-path:var(--k0);animation-timing-function:cubic-bezier(.65,0,.35,1)}
      42% {clip-path:var(--k1);animation-timing-function:cubic-bezier(.2,.8,.2,1)}
      100%{clip-path:inset(0 0 0 0)}
    }
    @keyframes pa-close{
      0%  {clip-path:inset(0 0 0 0);animation-timing-function:cubic-bezier(.65,0,.35,1)}
      55% {clip-path:var(--k1);animation-timing-function:cubic-bezier(.65,0,.35,1)}
      85%,100%{clip-path:var(--k0)}
    }
    /* then every line draws its own rule, one after another */
    .pa-sheet.opening .pa-item::after{transform-origin:left;animation:pa-rule calc(var(--pa-open) * .7) cubic-bezier(.2,.8,.2,1) both;
      animation-delay:calc(var(--pa-open) * .32 + var(--i, 0) * 30ms)}
    .pa-sheet.opening.rtl .pa-item::after{transform-origin:right}
    .pa-sheet.opening .pa-item > *{animation:pa-in calc(var(--pa-open) * .5) ease-out both;animation-delay:calc(var(--pa-open) * .32 + var(--i, 0) * 30ms)}
    @keyframes pa-rule{from{transform:scaleX(0)}}
    @keyframes pa-in{from{opacity:0}}
  `;

  return {
    id: 'ui.papeleta', name: 'Component · Slip',
    async start() {
      ui.style(CSS);
      ui.mount('overlay', host);
      await load();
      ui.defer(M.svc.provide('menu.view', { show, hide: () => hide(), isOpen: () => levels.length > 0 }));
    },
    stop() { hideNow(); ui.dispose(); },
  };
}