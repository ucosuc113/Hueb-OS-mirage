/* Componente · PULSO — no es una barra de tareas: una línea mínima en el borde superior.
   Lente, celda en foco, reloj, avisos y usuario. Todo texto, sin iconos. */
function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('pulso');
  const E = M.util.esc;

  const bar = document.createElement('div');
  bar.id = 'pulso';
  bar.innerHTML =
    '<button data-p="lens" title="Cambiar de lente"><span class="p-lens"></span></button>' +
    '<button data-p="wish" title="Deseo (Ctrl+Espacio)">Deseo</button>' +
    '<span class="p-focus"></span><span class="p-sp"></span>' +
    '<button data-p="notes" title="Avisos">Avisos<b class="p-n" hidden></b></button>' +
    '<span class="p-clock"></span><button data-p="user"></button>';
  const tray = document.createElement('div');
  tray.id = 'p-tray'; tray.hidden = true;
  const toasts = document.createElement('div');
  toasts.id = 'p-toasts';

  const q = s => bar.querySelector(s);
  const refreshFocus = () => { const c = M.cells.get(M.cells.focusedId); q('.p-focus').textContent = c ? c.title : ''; };
  const refreshLens = () => { const l = M.lens.current; q('.p-lens').textContent = l ? l.name : '—'; };
  const tick = () => { q('.p-clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  async function refreshCount() { const n = await Kernel.notifications.unreadCount(); const b = q('.p-n'); b.hidden = !n; b.textContent = n; }
  async function refreshUser() { const u = await Kernel.users.current(); q('[data-p=user]').textContent = u ? u.name : ''; }

  async function renderTray() {
    const items = await Kernel.notifications.list({ limit: 25 });
    tray.innerHTML = '<div class="t-head"><span>Avisos</span><button data-p="readall">marcar leídos</button></div>' +
      (items.length ? items.map(n => `<div class="t-item${n.read ? '' : ' un'}"><div><div>${E(n.title)}</div><div class="t-b">${E(n.body)}</div></div><small>${M.util.ago(n.ts)}</small></div>`).join('')
        : '<div class="t-empty">sin avisos</div>');
  }
  function toast(n) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<b>${E(n.title)}</b><div class="t-b">${E(n.body)}</div>`;
    toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), 4200);
    setTimeout(() => t.remove(), 4700);
  }

  ui.on(bar, 'click', async e => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    const a = b.dataset.p;
    if (a === 'lens') { const ls = M.lens.list(); const i = ls.findIndex(l => l.id === M.lens.current?.id); M.lens.use(ls[(i + 1) % ls.length].id); }
    else if (a === 'wish') M.bus.emit('key:wish', {});
    else if (a === 'notes') { tray.hidden = !tray.hidden; if (!tray.hidden) renderTray(); }
    else if (a === 'user') M.cells.open('config');
  });
  ui.on(tray, 'click', async e => { if (e.target.closest('[data-p=readall]')) { await Kernel.notifications.markAllRead(); renderTray(); refreshCount(); } });
  ui.on(document, 'pointerdown', e => { if (!tray.hidden && !e.target.closest('#p-tray,[data-p=notes]')) tray.hidden = true; });

  ui.defer(M.bus.on('cell:focused', refreshFocus));
  ui.defer(M.bus.on('cell:removed', refreshFocus));
  ui.defer(M.bus.on('cell:changed', refreshFocus));
  ui.defer(M.bus.on('lens:changed', refreshLens));
  ui.defer(M.bus.on('k:notifications:push', n => { toast(n); refreshCount(); if (!tray.hidden) renderTray(); }));
  ui.defer(M.bus.on('k:notifications:read', refreshCount));
  ui.defer(M.bus.on('k:users:profileChanged', refreshUser));
  ui.defer(M.bus.on('ready', () => { refreshLens(); refreshCount(); refreshUser(); }));

  let clock;
  return {
    id: 'ui.pulso', name: 'Componente · Pulso',
    start() {
      ui.style(`
        #pulso{position:absolute;left:0;right:0;top:0;height:30px;display:flex;align-items:center;gap:2px;padding:0 6px;
          background:var(--bg);border-bottom:var(--bw) solid var(--line);font:11px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase}
        #pulso button{position:relative;background:none;border:0;color:var(--ink);height:100%;padding:0 10px;cursor:pointer;font:inherit;letter-spacing:inherit;text-transform:inherit}
        #pulso button:hover{background:var(--ink);color:var(--bg)}
        .p-focus{color:var(--ink2);padding:0 12px;max-width:30ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .p-focus:empty{display:none}
        .p-sp{flex:1}
        .p-clock{color:var(--ink2);font-variant-numeric:tabular-nums;padding:0 10px}
        .p-n{margin-left:6px;padding:0 5px;background:var(--ink);color:var(--bg);font-weight:600}
        #pulso button:hover .p-n{background:var(--bg);color:var(--ink)}
        #p-tray{position:absolute;top:30px;right:0;width:min(360px,94vw);max-height:60vh;overflow:auto;background:var(--panel-solid);border:var(--bw) solid var(--ink);border-top:0;z-index:20}
        #p-tray[hidden]{display:none}
        .t-head{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:var(--bw) solid var(--line);font:11px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase}
        .t-head button{background:none;border:0;color:var(--ink2);cursor:pointer;font:inherit;text-transform:none;letter-spacing:.02em}
        .t-head button:hover{color:var(--ink)}
        .t-item{display:flex;gap:10px;padding:10px 14px;border-bottom:var(--bw) solid var(--line);opacity:.6}
        .t-item.un{opacity:1;border-left:var(--bw) solid var(--ink)}
        .t-item>div{flex:1;min-width:0} .t-item small{color:var(--ink2);font:11px/1.4 var(--mono)}
        .t-b{color:var(--ink2);font-size:12px} .t-empty{padding:20px;color:var(--ink2);font:12px/1 var(--mono)}
        #p-toasts{position:absolute;right:14px;bottom:14px;display:flex;flex-direction:column;gap:8px;pointer-events:none;z-index:30}
        .toast{min-width:220px;max-width:320px;padding:10px 14px;background:var(--ink);color:var(--bg);animation:t-in .2s;transition:opacity .4s}
        .toast .t-b{color:inherit;opacity:.65}
        .toast.out{opacity:0}
        @keyframes t-in{from{opacity:0}}
      `);
      ui.mount('chrome', bar); ui.mount('chrome', tray); ui.mount('overlay', toasts);
      tick(); clock = setInterval(tick, 15000); ui.defer(() => clearInterval(clock));
      refreshLens(); refreshFocus(); refreshCount(); refreshUser();
    },
    stop() { ui.dispose(); },
  };
}
