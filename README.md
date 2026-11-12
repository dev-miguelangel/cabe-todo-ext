<img src="assets/icons/icon128.png" alt="" width="64" align="left">

# Cabe Todo

**¿Te cabe todo en el día?** Planifica tus tareas en mañana y tarde, y sabe si te alcanza el tiempo.

<br clear="left">

Extensión de Chrome (Manifest V3) para planificar **un solo día** en bloques: por defecto **mañana** y **tarde**, o hasta 5 bloques propios (título, ícono y horario).

Por fuera es un tablero simple de tarjetas. Por dentro usa [PERT](https://es.wikipedia.org/wiki/T%C3%A9cnica_de_revisi%C3%B3n_y_evaluaci%C3%B3n_de_programas) para responder una sola pregunta:

> **¿Me alcanza este bloque del día para todo lo que puse?**

El usuario nunca escribe estimaciones optimistas/pesimistas ni ve fórmulas: solo ve resultados en lenguaje simple ("85 % de terminar a tiempo").

---

## Tabla de contenidos

- [Funcionalidades](#funcionalidades)
- [Instalación](#instalación)
- [Uso rápido](#uso-rápido)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Arquitectura](#arquitectura)
- [Desarrollo](#desarrollo)
- [Pruebas](#pruebas)
- [Versionar y publicar](#versionar-y-publicar)
- [Convenciones](#convenciones)
- [Privacidad](#privacidad)

## Funcionalidades

- **Crear una tarea en menos de 3 segundos**: una caja de texto y Enter (`Informe 2h ? pm #web`).
- **Bloques personalizables**: hasta 5 por día, cada uno con título, ícono y horario, sin superponerse.
- **Vistas**: *Hoy* (las tareas del día por bloque, con su campo para agregar, pronóstico y avance; ‹ › para otros días y 📅 para los próximos 7), *Épicas*, *Hechas* (completadas por día), *Rutinas* (todo lo que se repite: editar o eliminar), *Docs* (tareas con documentación) y *Ajustes*.
- **Tema claro / oscuro** con el botón ☾ / ☀︎ de arriba a la derecha (también en la documentación).
- **Pronóstico por bloque**: probabilidad de terminar a tiempo, calculada con PERT y calibrada con tu tiempo real.
- **Dependencias** ("va después de…") que ordenan el bloque y marcan la ruta crítica.
- **Temporizador por tarea** con alarma sonora y temporizador flotante opcional en las páginas que visitas (se activa en Ajustes y Chrome pide permiso).
- **Reuniones** con horario fijo, que pueden bloquear tu tiempo o correr en paralelo, y terminan solas a su hora.
- **Épicas**: agrupan trabajo de varios días, con progreso, fecha objetivo y bandeja propia.
- **Rutinas**: tareas que se repiten (`cada día`, `hábiles`, `cada lun,jue`). Al editar o borrar una, eliges si es *solo esta* o *todas*.
- **Documentación por tarea** en Markdown, en una pestaña a pantalla completa, con buscador en la vista *Docs*.
- **Cierre del día**: resumen de lo hecho frente a lo estimado, y mover lo pendiente con un clic.
- **Respaldo**: exportar e importar todos tus datos en JSON.
- **Temas**: oscuro (Chrome) y claro estilo Trello.

## Instalación

No hay *build*: el código se carga tal cual.

1. Clona el repositorio:
   ```bash
   git clone <url-del-repositorio> cabe-todo
   ```
2. Abre `chrome://extensions` y activa el **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y elige la carpeta del proyecto (la que contiene `manifest.json`).
4. Abre el panel con el icono de la extensión o con <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>.

Requiere Chrome 116 o superior (Side Panel API y documentos *offscreen*).

## Uso rápido

| Escribes | Resultado |
| --- | --- |
| `Responder correos` | Tarea con la duración por defecto, en el bloque actual |
| `Informe mensual 2h` | 2 horas de duración estimada |
| `Llamar a Juan 15m tarde` | 15 minutos, en el bloque *Tarde*: sirve el nombre de cualquier bloque (`gym`, `foco profundo`) |
| `Llamar a Juan 15m pm` | Igual que `tarde`: `am` / `pm` y `@gym` también funcionan |
| `Revisar PR 1h ?` | No estoy seguro: más margen en el pronóstico |
| `Pagar luz 10m !` | Estoy seguro: menos margen |
| `Ideas para la charla bl` | Al backlog, sin fecha ni bloque |
| `Revisar informe mañana am` | Mañana (el día siguiente), en el bloque de la mañana. `mañana` es siempre un día; el horario es `am` / `pm` / `tarde` |
| `Enviar factura el viernes` | El próximo viernes (hoy si coincide) |
| `Reunión proyecto 1 miércoles desde la 1pm 1h` | Reunión "proyecto 1" el miércoles de 13:00 a 14:00 (`a las 15`, `hasta las 16:30`, `13:00` también sirven) |
| `Diseño home 3h #web` | Asignada a la épica *web* |
| `Standup 15m am cada día` | Rutina diaria |

Atajos dentro del panel: <kbd>N</kbd> crea una tarea nueva en el bloque actual.

## Estructura del proyecto

```
cabe-todo/
├── manifest.json              # Definición de la extensión (único archivo requerido en la raíz)
├── README.md
├── assets/
│   └── icons/                 # Iconos 16/32/48/128 (generados con scripts/make_icons.py)
├── releases/                  # Zips de cada versión (cabe-todo-vX.Y.Z.zip)
├── docs/
│   ├── idea.md                # Documento de diseño: objetivos, modelo de datos y decisiones
│   ├── privacy.md             # Política de privacidad
│   └── store/                 # Ficha de la Chrome Web Store: textos, capturas y mosaicos
├── scripts/
│   ├── make_icons.py          # Genera los iconos sin dependencias
│   └── release.mjs            # Versiona: dist/ minificado + zip en releases/
├── src/
│   ├── background/
│   │   └── background.js      # Service worker: alarmas, notificaciones, reuniones y rutinas
│   ├── content/
│   │   └── float-timer.js     # Content script: temporizador flotante (se registra solo con permiso)
│   ├── pages/                 # Puntos de entrada HTML (uno por carpeta)
│   │   ├── panel/             # Side panel: panel.html · panel.js · panel.css (estilos base)
│   │   ├── doc/               # Pestaña de documentación de una tarea
│   │   └── offscreen/         # Documento offscreen para reproducir sonido
│   ├── views/                 # Vistas del panel: Hoy, Épicas, Hechas, Rutinas, Docs y Ajustes
│   ├── components/            # Piezas de UI reutilizables: tarjeta, modal, comentarios, editor
│   ├── core/                  # Lógica de dominio pura: PERT, bloques, parser, rutinas, temporizador
│   ├── services/              # Estado y persistencia: store, storage, sonido
│   ├── utils/                 # Utilidades: fechas, Markdown, helpers de DOM, arranque de tema
│   └── styles/                # Temas visuales (theme-trello.css)
└── tests/
    └── run.mjs                # Pruebas de la lógica: node tests/run.mjs
```

### Reglas de dependencia entre capas

```
pages → views → components → services → core · utils
```

`core/` y `utils/` son la base y no importan de las capas superiores.

- **`core/`** no usa DOM ni `chrome.*`. Son funciones puras, fáciles de probar con Node.
- **`services/store.js`** es la única puerta para cambiar el estado: las vistas leen `state` y llaman acciones.
- **`services/storage.js`** encapsula `chrome.storage.local`. Fuera de la extensión usa `localStorage`, para poder abrir las páginas en un navegador normal.
- Una capa solo importa de las capas que tiene a su derecha. Evita imports hacia atrás.

## Arquitectura

- **Vanilla JS, HTML y CSS** con módulos ES nativos. Sin framework, sin bundler y sin dependencias de runtime.
- **Flujo de datos unidireccional**: acción → `commit()` (aplica reglas y guarda) → suscriptores → re-render.
- **Persistencia local** en `chrome.storage.local`. Las pestañas abiertas se sincronizan con `chrome.storage.onChanged`.
- **Service worker** para todo lo que debe ocurrir con el panel cerrado: alarmas de fin de bloque, temporizador en cero, inicio y fin de reuniones, y creación diaria de rutinas.
- **Temas** con *design tokens* (variables CSS) en `:root`. Cada tema redefine los tokens bajo `[data-theme="…"]`. `utils/theme-boot.js` aplica el tema guardado antes del primer pintado.

> En el service worker, las rutas relativas se resuelven desde `src/background/`. Por eso usa rutas absolutas desde la raíz de la extensión (`/assets/...`, `/src/pages/...`).

## Desarrollo

1. Edita los archivos en `src/`.
2. En `chrome://extensions`, pulsa **↻ Recargar** en Cabe Todo. Si cambiaste el service worker o el manifiesto, cierra y vuelve a abrir el panel.
3. Para iterar en la UI sin recargar la extensión, sirve el proyecto y abre la página directamente:
   ```bash
   python3 -m http.server 8000
   # http://localhost:8000/src/pages/panel/panel.html
   ```
   Fuera de la extensión los datos se guardan en `localStorage`, y las APIs de `chrome.*` que faltan se omiten.

Para regenerar los iconos:

```bash
python3 scripts/make_icons.py
```

## Pruebas

Las pruebas cubren la lógica pura y el service worker (con `chrome.*` simulado). Solo necesitan Node 18 o superior:

```bash
node tests/run.mjs
```

Cada grupo imprime `OK: …`. Si falla una aserción, el proceso termina con código distinto de 0.

## Versionar y publicar

```bash
node scripts/release.mjs          # patch: 1.0.1 → 1.0.2
node scripts/release.mjs minor    # 1.0.2 → 1.1.0
node scripts/release.mjs major    # 1.1.0 → 2.0.0
node scripts/release.mjs 1.4.0    # versión exacta
```

El script:

1. Sube la versión en `manifest.json`.
2. Genera `dist/` con la extensión minificada. Usa [esbuild](https://esbuild.github.io/) vía `npx` para JS y CSS, sin instalar nada en el proyecto. `dist/` no se versiona.
3. Deja el paquete en `releases/cabe-todo-v<versión>.zip`, listo para subir a la Chrome Web Store.

Para probar la versión minificada antes de publicar, carga la carpeta `dist/` como extensión descomprimida.

### Chrome Web Store

Los textos de la ficha, la justificación de cada permiso, las respuestas de privacidad y la lista previa al envío están en [`docs/store/listing.md`](docs/store/listing.md). Las capturas (1280×800) y los mosaicos promocionales están en `docs/store/`, y la política de privacidad en [`docs/privacy.md`](docs/privacy.md).

El acceso a los sitios web es **opcional**: solo se pide al activar el temporizador flotante. Así la extensión se instala sin la advertencia "Leer y cambiar todos tus datos en todos los sitios web".

## Convenciones

- **Commits** con [Conventional Commits](https://www.conventionalcommits.org/es/): `feat:`, `fix:`, `refactor:`, `docs:`, `test:`…
- **Nombres de archivo** en `kebab-case.js`. Un módulo por responsabilidad.
- **Textos de la interfaz** en español.
- **Lógica nueva**: si no toca el DOM, va en `core/` y se agrega su prueba en `tests/run.mjs`.
- **Estilos**: usa los tokens (`--bg`, `--text`, `--accent`…) en lugar de colores fijos, para que funcionen todos los temas.
- **Simplicidad ante todo**: cada funcionalidad nueva debe servir al objetivo único, que es saber si te alcanza el día.

## Privacidad

Cabe Todo no tiene backend ni cuentas, y no envía datos a ningún servidor. Todo queda en el almacenamiento local de tu navegador. El respaldo JSON se descarga en tu equipo y solo tú decides dónde guardarlo. Ver la [política de privacidad](docs/privacy.md).
