/* Service · MOOD — the light of the system, in grayscale. Solid colors; hierarchy is made
   with opacity. In "auto" it follows the clock: day between 7 and 19 h, night the rest. */
function registerService(Kernel) {
  const M = window.Mirage.init();

  /* Derived from two colors (background / ink) so every tone stays coherent */
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
    night:    palette('Night',    '#000000', '#0b0b0b', '#111111', '255,255,255', true),
    day:      palette('Day',      '#ffffff', '#fafafa', '#f2f2f2', '0,0,0',       false),
    graphite: palette('Graphite', '#181818', '#202020', '#262626', '240,240,240', true),
    paper:    palette('Paper',    '#e6e6e6', '#f1f1f1', '#fafafa', '17,17,17',    false),
  };
  const LEGACY = { noche: 'night', dia: 'day', grafito: 'graphite', papel: 'paper' };   // ids saved before the English rename

  const byHour = h => (h >= 7 && h < 19) ? 'day' : 'night';
  let choice = 'auto', timer = null;

  function apply() {
    const id = choice === 'auto' ? byHour(new Date().getHours()) : (MOODS[choice] ? choice : 'night');
    M.tokens.set(MOODS[id].vars);
    M.bus.emit('mood:changed', { choice, applied: id });
  }

  const api = {
    list: () => [{ id: 'auto', name: 'Auto' }, ...Object.entries(MOODS).map(([id, m]) => ({ id, name: m.name }))],
    get: () => ({ choice, applied: choice === 'auto' ? byHour(new Date().getHours()) : choice }),
    async set(id) {
      if (id !== 'auto' && !MOODS[id]) throw new Error(`mood '${id}' does not exist`);
      choice = id; await Kernel.prefs.set('mirage.mood', id); apply();
    },
  };

  let off;
  return {
    id: 'svc.mood', name: 'Service · Mood',
    async start() {
      choice = await Kernel.prefs.get('mirage.mood', 'auto');
      choice = LEGACY[choice] || choice;
      if (choice !== 'auto' && !MOODS[choice]) choice = 'auto';      // preferences from the color version
      apply();
      timer = setInterval(() => { if (choice === 'auto') apply(); }, 5 * 60 * 1000);
      off = M.svc.provide('mood', api);
    },
    stop() { clearInterval(timer); off && off(); },
  };
}
