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

  function hi() { post({ t: 'ready' }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hi); else hi();
})();
