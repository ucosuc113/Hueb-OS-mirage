/* Componente · DESEO — reemplaza al menú inicio, al buscador y a la terminal de comandos.
   Ctrl+Espacio (también desde dentro de una celda), o escribir cualquier letra sobre el fondo. */
function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('wish');
  const el = document.createElement('div');
  el.id = 'wish'; el.hidden = true;
  el.innerHTML =
    '<div class="w-box"><div class="w-input"><span class="w-glyph">&gt;</span>' +
    '<input type="text" spellcheck="false" autocomplete="off" placeholder="app · archivo · nota hola · 2+2 · lente mosaico · ánimo dia"><kbd>esc</kbd></div>' +
    '<ul class="w-list"></ul></div>';
  const input = el.querySelector('input'), list = el.querySelector('.w-list');
  let results = [], sel = 0, seq = 0;

  const open = (seed = '') => { el.hidden = false; input.value = seed; input.focus(); search(); };
  const close = () => {
    if (el.hidden) return;
    el.hidden = true; input.blur();
    const c = M.cells.get(M.cells.focusedId); if (c) try { c.frame.contentWindow.focus(); } catch { }
  };

  async function search() {
    const my = ++seq;
    const r = await M.intents.query(input.value);
    if (my !== seq) return;                       // llegó una respuesta más nueva
    results = r; sel = 0; render();
  }
  function render() {
    if (!results.length) { list.innerHTML = '<li class="w-empty">nada que ofrecer</li>'; return; }
    let last = '';
    list.innerHTML = results.map((r, i) => {
      const head = r.group && r.group !== last ? `<li class="w-group">${M.util.esc(last = r.group)}</li>` : '';
      const ico = r.icon ? Kernel.icons.render(r.icon) : '';
      return head + `<li class="w-item${i === sel ? ' on' : ''}" data-i="${i}"><span class="w-ico">${ico}</span>` +
        `<span class="w-t">${M.util.esc(r.title)}</span><span class="w-h">${M.util.esc(r.hint || '')}</span></li>`;
    }).join('');
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  async function run(i) {
    const r = results[i]; if (!r) return;
    close();
    try { await M.intents.run(r); } catch (e) { M.notify('El deseo falló', e.message); }
  }

  ui.on(input, 'input', search);
  ui.on(input, 'keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, results.length); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + results.length) % Math.max(1, results.length); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
  });
  ui.on(list, 'click', e => { const li = e.target.closest('.w-item'); if (li) run(+li.dataset.i); });
  ui.on(el, 'pointerdown', e => { if (e.target === el) close(); });

  /* Activadores globales */
  ui.on(window, 'keydown', e => {
    if ((e.ctrlKey || e.altKey) && e.code === 'Space') { e.preventDefault(); el.hidden ? open() : close(); return; }
    const t = e.target;
    if (!el.hidden || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === ' ') return;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault(); open(e.key);
  });
  ui.defer(M.bus.on('key:wish', () => el.hidden ? open() : close()));

  return {
    id: 'ui.wish', name: 'Componente · Deseo',
    start() {
      ui.style(`
        #wish{position:absolute;inset:0;z-index:50;display:flex;justify-content:center;align-items:flex-start;padding-top:14vh;background:var(--scrim)}
        #wish[hidden]{display:none}
        .w-box{width:min(620px,92vw);background:var(--panel-solid);border:var(--bw) solid var(--ink)}
        .w-input{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:var(--bw) solid var(--line)}
        .w-glyph{font:600 16px/1 var(--mono)}
        .w-input input{flex:1;background:none;border:0;outline:0;color:var(--ink);font:16px/1.4 var(--font)}
        .w-input input::placeholder{color:var(--ink2)}
        .w-input kbd{font:10px/1.6 var(--mono);color:var(--ink2);border:var(--bw) solid var(--line);padding:0 5px;border-radius:2px;letter-spacing:.06em}
        .w-list{list-style:none;margin:0;padding:0;max-height:50vh;overflow:auto}
        .w-group{padding:10px 16px 4px;font:11px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink2)}
        .w-item{display:flex;align-items:center;gap:12px;padding:8px 16px;cursor:pointer}
        .w-item.on{background:var(--ink);color:var(--bg)}
        .w-item.on .w-h{color:inherit;opacity:.65}
        .w-ico{width:18px;height:18px;font-size:18px}
        .w-t{white-space:nowrap} .w-h{margin-left:auto;color:var(--ink2);font:11px/1 var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:50%}
        .w-empty{padding:16px;color:var(--ink2);font:12px/1 var(--mono)}
      `);
      ui.mount('overlay', el);
    },
    stop() { ui.dispose(); },
  };
}
