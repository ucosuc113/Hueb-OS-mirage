function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('candado');
  const build = { channel: 'development', mirage: M.version, kernel: Kernel.version || '?' };

  const el = document.createElement('div');
  el.id = 'candado'; el.hidden = true; el.tabIndex = -1;
  el.innerHTML =
    '<svg class="c-cover" aria-hidden="true"><defs><mask id="c-mask"><rect width="100%" height="100%" fill="#fff"/><g class="c-holes"></g></mask></defs>' +
    '<rect class="c-fill" width="100%" height="100%" mask="url(#c-mask)"/></svg>' +
    '<span class="c-brand">Mirage</span><span class="c-stamp"></span>' +
    '<div class="c-sheet">' +
    '<svg class="c-logo" viewBox="0 0 256 256" aria-hidden="true">' +
    '<path class="c-line" d="M48.88 122.21 L204.50 185.02 L127.14 66.91 L49.07 184.68 L161.47 98.93 L207.19 144.82"/>' +
    '<g class="c-node"><rect x="44.88" y="118.21" width="8" height="8"/><rect x="200.5" y="181.02" width="8" height="8"/>' +
    '<rect x="123.14" y="62.91" width="8" height="8"/><rect x="45.07" y="180.68" width="8" height="8"/>' +
    '<rect x="157.47" y="94.93" width="8" height="8"/><rect x="203.19" y="140.82" width="8" height="8"/></g></svg>' +
    '<div class="c-time"></div><div class="c-date"></div><div class="c-who"></div>' +
    '<form class="c-form"><input type="password" spellcheck="false" autocomplete="off" placeholder="password"><button type="submit" aria-label="Open">→</button></form>' +
    '<div class="c-msg"></div></div>';
  const q = s => el.querySelector(s);
  const sheet = q('.c-sheet'), form = q('.c-form'), input = q('input'), msg = q('.c-msg');
  let locked = false, user = null, needsPwd = false;

  const freeze = on => { for (const id of ['world', 'chrome']) { const l = document.getElementById(id); if (l) l.inert = on; } };
  const tick = () => {
    const d = new Date();
    q('.c-time').textContent = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    q('.c-date').textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  const SVGNS = 'http://www.w3.org/2000/svg', holes = q('.c-holes');
  let raf = 0;
  const clean = () => { cancelAnimationFrame(raf); raf = 0; el.classList.remove('leaving', 'open'); holes.replaceChildren(); };

  function reveal(speed) {
    const o = el.getBoundingClientRect(), W = o.width, H = o.height;
    const ns = [...el.querySelectorAll('.c-node rect')].map(r => {
      const b = r.getBoundingClientRect();
      const n = { cx: b.left - o.left + b.width / 2, cy: b.top - o.top + b.height / 2, h0: Math.max(5, b.width / 2), rect: document.createElementNS(SVGNS, 'rect') };
      n.full = Math.max(n.cx, W - n.cx, n.cy, H - n.cy);        // half-side that covers the whole screen from this node
      holes.appendChild(n.rect);
      return n;
    });
    const lead = 340 / speed, grow = 620 / speed, gap = 55 / speed, t0 = performance.now();
    el.classList.add('leaving');                                 // text and dashes go out (CSS)
    const frame = now => {
      const t = now - t0 - lead;
      let end = t > 0;
      if (t > 0) el.classList.add('open');                       // the white nodes hide: the windows take their place
      ns.forEach((n, i) => {
        const p = M.util.clamp((t - i * gap) / grow, 0, 1);
        if (p < 1) end = false;
        const h = t > 0 ? n.h0 + (n.full - n.h0) * p * p * p : 0;
        n.rect.setAttribute('x', n.cx - h); n.rect.setAttribute('y', n.cy - h);
        n.rect.setAttribute('width', h * 2); n.rect.setAttribute('height', h * 2);
      });
      if (end) { clean(); el.hidden = true; return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  async function lock() {
    if (locked) return;
    locked = true;
    clean();
    user = await Kernel.users.current();
    const rec = user && await Kernel.users.get(user.id);
    needsPwd = !!(rec && (rec.password || await Kernel.prefs.get('security.password', '')));
    q('.c-stamp').textContent = `${build.channel} · mirage ${build.mirage} · kernel ${build.kernel}`;
    q('.c-who').textContent = user ? user.name : 'no session';
    msg.textContent = needsPwd ? '' : 'press Enter to open';
    form.hidden = !needsPwd; input.value = '';
    freeze(true); tick(); el.hidden = false;
    document.activeElement?.blur?.();
    (needsPwd ? input : el).focus();
    Kernel.prefs.set('mirage.locked', true).catch(() => { });
    M.bus.emit('lock:changed', { locked: true });
  }

  async function unlock() {
    if (!locked) return;
    if (needsPwd) {
      try { await Kernel.users.login(user.id, input.value); }
      catch {
        msg.textContent = 'wrong password'; input.select();
        sheet.classList.remove('no'); void sheet.offsetWidth; sheet.classList.add('no');
        await new Promise(r => setTimeout(r, 600));
        return;
      }
    }
    locked = false; input.value = ''; freeze(false);
    Kernel.prefs.set('mirage.locked', false).catch(() => { });
    M.bus.emit('lock:changed', { locked: false });
    const anim = await Kernel.prefs.get('app.config.anim', true).catch(() => true);
    const speed = +(await Kernel.prefs.get('app.config.speed', 1).catch(() => 1)) || 1;
    if (locked) return;
    if (anim === false || matchMedia('(prefers-reduced-motion: reduce)').matches) el.hidden = true;
    else reveal(speed);
  }

  ui.on(form, 'submit', e => { e.preventDefault(); unlock(); });
  ui.on(el, 'pointerdown', () => { if (!needsPwd) unlock(); else input.focus(); });

  ui.on(window, 'keydown', e => {
    if (!locked) return;
    if (e.target !== input || e.ctrlKey || e.altKey || e.metaKey) e.stopImmediatePropagation();
    if (e.target !== input) { e.preventDefault(); if (e.key === 'Enter' && !needsPwd) unlock(); }
  }, true);

  let off, offIntent, clock, armed = Promise.resolve();
  return {
    id: 'ui.candado', name: 'Component · Lock',
    start() {
      ui.style(`
        #candado{position:absolute;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;background:var(--bg);overflow:hidden}
        #candado[hidden]{display:none}
        /* the World's dot grid, as a mask painted with a solid color */
        #candado::before{content:"";position:absolute;inset:0;pointer-events:none;background:var(--dot);
          -webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect width='2' height='2'/%3E%3C/svg%3E");
          mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect width='2' height='2'/%3E%3C/svg%3E");
          -webkit-mask-size:48px 48px;mask-size:48px 48px;-webkit-mask-position:center;mask-position:center}
        .c-brand,.c-stamp{position:absolute;top:22px;font:11px/1 var(--mono);text-transform:uppercase}
        .c-brand{left:26px;font-weight:600;letter-spacing:.34em}
        .c-stamp{right:26px;letter-spacing:.14em;color:var(--ink2)}
        .c-sheet{position:relative;width:min(520px,92vw);display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}
        .c-sheet.no{animation:c-no .3s}
        @keyframes c-no{25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
        .c-logo{width:min(40vh,320px);height:auto;aspect-ratio:1;overflow:visible;margin-bottom:6px}
        .c-line{fill:none;stroke:var(--ink);stroke-width:5;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;
          stroke-dasharray:16 9;animation:c-march 8s linear infinite}
        @keyframes c-march{to{stroke-dashoffset:-100}}
        .c-node rect{fill:var(--ink)}
        @media (prefers-reduced-motion:reduce){.c-line{animation:none}}
        .c-time{font:600 clamp(56px,11vh,104px)/1 var(--mono);letter-spacing:-.03em;font-variant-numeric:tabular-nums}
        .c-date{font:12px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink2)}
        .c-who{margin-top:10px;font:600 13px/1 var(--mono);letter-spacing:.2em;text-transform:uppercase}
        .c-form{display:flex;width:min(320px,86vw);margin-top:6px;border-bottom:var(--bw) dashed var(--edge)}
        .c-form:focus-within{border-bottom-color:var(--ink)}
        .c-form[hidden]{display:none}
        .c-form input{flex:1;min-width:0;padding:10px 4px 10px 34px;background:none;color:var(--ink);border:0;outline:0;font:15px/1 var(--mono);letter-spacing:.3em;text-align:center}
        .c-form input::placeholder{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink2)}
        .c-form button{width:34px;border:0;background:none;color:var(--ink);cursor:pointer;font:16px/1 var(--mono)}
        .c-form button:hover{background:var(--ink);color:var(--bg)}
        .c-msg{min-height:1.4em;font:11px/1.4 var(--mono);letter-spacing:.06em;color:var(--ink2)}
        .c-cover{display:none;position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
        .c-fill{fill:var(--bg)}
        #candado.leaving{background:transparent;pointer-events:none}
        #candado.leaving .c-cover{display:block}
        #candado.leaving::before,#candado.leaving .c-brand,#candado.leaving .c-stamp,#candado.leaving .c-time,
        #candado.leaving .c-date,#candado.leaving .c-who,#candado.leaving .c-form,#candado.leaving .c-msg{opacity:0;transition:opacity .18s}
        #candado.leaving .c-line{animation-play-state:paused;stroke-dasharray:0 25;transition:stroke-dasharray .34s cubic-bezier(.2,.8,.2,1)}
        #candado.open .c-node{visibility:hidden}
      `);
      ui.mount('overlay', el);
      clock = setInterval(tick, 15000); ui.defer(() => clearInterval(clock));
      off = M.svc.provide('lock', { lock, isLocked: () => locked, build, armed: () => armed });
      offIntent = M.intents.provide('lock', q => /^(lock|lock screen)$/i.test(q)
        ? [{ title: 'Lock screen', hint: 'lock the session', group: 'Actions', score: 0.96, run: lock }] : []);
      const fresh = !Kernel.bootComplete;
      let skip = false;
      try { skip = !!JSON.parse(localStorage.getItem('huebos_uefi') || '{}')['boot.skipLock']; } catch { }
      armed = (async () => {
        const was = await Kernel.prefs.get('mirage.locked', false).catch(() => false);
        if (was || (fresh && !skip)) await lock();
      })().catch(() => { });
    },
    stop() { clean(); off && off(); offIntent && offIntent(); freeze(false); ui.dispose(); },
  };
}