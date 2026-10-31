/* Component · WISH (remastered) — replaces the start menu, the search box and the command terminal.
   Ctrl/Alt+Space (also from inside a cell), or type any letter over the background.
   · empty: Recent (what you use most) · Recently closed · Pocket · Cells
   · it learns: what you run rises in the list (how often, discounted by how long ago)
   · Tab or → opens the other actions of the selected result (go to it, pin to the table, forget…) · Esc or ← goes back
   · a result may carry `id` (a stable key; without one nothing is learned) and `actions: [{ title, hint?, run }]`
   Same triggers and the same provider contract as before. wish.js stays as a fallback: swap the line in index.json. */
function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('deseo');
  const E = M.util.esc;
  const KEY = 'mirage.wish.use', KEEP = 300, HALF_LIFE = 7 * 86400e3, CAP = .3;
  const SECTIONS = ['Recent', 'Recently closed', 'Pocket', 'Cells'];

  const el = document.createElement('div');
  el.id = 'wish'; el.hidden = true;
  el.innerHTML =
    '<div class="w-box"><div class="w-input"><span class="w-glyph">&gt;</span><span class="w-crumb" hidden></span>' +
    '<input type="text" spellcheck="false" autocomplete="off" placeholder="app · file · note hello · 2+2 · lens mosaic · reopen · clip"><kbd class="w-cnt">esc</kbd></div>' +
    '<ul class="w-list"></ul><div class="w-foot"></div></div>';
  const input = el.querySelector('input'), list = el.querySelector('.w-list'), foot = el.querySelector('.w-foot');
  const glyph = el.querySelector('.w-glyph'), crumb = el.querySelector('.w-crumb'), cnt = el.querySelector('.w-cnt');
  let results = [], acts = null, sel = 0, seq = 0, use = {}, still = false, dead = false, hideT = 0, openT = 0;
  const ms = (v, d) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v)) || d;
  const isOpen = () => !el.hidden && !el.classList.contains('closing');
  const saveUse = M.util.debounce(() => { if (!dead) Kernel.prefs.set(KEY, use).catch(() => { }); }, 800);

  /* ── learning: frecency ── */
  function boost(key) {
    const u = key && use[key]; if (!u) return 0;
    return Math.min(CAP, Math.log1p(u.n) * .06) * Math.pow(.5, (Date.now() - u.t) / HALF_LIFE);
  }
  function remember(r) {
    if (!r.id) return;
    const u = use[r.id] || { n: 0 };
    use[r.id] = { n: u.n + 1, t: Date.now() };
    const keys = Object.keys(use);
    if (keys.length > KEEP) for (const k of keys.sort((a, b) => boost(a) - boost(b)).slice(0, keys.length - KEEP)) delete use[k];
    saveUse();
  }

  /* ── searching ── */
  function sections(all) {                                     // the empty Wish: sections instead of an arbitrary list
    const recent = all.filter(x => x.provider === 'apps' && boost(x.id) > 0)
      .sort((a, b) => boost(b.id) - boost(a.id)).slice(0, 5).map(x => ({ ...x, group: 'Recent' }));
    const taken = new Set(recent.map(x => x.id));
    const rest = all.filter(x => !(x.id && taken.has(x.id)));
    const out = [...recent];
    for (const g of SECTIONS.slice(1)) {
      const part = rest.filter(x => x.group === g);
      out.push(...(g === 'Cells' ? part.sort((a, b) => a.title.localeCompare(b.title)) : part.sort((a, b) => b.score - a.score).slice(0, 3)));
    }
    return out;
  }
  async function search() {
    const my = ++seq, q = input.value.trim();
    const r = await M.intents.query(q, { limit: q ? 14 : 80, rank: x => x.score + boost(x.id) });
    if (my !== seq) return;                                    // a newer answer arrived
    results = q ? r : sections(r);
    sel = 0; render();
  }

  const TAGS = { apps: 'APP', files: 'FILE', pocket: 'CLIP', ghosts: 'GONE' };
  const tagOf = r => r.tag || TAGS[r.provider] || ({ Math: 'MATH', Info: 'INFO' }[r.group]) || 'ACT';
  function level(id) {
    const u = id && use[id]; if (!u) return 0;
    const e = u.n * Math.pow(.5, (Date.now() - u.t) / HALF_LIFE);
    return e >= 15 ? 4 : e >= 7 ? 3 : e >= 3 ? 2 : e >= .75 ? 1 : 0;
  }
  function paintFoot() {
    const alt = '<span><kbd>Alt</kbd>+<kbd>1…9</kbd> direct</span>';
    foot.innerHTML = acts
      ? '<span><kbd>↑↓</kbd> move</span><span><kbd>Enter</kbd> run</span>' + alt + '<span><kbd>Esc</kbd> back</span>'
      : '<span><kbd>↑↓</kbd> move</span><span><kbd>Enter</kbd> run</span>' + (results[sel]?.actions?.length ? '<span><kbd>Tab</kbd> actions</span>' : '') + alt + '<span><kbd>Esc</kbd> close</span>';
  }
  function render() {
    const rows = acts ? acts.items : results, q = input.value.trim();
    cnt.textContent = acts ? `${rows.length} action${rows.length === 1 ? '' : 's'}` : q ? `${rows.length} result${rows.length === 1 ? '' : 's'}` : 'esc';
    if (!rows.length) { list.innerHTML = `<li class="w-empty">${acts ? 'no other actions' : 'nothing found'}</li>`; paintFoot(); return; }
    const runs = [];                                           // how many rows each section header covers
    if (!acts) rows.forEach((r, i) => { if (!i || r.group !== rows[i - 1].group) runs.push({ at: i, n: 0 }); runs[runs.length - 1].n++; });
    const count = new Map(runs.map(x => [x.at, x.n]));
    list.innerHTML = rows.map((r, i) => {
      const head = !acts && r.group && count.has(i) ? `<li class="w-group"><span>${E(r.group)}</span><i></i><span>${count.get(i)}</span></li>` : '';
      const sub = acts ? '' : r.sub ?? r.hint ?? '';
      const lv = acts ? 0 : level(r.id);
      const dots = lv ? `<span class="w-dots" title="how much you use it">${'●'.repeat(lv)}${'○'.repeat(4 - lv)}</span>` : '';
      const num = i < 9 ? `<span class="w-n">Alt+${i + 1}</span>` : '';
      const more = !acts && r.actions?.length ? '<kbd class="w-tab">tab</kbd>' : '';
      const side = acts && r.hint ? `<span>${E(r.hint)}</span>` : '';
      return head + `<li class="w-item${i === sel ? ' on' : ''}" data-i="${i}" style="--i:${Math.min(i, 9)}">` +
        (acts ? '' : `<span class="w-k">${tagOf(r)}</span>`) +
        `<span class="w-body"><span class="w-t">${E(r.title)}</span>${sub ? `<span class="w-s">${E(sub)}</span>` : ''}</span>` +
        `<span class="w-r">${side}${dots}${num}${more}</span></li>`;
    }).join('');
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    paintFoot();
  }
  function mark() {                                            // moving the selection does not rebuild the list
    list.querySelectorAll('.w-item').forEach(li => li.classList.toggle('on', +li.dataset.i === sel));
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    paintFoot();
  }

  /* ── the other actions of a result ── */
  function enterActs() {
    const r = results[sel];
    if (acts || !r?.actions?.length) return;
    acts = { of: r, items: r.actions, back: sel };
    crumb.textContent = r.title; crumb.hidden = false; glyph.hidden = true;
    sel = 0; render();
  }
  function leaveActs() {
    if (!acts) return;
    sel = acts.back; acts = null;
    crumb.hidden = true; glyph.hidden = false;
    render();
  }

  async function run(i) {
    const item = (acts ? acts.items : results)[i]; if (!item) return;
    const r = acts ? acts.of : item, act = acts ? item : null;
    close();
    try { await (act ? act.run() : M.intents.run(r)); remember(r); }
    catch (e) { M.notify('The wish failed', e.message); }
  }

  /* ── opening and closing ── */
  function open(seed = '') {
    clearTimeout(hideT); clearTimeout(openT);
    acts = null; crumb.hidden = true; glyph.hidden = false;
    el.hidden = false; el.classList.remove('closing', 'opening');
    if (!still) { void el.offsetWidth; el.classList.add('opening'); openT = setTimeout(() => el.classList.remove('opening'), ms('--mo-open', 560) * .6 + 100); }
    input.value = seed; input.focus(); search();
  }
  function close() {
    if (!isOpen()) return;
    input.blur();
    const c = M.cells.get(M.cells.focusedId); if (c) try { c.frame.contentWindow.focus(); } catch { }
    clearTimeout(openT); el.classList.remove('opening');
    if (still) { el.hidden = true; return; }
    el.classList.add('closing');
    hideT = setTimeout(() => { el.hidden = true; el.classList.remove('closing'); }, ms('--mo-close', 460) * .4 + 40);
  }

  ui.on(input, 'input', () => { if (acts) { acts = null; crumb.hidden = true; glyph.hidden = false; } search(); });
  ui.on(input, 'keydown', e => {
    const n = (acts ? acts.items : results).length;
    const d = e.altKey && !e.ctrlKey && !e.metaKey ? /^Digit([1-9])$/.exec(e.code) : null;
    if (d) { e.preventDefault(); run(+d[1] - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); acts ? leaveActs() : close(); }
    else if (e.key === 'ArrowLeft' && acts) { e.preventDefault(); leaveActs(); }
    else if (e.key === 'Tab') { e.preventDefault(); acts ? leaveActs() : enterActs(); }
    else if (e.key === 'ArrowRight' && !acts && input.selectionStart === input.value.length && results[sel]?.actions?.length) { e.preventDefault(); enterActs(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, n); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + n) % Math.max(1, n); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
  });
  ui.on(list, 'click', e => { const li = e.target.closest('.w-item'); if (li) run(+li.dataset.i); });
  ui.on(list, 'pointermove', e => { const li = e.target.closest('.w-item'); if (li && +li.dataset.i !== sel) { sel = +li.dataset.i; mark(); } });
  ui.on(el, 'pointerdown', e => { if (e.target === el) close(); });

  /* Global triggers (unchanged) */
  ui.on(window, 'keydown', e => {
    if ((e.ctrlKey || e.altKey) && e.code === 'Space') { e.preventDefault(); isOpen() ? close() : open(); return; }
    const t = e.target;
    if (isOpen() || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === ' ') return;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault(); open(e.key);
  });
  ui.defer(M.bus.on('key:wish', () => (isOpen() ? close() : open())));

  async function loadPrefs() {
    still = matchMedia('(prefers-reduced-motion: reduce)').matches || (await Kernel.prefs.get('app.config.anim', true)) === false;
  }
  ui.defer(M.bus.on('k:prefs:change', ({ key } = {}) => { if (String(key).startsWith('app.config.')) loadPrefs(); }));

  const CSS = `
    #wish{position:absolute;inset:0;z-index:50;display:flex;justify-content:center;align-items:flex-start;padding-top:14vh;background:var(--scrim)}
    #wish[hidden]{display:none}
    #wish.opening{animation:w-fade calc(var(--mo-open, 560ms) * .4) both}
    #wish.closing{animation:w-fade calc(var(--mo-close, 460ms) * .4) reverse both;pointer-events:none}
    @keyframes w-fade{from{opacity:0}}
    .w-box{--k0:inset(0 calc(50% - 2px) calc(100% - 4px) calc(50% - 2px));--k1:inset(0 0 calc(100% - 2px) 0);
      width:min(620px,92vw);background:var(--panel-solid);border:var(--bw) solid var(--ink)}
    #wish.opening .w-box{animation:w-open calc(var(--mo-open, 560ms) * .6) both}
    #wish.closing .w-box{animation:w-shut calc(var(--mo-close, 460ms) * .4) both}
    @keyframes w-open{0%,16%{clip-path:var(--k0)}42%{clip-path:var(--k1)}100%{clip-path:inset(0 0 0 0)}}
    @keyframes w-shut{0%{clip-path:inset(0 0 0 0)}55%{clip-path:var(--k1)}100%{clip-path:var(--k0)}}
    .w-input{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:var(--bw) solid var(--line)}
    .w-glyph{font:600 16px/1 var(--mono)}
    .w-crumb{flex:none;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:3px 8px;border:var(--bw) solid var(--ink);
      font:600 11px/1.2 var(--mono);letter-spacing:.06em;text-transform:uppercase}
    .w-crumb[hidden],.w-glyph[hidden]{display:none}
    .w-input input{flex:1;min-width:0;background:none;border:0;outline:0;color:var(--ink);font:16px/1.4 var(--font)}
    .w-input input::placeholder{color:var(--ink2)}
    .w-input kbd,.w-foot kbd{font:10px/1.6 var(--mono);color:var(--ink2);border:var(--bw) solid var(--line);padding:0 5px;border-radius:2px;letter-spacing:.06em}
    .w-list{list-style:none;margin:0;padding:0;max-height:50vh;overflow:auto}
    .w-group{display:flex;align-items:center;gap:8px;padding:10px 16px 4px;font:11px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink2)}
    .w-group i{flex:1;border-bottom:var(--bw) dotted var(--edge);transform:translateY(-2px)}
    .w-cnt{white-space:nowrap}
    .w-item{position:relative;display:flex;align-items:center;gap:12px;padding:7px 16px;cursor:pointer}
    .w-item::after{content:"";position:absolute;left:16px;right:16px;bottom:0;border-bottom:var(--bw) dashed var(--line);pointer-events:none}
    .w-item.on{background:var(--ink);color:var(--bg)}
    .w-item.on::after{display:none}
    #wish.opening .w-item::after{transform-origin:left;animation:w-rule calc(var(--mo-open, 560ms) * .5) cubic-bezier(.2,.8,.2,1) both;
      animation-delay:calc(var(--mo-open, 560ms) * .3 + var(--i, 0) * 30ms)}
    @keyframes w-rule{from{transform:scaleX(0)}}
    .w-k{flex:none;min-width:46px;padding:2px 4px;border:var(--bw) solid var(--line);color:var(--ink2);font:10px/1.3 var(--mono);letter-spacing:.06em;text-align:center}
    .w-item.on .w-k{border-color:currentColor;color:inherit;opacity:.7}
    .w-body{display:flex;flex-direction:column;flex:1;min-width:0;gap:1px}
    .w-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .w-s{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink2);font:11px/1.35 var(--mono)}
    .w-item.on .w-s{color:inherit;opacity:.65}
    .w-r{display:flex;align-items:center;gap:10px;flex:none;color:var(--ink2);font:11px/1 var(--mono);white-space:nowrap}
    .w-item.on .w-r{color:inherit;opacity:.8}
    .w-dots{letter-spacing:.12em}
    .w-item .w-tab{display:none;padding:0 5px;border:var(--bw) solid currentColor;border-radius:2px;color:inherit;font:10px/1.6 var(--mono);opacity:.65} .w-item.on .w-tab{display:inline-block}
    .w-empty{padding:16px;color:var(--ink2);font:12px/1 var(--mono)}
    .w-foot{display:flex;flex-wrap:wrap;gap:4px 14px;padding:7px 16px;border-top:var(--bw) solid var(--line);color:var(--ink2);font:10px/1.4 var(--mono);letter-spacing:.04em}
  `;

  return {
    id: 'ui.wish', name: 'Component · Wish',
    async start() {
      dead = false;
      ui.style(CSS);
      ui.mount('overlay', el);
      await loadPrefs();
      const saved = await Kernel.prefs.get(KEY, {});
      use = saved && typeof saved === 'object' ? saved : {};
    },
    stop() {
      clearTimeout(hideT); clearTimeout(openT);
      Kernel.prefs.set(KEY, use).catch(() => { });
      dead = true;                                             // a pending debounced save must not run after this
      ui.dispose();
    },
  };
}