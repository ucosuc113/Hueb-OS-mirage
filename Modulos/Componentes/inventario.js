function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('inventario');
  const E = M.util.esc, S = M.util.score;
  const KEY = 'mirage.inventory', KEY_PAUSE = 'mirage.inventory.paused', DIR = '/device/docs/pocket';
  const MAX = 30, MAX_TEXT = 4000, MAX_IMG = 8e6;
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif' };
  const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' };

  let items = [], paused = false, opened = false, still = false, dead = false, armed = false;
  let hideT = 0, armT = 0, flashT = 0, ageT = 0, lastCell = 0;
  const urls = new Map();                                      // item id → object URL of its thumbnail
  const base = p => String(p).split('/').pop();
  const save = M.util.debounce(() => { if (!dead) Kernel.prefs.set(KEY, items).catch(() => { }); }, 500);

  const el = document.createElement('div');
  el.id = 'inventario'; el.hidden = true;
  el.innerHTML =
    '<div class="iv-head"><b>Pocket</b><span class="iv-n"></span><span class="iv-sp"></span>' +
    '<button data-iv="capture" title="Read the system clipboard now">Capture</button>' +
    '<button data-iv="pause" title="Stop recording what you copy"></button>' +
    '<button data-iv="clear" title="Remove everything that is not kept"></button></div>' +
    '<ul class="iv-list"></ul><div class="iv-foot"></div>';
  const list = el.querySelector('.iv-list'), foot = el.querySelector('.iv-foot');

  function changed() {
    save();
    M.bus.emit('inventory:changed', { count: items.length, paused });
    if (opened) render();
  }
  function drop(it) {
    const u = urls.get(it.id); if (u) { URL.revokeObjectURL(u); urls.delete(it.id); }
    if (it.own && it.path) Kernel.fs.remove(it.path).catch(() => { });          // an image the Pocket itself wrote
  }

  /* ── keeping things ── */
  function add(it, force) {
    if (paused && !force) return false;
    if (it.kind === 'text') { it.text = String(it.text || '').slice(0, MAX_TEXT); if (!it.text.trim()) return false; }
    const dupe = items.find(x => x.kind === it.kind && (it.kind === 'text' ? x.text === it.text : x.path === it.path));
    if (dupe) { dupe.t = Date.now(); items = [dupe, ...items.filter(x => x !== dupe)]; changed(); return true; }
    items.unshift({ id: M.util.uid('i'), t: Date.now(), ...it });
    while (items.length > MAX) {                               // the oldest one that is not kept goes first
      let k = items.map(x => !x.keep).lastIndexOf(true);
      if (k < 0) k = items.length - 1;
      drop(items.splice(k, 1)[0]);
    }
    changed();
    return true;
  }
  function remove(id) { const i = items.findIndex(x => x.id === id); if (i >= 0) { drop(items.splice(i, 1)[0]); changed(); } }
  function clearUnkept() { const gone = items.filter(x => !x.keep); items = items.filter(x => x.keep); gone.forEach(drop); changed(); }
  function setPaused(v) { paused = !!v; Kernel.prefs.set(KEY_PAUSE, paused).catch(() => { }); changed(); }

  async function addImage(blob, type) {
    if (blob.size > MAX_IMG) { M.notify('Too big for the Pocket', `${(blob.size / 1e6).toFixed(1)} MB (the limit is ${MAX_IMG / 1e6} MB)`); return false; }
    const path = `${DIR}/clip-${Date.now().toString(36)}.${EXT[type] || 'png'}`;
    await Kernel.fs.writeBinary(path, blob, type);
    return add({ kind: 'image', path, own: true, from: 'clipboard' }, true);
  }
  async function capture() {                                   // explicit, so it also works while paused
    try {
      let n = 0;
      for (const item of await navigator.clipboard.read()) {
        const img = item.types.find(t => t.startsWith('image/'));
        if (img) { if (await addImage(await item.getType(img), img)) n++; }
        else if (item.types.includes('text/plain') && add({ kind: 'text', text: await (await item.getType('text/plain')).text(), from: 'clipboard' }, true)) n++;
      }
      flash(n ? `captured ${n}` : 'the clipboard is empty');
    } catch (e) { M.notify('Could not read the clipboard', e.message || 'permission denied'); }
  }

  /* ── giving things back ── */
  async function copyBack(id) {
    const it = items.find(x => x.id === id); if (!it) return;
    try {
      if (it.kind === 'image') {
        let blob = await Kernel.fs.readBlob(it.path);
        if (blob.type !== 'image/png') {                       // the clipboard only takes PNG
          const bmp = await createImageBitmap(blob), cv = new OffscreenCanvas(bmp.width, bmp.height);
          cv.getContext('2d').drawImage(bmp, 0, 0); blob = await cv.convertToBlob({ type: 'image/png' });
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      } else await navigator.clipboard.writeText(it.kind === 'text' ? it.text : it.path);
      flash('copied');
    } catch (e) { M.notify('Could not copy it back', e.message); }
  }
  async function toTable(id) {
    const it = items.find(x => x.id === id), sc = M.svc.get('scraps'); if (!it) return;
    if (!sc) return M.notify('No scraps', 'the scraps component is not loaded');
    try {
      if (it.kind === 'text') await sc.note(it.text);
      else { await sc.pin(it.path); if (it.own) { it.own = false; save(); } }   // on the table the file belongs to the scrap, not to the Pocket
      close();
    } catch (e) { M.notify('Could not put it on the table', e.message); }
  }

  /* ── the panel ── */
  const hint = () => (paused ? 'recording is paused' : 'click an item to copy it back');
  function flash(s) { foot.textContent = s; clearTimeout(flashT); flashT = setTimeout(() => { foot.textContent = hint(); }, 1600); }
  function row(it) {
    const kind = { text: 'txt', image: 'img', file: 'file' }[it.kind];
    const pv = it.kind === 'text' ? E(it.text.slice(0, 160)) : it.kind === 'image' ? `<img alt="" data-img="${it.id}">` : E(base(it.path));
    return `<li class="iv-it${it.keep ? ' keep' : ''}" data-id="${it.id}"><span class="iv-k">${kind}</span><span class="iv-pv">${pv}</span>` +
      `<span class="iv-ago">${E(M.util.ago(it.t))}</span><span class="iv-acts">` +
      `<button data-iv="table" title="Put it on the table">Table</button>` +
      `<button data-iv="keep" title="${it.keep ? 'Let it expire again' : 'Never evict it'}">${it.keep ? 'Kept' : 'Keep'}</button>` +
      `<button data-iv="del" title="Remove">×</button></span></li>`;
  }
  async function thumb(it, img) {
    if (!it) return;
    try {
      let u = urls.get(it.id);
      if (!u) {
        const b = await Kernel.fs.readBlob(it.path);
        u = URL.createObjectURL(b.type ? b : new Blob([b], { type: MIME[it.path.split('.').pop()] || 'image/png' }));
        urls.set(it.id, u);
      }
      img.src = u;
    } catch { img.replaceWith(document.createTextNode('missing')); }
  }
  function render() {
    el.querySelector('.iv-n').textContent = items.length;
    const p = el.querySelector('[data-iv=pause]'), c = el.querySelector('[data-iv=clear]');
    p.textContent = paused ? 'Resume' : 'Pause'; p.classList.toggle('on', paused);
    c.textContent = armed ? 'Sure?' : 'Clear'; c.classList.toggle('arm', armed);
    foot.textContent = hint();
    list.innerHTML = items.length ? items.map(row).join('') : '<li class="iv-empty">nothing yet · copy something, or press Capture to bring in the clipboard</li>';
    list.querySelectorAll('img[data-img]').forEach(img => thumb(items.find(x => x.id === img.dataset.img), img));
  }
  function open() {
    if (opened) return;
    opened = true; clearTimeout(hideT); armed = false; render();
    el.classList.toggle('still', still); el.classList.remove('closing');
    el.hidden = false; void el.offsetWidth; el.classList.add('open');
    ageT = setInterval(render, 30000);                         // keeps the ages honest
    M.bus.emit('inventory:changed', { count: items.length, paused });
  }
  function close() {
    if (!opened) return;
    opened = false; clearInterval(ageT);
    el.classList.remove('open'); el.classList.add('closing');
    hideT = setTimeout(() => { if (!opened) { el.hidden = true; el.classList.remove('closing'); } }, still ? 0 : 240);
    M.bus.emit('inventory:changed', { count: items.length, paused });
  }
  const toggle = () => (opened ? close() : open());

  ui.on(el, 'click', e => {
    const b = e.target.closest('[data-iv]'), li = e.target.closest('.iv-it');
    if (b && !li) {                                            // the header
      const a = b.dataset.iv;
      if (a === 'capture') capture();
      else if (a === 'pause') setPaused(!paused);
      else if (a === 'clear') {
        if (!armed) { armed = true; clearTimeout(armT); armT = setTimeout(() => { armed = false; if (opened) render(); }, 2500); render(); }
        else { armed = false; clearTimeout(armT); clearUnkept(); }
      }
      return;
    }
    if (!li) return;
    const id = li.dataset.id, a = b?.dataset.iv;
    if (a === 'table') toTable(id);
    else if (a === 'keep') { const it = items.find(x => x.id === id); if (it) { it.keep = !it.keep; changed(); } }
    else if (a === 'del') remove(id);
    else copyBack(id);
  });

  /* ── what you copy ── */
  function selected() {
    const a = document.activeElement;
    if (a && /^(TEXTAREA|INPUT)$/.test(a.tagName) && typeof a.selectionStart === 'number' && a.selectionEnd > a.selectionStart && a.type !== 'password') return a.value.slice(a.selectionStart, a.selectionEnd);
    return String(window.getSelection() || '');
  }
  const onCopy = () => { const t = selected(); if (t.trim()) add({ kind: 'text', text: t, from: 'table' }); };
  ui.on(document, 'copy', onCopy, true);
  ui.on(document, 'cut', onCopy, true);

  /* ── closing, shortcuts ── */
  ui.on(document, 'pointerdown', e => { if (opened && !e.target.closest('#inventario,[data-inv]')) close(); }, true);
  ui.on(window, 'blur', () => { if (opened) close(); });       // a click inside a cell (iframe)
  ui.on(window, 'keydown', e => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP') { e.preventDefault(); toggle(); return; }
    if (opened && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }, true);
  ui.defer(M.bus.on('key:pocket', () => toggle()));
  for (const t of ['lock:changed', 'key:wish', 'key:menu']) ui.defer(M.bus.on(t, () => { if (opened) close(); }));

  async function loadPrefs() {
    still = matchMedia('(prefers-reduced-motion: reduce)').matches || (await Kernel.prefs.get('app.config.anim', true)) === false;
  }
  ui.defer(M.bus.on('k:prefs:change', ({ key } = {}) => { if (String(key).startsWith('app.config.')) loadPrefs(); }));

  function wishes(q) {
    const m = q.match(/^(?:clip|pocket)(?:\s+(.+))?$/i);
    if (!m && q) return [];
    const f = (m?.[1] || '').trim();
    return items.map((it, i) => {
      const label = it.kind === 'text' ? it.text.replace(/\s+/g, ' ').slice(0, 70) : base(it.path);
      const s = !q ? .4 - i * .01 : f ? S(f, it.kind === 'text' ? it.text : label) : .9 - i * .01;
      return s > .2 && (q || i < 3) ? {
        title: label, hint: `${it.kind} · ${M.util.ago(it.t)}`, sub: `${it.kind} · from ${M.catalog.get(it.from)?.name || it.from || 'somewhere'} · ${M.util.ago(it.t)}`, group: 'Pocket', score: s, run: () => copyBack(it.id),
        actions: [
          { title: 'Copy it back', run: () => copyBack(it.id) },
          { title: 'Put it on the table', run: () => toTable(it.id) },
          { title: 'Remove', run: () => remove(it.id) },
        ],
      } : null;
    }).filter(Boolean).slice(0, 8);
  }

  const CSS = `
    #inventario{position:absolute;left:0;bottom:31px;z-index:26;width:min(380px,100vw);max-height:min(60vh,520px);display:flex;flex-direction:column;
      background:var(--panel-solid);border:var(--bw) solid var(--ink);border-left:0;
      --k0:inset(calc(100% - 4px) calc(100% - 4px) 0 0);--k1:inset(0 calc(100% - 2px) 0 0)}
    #inventario[hidden]{display:none}
    #inventario.open{animation:iv-open calc(var(--mo-open, 560ms) * .6) both}
    #inventario.closing{animation:iv-close calc(var(--mo-close, 460ms) * .45) both;pointer-events:none}
    #inventario.still{animation:none!important}
    @keyframes iv-open{0%,16%{clip-path:var(--k0)}42%{clip-path:var(--k1)}100%{clip-path:inset(0 0 0 0)}}
    @keyframes iv-close{0%{clip-path:inset(0 0 0 0)}55%{clip-path:var(--k1)}100%{clip-path:var(--k0)}}
    .iv-head{display:flex;align-items:center;gap:8px;flex:none;padding:8px 10px;border-bottom:var(--bw) solid var(--line);font:11px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase}
    .iv-head b{font-weight:600}
    .iv-n{color:var(--ink2)}
    .iv-sp{flex:1}
    .iv-head button{border:var(--bw) solid var(--line);background:none;color:var(--ink);padding:3px 8px;cursor:pointer;font:inherit;letter-spacing:.06em}
    .iv-head button:hover,.iv-head button.on,.iv-head button.arm{background:var(--ink);color:var(--bg);border-color:var(--ink)}
    .iv-list{list-style:none;margin:0;padding:0;overflow:auto;flex:1}
    .iv-it{position:relative;display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer}
    .iv-it::after{content:"";position:absolute;left:0;right:0;bottom:0;border-bottom:var(--bw) dashed var(--line);pointer-events:none}
    .iv-it:hover{background:var(--panel)}
    .iv-k{flex:none;min-width:36px;padding:2px 4px;border:var(--bw) solid var(--line);color:var(--ink2);font:10px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;text-align:center}
    .iv-it.keep .iv-k{background:var(--ink);color:var(--bg);border-color:var(--ink)}
    .iv-pv{flex:1;min-width:0;max-height:3.2em;overflow:hidden;font:12px/1.35 var(--mono);word-break:break-word}
    .iv-pv img{display:block;max-height:46px;max-width:100%;object-fit:contain}
    .iv-ago{flex:none;color:var(--ink2);font:10px var(--mono)}
    .iv-acts{display:none;flex:none;gap:4px}
    .iv-it:hover .iv-ago{display:none} .iv-it:hover .iv-acts{display:flex}
    .iv-acts button{border:var(--bw) solid var(--edge);background:var(--panel-solid);color:var(--ink);padding:1px 6px;cursor:pointer;font:10px/1.4 var(--mono);letter-spacing:.04em;text-transform:uppercase}
    .iv-acts button:hover{background:var(--ink);color:var(--bg)}
    .iv-empty{padding:18px 12px;color:var(--ink2);font:12px/1.5 var(--mono)}
    .iv-foot{flex:none;padding:6px 10px;border-top:var(--bw) solid var(--line);color:var(--ink2);font:10px/1.4 var(--mono);letter-spacing:.04em}
  `;

  const svc = {
    count: () => items.length, isPaused: () => paused, isOpen: () => opened,
    items: () => items.map(({ id, t, kind, text, path, keep }) => ({ id, t, kind, text, path, keep })),
    add: it => add(it, true), remove, copyBack, toTable, capture, open, close, toggle,
  };

  return {
    id: 'ui.inventario', name: 'Component · Pocket inventory',
    async start() {
      dead = false;
      ui.style(CSS);
      ui.mount('chrome', el);
      ui.defer(M.intents.provide('pocket', wishes));
      ui.defer(M.svc.provide('inventory', svc));
      ui.defer(M.api.register('inventory', {                   // what a cell can do: hand over the text it just had copied
        add: (ctx, text) => {
          const now = Date.now();
          if (now - lastCell < 80) return false; lastCell = now;
          return add({ kind: 'text', text: String(text || ''), from: ctx.appId || 'cell' });
        },
      }));
      offsK(Kernel.on('clipboard:change', ({ op, paths } = {}) => {   // files copied with the Kernel clipboard (nothing sends them yet: see 14d)
        if (op && paths?.length) for (const p of paths) add({ kind: 'file', path: p, from: 'files' });
      }));

      await loadPrefs();
      paused = (await Kernel.prefs.get(KEY_PAUSE, false)) === true;
      const saved = await Kernel.prefs.get(KEY, []);
      items = (Array.isArray(saved) ? saved : []).filter(x => x && x.id && ((x.kind === 'text' && x.text) || ((x.kind === 'image' || x.kind === 'file') && x.path))).slice(0, MAX);
      M.bus.emit('inventory:changed', { count: items.length, paused });
    },
    stop() {
      clearTimeout(hideT); clearTimeout(armT); clearTimeout(flashT); clearInterval(ageT);
      Kernel.prefs.set(KEY, items).catch(() => { });
      dead = true;                                             // a pending debounced save must not run after this
      offsK(null);
      urls.forEach(u => URL.revokeObjectURL(u)); urls.clear();
      ui.dispose();
    },
  };

  /* keeps the Kernel listener so stop() can release it */
  function offsK(f) { if (f === null) { offsK.f && offsK.f(); offsK.f = null; } else offsK.f = f; }
}