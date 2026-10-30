/* Componente · PACTO — cuando una celda de terceros pide algo, el sistema pregunta aquí.
   Resuelve el hueco del Kernel donde nada concedía permisos a las apps. */
function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('pacto');
  const E = M.util.esc;
  const box = document.createElement('div');
  box.id = 'pacto';
  const queue = [];
  let busy = false;

  function pump() {
    if (busy || !queue.length) return;
    busy = true;
    const { cell, perm, resolve } = queue.shift();
    const what = M.caps.DESC[perm] || perm;
    box.innerHTML =
      `<div class="pc-card"><div class="pc-top"><span class="pc-ico">${Kernel.icons.render(cell.icon)}</span><span class="pc-lbl">pacto</span></div>` +
      `<h3>${E(cell.title)} pide permiso para ${E(what)}</h3>` +
      '<p class="pc-sub">Es una celda de terceros: vive aislada y solo puede hablar con el sistema por esta API.</p>' +
      '<div class="pc-btns"><button data-v="deny">Negar</button><button data-v="once">Solo ahora</button><button class="on" data-v="always">Siempre</button></div></div>';
    box.hidden = false;
    box.onclick = e => {
      const b = e.target.closest('[data-v]'); if (!b) return;
      box.hidden = true; box.innerHTML = ''; busy = false; resolve(b.dataset.v); pump();
    };
  }

  const api = { ask: (cell, perm) => new Promise(resolve => { queue.push({ cell, perm, resolve }); pump(); }) };
  let off;
  return {
    id: 'ui.pacto', name: 'Componente · Pacto',
    start() {
      ui.style(`
        #pacto{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:var(--scrim)}
        #pacto[hidden]{display:none}
        .pc-card{width:min(420px,92vw);padding:22px;background:var(--panel-solid);border:var(--bw) solid var(--ink)}
        .pc-top{display:flex;align-items:center;gap:10px;margin-bottom:14px}
        .pc-ico{width:22px;height:22px;font-size:22px}
        .pc-lbl{font:11px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink2)}
        .pc-card h3{margin:0 0 8px;font-size:16px;font-weight:600;line-height:1.35}
        .pc-sub{margin:0;color:var(--ink2);font-size:12px}
        .pc-btns{display:flex;gap:8px;margin-top:18px}
        .pc-btns button{flex:1;padding:8px 10px;border:var(--bw) solid var(--edge);background:transparent;color:var(--ink);cursor:pointer;font:inherit}
        .pc-btns button:hover{border-color:var(--ink)}
        .pc-btns button.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
      `);
      box.hidden = true; ui.mount('overlay', box);
      off = M.svc.provide('covenant', api);
    },
    stop() { off && off(); queue.splice(0).forEach(q => q.resolve('deny')); ui.dispose(); },
  };
}
