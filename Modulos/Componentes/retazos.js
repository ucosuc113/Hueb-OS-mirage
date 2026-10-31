/* Component · SCRAPS — objects that live ON the table.
   A scrap is a file or folder pinned to the plane: a note you type into, a text, a picture, or just
   the name of whatever you pinned. It only remembers WHERE it is (prefs); the content is always the
   file itself, so Chronicle, Files and Notes keep seeing the same thing.
   · a BLANK scrap (path: null) is a placeholder: a note that has no file until you type, an image / file
     waiting to be chosen or dropped on it, a folder waiting for its name
   · right click on the table: New note / image / file / folder, Paste · right click on a scrap: its own menu
   · × takes the scrap off the table; it never deletes the file
   · drop files from your computer onto the table: they are imported to /device/docs and pinned there
   · only the Table lens shows them (the other lenses have no plane to lay them on)
   Wish: `scrap <text>` · `pin <path>`        Cells: Mirage.scraps.pin(path) */
function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('retazos');
  const E = M.util.esc;
  const KEY = 'mirage.scraps', DIR = '/device/docs', PEEK = 6000, MIN_W = 140, MIN_H = 90;
  const SIZE = { text: [240, 170], image: [260, 200], dir: [220, 150], file: [180, 110] };
  const LABEL = { text: 'new note', image: 'image', file: 'file', dir: 'folder' };
  const IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' };
  const TEXTY = /^text\/|json|javascript|xml/, TEXTEXT = /\.(txt|md|js|json|html?|css|csv|log)$/i;   // same rule the Files app imports with
  const SVG = d => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>${d}</svg>`;
  const ICO = {
    text: SVG("<path d='M5 3h10l4 4v14H5z'/><path d='M8 12h8M8 16h8'/>"),
    image: SVG("<path d='M3 4h18v16H3z'/><circle cx='9' cy='10' r='2'/><path d='M3 18l6-5 4 3 3-2 5 4'/>"),
    file: SVG("<path d='M6 3h8l4 4v14H6z'/><path d='M14 3v4h4'/>"),
    dir: SVG("<path d='M3 6h7l2 2h9v11H3z'/>"),
    paste: SVG("<path d='M6 5h12v16H6z'/><path d='M9 5V3h6v2'/>"),
  };

  let list = [], layer = null, drag = null, zTop = 0, zLow = 0, dead = false, offMenu = [];
  const els = new Map();                                       // id → { el, body, url, kind, dirty, flush, later }
  const byId = id => list.find(s => s.id === id);
  const lens = () => (M.lens.current?.id === 'mesa' ? M.lens.current : null);
  const mod = (v, m) => ((v % m) + m) % m;
  const base = p => String(p || '').split('/').pop();
  const ext = p => { const n = base(p); return n.includes('.') ? n.split('.').pop().toLowerCase() : ''; };
  const under = (p, dir) => !!p && !!dir && (p === dir || p.startsWith(dir + '/'));
  const fmt = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const save = M.util.debounce(() => { if (!dead) Kernel.prefs.set(KEY, list).catch(() => { }); }, 500);
  const calm = async () => matchMedia('(prefers-reduced-motion: reduce)').matches || (await Kernel.prefs.get('app.config.anim', true)) === false;

  function kindOf(node, path) {
    if (node.type === 'dir') return 'dir';
    if (node.type !== 'file') return 'file';
    if (IMG[ext(path)]) return 'image';
    return node.encoding === 'binary' ? 'file' : 'text';
  }

  /* ── geometry: same rule as the cells (nearest copy of the torus) ── */
  function place(s) {
    const r = els.get(s.id), L = lens(); if (!r || !L) return;
    const o = L.near({ x: s.x, y: s.y, w: s.w, h: s.h }), st = r.el.style;
    st.left = Math.round(s.x + o.x) + 'px'; st.top = Math.round(s.y + o.y) + 'px';
    st.width = Math.round(s.w) + 'px'; st.height = Math.round(s.h) + 'px';
  }
  const placeAll = () => list.forEach(s => place(s));

  function raise(s) {
    const r = els.get(s.id); if (!r) return;
    r.el.style.zIndex = ++zTop;
    list.push(list.splice(list.indexOf(s), 1)[0]); save();     // list order = stacking order, so it survives a reload
  }
  function sink(s) {
    const r = els.get(s.id); if (!r) return;
    r.el.style.zIndex = --zLow;
    list.unshift(list.splice(list.indexOf(s), 1)[0]); save();
  }

  /* ── one scrap ── */
  function title(s, r, text) {
    const name = s.path ? base(s.path) : LABEL[s.kind] || 'scrap';
    const noteLike = text != null && (!s.path || /^scrap-/.test(name));          // notes are named by their first line
    const first = noteLike ? (text.split('\n').find(l => l.trim()) || '').trim().slice(0, 30) : '';
    r.el.querySelector('.sc-name').textContent = r.el.querySelector('.sc-mini span').textContent = first || name;
  }
  function reset(r) { if (r.url) URL.revokeObjectURL(r.url); r.url = null; r.body.innerHTML = ''; }

  function ensureText(s, r) {
    let ta = r.body.firstElementChild;
    if (!ta || ta.tagName !== 'TEXTAREA') {
      r.body.innerHTML = '<textarea spellcheck="false" placeholder="write…"></textarea>';
      ta = r.body.firstElementChild;
      ta.addEventListener('input', () => { r.dirty = true; title(s, r, ta.value); r.later(); });
    }
    return ta;
  }

  /* a scrap with no file yet */
  function blankBody(s, r) {
    const kind = s.kind || 'text';
    r.el.classList.remove('gone');
    const fresh = r.kind !== kind;
    if (fresh) { reset(r); r.kind = kind; }
    if (kind === 'text') { const ta = ensureText(s, r); ta.readOnly = false; title(s, r, ta.value); return; }
    if (fresh) r.body.innerHTML = kind === 'dir'
      ? '<div class="sc-ph"><input class="sc-in" placeholder="folder name" spellcheck="false" maxlength="60"><div class="sc-meta">Enter creates it in /device/docs</div></div>'
      : `<div class="sc-ph"><button class="sc-pick" data-a="pick">${kind === 'image' ? 'Choose image' : 'Choose file'}</button><div class="sc-meta">or drop ${kind === 'image' ? 'a picture' : 'a file'} on it</div></div>`;
    title(s, r);
  }

  async function fill(s) {
    const r = els.get(s.id); if (!r) return;
    try {
      if (!s.path) return blankBody(s, r);
      let node = null;
      try { node = await Kernel.fs.stat(s.path); } catch { }
      if (els.get(s.id) !== r) return;                         // taken off the table while we were reading
      r.el.classList.toggle('gone', !node);
      const kind = node ? kindOf(node, s.path) : 'gone';
      if (r.kind !== kind) { reset(r); r.kind = kind; }

      if (kind === 'gone') {
        r.body.innerHTML = `<div class="sc-meta">missing<br>${E(s.path)}</div>`; title(s, r);
      } else if (kind === 'text') {
        const text = await Kernel.fs.read(s.path);
        if (els.get(s.id) !== r) return;
        const ta = ensureText(s, r);
        if (document.activeElement !== ta) { ta.value = text.slice(0, PEEK); ta.readOnly = text.length > PEEK; }   // never overwrite what is being typed
        title(s, r, ta.value);
      } else if (kind === 'image') {
        const blob = await Kernel.fs.readBlob(s.path);
        if (els.get(s.id) !== r) return;
        if (r.url) URL.revokeObjectURL(r.url);
        r.url = URL.createObjectURL(new Blob([blob], { type: IMG[ext(s.path)] }));
        r.body.innerHTML = '<img alt="" draggable="false">'; r.body.firstElementChild.src = r.url;
        title(s, r);
      } else if (kind === 'dir') {
        const items = (await Kernel.fs.readdir(s.path)).sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name));
        if (els.get(s.id) !== r) return;
        r.body.innerHTML = '<ul class="sc-list">' +
          (items.slice(0, 8).map(i => `<li>${E(i.name)}${i.type === 'dir' ? '/' : ''}</li>`).join('') || '<li>empty folder</li>') +
          (items.length > 8 ? `<li>+${items.length - 8} more</li>` : '') + '</ul>';
        title(s, r);
      } else {
        r.body.innerHTML = `<div class="sc-big">${E(ext(s.path) || 'file')}</div><div class="sc-meta">${fmt(node.size || 0)}</div>`;
        title(s, r);
      }
    } catch (e) { console.warn('[Mirage:scraps]', s.path, e.message); }
  }

  function add(s, born) {
    list.push(s);
    const el = document.createElement('div');
    el.className = 'scrap'; el.dataset.id = s.id; el.style.zIndex = ++zTop;
    el.innerHTML =
      '<div class="sc-bar"><span class="sc-name"></span><span class="sc-btns">' +
      '<button data-a="open" title="Open">↗</button><button data-a="off" title="Take off the table (the file stays)">×</button></span></div>' +
      '<div class="sc-body"></div><i class="sc-grip"></i><div class="sc-mini"><span></span></div>';
    if (born) {                                                // same birth as a cell: dot → line → sheet
      el.classList.add('born');
      el.addEventListener('animationend', ev => { if (ev.target === el) el.classList.remove('born'); });
    }
    layer.appendChild(el);
    const r = { el, body: el.querySelector('.sc-body'), url: null, kind: null, dirty: false };
    r.flush = () => {
      const ta = r.body.querySelector('textarea');
      if (!r.dirty || !ta || ta.readOnly) return;
      r.dirty = false;
      if (!s.path) { s.path = `${DIR}/scrap-${Date.now().toString(36)}.txt`; delete s.kind; save(); }   // a blank note becomes a file with its first words
      Kernel.fs.write(s.path, ta.value).catch(e => M.notify('Could not save the scrap', e.message));
    };
    r.later = M.util.debounce(r.flush, 1200);
    els.set(s.id, r);
    place(s);
    return fill(s);
  }

  function unpin(id, discard) {
    const s = byId(id), r = els.get(id); if (!s || !r) return;
    if (discard) r.dirty = false; else r.flush();              // an edit made in the last second is not lost
    if (r.url) URL.revokeObjectURL(r.url);
    r.el.remove(); els.delete(id); list.splice(list.indexOf(s), 1); save();
  }

  /* ── creating ── */
  async function birth(s) {
    const born = !(await calm());
    await add(s, born); save();
    return s;
  }
  function spot(w, h, center) {                                // under the cursor, or (staggered) in the middle of the view
    const L = lens(), c = center || (L ? L.center() : { x: 0, y: 0 }), n = center ? 0 : (list.length % 6) * 26;
    return { x: L ? mod(c.x - w / 2 + n, L.wrap.w) : n, y: L ? mod(c.y - h / 2 + n, L.wrap.h) : n };
  }
  async function pin(path, center) {
    path = Kernel.fs.normalize(path);
    const node = await Kernel.fs.stat(path);
    if (!node) throw new Error(`'${path}' does not exist`);
    const dupe = list.find(s => s.path === path);
    if (dupe) { raise(dupe); return dupe; }                    // already on the table
    const [w, h] = SIZE[kindOf(node, path)];
    if (!lens()) M.notify('Scraps live on the Table', 'switch to the Table lens to see it');
    return birth({ id: M.util.uid('s'), path, w, h, ...spot(w, h, center) });
  }
  async function blank(kind, center) {
    const [w, h] = SIZE[kind];
    const s = await birth({ id: M.util.uid('s'), kind, path: null, w, h, ...spot(w, h, center) });
    els.get(s.id)?.body.querySelector('textarea, .sc-in')?.focus();
    return s;
  }
  async function note(text, center) {
    const path = `${DIR}/scrap-${Date.now().toString(36)}.txt`;
    await Kernel.fs.write(path, text);
    return pin(path, center);
  }
  const focusText = id => els.get(id)?.body.querySelector('textarea')?.focus();

  async function importOne(f) {
    let path = `${DIR}/${f.name}`, n = 1;
    while (await Kernel.fs.exists(path)) path = `${DIR}/${f.name.replace(/(\.[^.]*)?$/, ` (${n++})$1`)}`;
    if (TEXTY.test(f.type) || TEXTEXT.test(f.name)) await Kernel.fs.write(path, await f.text());
    else await Kernel.fs.writeBinary(path, await f.arrayBuffer(), f.type || 'application/octet-stream');
    return path;
  }
  async function importFiles(files, center) {
    let i = 0;
    for (const f of files) { const d = i++ * 28; await pin(await importOne(f), { x: center.x + d, y: center.y + d }); }
  }

  /* a blank (or an image) scrap takes its file from a picker or a drop */
  async function attach(s, file) {
    s.path = await importOne(file); delete s.kind; save();
    await fill(s);
  }
  function choose(s) {
    const inp = document.createElement('input');
    inp.type = 'file';
    if ((s.kind || els.get(s.id)?.kind) === 'image') inp.accept = 'image/*';
    inp.onchange = () => { const f = inp.files?.[0]; if (f) attach(s, f).catch(e => M.notify('Could not attach it', e.message)); };
    inp.click();
  }
  async function makeDir(s, name) {
    name = String(name).trim().replace(/[\\/]/g, '-');
    if (!name) return;
    const path = `${DIR}/${name}`;
    if (await Kernel.fs.exists(path)) throw new Error(`'${name}' already exists`);
    await Kernel.fs.mkdir(path);
    s.path = path; delete s.kind; save();
    await fill(s);
  }

  /* Paste: files copied with the Kernel clipboard are pinned (they stay where they are); otherwise the system clipboard */
  async function paste(center) {
    const clip = Kernel.clipboard.get();
    let i = 0;
    const at = () => { const d = i++ * 28; return { x: center.x + d, y: center.y + d }; };
    if (clip.paths.length) {
      for (const p of clip.paths) await pin(p, at()).catch(e => M.notify('Could not pin', e.message));
      return;
    }
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (type) {
          const e = Object.keys(IMG).find(k => IMG[k] === type) || 'png';
          await pin(await importOne(new File([await item.getType(type)], `pasted-${Date.now().toString(36)}.${e}`, { type })), at());
        } else if (item.types.includes('text/plain')) {
          const text = await (await item.getType('text/plain')).text();
          if (text.trim()) await note(text, at());
        }
      }
    } catch (e) { M.notify('Could not read the clipboard', e.message || 'permission denied'); return; }
    if (!i) M.notify('Nothing to paste', 'the clipboard has no picture, text or files');
  }

  async function open(s) {
    if (!s.path) return;
    try {
      const st = await Kernel.fs.stat(s.path);
      if (st?.type === 'dir') return M.cells.open('files', { args: { startPath: s.path } });
      const res = await Kernel.openFile(s.path);
      if (res && res.ok === false) M.notify('Nothing opens this', `no cell is bound to '${ext(s.path) || 'this file'}'`);
    } catch (e) { M.notify('Could not open', e.message); }
  }

  /* ── pointer: a scrap handles its own drag, so the Table never pans underneath it ── */
  function onDown(e) {
    if (e.button !== 0 && e.button !== 1) return;              // the right button is for the menu
    const el = e.target.closest('.scrap'); if (!el) return;
    e.stopPropagation();
    const s = byId(el.dataset.id), L = lens(); if (!s || !L) return;
    raise(s);
    if (e.target.closest('[data-a]')) return;
    const grip = e.target.closest('.sc-grip'), bar = e.target.closest('.sc-bar, .sc-mini');
    if (!grip && !bar) return;                                 // the body is for typing / double-clicking
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    drag = { s, size: !!grip, sx: e.clientX, sy: e.clientY, x: s.x, y: s.y, w: s.w, h: s.h, k: L.zoom() };
  }
  function onMove(e) {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / drag.k, dy = (e.clientY - drag.sy) / drag.k, s = drag.s;
    if (drag.size) { s.w = Math.max(MIN_W, drag.w + dx); s.h = Math.max(MIN_H, drag.h + dy); }
    else { s.x = drag.x + dx; s.y = drag.y + dy; }
    place(s);
  }
  function onUp() {
    if (!drag) return;
    const s = drag.s, L = lens(); drag = null;
    if (L) { s.x = mod(s.x, L.wrap.w); s.y = mod(s.y, L.wrap.h); place(s); }   // the saved position goes back to [0, WRAP)
    save();
  }
  function onDbl(e) {
    const el = e.target.closest('.scrap'); if (!el) return;
    e.stopPropagation();                                       // not "see all"
    if (e.target.closest('textarea:not([readonly]), input')) return;   // a word selection inside a note
    const s = byId(el.dataset.id); if (s) open(s);
  }
  function onClick(e) {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const s = byId(b.closest('.scrap').dataset.id); if (!s) return;
    const a = b.dataset.a;
    if (a === 'off') unpin(s.id); else if (a === 'pick') choose(s); else open(s);
  }
  function onKey(e) {
    const t = e.target;
    if (e.key === 'Escape' && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) t.blur();
    else if (e.key === 'Enter' && t.classList?.contains('sc-in')) {
      const s = byId(t.closest('.scrap').dataset.id);
      if (s) makeDir(s, t.value).catch(err => M.notify('Could not create the folder', err.message));
    }
  }

  /* ── Wish: `scrap hello` · `scrap` (blank) · `pin /device/docs/a.txt` ── */
  const verb = (q, ...names) => { const m = q.match(new RegExp('^(?:' + names.join('|') + ')(?:\\s+(.+))?$', 'i')); return m ? (m[1] || '').trim() : null; };
  function wishes(q) {
    const out = [], text = verb(q, 'scrap', 'sticky'), path = verb(q, 'pin');
    if (text !== null) out.push({
      title: text ? `Scrap: ${text}` : 'New blank scrap', hint: 'a note on the table', group: 'Actions', score: 0.97,
      run: async () => { try { focusText((await note(text)).id); } catch (e) { M.notify('Could not make the scrap', e.message); } },
    });
    if (path) out.push({
      title: `Pin to the table: ${path}`, hint: 'file or folder', group: 'Actions', score: 0.96,
      run: () => pin(path).catch(e => M.notify('Could not pin', e.message)),
    });
    return out;
  }

  /* ── right click ── */
  function scrapItems(s) {
    if (!s) return [];
    const r = els.get(s.id), kind = s.kind || r?.kind, items = [];
    if (s.path) items.push({ label: 'Open', hint: 'dbl click', run: () => open(s) });
    if (!s.path && (kind === 'image' || kind === 'file')) items.push({ label: kind === 'image' ? 'Choose image…' : 'Choose file…', run: () => choose(s) });
    if (s.path && kind === 'image') items.push({ label: 'Replace image…', run: () => choose(s) });
    if (s.path) items.push({ label: 'Copy path', run: () => navigator.clipboard?.writeText(s.path).then(() => M.notify('Path copied', s.path)).catch(() => { }) });
    items.push({ sep: true }, { label: 'Bring to front', run: () => raise(s) }, { label: 'Send to back', run: () => sink(s) },
      { sep: true }, { label: 'Take off the table', hint: s.path ? 'file stays' : '', run: () => unpin(s.id) });
    if (s.path) items.push({
      label: kind === 'dir' ? 'Delete folder' : 'Delete file', danger: true,
      items: [{ label: kind === 'dir' ? 'Yes, with its contents' : 'Yes, delete it', danger: true, run: () => Kernel.fs.remove(s.path, { recursive: true }).catch(e => M.notify('Could not delete', e.message)) }],
    });
    return items;
  }
  function unhook() { offMenu.forEach(f => f()); offMenu = []; }
  function hook(menu) {
    unhook();
    const at = c => (lens() && c?.point ? lens().toWorld(c.point.x, c.point.y) : null);   // where you clicked, in table coordinates
    offMenu = [
      menu.provide('scrap', {                                  // a scrap: its own menu, nobody adds to it
        rank: 10,
        match: t => t.closest?.('.scrap'),
        items: ({ hit }) => scrapItems(byId(hit.closest('.scrap').dataset.id)),
      }),
      menu.provide('scrap-table', {                            // the bare table: creating things; the shell's items follow
        rank: 80, inherit: true,
        match: t => lens() && t.closest?.('#world') && !t.closest('.cell, .scrap'),
        items: () => [
          { label: 'New note', icon: ICO.text, run: c => blank('text', at(c)) },
          { label: 'New image', icon: ICO.image, run: c => blank('image', at(c)) },
          { label: 'New file', icon: ICO.file, run: c => blank('file', at(c)) },
          { label: 'New folder', icon: ICO.dir, run: c => blank('dir', at(c)) },
          { sep: true },
          { label: 'Paste', icon: ICO.paste, run: c => paste(at(c) || lens()?.center() || { x: 0, y: 0 }) },
        ],
      }),
    ];
  }

  const CSS = `
    #scraps{position:absolute;left:0;top:0;width:0;height:0;z-index:5;display:none}
    .lens-mesa #scraps{display:block}
    .scrap{--u:calc(var(--bw, 2px) / var(--k, 1));--d:calc(50% - var(--u) * 2);--l:calc(50% - var(--u) / 2);
      position:absolute;display:flex;flex-direction:column;overflow:hidden;container-type:size;background:var(--panel-solid);color:var(--ink);
      border:calc(var(--bw) / var(--k,1)) dashed var(--edge)}
    .scrap:focus-within{border-style:solid;border-color:var(--ink)}
    .scrap.gone{opacity:.5}
    .scrap.born{animation:sc-born var(--mo-open, 560ms) both;pointer-events:none}
    @keyframes sc-born{
      0%  {clip-path:inset(50% 50% 50% 50%);animation-timing-function:ease-out}
      12% {clip-path:inset(var(--d) var(--d) var(--d) var(--d))}
      20% {clip-path:inset(var(--d) var(--d) var(--d) var(--d));animation-timing-function:cubic-bezier(.65,0,.35,1)}
      50% {clip-path:inset(var(--l) 0 var(--l) 0)}
      58% {clip-path:inset(var(--l) 0 var(--l) 0);animation-timing-function:cubic-bezier(.65,0,.35,1)}
      100%{clip-path:inset(0 0 0 0)}
    }
    .sc-bar{display:flex;align-items:center;gap:6px;height:24px;flex:none;padding:0 2px 0 8px;cursor:grab;user-select:none;touch-action:none;color:var(--ink2);
      border-bottom:calc(var(--bw) / var(--k,1)) dashed var(--line)}
    .scrap:hover .sc-bar,.scrap:focus-within .sc-bar{color:var(--ink)}
    .sc-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:10px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase}
    .sc-btns{display:flex;opacity:0;transition:opacity .15s}
    .scrap:hover .sc-btns,.scrap:focus-within .sc-btns{opacity:1}
    .sc-btns button{border:0;background:transparent;color:inherit;width:22px;height:22px;cursor:pointer;font:13px/1 var(--mono)}
    .sc-btns button:hover{background:var(--ink);color:var(--bg)}
    .sc-body{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
    .sc-body textarea{flex:1;min-height:0;width:100%;resize:none;border:0;outline:none;padding:8px 10px;background:transparent;color:var(--ink);font:12px/1.55 var(--mono)}
    .sc-body textarea[readonly]{color:var(--ink2);cursor:default}
    .sc-body img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;user-select:none;pointer-events:none}
    .sc-list{margin:0;padding:6px 10px;list-style:none;overflow:hidden;font:11px/1.6 var(--mono);color:var(--ink2)}
    .sc-list li{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sc-big{margin:auto auto 0;text-align:center;font:600 22px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase}
    .sc-meta{margin:6px 0 auto;padding:0 8px;text-align:center;font:10px/1.5 var(--mono);color:var(--ink2);word-break:break-all}
    /* blank scrap: a dashed slot waiting for its content */
    .sc-ph{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;margin:8px;padding:8px;
      border:calc(var(--bw) / var(--k,1)) dashed var(--line)}
    .sc-ph .sc-meta{margin:0;padding:0}
    .sc-pick{padding:7px 14px;border:var(--bw) solid var(--ink);background:transparent;color:var(--ink);cursor:pointer;font:600 11px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase}
    .sc-pick:hover{background:var(--ink);color:var(--bg)}
    .sc-in{width:100%;max-width:170px;padding:6px 8px;border:var(--bw) solid var(--edge);background:transparent;color:var(--ink);font:12px/1 var(--mono);outline:none}
    .sc-in:focus{border-color:var(--ink)}
    .sc-grip{position:absolute;right:0;bottom:0;width:12px;height:12px;cursor:nwse-resize;touch-action:none;
      border-right:calc(var(--bw) / var(--k,1)) solid var(--ink2);border-bottom:calc(var(--bw) / var(--k,1)) solid var(--ink2)}
    /* semantic zoom: far away a scrap is just its name, kept at a constant visual size */
    .sc-mini{display:none;position:absolute;inset:0;z-index:1;align-items:center;justify-content:center;padding:8px;text-align:center;
      background:var(--panel-solid);cursor:grab;user-select:none;touch-action:none}
    .sc-mini span{max-height:100%;overflow:hidden;font:600 min(calc(12px / var(--k,1)),14cqmin)/1.2 var(--mono);letter-spacing:.08em;text-transform:uppercase}
    .far .sc-mini{display:flex}
    .far .sc-bar,.far .sc-body,.far .sc-grip{visibility:hidden}
  `;

  return {
    id: 'ui.retazos', name: 'Component · Scraps',
    async start() {
      dead = false;
      ui.style(CSS);
      layer = document.createElement('div'); layer.id = 'scraps';
      ui.mount('plane', layer);
      ui.on(layer, 'pointerdown', onDown);
      ui.on(layer, 'dblclick', onDbl);
      ui.on(layer, 'click', onClick);
      ui.on(layer, 'keydown', onKey);
      ui.on(window, 'pointermove', onMove);
      ui.on(window, 'pointerup', onUp);

      /* files dropped from the computer land where they are dropped (on a blank scrap: they fill that one) */
      const world = document.getElementById('world');
      ui.on(world, 'dragover', e => { if (lens() && [...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
      ui.on(world, 'drop', e => {
        const L = lens(), files = e.dataTransfer?.files; if (!L || !files?.length) return;
        e.preventDefault();
        const hit = byId(e.target.closest?.('.scrap')?.dataset.id), fail = err => M.notify('Could not pin', err.message);
        if (hit && !hit.path && (hit.kind === 'image' || hit.kind === 'file')) attach(hit, files[0]).catch(fail);
        else importFiles([...files], L.toWorld(e.clientX, e.clientY)).catch(fail);
      });

      ui.defer(M.bus.on('mesa:view', placeAll));
      ui.defer(M.bus.on('lens:changed', placeAll));
      ui.defer(M.bus.on('k:fs:write', ({ path } = {}) => list.filter(s => s.path === path).forEach(s => fill(s))));
      ui.defer(M.bus.on('k:fs:remove', ({ path } = {}) => list.filter(s => under(s.path, path)).forEach(s => unpin(s.id, true))));
      ui.defer(M.bus.on('k:fs:move', ({ src, dst } = {}) => {
        const hit = list.filter(s => under(s.path, src));
        hit.forEach(s => { s.path = dst + s.path.slice(src.length); fill(s); });
        if (hit.length) save();
      }));
      ui.defer(M.intents.provide('scraps', wishes));
      ui.defer(M.api.register('scraps', {
        pin: async (ctx, path) => (await pin(path)).id,
        list: () => list.map(({ id, path }) => ({ id, path })),
      }, { pin: 'fs.read' }));

      /* the right-click menu may start before or after this component, and may restart */
      const m = M.svc.get('menu'); if (m) hook(m);
      ui.defer(M.bus.on('svc:provided', ({ name } = {}) => { if (name === 'menu') hook(M.svc.get('menu')); }));
      ui.defer(unhook);

      const saved = await Kernel.prefs.get(KEY, []);
      for (const s of Array.isArray(saved) ? saved : [])
        if (s && s.id && (s.path || s.kind) && [s.x, s.y, s.w, s.h].every(Number.isFinite)) add(s);
    },
    stop() {
      els.forEach(r => { r.flush(); if (r.url) URL.revokeObjectURL(r.url); });
      Kernel.prefs.set(KEY, list).catch(() => { });
      dead = true;                                             // a pending debounced save must not run after this
      els.clear(); drag = null;
      ui.dispose();
    },
  };
}