# Plan: sincronizar con Google Drive

Ver y editar la misma lista en todos mis equipos (extensión de Chrome y web en el celular) con un botón **Sincronizar**. Los datos se guardan en mi propio Google Drive, de forma privada.

**Estado:** etapas 1 (mezcla), 2 (Drive en la web) y 3 (Drive en la extensión) hechas. Etapa 4 (textos, tienda y versiones) pendiente.

## Decisiones

| Tema | Decisión |
| --- | --- |
| Quién | Solo yo, con la misma cuenta de Google en todos los equipos. No se comparte con otras personas. |
| Dónde | Un archivo `cabe-todo-sync.json` en una carpeta `Cabe Todo` de **mi** Drive. No es público. |
| Permiso de Google | `drive.file`: la app solo ve los archivos que ella misma crea, no el resto del Drive. Es un permiso "no sensible". |
| Cuándo | Botón **Sincronizar** en Ajustes (y quizás en el encabezado de Hoy). Sin sincronización automática por ahora. |
| Cómo se mezcla | Cada tarea, épica y rutina por separado: gana el cambio más reciente. Los borrados se recuerdan para que no "revivan". |
| Servidor | Ninguno propio: el navegador habla directo con la API de Google Drive. |

## Cómo funciona "Sincronizar"

1. Si no hay sesión, pide iniciar sesión con Google (solo la primera vez o cuando vence el permiso).
2. Busca `cabe-todo-sync.json` en el Drive. Si no existe, lo crea con lo local y termina.
3. Lo descarga y lo **mezcla** con lo local.
4. Guarda el resultado en el equipo y lo sube al Drive.
5. Muestra un resumen: "Sincronizado: 3 nuevas, 2 actualizadas, 1 borrada" y la hora de la última sincronización.

Si el archivo cambió en Drive entre los pasos 3 y 4 (otro equipo sincronizó en ese momento), se repite desde el paso 3. Para eso se compara su `modifiedTime` antes de subir. Como lo usa una sola persona, choques así son muy raros.

## Mezcla (lo más importante)

Va en el código compartido (`src/core/merge.js` de la extensión, copiado a la web) con sus pruebas. Sirve también para importar un respaldo **mezclando** en lugar de reemplazar.

### Cambios en los datos

| Problema hoy | Cambio |
| --- | --- |
| No se sabe qué versión de una tarea es más nueva | `updated_at` en cada tarea, épica y rutina, y en los ajustes. Lo pone `store.js` en `commit()`: compara con el estado anterior y marca solo lo que cambió, para no tener que recordarlo en cada acción. |
| Algo borrado en un equipo "revive" al mezclar con otro | Lista de borrados `deleted: { id: fecha }`. Al mezclar, un borrado más reciente que la última edición gana. Se limpian después de 60 días. |
| **Las rutinas se duplicarían**: cada equipo crea la tarea de hoy de una rutina con un id distinto | Id fijo para esas tareas: `<id de la rutina>_<fecha>`. Así los dos equipos crean la misma y al mezclar se juntan. |
| Respaldos de versiones anteriores | El respaldo pasa a `version: 2` (con `updated_at` y `deleted`). Los de `version: 1` se siguen leyendo: lo que no tiene `updated_at` cuenta como el más antiguo. |

### Reglas de la mezcla

- **Tareas, épicas y rutinas:** por id. Si existe en un solo lado, se agrega, salvo que esté en la lista de borrados con fecha posterior. Si existe en los dos, gana el `updated_at` más reciente, completo.
- **Comentarios de una tarea:** se unen por id, aunque gane la otra versión de la tarea. Así no se pierde un comentario escrito en el celular.
- **Ajustes:** gana el más reciente, completo. Son pocos y se cambian poco.
- **Temporizador corriendo en dos equipos:** gana la versión más reciente de la tarea. Es aceptable para uso personal.
- **Relojes desfasados** entre equipos: unos minutos de diferencia no importan en la práctica.

## Iniciar sesión con Google

| | Web (PWA) | Extensión |
| --- | --- | --- |
| Librería | Google Identity Services (`accounts.google.com/gsi/client`), cliente de token | `chrome.identity.getAuthToken` (permiso `identity` y `oauth2.client_id` en el manifest) |
| Tipo de cliente OAuth | "Aplicación web", con origen `https://cabe-todo-web.vercel.app` (y `http://localhost:4173` para probar) | "Extensión de Chrome", ligado al id de la extensión |
| Token | Dura 1 hora; se pide de nuevo al sincronizar si venció (puede abrir una ventanita) | Chrome lo renueva solo |
| Cambios de seguridad | CSP: `script-src https://accounts.google.com/gsi/client`, `connect-src https://www.googleapis.com`, `frame-src https://accounts.google.com` | Ninguno extra: la API de Google acepta llamadas desde la extensión (CORS) |

