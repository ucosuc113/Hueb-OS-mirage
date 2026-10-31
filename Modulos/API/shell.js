/* API · cell — what a cell can do with the shell: change its title,
   open other cells (they stay joined to it by a "thread"), close itself, install. */
function registerAPI(Kernel) {
  const M = window.Mirage.init();

  const methods = {
    self: (ctx) => M.cells.list().find(c => c.id === ctx.cell.id),
    list: () => M.cells.list().map(({ id, appId, title, icon, state }) => ({ id, appId, title, icon, state })),
    setTitle: (ctx, t) => { M.cells.setTitle(ctx.cell.id, t); return true; },
    setIcon: (ctx, i) => { M.cells.setIcon(ctx.cell.id, i); return true; },
    stow: (ctx) => M.cells.stow(ctx.cell.id),
    close: (ctx) => { setTimeout(() => M.cells.close(ctx.cell.id), 0); return true; },
    async open(ctx, appId, opts = {}) {
      const c = await M.cells.open(appId, { args: opts.args, parent: opts.detached ? null : ctx.cell.id });
      return c.id;
    },
    catalog: () => M.catalog.list().map(({ id, name, icon, category, userApp }) => ({ id, name, icon, category, userApp })),
    async install(ctx, path) { const mf = await M.catalog.install(path); return { id: mf.id, name: mf.name }; },
  };
  const perms = { install: 'app.install' };

  let off;
  return { id: 'api.cell', name: 'API · Cells', start() { off = M.api.register('cell', methods, perms); }, stop() { off && off(); } };
}
