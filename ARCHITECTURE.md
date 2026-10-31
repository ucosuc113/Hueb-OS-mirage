# Hueb-OS Mirage — architecture

> The Kernel (`Kernel.js`) **is never touched**. Everything here builds on what the Kernel already exposes.
>
> **Mirage is self-contained.** It shares only `Kernel.js` with the Hueb-OS environment. It has its own bootloader
> (L0, `index.html` + `ignition.js`) and its own shell. It does not use the repo's root `index.html`, nor `sw.js`, nor the
> installer, nor the `/system/OS/<repo>` structure: just serve this folder as is (GitHub Pages, any static
> server). **Warning:** the Kernel fixes the name of the IndexedDB database (`HuebOS`); two systems on the *same
> origin* would share data. Serve it from its own domain/origin.

## Why not "bootloader + shell"

Two layers force the shell to be a monolithic block: if it fails, everything fails; if you want to change
how windows look, you rewrite the shell. Mirage separates **what the system does** from **how it looks**
in layers with small contracts, and builds the shell *with the Kernel's own tools*
(modules, processes, permissions) instead of next to them.

```
 Kernel.js                untouchable (the only thing shared with Hueb-OS): FS, Procs, Apps, Prefs, Permissions, Modules, Notifications…
 ─────────────────────────────────────────────────────────────────────────────
 L0  IGNITION     index.html + mirage/ignition.js   own BOOTLOADER: loads Kernel.js, safe mode, rescue
 L1  SUBSTRATE    mirage/substrate.js               8 headless organs (draw nothing)
 L2  CELL HOST    mirage/cells.js                   cell = process + iframe + card + IPC
 L3  MODULES      Modulos/{Servicios,API,Componentes}   what the Kernel loads and manages
 L4  CELLS        apps/*.html                       isolated applications that talk through the SDK
```

### The Substrate's 8 organs

| organ | what for | who uses it |
|---|---|---|
| `Mirage.bus` | own pub/sub. Kernel events come in as `k:<event>` | everyone |
| `Mirage.svc` | locator with waiting: `await svc.need('mood')`. Load order stops mattering | modules |
| `Mirage.intents` | providers of *wishes*: apps, files, verbs, math… | Wish |
| `Mirage.api` | public namespaces (`fs.read`, `cell.open`…) with per-method permission | cells |
| `Mirage.caps` | user role ∩ the cell's covenant; asks the `covenant` component for the covenant | api |
| `Mirage.tokens` | live design variables, pushed to the shell and cells | mood |
| `Mirage.ui` | fixed layers and `scope(owner)` with `dispose()` — a module unmounts without a trace | components |
| `Mirage.lens` | **how cells are laid out.** A lens only decides geometry | table, mosaic |

Plus `Mirage.catalog` (Kernel apps + whatever their manifest says) and `Mirage.cells` (L2).

## Startup

1. `index.html` loads `substrate.js`, `cells.js` and `ignition.js`. Ignition opens a 700 ms window (Shift or F8 =
   safe mode), **loads `Kernel.js` itself** (if missing, it shows a failure with retry), and calls `Mirage.init()`
   (idempotent: every module calls it too).
2. The Kernel starts on its own (DB → FS → prefs → apps from `apps/index.json` → modules).
3. Its `ModuleLoader`s sync `Modulos/<Type>/index.json` and run each file:
   `registerService` → `registerAPI` → `registerComponent`. Each module is a **protected process**
   in `Kernel.procs`, and can be stopped/restarted hot (`Kernel.modules.restart(path)`),
   even the active lens — the whole interface reloads without touching cells or the Kernel.
4. Kernel `ready` event → catalog, saved lens, session restore (`mirage.session`).
5. With no lens at all (Safe Mode or broken modules) Ignition offers its **rescue console**, which depends on
   no module and can relaunch `Kernel.modules.bootAll()`.

## What is different from the usual desktop

- **Table, not desktop.** An infinite plane with no windows or taskbar. Drag the background, wheel to zoom,
  and **semantic zoom**: far away, each cell collapses into a bubble. `Esc` sees everything, `⤢` enters a cell.
  The zoom snaps to a crisp 1:1 near 100 %.
