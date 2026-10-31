function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('pliego');
  const E = M.util.esc;
  const el = document.createElement('div');
  el.id = 'pliego'; el.hidden = true;
  let sel = 0, items = [], opened = false, hideT;

  const build = () => M.svc.get('lock')?.build || { channel: 'development', mirage: M.version, kernel: Kernel.version || '?' };
  const mins = () => { const m = Math.round(performance.now() / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };

  const DO = {
    lock: () => M.svc.get('lock') ? M.svc.get('lock').lock() : M.notify('No lock screen', 'The lock component is not loaded'),
    reload: async () => { for (const m of Kernel.modules.list('componente')) await Kernel.modules.restart(m.path); },
    reboot: () => location.reload(),
    repair: () => { if (confirm('Go to repair mode?')) Kernel.repair.redirectToRepair('manual', {}); },
    overview: () => M.lens.current?.overview?.(),
    clear: () => M.cells.list().forEach(c => M.cells.stow(c.id)),
  };
  const KEYS = { l: 'lock', r: 'reload', b: 'reboot', p: 'repair', v: 'overview', c: 'clear' };
  const run = async n => { try { await DO[n](); } catch (e) { M.notify('The fold failed', e.message); } };

  const btn = (key, label, d, hot) => `<button class="pl-act${hot ? ' hot' : ''}" data-do="${d}"><span>${label}</span><kbd>${key}</kbd></button>`;
  const ico = i => `<span class="pl-ico">${Kernel.icons.render(i)}</span>`;

  async function render() {
    const u = await Kernel.users.current();
    const b = build(), md = M.svc.get('mood'), mo = md?.get();
    const cells = M.cells.list();
    const apps = M.catalog.list().sort((x, y) => x.name.localeCompare(y.name));
    const live = cells.filter(c => c.state !== 'stowed').length;
    items = [...cells.map(c => ({ t: 'cell', id: c.id })), ...apps.map(a => ({ t: 'app', id: a.id }))];
    sel = Math.max(0, Math.min(sel, items.length - 1));

    const info = [
      ['user', u ? u.name : 'no session'],
      ['lens', M.lens.current?.name || '—'],
      ['mood', mo ? (mo.choice === 'auto' ? 'auto · ' + mo.applied : mo.choice) : '—'],
      ['cells', `${live} on table · ${cells.length - live} in pocket`],
      ['uptime', mins()],
      ['boot', M.boot?.safeMode ? 'safe mode' : 'normal'],
    ];
    const row = (i, icon, title, hint) =>
      `<li class="pl-row${i === sel ? ' on' : ''}" data-i="${i}">${ico(icon)}<span class="pl-t">${E(title)}</span><span class="pl-h">${E(hint)}</span></li>`;

    el.innerHTML =
      `<div class="pl-col pl-a"><div class="pl-brand"><b>Mirage</b><span class="pl-stamp">${E(b.channel)}</span></div>` +
      `<div class="pl-ver">mirage ${E(b.mirage)} · kernel ${E(b.kernel)}</div>` +
      `<dl class="pl-info">${info.map(([k, v]) => `<dt>${k}</dt><dd>${E(v)}</dd>`).join('')}</dl><div class="pl-sp"></div>` +
      `<div class="pl-acts">${btn('L', 'Lock', 'lock', true)}${btn('R', 'Reload interface', 'reload')}${btn('B', 'Reboot all', 'reboot')}${btn('P', 'Repair', 'repair')}</div></div>` +

      `<div class="pl-col pl-b"><div class="pl-h2">Index</div><ul class="pl-list">` +
      (cells.length ? '<li class="pl-grp">On the table</li>' + cells.map((c, i) => row(i, c.icon, c.title, c.state === 'stowed' ? 'pocket' : 'open')).join('') : '') +
      '<li class="pl-grp">Cells</li>' + apps.map((a, k) => row(cells.length + k, a.icon, a.name, k < 9 ? String(k + 1) : '')).join('') +
      `</ul><div class="pl-foot"><kbd>↑↓</kbd><kbd>Enter</kbd><kbd>1–9</kbd><kbd>Space</kbd> Wish</div></div>` +

      `<div class="pl-col pl-c"><div class="pl-h2">Table</div><div class="pl-lbl">lens</div>` +
      `<div class="pl-seg">${M.lens.list().map(l => `<button data-lens="${l.id}" class="${l.id === M.lens.current?.id ? 'on' : ''}">${E(l.name)}</button>`).join('')}</div>` +
      `<div class="pl-lbl">mood</div><div class="pl-seg v">${md ? md.list().map(m => `<button data-mood="${m.id}" class="${m.id === mo.choice ? 'on' : ''}">${E(m.name)}</button>`).join('') : '<span class="pl-h">no service</span>'}</div>` +
      `<div class="pl-sp"></div><div class="pl-acts">${btn('V', 'View all', 'overview')}${btn('C', 'Clear table', 'clear')}</div></div>`;
  }
  function mark() {
    el.querySelectorAll('.pl-row').forEach(r => r.classList.toggle('on', +r.dataset.i === sel));
    el.querySelector('.pl-row.on')?.scrollIntoView({ block: 'nearest' });
  }

  const tab = () => document.querySelector('[data-p=menu]');
  async function open() {
    if (opened || M.svc.get('lock')?.isLocked()) return;
    opened = true; clearTimeout(hideT); sel = 0;
    await render();
    el.hidden = false; void el.offsetWidth; el.classList.add('open');
    tab()?.classList.add('on');
  }
  function close() {
    if (!opened) return;
    opened = false; el.classList.remove('open'); tab()?.classList.remove('on');
    hideT = setTimeout(() => { if (!opened) el.hidden = true; }, 300);
    const c = M.cells.get(M.cells.focusedId); if (c) try { c.frame.contentWindow.focus(); } catch { }
  }
  function go(i) {
    const it = items[i]; if (!it) return;
    close();
    if (it.t === 'cell') { M.cells.unstow(it.id); M.cells.focus(it.id); M.lens.current?.fit?.(it.id); }
    else M.cells.open(it.id).catch(e => M.notify('Could not open', e.message));
  }

  ui.on(el, 'click', e => {
    const r = e.target.closest('[data-i]'); if (r) return go(+r.dataset.i);
    const d = e.target.closest('[data-do]'); if (d) { close(); return run(d.dataset.do); }
    const l = e.target.closest('[data-lens]'); if (l) return void M.lens.use(l.dataset.lens);
    const m = e.target.closest('[data-mood]'); if (m) return void M.svc.get('mood')?.set(m.dataset.mood);
  });
  ui.on(el, 'pointerover', e => { const r = e.target.closest('[data-i]'); if (r && +r.dataset.i !== sel) { sel = +r.dataset.i; mark(); } });
  ui.on(document, 'pointerdown', e => { if (opened && !e.target.closest('#pliego,[data-p=menu]')) close(); });
  ui.on(window, 'blur', () => { if (opened) close(); });      // click inside a cell (iframe)

  /* Capture phase: while open the Fold keeps the keys (except Ctrl/Alt+Space, which belong to the Wish) */
  ui.on(window, 'keydown', e => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyM') { e.preventDefault(); opened ? close() : open(); return; }
    if (!opened) return;
    if (e.ctrlKey || e.metaKey || e.altKey) { if ((e.ctrlKey || e.altKey) && e.code === 'Space') close(); return; }
    const k = e.key, stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === 'Escape') { stop(); close(); }
    else if (k === 'ArrowDown' || k === 'ArrowUp') { stop(); sel = (sel + (k === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length); mark(); }
    else if (k === 'Enter') { stop(); go(sel); }
    else if (/^[1-9]$/.test(k)) { stop(); const a = items.filter(i => i.t === 'app')[+k - 1]; if (a) go(items.indexOf(a)); }
    else if (k === ' ' || k === '/') { stop(); close(); M.bus.emit('key:wish', {}); }
    else if (KEYS[k.toLowerCase()]) { stop(); close(); run(KEYS[k.toLowerCase()]); }
    else if (k.length === 1) close();                       // any other letter: the Wish picks it up, as always
  }, true);

  ui.defer(M.bus.on('key:menu', () => opened ? close() : open()));
  for (const t of ['cell:added', 'cell:removed', 'cell:changed', 'lens:changed', 'mood:changed', 'catalog:changed'])
    ui.defer(M.bus.on(t, () => { if (opened) render(); }));
  ui.defer(M.bus.on('lock:changed', () => close()));

  return {
    id: 'ui.pliego', name: 'Component · Fold',
    start() {
      ui.style(`
        #pliego{position:absolute;left:0;top:30px;z-index:25;display:flex;width:min(800px,100vw);height:min(460px,calc(100% - 66px))}
        #pliego[hidden]{display:none}
        #pliego:not(.open){pointer-events:none}
        .pl-col{display:flex;flex-direction:column;gap:8px;min-width:0;padding:14px 16px;overflow:hidden;background:var(--panel-solid);
          border-bottom:var(--bw) solid var(--ink);transform-origin:left center;transform:scaleX(0);transition:transform .22s cubic-bezier(.2,.8,.2,1)}
        #pliego.open .pl-col{transform:scaleX(1)}
        #pliego.open .pl-b{transition-delay:.07s} #pliego.open .pl-c{transition-delay:.14s}
        .pl-a{width:230px;flex:none;border-right:var(--bw) dashed var(--edge)}
        .pl-b{flex:1;border-right:var(--bw) dashed var(--edge)}
        .pl-c{width:200px;flex:none;border-right:var(--bw) solid var(--ink)}
        @media(max-width:700px){.pl-a{display:none}} @media(max-width:480px){.pl-c{display:none}}
        .pl-brand{display:flex;align-items:center;justify-content:space-between;gap:8px}
        .pl-brand b{font:600 18px/1 var(--mono);letter-spacing:.4em;text-transform:uppercase}
        .pl-stamp{border:var(--bw) solid var(--ink);padding:3px 7px;font:600 10px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;transform:rotate(-4deg)}
        .pl-ver{font:11px/1.4 var(--mono);color:var(--ink2);letter-spacing:.04em}
        .pl-info{display:grid;grid-template-columns:auto 1fr;gap:5px 12px;margin:8px 0 0;font:11px/1.4 var(--mono)}
        .pl-info dt{color:var(--ink2);text-transform:uppercase;letter-spacing:.08em}
        .pl-info dd{margin:0;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .pl-sp{flex:1}
        .pl-h2,.pl-lbl,.pl-grp{font:11px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ink2)}
        .pl-h2{padding-bottom:8px;border-bottom:var(--bw) solid var(--line);color:var(--ink)}
        .pl-lbl{margin-top:6px}
        .pl-list{list-style:none;margin:0 -16px;padding:0;overflow:auto;flex:1}
        .pl-grp{padding:10px 16px 4px}
        .pl-row{display:flex;align-items:center;gap:10px;padding:6px 16px;cursor:pointer}
        .pl-row.on{background:var(--ink);color:var(--bg)}
        .pl-t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .pl-h{margin-left:auto;font:11px/1 var(--mono);color:var(--ink2)} .pl-row.on .pl-h{color:inherit;opacity:.65}
        .pl-ico{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px;font-size:16px;filter:grayscale(1)}
        .pl-ico svg{fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:square;stroke-linejoin:miter;width:1em;height:1em}
        .pl-acts{display:flex;flex-direction:column;gap:6px}
        .pl-act{display:flex;justify-content:space-between;align-items:center;width:100%;padding:7px 10px;border:var(--bw) solid var(--line);background:none;color:var(--ink);cursor:pointer;font:inherit}
        .pl-act.hot{border-color:var(--ink)}
        .pl-act:hover{background:var(--ink);color:var(--bg);border-color:var(--ink)}
        .pl-act kbd,.pl-foot kbd{font:10px/1.6 var(--mono);border:var(--bw) solid currentColor;opacity:.6;padding:0 5px;border-radius:2px}
        .pl-seg{display:flex;flex-wrap:wrap;border:var(--bw) solid var(--line)}
        .pl-seg.v{flex-direction:column}
        .pl-seg button{flex:1;padding:6px 8px;border:0;background:none;color:var(--ink);cursor:pointer;font:11px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;text-align:left}
        .pl-seg button:not(.on):hover{background:var(--panel)}
        .pl-seg button.on{background:var(--ink);color:var(--bg)}
        .pl-foot{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font:11px/1 var(--mono);color:var(--ink2)}
        #pulso [data-p=menu].on{background:var(--ink);color:var(--bg)}
        .p-dev{margin-left:8px;padding:1px 4px;border:var(--bw) solid currentColor;font:600 9px/1.2 var(--mono);letter-spacing:.1em}
      `);
      ui.mount('chrome', el);
    },
    stop() { clearTimeout(hideT); ui.dispose(); },
  };
}