# Ficha de Chrome Web Store

Textos listos para copiar en el [panel de desarrollador](https://chrome.google.com/webstore/devconsole). Las imágenes están en esta misma carpeta.

## Paquete

- Archivo: `releases/cabe-todo-vX.Y.Z.zip`, generado con `node scripts/release.mjs`. El zip trae `manifest.json` en la raíz.
- Idioma predeterminado: **Español**.

## Ficha de la tienda → Detalles del producto

**Nombre** (viene del manifest): `Cabe Todo`

**Resumen** (viene del manifest, 132 caracteres como máximo):

> Planifica tu día en bloques y sabe a tiempo si te alcanza: tareas, reuniones, rutinas y documentación en el panel lateral.

**Descripción**:

```
¿Te cabe todo en el día? Cabe Todo planifica tus tareas en bloques (mañana, tarde o los que tú definas) y te dice, bloque por bloque, la probabilidad de terminar a tiempo. Vive en el panel lateral de Chrome, junto a lo que estás haciendo.

ESCRIBE COMO HABLAS
Una caja de texto y Enter. Sin formularios:
• "Informe 2h tarde #ventas": 2 horas, en la tarde, en la épica Ventas.
• "Reunión equipo jueves 10am 1h": una reunión el jueves de 10:00 a 11:00.
• "Standup 15m cada día": una rutina que se crea sola cada día.
• "Ideas para la charla bl": al backlog, para después.

SABE A TIEMPO SI TE ALCANZA
• Probabilidad de terminar cada bloque, calculada con PERT a partir de tus estimaciones.
• Aprende de lo que tardas de verdad con el temporizador y ajusta el pronóstico.
• Sugerencias para mover tareas cuando un bloque no da.
• Avisos al terminar cada bloque y al empezar cada reunión, con cuenta regresiva antes.

ORGANIZA SIN ESFUERZO
• Hasta 5 bloques al día, con nombre, ícono y horario.
• Arrastra para reordenar y mueve tareas a otro bloque o día con un clic.
• Épicas con fecha objetivo, avance y probabilidad de llegar.
• Rutinas que se repiten los días que elijas.
• Vista de tareas hechas y de los próximos 7 días.

DOCUMENTA CADA TAREA
• Editor Markdown con plantillas (incluye "Historia de usuario"), tablas y casillas.
• Exporta la documentación a PDF tamaño carta.
• Comentarios con enlaces y documentos anclados.

TU INFORMACIÓN ES TUYA
• Sin cuentas, sin servidores, sin analítica, sin publicidad.
• Todo se guarda en tu navegador. Exporta un respaldo cuando quieras.
• Tema claro y oscuro.

Ábrelo con el ícono de la barra o con Alt+Shift+P.
```

**Categoría**: Productividad → Flujo de trabajo y planificación

**Imágenes** (en esta carpeta):

| Campo | Archivo | Tamaño |
| --- | --- | --- |
| Ícono de la tienda | `assets/icons/icon128.png` | 128×128 (dibujo de 96×96 con margen) |
| Capturas de pantalla | `screenshots/1-hoy.png` … `screenshots/5-ajustes.png` | 1280×800 |
| Mosaico promocional pequeño | `promo-small-440x280.png` | 440×280 |
| Mosaico de marquesina (opcional) | `promo-marquee-1400x560.png` | 1400×560 |

**URL de la página principal**: https://github.com/dev-miguelangel/cabe-todo-ext

**URL oficial**: déjala vacía. Es opcional y solo acepta sitios verificados en Google Search Console con la misma cuenta de Google del panel de desarrollador; github.com no se puede verificar. Si algún día la quieres, verifica `https://dev-miguelangel.github.io/cabe-todo-ext/` en Search Console con un archivo HTML en `docs/`.

**URL de asistencia**: https://github.com/dev-miguelangel/cabe-todo-ext/issues

**Correo de contacto**: dev.miguelangel.jaimen+cabetodo@gmail.com

## Prácticas de privacidad

**Propósito único**:

> Planificar las tareas del día en bloques de tiempo y pronosticar si alcanza el tiempo para terminarlas.

**Justificación de permisos**:

| Permiso | Justificación |
| --- | --- |
| `storage` | Guarda localmente las tareas, épicas, rutinas, documentación y ajustes del usuario. |
| `sidePanel` | La interfaz completa de la extensión se muestra en el panel lateral de Chrome. |
| `alarms` | Programa los avisos de fin de bloque, el aviso cuando el temporizador de una tarea llega a cero, el inicio de reuniones y la creación diaria de rutinas a medianoche. |
| `notifications` | Muestra esos avisos al usuario (fin de bloque, temporizador en cero, inicio de reunión). |
| `offscreen` | Reproduce el sonido de la alarma del temporizador: en Manifest V3 el service worker no puede reproducir audio, así que usa un documento offscreen con el motivo AUDIO_PLAYBACK. |
| `scripting` | Registra el content script del temporizador flotante solo después de que el usuario lo activa en Ajustes y concede el acceso opcional a los sitios. |
| Permiso de host (opcional: `http://*/*`, `https://*/*`) | Opcional y pedido en tiempo de ejecución. Solo se usa para dibujar sobre las páginas un botón flotante con la cuenta del temporizador de la tarea en curso y la cuenta regresiva de la próxima reunión. El script lee únicamente el almacenamiento de la propia extensión; no lee, guarda ni modifica el contenido de las páginas. |

**¿Usas código remoto?** No. Todo el código JavaScript viene incluido en el paquete.

**Uso de datos**: no marcar ninguna categoría. La extensión no recopila ni transmite datos: todo queda en `chrome.storage.local` en el equipo del usuario.

Marcar las tres certificaciones:

- No vendo ni transfiero datos de usuarios a terceros, salvo en los casos de uso aprobados.
- No uso ni transfiero datos de usuarios para fines no relacionados con el propósito único del elemento.
- No uso ni transfiero datos de usuarios para determinar la solvencia crediticia ni con fines de préstamo.

**URL de la política de privacidad**: https://dev-miguelangel.github.io/cabe-todo-ext/privacidad.html (GitHub Pages, carpeta `docs/` de `main`; fuente en `docs/privacidad.html`)

## Distribución

- Visibilidad: **Público**, o **No listado** si quieres probar primero con un enlace.
- Regiones: todas.

## Antes de enviar

- [ ] `node tests/run.mjs` pasa.
- [ ] `node scripts/release.mjs` genera el zip nuevo.
- [ ] Probar el zip: descomprimirlo, cargarlo en `chrome://extensions` y revisar Hoy, Épicas, Docs y el temporizador flotante. Al activar el temporizador flotante, Chrome debe pedir el permiso.
- [x] Política de privacidad publicada y con correo de contacto.
- [ ] Correo de contacto verificado en la cuenta de desarrollador. El registro único cuesta USD 5.
