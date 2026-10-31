/* Component · MOTION — how cells are born and die: a dot that stretches into a line,
   which opens into a sheet. On close, the same path in reverse. CSS only (clip-path) on the card:
   it touches neither iframes nor geometry. Reads `app.config.anim` and `app.config.speed` (written by Settings). */
function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('movimiento');
  const OPEN = 560, CLOSE = 460;                      // ms at 1× speed
  const els = new Map(), ghosts = new Set();          // id → element (stays alive after cell:removed)
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let on = true, speed = 1;

  const root = document.documentElement;
  async function load() {
    on = (await Kernel.prefs.get('app.config.anim', true)) !== false;
    speed = +(await Kernel.prefs.get('app.config.speed', 1)) || 1;
    root.style.setProperty('--mo-open', OPEN / speed + 'ms');
    root.style.setProperty('--mo-close', CLOSE / speed + 'ms');
  }
  const live = () => on && !reduce.matches;

  function play(el, cls, ms, done) {
    el.classList.add(cls);
    setTimeout(() => { el.classList.remove(cls); done && done(); }, ms + 40);
  }

  ui.defer(M.bus.on('cell:added', c => {
    const cell = M.cells.get(c.id); if (!cell) return;
    els.set(c.id, cell.el);
    if (!live() || document.getElementById('splash')) return;
    play(cell.el, 'opening', OPEN / speed);
  }));

  ui.defer(M.bus.on('cell:removed', c => {
    const el = els.get(c.id); els.delete(c.id);
    const plane = document.getElementById('plane');
    if (!el || !plane || !live() || el.isConnected || el.classList.contains('stowed')) return;
    el.classList.remove('focused', 'opening');
    plane.appendChild(el); ghosts.add(el);
    play(el, 'closing', CLOSE / speed, () => { ghosts.delete(el); el.remove(); });
  }));

  ui.defer(M.bus.on('k:prefs:change', ({ key }) => { if (String(key).startsWith('app.config.')) load(); }));

  return {
    id: 'ui.movimiento', name: 'Component · Motion',
    async start() {
      ui.style(`
        :root{--mo-open:${OPEN}ms;--mo-close:${CLOSE}ms}
        .cell{--u:calc(var(--bw, 2px) / var(--k, 1));--d:calc(50% - var(--u) * 2);--l:calc(50% - var(--u) / 2)}
        .cell.opening,.cell.closing{pointer-events:none}
        .cell.opening{animation:cell-open var(--mo-open) both}
        .cell.closing{animation:cell-close var(--mo-close) both}
        .cell.opening::after,.cell.closing::after{content:"";position:absolute;inset:0;z-index:5;pointer-events:none;background:var(--ink)}
        .cell.opening::after{animation:cell-veil-in var(--mo-open) linear both}
        .cell.closing::after{animation:cell-veil-out var(--mo-close) linear both}
        /* dot → pause → line (horizontal) → pause → box (vertical) */
        @keyframes cell-open{
          0%  {clip-path:inset(50% 50% 50% 50%);animation-timing-function:ease-out}
          12% {clip-path:inset(var(--d) var(--d) var(--d) var(--d))}
          20% {clip-path:inset(var(--d) var(--d) var(--d) var(--d));animation-timing-function:cubic-bezier(.65,0,.35,1)}
          50% {clip-path:inset(var(--l) 0 var(--l) 0)}
          58% {clip-path:inset(var(--l) 0 var(--l) 0);animation-timing-function:cubic-bezier(.65,0,.35,1)}
          100%{clip-path:inset(0 0 0 0)}
        }
        @keyframes cell-close{
          0%  {clip-path:inset(0 0 0 0);animation-timing-function:cubic-bezier(.65,0,.35,1)}
          42% {clip-path:inset(var(--l) 0 var(--l) 0)}
          50% {clip-path:inset(var(--l) 0 var(--l) 0);animation-timing-function:cubic-bezier(.65,0,.35,1)}
          80% {clip-path:inset(var(--d) var(--d) var(--d) var(--d))}
          88% {clip-path:inset(var(--d) var(--d) var(--d) var(--d));animation-timing-function:ease-in}
          100%{clip-path:inset(50% 50% 50% 50%)}
        }
        @keyframes cell-veil-in{0%,68%{opacity:1}100%{opacity:0}}
        @keyframes cell-veil-out{0%{opacity:0}30%,100%{opacity:1}}
      `);
      M.cells.each(c => els.set(c.id, c.el));
      await load();
    },
    stop() { ghosts.forEach(g => g.remove()); ghosts.clear(); ['--mo-open', '--mo-close'].forEach(p => root.style.removeProperty(p)); ui.dispose(); },
  };
}