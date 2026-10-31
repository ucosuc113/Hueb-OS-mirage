function registerService(Kernel) {
  const M = window.Mirage.init();
  const ui = M.ui.scope('menu');
  const SEP = { sep: true };
  const EDITABLE = 'textarea,input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]),[contenteditable=""],[contenteditable="true"]';
  const providers = new Map();
  const offs = [];
  let lastCell = 0;
  const locked = () => !!M.svc.get('lock')?.isLocked?.();

  const api = {
    SEP,
    provide(id, p) {
      const entry = { rank: 50, inherit: false, ...p };
      providers.set(id, entry);
      return () => { if (providers.get(id) === entry) providers.delete(id); };
    },
    async collect(ctx) {
      const out = [];
      for (const p of [...providers.values()].sort((a, b) => a.rank - b.rank)) {
        let hit = null;
        try { hit = p.match(ctx.target, ctx.ev); } catch { }
        if (!hit) continue;
        const items = (await p.items({ ...ctx, hit })) || [];
        if (items.length) { if (out.length) out.push(SEP); out.push(...items); }
        if (!p.inherit) break;                                       // the zone is claimed: nobody else adds to it
      }
      return out;
    },
    async open(point, items, ctx = {}) {
      const view = M.svc.get('menu.view');
      return view ? view.show(items, point, { point, ...ctx }) : false;
    },
    close() { M.svc.get('menu.view')?.hide(); },
  };

  function onContext(e) {
    const t = e.target, near = s => t.closest?.(s);
    if (near('#papeleta')) { e.preventDefault(); return; }           // the slip itself never opens another
    if (near(EDITABLE)) return;                                      // layer 2 exception: native menu in text fields
    e.preventDefault();                                              // layer 1
    if (locked()) return;
    const ctx = { ev: e, target: t, point: { x: e.clientX, y: e.clientY }, lens: M.lens.current };
    api.collect(ctx)
      .then(items => items.length ? api.open(ctx.point, items, ctx) : api.close())
      .catch(err => console.warn('[Mirage:menu]', err));
  }

  /* What the shell gives every cell, in its title bar and in its content */
  function cellItems(id) {
    if (!M.cells.get(id)) return [];
    return [
      { label: 'Enter', hint: 'dbl click', run: () => M.lens.current?.fit?.(id) },
      { label: 'Stow', run: () => M.cells.stow(id) },
      SEP,
      { label: 'Close', danger: true, run: () => M.cells.close(id) },
    ];
  }

  /* ── cells ── */
  const pick = (c, id) => { try { c.frame.contentWindow.postMessage({ mirage: 1, t: 'event', event: 'menu:pick', data: { id } }, '*'); } catch { } };
  const iconOk = i => typeof i === 'string' && (/^<svg[\s>]/i.test(i.trim()) ? i.length <= 3000 : i.length <= 4);   // inline svg or a short glyph, never a URL
  function fromCell(c, raw, depth = 0) {                             // a cell's entries are data: shape and size are enforced here
    if (!Array.isArray(raw) || depth > 3) return [];
    const out = [];
    for (const it of raw.slice(0, 40)) {
      if (!it || typeof it !== 'object') continue;
      if (it.sep) { out.push(SEP); continue; }
      const item = {
        label: String(it.label ?? '').slice(0, 60), hint: it.hint != null ? String(it.hint).slice(0, 24) : '',
        icon: iconOk(it.icon) ? it.icon : undefined, disabled: !!it.disabled, danger: !!it.danger, checked: !!it.checked,
      };
      if (Array.isArray(it.items)) item.items = fromCell(c, it.items, depth + 1);
      else { const id = String(it.id ?? '').slice(0, 40); item.run = () => pick(c, id); }
      out.push(item);
    }
    return out;
  }
  const cellApi = {
    open(ctx, x, y, raw, opts = {}) {
      const c = ctx.cell, fr = c.frame, now = Date.now();
      if (!fr || locked() || now - lastCell < 150 || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      lastCell = now;
      const r = fr.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      /* the iframe may be scaled (the Table zooms the whole plane): its bounding box is the scaled one, clientWidth is not */
      const point = { x: r.left + x * (r.width / (fr.clientWidth || 1)), y: r.top + y * (r.height / (fr.clientHeight || 1)) };
      const own = fromCell(c, raw), shell = opts.bare ? [] : cellItems(c.id);
      const items = [...own, ...(own.length && shell.length ? [SEP] : []), ...shell];
      if (!c.trusted) items.push(SEP, { label: 'from ' + c.title, disabled: true });      // a third-party cell cannot pass for the system
      return api.open(point, items, { point, cell: c.id, source: 'cell' });
    },
  };

  return {
    id: 'svc.menu', name: 'Service · Menu',
    start() {
      ui.on(document, 'contextmenu', onContext, true);

      /* Title bar and bubble of a cell */
      offs.push(api.provide('cell', {
        rank: 20,
        match: t => t.closest?.('.cell-bar, .cell-bubble'),
        items: ({ hit }) => {
          const id = hit.closest('.cell').dataset.cell;
          M.cells.focus(id, { noFrameFocus: true });                 // so you can see which cell the menu belongs to
          return cellItems(id);
        },
      }));

      /* Background of the world, in any lens: what THIS lens offers (lens.menu) + the shell's own */
      offs.push(api.provide('shell', {
        rank: 90,
        match: t => t.closest?.('#world') && !t.closest('.cell, .scrap'),
        items: async ctx => {
          const own = (await ctx.lens?.menu?.(ctx)) || [];
          const md = M.svc.get('mood'), mo = md?.get();
          const base = [
            { label: 'Lens', items: M.lens.list().map(l => ({ label: l.name, checked: l.id === ctx.lens?.id, run: () => M.lens.use(l.id) })) },
          ];
          if (md) base.push({ label: 'Mood', items: md.list().map(m => ({ label: m.name, checked: m.id === mo.choice, run: () => md.set(m.id) })) });
          base.push({
            label: 'Open',
            items: () => M.catalog.list().sort((a, b) => a.name.localeCompare(b.name))
              .map(a => ({ label: a.name, icon: a.icon, run: () => M.cells.open(a.id).catch(e => M.notify('Could not open', e.message)) })),
          });
          base.push(SEP, { label: 'Lock', disabled: !M.svc.get('lock'), run: () => M.svc.get('lock')?.lock() });
          return own.length ? [...own, SEP, ...base] : base;
        },
      }));

      offs.push(M.api.register('menu', cellApi));                    // Mirage.menu.open(...) inside the cells
      offs.push(M.svc.provide('menu', api));
    },
    stop() { offs.forEach(f => f()); offs.length = 0; providers.clear(); ui.dispose(); },
  };
}