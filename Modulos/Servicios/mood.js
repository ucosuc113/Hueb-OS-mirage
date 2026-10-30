/* Servicio · ÁNIMO — la luz del sistema, en escala de grises. Colores sólidos; la jerarquía
   se logra con opacidad. En "auto" sigue la hora: día entre 7 y 19 h, noche el resto. */
function registerService(Kernel) {
  const M = window.Mirage.init();

  /* Se derivan de dos colores (fondo / tinta) para que todos los tonos sean coherentes */
  const rgba = (rgb, a) => `rgba(${rgb},${a})`;
  function palette(name, bg, cell, solid, inkRgb, dark) {
    const ink = `rgb(${inkRgb})`;
    return { name, vars: {
      scheme: dark ? 'dark' : 'light',
      bg, 'cell-bg': cell, 'panel-solid': solid, ink, accent: ink, 'on-accent': bg, danger: ink,
      ink2: rgba(inkRgb, .55), panel: rgba(inkRgb, .07), line: rgba(inkRgb, .2), edge: rgba(inkRgb, .4), dot: rgba(inkRgb, .22),
      scrim: dark ? 'rgba(0,0,0,.78)' : 'rgba(255,255,255,.78)',
    } };
  }
  const MOODS = {
    noche:   palette('Noche',   '#000000', '#0b0b0b', '#111111', '255,255,255', true),
    dia:     palette('Día',     '#ffffff', '#fafafa', '#f2f2f2', '0,0,0',       false),
    grafito: palette('Grafito', '#181818', '#202020', '#262626', '240,240,240', true),
    papel:   palette('Papel',   '#e6e6e6', '#f1f1f1', '#fafafa', '17,17,17',    false),
  };

  const byHour = h => (h >= 7 && h < 19) ? 'dia' : 'noche';
  let choice = 'auto', timer = null;

  function apply() {
    const id = choice === 'auto' ? byHour(new Date().getHours()) : (MOODS[choice] ? choice : 'noche');
    M.tokens.set(MOODS[id].vars);
    M.bus.emit('mood:changed', { choice, applied: id });
  }

  const api = {
    list: () => [{ id: 'auto', name: 'Auto' }, ...Object.entries(MOODS).map(([id, m]) => ({ id, name: m.name }))],
    get: () => ({ choice, applied: choice === 'auto' ? byHour(new Date().getHours()) : choice }),
    async set(id) {
      if (id !== 'auto' && !MOODS[id]) throw new Error(`ánimo '${id}' no existe`);
      choice = id; await Kernel.prefs.set('mirage.mood', id); apply();
    },
  };

  let off;
  return {
    id: 'svc.mood', name: 'Servicio · Ánimo',
    async start() {
      choice = await Kernel.prefs.get('mirage.mood', 'auto');
      if (choice !== 'auto' && !MOODS[choice]) choice = 'auto';      // preferencias de la versión a color
      apply();
      timer = setInterval(() => { if (choice === 'auto') apply(); }, 5 * 60 * 1000);
      off = M.svc.provide('mood', api);
    },
    stop() { clearInterval(timer); off && off(); },
  };
}
