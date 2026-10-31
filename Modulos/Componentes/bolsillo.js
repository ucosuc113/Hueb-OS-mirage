/* Component · POCKET — where cells are stored instead of being "minimized".
   A stowed cell stays alive (its process and iframe are untouched): it just stops getting in the way. */
function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('bolsillo');
  const dock = document.createElement('div');
  dock.id = 'bolsillo';

  function render() {
    const stowed = M.cells.list().filter(c => c.state === 'stowed');
    dock.hidden = !stowed.length;
    dock.innerHTML = stowed.map(c =>
      `<button class="b-chip" data-id="${c.id}" title="Take out of the pocket"><i>${Kernel.icons.render(c.icon)}</i><span>${M.util.esc(c.title)}</span></button>`).join('');
  }
  ui.on(dock, 'click', e => {
    const b = e.target.closest('.b-chip'); if (!b) return;
    M.cells.unstow(b.dataset.id); M.cells.focus(b.dataset.id); M.lens.current?.fit?.(b.dataset.id);
  });
  for (const t of ['cell:added', 'cell:changed', 'cell:removed', 'ready']) ui.defer(M.bus.on(t, render));

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
      `);
      ui.mount('chrome', dock); render();
    },
    stop() { ui.dispose(); },
  };
}
