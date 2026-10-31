/* ═══════════════════════════════════════════════════════════════
   MIRAGE · L0 · IGNITION — the bootloader.
   Sequence: substrate → safe-mode window → Kernel.js → modules → session.
   It is the only thing that survives if everything else fails: if the Kernel does not load, or there is no
   interface, it offers its own rescue console without depending on any module.
   Shared with the Kernel: only Kernel.js. Nothing else from the Hueb-OS environment.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const M = window.Mirage;
  const $ = id => document.getElementById(id);
  const step = $('sp-step'), fill = $('sp-fill'), splash = $('splash');
  const SAFE_WINDOW_MS = 700;           // minimum time for the user to ask for safe mode
  const t0 = Date.now();
  let safe = false;

  const progress = (pct, text) => { fill.style.width = pct + '%'; if (text) step.textContent = text; };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  window.addEventListener('keydown', e => { if (e.key === 'Shift' || e.key === 'F8') { safe = true; e.preventDefault(); progress(20, 'safe mode requested'); } });

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src));
      document.head.appendChild(s);
    });
  }

  function panel(title, lines, buttons) {
    const el = document.createElement('div');
    el.className = 'rescue';
    el.innerHTML = `<h2>${title}</h2>${lines.map(l => `<p class="${l.startsWith('·') ? 'muted' : ''}">${l.replace(/^·/, '')}</p>`).join('')}<div></div><pre></pre>`;
    const box = el.querySelector('div');
    for (const [label, fn] of buttons) { const b = document.createElement('button'); b.textContent = label; b.onclick = () => fn(el); box.appendChild(b); }
    $('overlay').appendChild(el);
    return el;
  }

  function failedKernel(err) {
    splash.classList.add('gone');
    panel('Mirage could not load the Kernel',
      [String(err && err.message || err), '·Check that Kernel.js sits next to index.html on the server.'],
      [['Retry', () => location.reload()]]);
  }

  function rescue(reason) {
    const K = window.Kernel;
    panel('Rescue mode',
      [reason, '·No interface module (lens) started. The Kernel is alive.'],
      [['Restart', () => location.reload()],
       ['Retry modules', async el => {
         const log = el.querySelector('pre'); log.textContent = 'reloading modules…';
         try { await K.modules.bootAll(); await M.lens.restore(); if (M.lens.current) el.remove(); else log.textContent = 'there is still no lens'; }
         catch (e) { log.textContent = String(e && e.stack || e); }
       }],
       ['Repair', () => K.repair.redirectToRepair('manual', {})]]);
  }

  async function ignite() {
    progress(10, 'substrate ready');
    const left = SAFE_WINDOW_MS - (Date.now() - t0);
    if (left > 0) await wait(left);
    if (safe) sessionStorage.setItem('huebos_safe_mode', '1');     // the Kernel consumes it at startup

    progress(30, 'loading kernel');
    try { await loadScript('Kernel.js'); } catch (e) { return failedKernel(e); }
    if (!window.Kernel) return failedKernel(new Error('Kernel.js loaded but did not define window.Kernel'));

    const K = window.Kernel;
    M.init();
    progress(45, `kernel ${K.version}`);
    K.on('boot:step', ({ label }) => { if (label) step.textContent = label.toLowerCase(); });
    K.on('modules:started', ({ id }) => { step.textContent = 'module · ' + id; fill.style.width = Math.min(90, parseFloat(fill.style.width) + 5) + '%'; });
    K.on('boot:critical', e => { step.textContent = 'critical failure: ' + (e && e.reason); });

    const ev = await M.ready;
    progress(100, 'ready');
    splash.classList.add('gone');
    setTimeout(() => splash.remove(), 700);
    if (!M.lens.current) rescue(ev.safeMode ? 'Started in safe mode: modules were skipped on purpose.' : 'No lens was registered.');
  }
  ignite();
})();
