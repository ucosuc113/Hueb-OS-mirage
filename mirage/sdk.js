/* MIRAGE SDK — injected inline into every cell (srcdoc). Never write the closing script tag here. */
(function () {
  if (window.Mirage) return;
  var HOST = window.parent;   // captured now: an app may declare its own global "parent" and shadow it
  var pending = {}, seq = 0, handlers = {}, info = null, readyRes;
  var ready = new Promise(function (r) { readyRes = r; });

  function post(m) { m.mirage = 1; HOST.postMessage(m, '*'); }
  function call(method) {
    var params = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (res, rej) {
      var id = ++seq; pending[id] = { res: res, rej: rej };
      post({ t: 'call', id: id, method: method, params: params });
    });
  }
  function applyTokens(css) { var s = document.getElementById('mirage-tokens'); if (s && css) s.textContent = css; }
  function emit(topic, data) {
    (handlers[topic] || []).slice().forEach(function (f) { try { f(data); } catch (e) { console.error(e); } });
  }

  window.addEventListener('message', function (e) {
    if (e.source !== HOST) return;
    var d = e.data; if (!d || d.mirage !== 1) return;
    if (d.t === 'ret') {
      var p = pending[d.id]; if (!p) return; delete pending[d.id];
      d.ok ? p.res(d.result) : p.rej(new Error(d.error));
    } else if (d.t === 'hello') {
      info = d.data; applyTokens(info.css); readyRes(info);
    } else if (d.t === 'event') {
      if (d.event === 'tokens') applyTokens(d.data.css);
      emit(d.event, d.data);
    }
  });

  /* Mirage.fs.read(p) → call('fs.read', p). Cualquier namespace del Substrate sirve. */
  function ns(name) {
    return new Proxy({}, { get: function (_, fn) {
      if (typeof fn !== 'string' || fn === 'then') return undefined;
      return function () { return call.apply(null, [name + '.' + fn].concat([].slice.call(arguments))); };
    } });
  }
  var core = {
    ready: ready,
    call: call,
    info: function () { return info; },
    on: function (topic, fn) {
      (handlers[topic] = handlers[topic] || []).push(fn);
      if (topic !== 'tokens' && topic !== 'args') call('events.sub', topic).catch(function () { });
      return function () { handlers[topic] = (handlers[topic] || []).filter(function (f) { return f !== fn; }); };
    },
  };
  window.Mirage = new Proxy(core, { get: function (t, k) {
    if (k in t) return t[k];
    if (typeof k === 'string' && k !== 'then') return ns(k);
  } });

  /* Global Wish / Fold shortcuts even when focus is inside the cell */
  window.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.altKey) && e.code === 'Space') { e.preventDefault(); post({ t: 'key', key: 'wish' }); }
    if (e.altKey && e.code === 'KeyM') { e.preventDefault(); post({ t: 'key', key: 'menu' }); }
  });

  var EDITABLE = 'textarea,input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]),[contenteditable=""],[contenteditable="true"]';
  var menuFn = null, menuRuns = {}, menuSeq = 0;
  function packMenu(list, depth) {
    var out = [];
    (Array.isArray(list) ? list : []).slice(0, 40).forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      if (it.sep) { out.push({ sep: true }); return; }
      var o = { label: it.label, icon: it.icon, hint: it.hint, disabled: it.disabled, danger: it.danger, checked: it.checked };
      var sub = typeof it.items === 'function' ? it.items() : it.items;
      if (sub && depth < 3) o.items = packMenu(sub, depth + 1);
      else if (typeof it.run === 'function') { o.id = 'm' + (++menuSeq); menuRuns[o.id] = it.run; }
      out.push(o);
    });
    return out;
  }
  core.contextMenu = function (fn) { menuFn = typeof fn === 'function' ? fn : null; };
  handlers['menu:pick'] = [function (d) {                       // the shell tells us which entry was picked
    var f = d && menuRuns[d.id];
    if (f) { try { f(); } catch (err) { console.error(err); } }
  }];
  window.addEventListener('contextmenu', function (e) {
    if (e.target && e.target.closest && e.target.closest(EDITABLE)) return;
    e.preventDefault();
    var res = null;
    menuRuns = {};
    try { res = menuFn ? menuFn(e) : null; } catch (err) { console.error(err); }
    var bare = !!(res && !Array.isArray(res) && res.bare);
    var list = res && !Array.isArray(res) ? res.items : res;
    call('menu.open', e.clientX, e.clientY, packMenu(list, 0), { bare: bare }).catch(function () { });
  }, true);

  function hi() { post({ t: 'ready' }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hi); else hi();
})();