- **Threads.** A cell opened from another stays joined to it by a line (it is the Kernel's `Procs` tree).
  Closing the parent closes the children, because killing the process kills its children.
- **Wish, and also a start menu.** `Ctrl+Space` (or typing any letter) opens a single bar: apps, files,
  `note …`, `2+2`, `lens mosaic`, `mood paper`, `install /path.html`, `see all`, `reload interface`, `lock`.
  Any module adds providers with `Mirage.intents.provide`.
- **Fold.** The start menu, as a sheet folded in three (`Alt+M` or the MIRAGE button in the Pulse): system status
  and actions (lock, reload, reboot, repair), a keyboard-driven cell index, and lens/mood switches.
- **Lock.** A lock screen (`lock` in the Wish, or `L` in the Fold) with a big clock and, if the user has a password,
  a field to get back in. It is a courtesy lock, not real security.
- **Motion.** Cells are born as a dot that stretches into a line and opens into a sheet; closing plays it in reverse.
  Switchable and adjustable in Settings.
- **Interchangeable lenses.** `Table` and `Mosaic` (grid) show the same cells **without reloading a single iframe**
  (moving an iframe in the DOM would restart it; that is why lenses only touch geometry).
- **Pocket, not minimize.** A stowed cell stays alive; it just stops getting in the way.
- **Chronicle.** Time as the axis: a diary of what happens + recent versions of text files with *restore*
  (also for already deleted files).
- **Mood.** Grayscale scale: Night, Day, Graphite, Paper; in *auto* it follows the clock (day 7–19 h).
- **Covenants.** Third-party cells ask for each permission with a card; "always / just now / deny".
  This closes the Kernel gap where nobody granted permissions to apps.
- **User cells.** Any `.html` with a `wos-manifest` manifest in `/device/apps` is an app
  (`install <path>` or the button in Files). The Kernel forgets the registry on every boot; Mirage rebuilds it.

## Visual language

Flat, black and white, minimalist: **no gradients, no shadows, no rounded corners, no emoji**. Solid colors;
hierarchy is made with opacity (`--ink`, `--ink2` = 55 %, `--line` = 20 %, `--edge` = 40 %). Icons are
linear SVG stroke that inherits the color (`currentColor`); an emoji from a third-party cell is turned gray by CSS.
**Every border measures 2 real monitor pixels**: `--bw` = 2 / `devicePixelRatio` (recalculated if the browser zoom
changes). Inside the Table the plane is scaled, so the cell frame uses `--bw / --k` and threads use
`vector-effect: non-scaling-stroke`: they keep measuring 2 px at any zoom. (A cell's inner content does
scale with the zoom, like an image.) To keep that content sharp, the plane only holds its own GPU layer while
moving; once it stops, the layer is released and the browser re-rasterizes at the real scale.

## Security (aligned with the `/device` boundary)

- `Kernel.fs` already jails everything to `/device`; Mirage opens no other path (it never uses raw `DB`).
- System cells (`meta.systemApp`): `srcdoc` iframe with `allow-same-origin`. Third-party cells:
  **opaque origin**, they can only use the SDK/IPC. Verified: `frame.contentDocument` is inaccessible from the shell.
- Every call goes through `Mirage.caps`: the user's role rules; on top of it, the cell's covenant.
- The IPC only serves windows the shell opened (`cellBySource`).

## Contracts for extending

**Service / API / Component** — a file in `Modulos/<Type>/` + its name in `index.json`:

```js
function registerComponent(Kernel) {          // registerService / registerAPI work the same
  const M = window.Mirage.init();
  const ui = M.ui.scope('my-thing');
  return { id: 'ui.my-thing', name: 'My thing',
    start() { ui.style('…'); ui.mount('chrome', el); },
    stop()  { ui.dispose(); } };                // leaves the DOM clean
}
```

**Lens** — `M.lens.register({ id, name, icon, enter(), leave(), place(cell), suggest?(cell,parent), fit?(id), overview?() })`.
Cells are `M.cells.get(id)` (`.rect`, `.el`, `.state`, `.parent`); change `.rect` and call `M.cells.touch(id)`.

**Cell** — an `.html` with:

```html
<script type="application/json" id="wos-manifest">{ "id":"my-app", "name":"My app", "icon":"🧪",
  "keywords":["…"], "permissions":["fs.read"], "winWidth":600, "winHeight":420 }</script>
<script>
  Mirage.ready.then(info => { /* info.args, info.trusted */ });
  const txt = await Mirage.fs.read('/device/docs/a.txt');   // any Mirage.api namespace
  Mirage.on('k:fs:write', e => {});                          // Kernel / Mirage events
</script>
```

The SDK, the tokens (`var(--ink)`, `--accent`, `--panel`…) and a minimal CSS kit are injected automatically.
**Do not declare globals named `parent`, `top` or `Mirage`**: the SDK is already protected against `parent`, but it is a bad idea.

## Known limitations / pending

- Verified with a local static server (real Chrome and the built-in browser). No Service Worker or external bootloader;
  still to be tested on GitHub Pages with its base path.
- `srcdoc` iframes inherit the page's CSP: `index.html` defines none; if you add one, allow inline scripts.
- Missing: dragging files between cells, shortcuts inside cells beyond the Wish and the Fold, `.hpkg` packaging
  (Mirage uses `.html` with a manifest).
- File names (`pliego.js`, `candado.js`, `movimiento.js`, `mesa.js`…) and internal ids (`ui.pliego`, lens id `mesa`)
  keep their original Spanish names; only what the user sees was translated.
