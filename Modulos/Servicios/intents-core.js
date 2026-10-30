/* Servicio · DESEOS BÁSICOS — los proveedores de intención que vienen de fábrica.
   No hay menú inicio: todo lo que el sistema sabe hacer entra por aquí.
   Cualquier otro módulo puede sumar los suyos con Mirage.intents.provide(). */
function registerService(Kernel) {
  const M = window.Mirage.init();
  const S = M.util.score;
  const offs = [];

  const SAFE_MATH = /^[\d\s+\-*/().,%^]+$/;
  function calc(q) {
    if (!SAFE_MATH.test(q) || !/[+\-*/%^]/.test(q.replace(/^\s*-/, '')) || !/\d/.test(q)) return null;
    try {
      const v = Function('"use strict";return (' + q.replace(/,/g, '.').replace(/\^/g, '**') + ')')();
      return typeof v === 'number' && isFinite(v) ? v : null;
    } catch { return null; }
  }
  const quiet = p => /^\/device\/(system|temp|desktop)(\/|$)/.test(p);
  const verb = (q, ...names) => { const m = q.match(new RegExp('^(?:' + names.join('|') + ')\\s+(.+)$', 'i')); return m ? m[1].trim() : null; };

  /* 1 · Apps */
  offs.push(M.intents.provide('apps', (q) => M.catalog.list().map(a => {
    const hay = [a.name, a.id, a.category, a.description, ...a.keywords];
    const score = q ? Math.max(...hay.map((t, i) => S(q, t) * (i === 0 ? 1 : 0.8))) : 0.5;
    return score > 0.2 ? {
      title: a.name, hint: a.userApp ? 'celda de usuario' : a.description || a.category, icon: a.icon, group: 'Celdas', score,
      run: () => M.cells.open(a.id),
    } : null;
  }).filter(Boolean)));

  /* 2 · Archivos: búsqueda por nombre en /device */
  offs.push(M.intents.provide('files', async (q) => {
    if (q.length < 2) return [];
    const nodes = await Kernel.db.list(Kernel.STORES.FS);
    return nodes.filter(n => n.type !== 'shortcut' && !quiet(n.id) && n.id !== '/device')
      .map(n => ({ n, s: S(q, n.name) })).filter(x => x.s > 0.3).sort((a, b) => b.s - a.s).slice(0, 5)
      .map(({ n, s }) => ({
        title: n.name, hint: n.id, group: 'Archivos', score: s * 0.85,
        run: () => n.type === 'dir' ? M.cells.open('files', { args: { startPath: n.id } }) : Kernel.openFile(n.id),
      }));
  }));

  /* 3 · Verbos y cálculo */
  offs.push(M.intents.provide('verbs', async (q) => {
    const out = [];
    const v = calc(q);
    if (v !== null) out.push({ title: `= ${v}`, hint: 'Enter copia el resultado', group: 'Cálculo', score: 0.95, run: () => navigator.clipboard?.writeText(String(v)).catch(() => { }) });

    const note = verb(q, 'nota', 'n', 'note');
    if (note) out.push({ title: `Anotar: ${note}`, hint: 'crea un archivo en /device/docs', group: 'Acciones', score: 0.97, run: async () => {
      const path = `/device/docs/nota-${Date.now().toString(36)}.txt`;
      await Kernel.fs.write(path, note);
      M.notify('Nota guardada', path);
    } });

    const lens = verb(q, 'lente', 'lens', 'vista');
    if (lens) for (const l of M.lens.list()) if (S(lens, l.id) > 0.3 || S(lens, l.name) > 0.3)
      out.push({ title: `Lente: ${l.name}`, group: 'Acciones', score: 0.96, run: () => M.lens.use(l.id) });

    const mood = verb(q, 'animo', 'ánimo', 'luz', 'tema');
    if (mood) { const svc = M.svc.get('mood'); if (svc) for (const m of svc.list()) if (S(mood, m.id) > 0.3 || S(mood, m.name) > 0.3)
      out.push({ title: `Ánimo: ${m.name}`, group: 'Acciones', score: 0.96, run: () => svc.set(m.id) }); }

    const inst = verb(q, 'instalar', 'install');
    if (inst) out.push({ title: `Instalar celda desde ${inst}`, hint: 'copia el .html a /device/apps y la registra', group: 'Acciones', score: 0.96, run: async () => {
      const mf = await M.catalog.install(inst);
      M.notify('Celda instalada', `${mf.name || mf.id} ya está en el Deseo`);
    } });

    if (/^(orden|vista general|overview|todo)$/i.test(q)) out.push({ title: 'Ver todo el mundo', group: 'Acciones', score: 0.96, run: () => M.lens.current?.overview?.() });
    if (/^(cerrar todo|limpiar)$/i.test(q)) out.push({ title: 'Cerrar todas las celdas', group: 'Acciones', score: 0.96, run: () => M.cells.list().forEach(c => M.cells.close(c.id)) });
    if (/^(recargar|reiniciar) ?(shell|interfaz)?$/i.test(q)) out.push({ title: 'Recargar la interfaz', hint: 'reinicia los componentes sin reiniciar el Kernel', group: 'Acciones', score: 0.96, run: async () => {
      for (const m of Kernel.modules.list('componente')) await Kernel.modules.restart(m.path);
    } });
    if (/^(hora|fecha|reloj)$/i.test(q)) out.push({ title: new Date().toLocaleString(), group: 'Info', score: 0.9 });
    return out;
  }));

  return { id: 'svc.intents-core', name: 'Servicio · Deseos básicos', start() { }, stop() { offs.forEach(f => f()); } };
}