**Nota sobre la extensión:**
- El id de la extensión cambia entre la versión cargada a mano (descomprimida) y la publicada en la tienda.
- Para no crear dos clientes OAuth, se fija el id con la clave `key` en el `manifest.json`.
- Alternativa: `chrome.identity.launchWebAuthFlow` con un cliente web. Funciona también en Edge y Brave, pero hay que renovar el token a mano.

## Google Cloud (una sola vez, gratis)

1. Crear un proyecto "Cabe Todo" en Google Cloud Console.
2. Activar la **Google Drive API**.
3. Pantalla de consentimiento: tipo **Externo**, en modo **Prueba**, con mi correo como usuario de prueba. Al ser solo para mí, **no hace falta la verificación de Google**.
4. Crear los dos clientes OAuth: web y extensión.

Las cuotas gratuitas de la API de Drive sobran para esto.

**Si algún día se abre a otras personas:**
- habría que publicar la app de OAuth;
- `drive.file` solo pide verificar la marca, no la revisión de seguridad;
- mientras tanto, el botón debería ocultarse o avisar que es experimental para quien instale la extensión desde la tienda.

## Privacidad y tienda

- **Política de privacidad (`docs/privacy.md` y `privacidad.html`):** agregar que, si se activa la sincronización, los datos se guardan en el Google Drive del usuario. El desarrollador no tiene acceso a ellos.
- **Ficha de la Chrome Web Store:** agregar el permiso `identity` con su justificación y actualizar "uso de datos". Los datos se transmiten a Google Drive solo por acción del usuario.
- **Textos que cambian:** "Sin cuentas ni servidores" pasa a "Sin cuentas propias; sincronización opcional con tu Google Drive".

## Etapas

1. ✅ **Mezcla en el código compartido** (extensión, con pruebas):
   - `updated_at` automático en `commit()`;
   - lista de borrados;
   - ids fijos para las tareas de rutina;
   - respaldo `version: 2`;
   - `merge.js`;
   - "Importar → **Mezclar** o Reemplazar" en las dos apps.

   Ya sirve sin Drive.

   **Hecho:**
   - `src/core/merge.js`: `mergeData`, `stampChanges` y borrados que se olvidan a los 60 días.
   - `store.js` marca `updated_at` en `commit()` comparando con la huella de lo último guardado; el service worker de la extensión también marca lo que guarda.
   - Las tareas de rutina tienen id fijo (`<rutina>_<fecha>`). Las que ya existían con ids al azar se unen por rutina y día al mezclar.
   - Respaldo `version: 2` con `deleted`; los de versión 1 se siguen leyendo.
   - "Importar respaldo" pregunta **Mezclar** o **Reemplazar todo** (`components/import-choice.js`, compartido con la web).
   - Resumen tipo "3 tareas nuevas, 1 épica nueva".
   - Pruebas: más reciente gana, borrados, comentarios, rutinas, referencias y mezclar dos veces lo mismo.
2. ✅ **Drive en la web:** iniciar sesión, buscar o crear el archivo, sincronizar, resumen y "Última sincronización: …". Probado en el celular.
3. ✅ **Drive en la extensión:** `chrome.identity`, el mismo flujo, y probar con la web en paralelo.
4. **Textos y tienda:** política de privacidad, ficha de la Chrome Web Store, README y nueva versión de las dos apps.

## Riesgos

| Riesgo | Cómo se maneja |
| --- | --- |
| Pérdida de datos por una mezcla mal hecha | Pruebas de `merge.js` con casos de borrado, edición en los dos lados y rutinas. Antes de aplicar una sincronización se guarda una copia local para **Deshacer**, como ya hace la importación en la web. |
| El permiso vence a mitad de una sincronización | Se pide de nuevo y se reintenta. Si falla, nada local cambia. |
| Archivo de Drive dañado o editado a mano | Se valida con `parseBackup`. Si no sirve, se avisa y no se toca nada. |
| Dos equipos sincronizan a la vez | Se compara `modifiedTime` antes de subir y se reintenta. |
