# Hueb-OS Mirage — arquitectura

> El Kernel (`Kernel.js`) **no se toca nunca**. Todo lo de aquí se apoya en lo que el Kernel ya expone.
>
> **Mirage es autónomo.** Comparte con el entorno Hueb-OS únicamente `Kernel.js`. Tiene su propio bootloader
> (L0, `index.html` + `ignition.js`) y su propio shell. No usa el `index.html` raíz del repo, ni `sw.js`, ni el
> instalador, ni la estructura `/system/OS/<repo>`: basta con servir esta carpeta tal cual (GitHub Pages, cualquier
> servidor estático). **Aviso:** el Kernel fija el nombre de la base IndexedDB (`HuebOS`); dos sistemas en el *mismo
> origen* compartirían datos. Sírvelo desde un dominio/origen propio.

## Por qué no "bootloader + shell"

Dos capas obligan a que el shell sea un bloque monolítico: si falla, falla todo; si quieres cambiar
cómo se ven las ventanas, reescribes el shell. Mirage separa **qué hace el sistema** de **cómo se ve**
en capas con contratos pequeños, y construye el shell *con las herramientas del propio Kernel*
(módulos, procesos, permisos) en vez de al lado de ellas.

```
 Kernel.js                intocable (lo único compartido con Hueb-OS): FS, Procs, Apps, Prefs, Permisos, Módulos, Notificaciones…
 ─────────────────────────────────────────────────────────────────────────────
 L0  IGNITION     index.html + mirage/ignition.js   BOOTLOADER propio: carga Kernel.js, modo seguro, rescate
 L1  SUBSTRATE    mirage/substrate.js               8 órganos headless (sin pintar nada)
 L2  CELL HOST    mirage/cells.js                   celda = proceso + iframe + tarjeta + IPC
 L3  MÓDULOS      Modulos/{Servicios,API,Componentes}   lo que el Kernel carga y gestiona
 L4  CELDAS       apps/*.html                       aplicaciones aisladas que hablan por SDK
```

### Los 8 órganos del Substrate

| órgano | para qué | quién lo usa |
|---|---|---|
| `Mirage.bus` | pub/sub propio. Eventos del Kernel entran como `k:<evento>` | todos |
| `Mirage.svc` | localizador con espera: `await svc.need('mood')`. El orden de carga deja de importar | módulos |
| `Mirage.intents` | proveedores de *deseos*: apps, archivos, verbos, cálculo… | Deseo |
| `Mirage.api` | namespaces públicos (`fs.read`, `cell.open`…) con permiso por método | celdas |
| `Mirage.caps` | rol del usuario ∩ pacto de la celda; pide el pacto al componente `covenant` | api |
| `Mirage.tokens` | variables de diseño vivas, empujadas a shell y celdas | mood |
| `Mirage.ui` | capas fijas y `scope(owner)` con `dispose()` — un módulo se desmonta sin dejar rastro | componentes |
| `Mirage.lens` | **cómo se disponen las celdas.** Una lente solo decide geometría | mesa, mosaico |

Más `Mirage.catalog` (apps del Kernel + lo que su manifiesto dice de más) y `Mirage.cells` (L2).

## Arranque

1. `index.html` carga `substrate.js`, `cells.js` e `ignition.js`. Ignition abre una ventana de 700 ms (Shift o F8 =
   modo seguro), **carga `Kernel.js` él mismo** (si falta, muestra un fallo con reintento), y llama a `Mirage.init()`
   (idempotente: también lo llama cada módulo).
2. El Kernel arranca solo (DB → FS → prefs → apps desde `apps/index.json` → módulos).
3. Sus `ModuleLoader` sincronizan `Modulos/<Tipo>/index.json` y ejecutan cada archivo:
   `registerService` → `registerAPI` → `registerComponent`. Cada módulo es un **proceso protegido**
   en `Kernel.procs`, y se puede parar/reiniciar en caliente (`Kernel.modules.restart(path)`),
   incluso la lente activa — la interfaz entera se recarga sin tocar celdas ni Kernel.
4. Evento `ready` del Kernel → catálogo, lente guardada, restauración de la sesión (`mirage.session`).
5. Sin ninguna lente (Modo Seguro o módulos rotos) Ignition ofrece su **consola de rescate**, que no depende
   de ningún módulo y puede relanzar `Kernel.modules.bootAll()`.

## Qué es distinto del escritorio de siempre

- **Mesa, no escritorio.** Un plano infinito sin ventanas ni barra de tareas. Arrastrar el fondo, rueda para zoom,
  y **zoom semántico**: lejos, cada celda colapsa a una burbuja. `Esc` ve todo, `⤢` entra en una celda.
- **Hilos.** Una celda abierta desde otra queda unida a ella por una línea (es el árbol de `Procs` del Kernel).
  Cerrar la madre cierra a las hijas, porque matar el proceso mata a sus hijos.
