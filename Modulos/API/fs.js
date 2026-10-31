/* API · fs — /device files for cells. The Kernel already jails everything to /device;
   here we only decide WHO may call (capabilities) and what shape the responses have. */
function registerAPI(Kernel) {
  const M = window.Mirage.init();
  const fs = Kernel.fs;

  const brief = n => ({
    id: n.id, name: n.name, type: n.type, size: n.size || 0, mtime: n.mtime || 0,
    mime: n.mime || null, binary: n.encoding === 'binary', appId: n.type === 'shortcut' ? n.meta?.appId : undefined,
  });

  const methods = {
    async list(ctx, path) {
      const items = (await fs.readdir(path)).map(brief);
      return items.sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name));
    },
    read: (ctx, path) => fs.read(path),
    readDataURL: (ctx, path) => fs.readDataURL(path),
    stat: (ctx, path) => fs.stat(path),
    exists: (ctx, path) => fs.exists(path),
    open: (ctx, path) => fs.stat(path).then(st => st && st.type === 'dir'
      ? M.cells.open('files', { args: { startPath: path }, parent: ctx.cell.id }).then(() => ({ ok: true }))
      : Kernel.openFile(path)),
    async write(ctx, path, content) { await fs.write(path, String(content ?? '')); return true; },
    async writeBinary(ctx, path, buf, mime) { await fs.writeBinary(path, buf, mime); return true; },
    async mkdir(ctx, path) { await fs.mkdir(path); return true; },
    async move(ctx, from, to) { await fs.move(from, to); return true; },
    async remove(ctx, path, recursive) { await fs.remove(path, { recursive: !!recursive }); return true; },
  };
  const perms = {
    list: 'fs.read', read: 'fs.read', readDataURL: 'fs.read', stat: 'fs.read', exists: 'fs.read', open: 'fs.read',
    write: 'fs.write', writeBinary: 'fs.write', mkdir: 'fs.write', move: 'fs.write', remove: 'fs.delete',
  };

  let off;
  return { id: 'api.fs', name: 'API · Files', start() { off = M.api.register('fs', methods, perms); }, stop() { off && off(); } };
}
