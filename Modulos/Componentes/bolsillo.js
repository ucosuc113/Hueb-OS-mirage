
function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('bolsillo');
  const dock = document.createElement('div');
  dock.id = 'bolsillo';

  const POCKET = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M4 5h16v9a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z'/><path d='M4 9h16'/></svg>";
  function render() {
    const stowed = M.cells.list().filter(c => c.state === 'stowed'), inv = M.svc.get('inventory');
    dock.hidden = !stowed.length && !inv;
    dock.innerHTML =
      (inv ? `<button class="b-chip b-inv${inv.isOpen() ? ' on' : ''}" data-inv title="Pocket (Alt+P)"><i>${Kernel.icons.render(POCKET)}</i><span>Pocket · ${inv.count()}${inv.isPaused() ? ' · paused' : ''}</span></button>` : '') +
      stowed.map(c =>
        `<button class="b-chip" data-id="${c.id}" title="Take out of the pocket"><i>${Kernel.icons.render(c.icon)}</i><span>${M.util.esc(c.title)}</span></button>`).join('');
  }
  ui.on(dock, 'click', e => {
    if (e.target.closest('[data-inv]')) return void M.svc.get('inventory')?.toggle();
    const b = e.target.closest('.b-chip'); if (!b) return;
    M.cells.unstow(b.dataset.id); M.cells.focus(b.dataset.id); M.lens.current?.fit?.(b.dataset.id);
  });
  for (const t of ['cell:added', 'cell:changed', 'cell:removed', 'ready', 'inventory:changed', 'svc:provided']) ui.defer(M.bus.on(t, render));

  return {
    id: 'ui.bolsillo', name: 'Component · Pocket',
    start() {
      ui.style(`
        #bolsillo{position:absolute;left:0;bottom:0;display:flex;max-width:100vw;overflow-x:auto;background:var(--bg);border-top:var(--bw) solid var(--line);border-right:var(--bw) solid var(--line)}
        #bolsillo[hidden]{display:none}
        .b-chip{display:flex;align-items:center;gap:8px;border:0;border-right:var(--bw) solid var(--line);background:none;color:var(--ink);padding:0 14px;height:30px;cursor:pointer;font:11px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
        .b-chip:last-child{border-right:0}
        .b-chip:hover{background:var(--ink);color:var(--bg)}
        .b-chip i{width:14px;height:14px;font-size:14px;font-style:normal}
        .b-inv{border-right:var(--bw) solid var(--ink)}
        .b-inv.on{background:var(--ink);color:var(--bg)}
        .b-inv{border-right:var(--bw) solid var(--ink)}
        .b-inv.on{background:var(--ink);color:var(--bg)}
      `);
      ui.mount('chrome', dock); render();
    },
    stop() { ui.dispose(); },
  };
}