- **Deseo, no menú inicio.** `Ctrl+Espacio` (o escribir cualquier letra) abre una barra única: apps, archivos,
  `nota …`, `2+2`, `lente mosaico`, `ánimo ocaso`, `instalar /ruta.html`, `ver todo`, `recargar interfaz`.
  Cualquier módulo suma proveedores con `Mirage.intents.provide`.
- **Lentes intercambiables.** `Mesa` y `Mosaico` (rejilla) muestran las mismas celdas **sin recargar ni un iframe**
  (mover un iframe en el DOM lo reiniciaría; por eso las lentes solo tocan geometría).
- **Bolsillo, no minimizar.** Una celda guardada sigue viva; solo deja de estorbar.
- **Crónica.** El tiempo como eje: diario de lo que ocurre + versiones recientes de archivos de texto con *restaurar*
  (también de archivos ya borrados).
- **Ánimo.** Escala de grises: Noche, Día, Grafito, Papel; en *auto* sigue la hora (día 7–19 h).
- **Pactos.** Las celdas de terceros piden cada permiso con una tarjeta; "siempre / solo esta vez / negar".
  Esto cierra el hueco del Kernel donde nadie concedía permisos a las apps.
- **Celdas de usuario.** Cualquier `.html` con manifiesto `wos-manifest` en `/device/apps` es una app
  (`instalar <ruta>` o el botón en Archivos). El Kernel olvida el registro en cada arranque; Mirage lo reconstruye.

## Lenguaje visual

Plano, blanco y negro, minimalista: **sin degradados, sin sombras, sin esquinas redondeadas, sin emojis**. Colores
sólidos; la jerarquía se hace con opacidad (`--ink`, `--ink2` = 55 %, `--line` = 20 %, `--edge` = 40 %). Los iconos
son trazo lineal SVG que hereda el color (`currentColor`); un emoji de una celda de terceros se pasa a gris por CSS.
**Todo borde mide 2 píxeles reales del monitor**: `--bw` = 2 / `devicePixelRatio` (se recalcula si cambia el zoom del
navegador). Dentro de la Mesa el plano se escala, por eso el marco de la celda usa `--bw / --k` y los hilos usan
`vector-effect: non-scaling-stroke`: siguen midiendo 2 px a cualquier zoom. (El contenido interno de una celda sí
escala con el zoom, como una imagen.)

## Seguridad (alineada con la frontera `/device`)

- `Kernel.fs` ya enjaula todo a `/device`; Mirage no abre otra vía (nunca usa `DB` crudo).
- Celdas de sistema (`meta.systemApp`): iframe `srcdoc` con `allow-same-origin`. Celdas de terceros:
  **origen opaco**, solo pueden usar el SDK/IPC. Verificado: `frame.contentDocument` es inaccesible desde el shell.
- Toda llamada pasa por `Mirage.caps`: el rol del usuario manda; encima, el pacto de la celda.
- El IPC solo atiende a ventanas que el shell abrió (`cellBySource`).

## Contratos para extender

**Servicio / API / Componente** — un archivo en `Modulos/<Tipo>/` + su nombre en `index.json`:

```js
function registerComponent(Kernel) {          // registerService / registerAPI igual
  const M = window.Mirage.init();
  const ui = M.ui.scope('mi-cosa');
  return { id: 'ui.mi-cosa', name: 'Mi cosa',
    start() { ui.style('…'); ui.mount('chrome', el); },
    stop()  { ui.dispose(); } };                // deja el DOM limpio
}
```

**Lente** — `M.lens.register({ id, name, icon, enter(), leave(), place(cell), suggest?(cell,parent), fit?(id), overview?() })`.
Las celdas son `M.cells.get(id)` (`.rect`, `.el`, `.state`, `.parent`); cambia `.rect` y llama `M.cells.touch(id)`.

**Celda** — un `.html` con:

```html
<script type="application/json" id="wos-manifest">{ "id":"mi-app", "name":"Mi app", "icon":"🧪",
  "keywords":["…"], "permissions":["fs.read"], "winWidth":600, "winHeight":420 }</script>
<script>
  Mirage.ready.then(info => { /* info.args, info.trusted */ });
  const txt = await Mirage.fs.read('/device/docs/a.txt');   // cualquier namespace de Mirage.api
  Mirage.on('k:fs:write', e => {});                          // eventos del Kernel / Mirage
</script>
```

El SDK, los tokens (`var(--ink)`, `--accent`, `--panel`…) y un kit CSS mínimo se inyectan solos.
**No declares globales llamados `parent`, `top` o `Mirage`**: el SDK ya está protegido contra `parent`, pero es mala idea.

## Limitaciones conocidas / pendientes

- Verificado con servidor estático local (Chrome real y el navegador integrado). Sin Service Worker ni bootloader
  externo; falta probarlo en GitHub Pages con su ruta base.
- Los iframes `srcdoc` heredan el CSP de la página: `index.html` no define ninguno; si añades uno, permite scripts inline.
- Faltan: arrastrar archivos entre celdas, atajos dentro de celdas más allá del Deseo, empaquetado `.hpkg`
  (Mirage usa `.html` con manifiesto).
