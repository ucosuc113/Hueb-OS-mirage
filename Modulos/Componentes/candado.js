function registerComponent(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('candado');
  const build = { channel: 'development', mirage: M.version, kernel: Kernel.version || '?' };

  const el = document.createElement('div');
  el.id = 'candado'; el.hidden = true; el.tabIndex = -1;
  el.innerHTML =
    '<div class="c-sheet"><span class="c-stamp"></span>' +
    '<div class="c-time"></div><div class="c-date"></div><div class="c-who"></div>' +
    '<form class="c-form"><input type="password" spellcheck="false" autocomplete="off" placeholder="password"><button type="submit">Open</button></form>' +
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

  async function lock() {
    if (locked) return;
    locked = true;
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
        await new Promise(r => setTimeout(r, 600));           // slows down brute force
        return;
      }
    }
    locked = false; el.hidden = true; input.value = ''; freeze(false);
    Kernel.prefs.set('mirage.locked', false).catch(() => { });
    M.bus.emit('lock:changed', { locked: false });
  }

  ui.on(form, 'submit', e => { e.preventDefault(); unlock(); });
  ui.on(el, 'pointerdown', () => { if (!needsPwd) unlock(); else input.focus(); });
  /* Capture phase: while locked, nothing underneath (Wish, Fold, Table) sees the keys */
  ui.on(window, 'keydown', e => {
    if (!locked) return;
    if (e.target !== input || e.ctrlKey || e.altKey || e.metaKey) e.stopImmediatePropagation();
    if (e.target !== input) { e.preventDefault(); if (e.key === 'Enter' && !needsPwd) unlock(); }
  }, true);

  let off, offIntent, clock;
  return {
    id: 'ui.candado', name: 'Component · Lock',
    start() {
      ui.style(`
        #candado{position:absolute;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;background:var(--bg)}
        #candado[hidden]{display:none}
        .c-sheet{width:min(460px,92vw);padding:40px 36px 32px;display:flex;flex-direction:column;align-items:center;gap:12px;
          text-align:center;background:var(--panel-solid);border:var(--bw) solid var(--ink)}
        .c-sheet.no{animation:c-no .3s}
        @keyframes c-no{25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
        .c-stamp{border:var(--bw) solid var(--ink);padding:4px 10px;font:600 10px/1 var(--mono);letter-spacing:.16em;text-transform:uppercase;transform:rotate(-3deg);margin-bottom:8px}
        .c-time{font:600 76px/1 var(--mono);letter-spacing:-.03em;font-variant-numeric:tabular-nums}
        .c-date{font:12px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink2)}
        .c-who{margin-top:14px;font-size:15px;font-weight:600}
        .c-form{display:flex;gap:8px;width:100%;margin-top:6px}
        .c-form[hidden]{display:none}
        .c-form input{flex:1;min-width:0;padding:8px 10px;background:none;color:var(--ink);border:var(--bw) solid var(--edge);outline:0;font:inherit}
        .c-form input:focus{border-color:var(--ink)}
        .c-form button{padding:8px 14px;border:var(--bw) solid var(--ink);background:var(--ink);color:var(--bg);cursor:pointer}
        .c-msg{min-height:1.4em;font:11px/1.4 var(--mono);letter-spacing:.06em;color:var(--ink2)}
      `);
      ui.mount('overlay', el);
      clock = setInterval(tick, 15000); ui.defer(() => clearInterval(clock));
      off = M.svc.provide('lock', { lock, isLocked: () => locked, build });
      offIntent = M.intents.provide('lock', q => /^(lock|lock screen)$/i.test(q)
        ? [{ title: 'Lock screen', hint: 'lock the session', group: 'Actions', score: 0.96, run: lock }] : []);
      Kernel.prefs.get('mirage.locked', false).then(v => { if (v) lock(); }).catch(() => { });
    },
    stop() { off && off(); offIntent && offIntent(); freeze(false); ui.dispose(); },
  };
}