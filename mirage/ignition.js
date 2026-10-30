/* ═══════════════════════════════════════════════════════════════
   MIRAGE · L0 · IGNITION — el bootloader.
   Secuencia: substrate → ventana de modo seguro → Kernel.js → módulos → sesión.
   Es lo único que sobrevive si todo lo demás falla: si el Kernel no carga, o no hay
   interfaz, ofrece su propia consola de rescate sin depender de ningún módulo.
   Compartido con el Kernel: solo Kernel.js. Nada más del entorno Hueb-OS.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const M = window.Mirage;
  const $ = id => document.getElementById(id);
  const step = $('sp-step'), fill = $('sp-fill'), splash = $('splash');
  const SAFE_WINDOW_MS = 700;           // tiempo mínimo para que el usuario pida modo seguro
  const t0 = Date.now();
  let safe = false;

  const progress = (pct, text) => { fill.style.width = pct + '%'; if (text) step.textContent = text; };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  window.addEventListener('keydown', e => { if (e.key === 'Shift' || e.key === 'F8') { safe = true; e.preventDefault(); progress(20, 'modo seguro solicitado'); } });

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('no se pudo cargar ' + src));
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
    panel('Mirage no pudo cargar el Kernel',
      [String(err && err.message || err), '·Comprueba que Kernel.js esté junto a index.html en el servidor.'],
      [['Reintentar', () => location.reload()]]);
  }

  function rescue(reason) {
    const K = window.Kernel;
    panel('Modo de rescate',
      [reason, '·Ningún módulo de interfaz (lente) arrancó. El Kernel sí está vivo.'],
      [['Reiniciar', () => location.reload()],
       ['Reintentar módulos', async el => {
         const log = el.querySelector('pre'); log.textContent = 'recargando módulos…';
         try { await K.modules.bootAll(); await M.lens.restore(); if (M.lens.current) el.remove(); else log.textContent = 'sigue sin haber lente'; }
         catch (e) { log.textContent = String(e && e.stack || e); }
       }],
       ['Reparación', () => K.repair.redirectToRepair('manual', {})]]);
  }

  async function ignite() {
    progress(10, 'substrate listo');
    const left = SAFE_WINDOW_MS - (Date.now() - t0);
    if (left > 0) await wait(left);
    if (safe) sessionStorage.setItem('huebos_safe_mode', '1');     // el Kernel lo consume en su arranque

    progress(30, 'cargando kernel');
    try { await loadScript('Kernel.js'); } catch (e) { return failedKernel(e); }
    if (!window.Kernel) return failedKernel(new Error('Kernel.js cargó pero no definió window.Kernel'));

    const K = window.Kernel;
    M.init();
    progress(45, `kernel ${K.version}`);
    K.on('boot:step', ({ label }) => { if (label) step.textContent = label.toLowerCase(); });
    K.on('modules:started', ({ id }) => { step.textContent = 'módulo · ' + id; fill.style.width = Math.min(90, parseFloat(fill.style.width) + 5) + '%'; });
    K.on('boot:critical', e => { step.textContent = 'fallo crítico: ' + (e && e.reason); });

    const ev = await M.ready;
    progress(100, 'listo');
    splash.classList.add('gone');
    setTimeout(() => splash.remove(), 700);
    if (!M.lens.current) rescue(ev.safeMode ? 'Arranque en modo seguro: los módulos se omitieron a propósito.' : 'No se registró ninguna lente.');
  }
  ignite();
})();
