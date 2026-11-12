# Política de privacidad de Cabe Todo

_Última actualización: 12 de noviembre de 2026_

Cabe Todo planifica las tareas del día. Existe como extensión de Chrome y como app web instalable (https://cabe-todo-web.vercel.app). Esta política explica qué datos maneja y qué hace con ellos.

## Resumen

- **El desarrollador no recopila, no recibe y no vende ningún dato.** Cabe Todo no tiene servidores propios, cuentas, analítica ni publicidad.
- Todo lo que escribes se guarda en tu equipo.
- Solo si tú activas **Sincronizar con Google Drive**, tus datos se guardan también en un archivo de **tu propio** Google Drive, para verlos en tus otros equipos.

## Qué datos guarda y dónde

Cabe Todo guarda en tu equipo:

- tus tareas, reuniones, rutinas y épicas (títulos, duraciones, fechas, bloques y estado);
- la documentación y los comentarios que escribes en cada tarea;
- los tiempos que registras con el temporizador;
- tus ajustes (bloques del día, plantillas, tema, avisos, orden del menú);
- la fecha de cada cambio y los borrados recientes (60 días), para poder mezclar los datos de tus equipos.

En la extensión se guardan en el almacenamiento local de Chrome (`chrome.storage.local`). En la app web, en el almacenamiento del navegador (IndexedDB).

Ni el desarrollador ni terceros tienen acceso a estos datos. Se borran al desinstalar la extensión o al borrar los datos del sitio en el navegador.

## Respaldo

Si usas **Ajustes → Respaldo**, Cabe Todo crea un archivo JSON con tus datos:
- **Exportar** o **Descargar** lo deja en la carpeta que elijas.
- En el celular, **Compartir…** lo entrega a la app que tú elijas (WhatsApp, correo, Drive…).

Cabe Todo no lo sube a ningún lugar por su cuenta.

## Sincronización con Google Drive (opcional)

Si activas **Ajustes → Sincronizar con Google Drive**:

- **Permiso que se pide:** Google te pide permiso para que Cabe Todo use tu Drive con el alcance `drive.file`. Con él, Cabe Todo **solo puede ver y modificar los archivos que ella misma crea**, no el resto de tu Drive.
- **Archivo que se usa:** Cabe Todo crea una carpeta `Cabe Todo` con un archivo `cabe-todo-sync.json`, que contiene los mismos datos del respaldo.
- **Sincronizar:** al tocar **Sincronizar**, Cabe Todo descarga ese archivo, lo mezcla con lo de tu equipo y lo vuelve a subir. La comunicación es directa entre tu navegador y Google; no pasa por ningún servidor del desarrollador.
- **Permiso de acceso (token):** Google entrega un permiso temporal de alrededor de una hora. Se guarda solo mientras el navegador está abierto (`chrome.storage.session` en la extensión, `sessionStorage` en la web) y nunca se envía a otro lugar que no sea Google.
- **No se pide** tu nombre, tu correo ni tus contactos.
- **Para dejar de usarla:**
  - **Desconectar** revoca el permiso y olvida la conexión en ese equipo.
  - También puedes quitar el acceso en https://myaccount.google.com/permissions.
  - El archivo en tu Drive no se borra solo: puedes eliminarlo cuando quieras.

El uso y la transferencia que hace Cabe Todo de la información recibida de las API de Google se ajustan a la [Política de datos de usuario de los servicios de las API de Google](https://developers.google.com/terms/api-services-user-data-policy), incluidos los requisitos de uso limitado. Los datos de tu Drive se usan solo para sincronizar tu lista: no se usan para publicidad, no se venden ni se comparten con nadie.

## Permisos de la extensión

| Permiso | Para qué se usa |
| --- | --- |
| `storage` | Guardar tus tareas y ajustes en tu equipo. |
| `sidePanel` | Mostrar la app en el panel lateral de Chrome. |
| `alarms` | Avisarte cuando termina un bloque, cuando el temporizador llega a cero y cuando empieza una reunión, y crear las rutinas del día. |
| `notifications` | Mostrar esos avisos. |
| `offscreen` | Reproducir el sonido de la alarma del temporizador. |
| `scripting` | Mostrar el temporizador flotante en las páginas, solo si lo activas. |
| `identity` | Abrir la ventana de Google para dar el permiso de Drive, solo si activas la sincronización. |
| Acceso a sitios web (opcional) | Se pide solo si activas el temporizador flotante en **Ajustes → Preferencias**. Sirve únicamente para dibujar el botón flotante del temporizador sobre las páginas. **La extensión no lee, guarda ni modifica el contenido de las páginas.** Puedes revocarlo cuando quieras desde `chrome://extensions`. |

## Código remoto

La extensión no descarga ni ejecuta código remoto: todo su código viene dentro del paquete publicado.

La app web carga la librería de inicio de sesión de Google (`accounts.google.com/gsi/client`) solo para la sincronización con Drive.

## Menores de edad

Cabe Todo no está dirigida a menores de 13 años y no recopila datos de nadie.

## Cambios a esta política

Si la política cambia, se actualizará este documento con su nueva fecha.

## Contacto

Para preguntas sobre privacidad, escribe a [dev.miguelangel.jaimen+cabetodo@gmail.com](mailto:dev.miguelangel.jaimen+cabetodo@gmail.com).
