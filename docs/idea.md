# Plan de Desarrollo: Cabe Todo (Chrome Extension)

## 🎯 Objetivo
**Cabe Todo** es una extensión de Chrome (Manifest V3) para planificar **un solo día**, dividido en dos bloques: **AM (mañana)** y **PM (tarde)**.

Por fuera se ve como un tablero tipo Trello de dos columnas. Por dentro usa PERT para responder la pregunta que de verdad importa:

> **"¿Me alcanza la mañana (o la tarde) para todo lo que puse?"**

### Principios
1. **Crear una tarea toma < 3 segundos**: escribir y Enter. Todo lo demás es opcional.
2. **PERT es invisible**: el usuario nunca escribe O/M/P ni ve ES/LS. Solo ve resultados en lenguaje simple ("85% de probabilidad de terminar a tiempo").
3. **Un día, dos bloques**: la vista principal es siempre *hoy*. Las **épicas** agrupan trabajo de varios días, pero no complican la vista diaria: son una etiqueta de color y una bandeja de tareas sin fecha.

---

## 🧠 Cómo se adapta PERT a una persona (decisión clave)

PERT clásico supone tareas en **paralelo** con varios recursos. Una persona hace **una cosa a la vez**, así que:

| Concepto PERT | En Cabe Todo significa |
|---|---|
| Dependencias | Solo definen el **orden** dentro del bloque (orden topológico) |
| Duración del proyecto | Suma de los TE del bloque (las tareas son secuenciales) |
| Varianza | Suma de varianzas del bloque → **probabilidad de terminar a tiempo** |
| Holgura (slack) | `fin del bloque − hora estimada de término` de cada tarea |
| Ruta crítica | Tareas de las que dependen otras: si se atrasan, arrastran a las demás → se resaltan |

Esto simplifica mucho el cálculo y lo hace útil de verdad para el día a día.

---

## ⚡ Creación de tareas (lo más simple posible)

### Quick-add: una sola caja de texto
Arriba de cada columna (AM / PM) hay un input. Escribes y Enter:

```
Responder correos                 → 30 min (por defecto), en el bloque donde escribiste
Informe mensual 2h                → 2 horas
Llamar a Juan 15m pm              → 15 min, forzado a la tarde
Revisar PR 1h ?                   → "?" = estimación incierta (más varianza)
Diseñar logo 2h #web              → asignada a la épica "web"
```

**Tokens reconocidos** (todos opcionales, al final del texto):
- Duración: `15m`, `45m`, `1h`, `1.5h`, `2h`
- Bloque: `am` / `pm` (o `mañana` / `tarde`)
- Incertidumbre: `?` = no estoy seguro · `!` = muy seguro
- Épica: `#nombre` → si no existe, se crea al vuelo con un color automático (autocompletado al escribir `#`)

### De una duración a O/M/P (automático)
El usuario da **una sola duración** (M). La app deriva el resto según la certeza:

| Certeza | O (optimista) | M | P (pesimista) |
|---|---|---|---|
| `!` segura | 0.9 × M | M | 1.3 × M |
| normal (default) | 0.75 × M | M | 2 × M |
| `?` incierta | 0.5 × M | M | 3 × M |

> El pesimista se carga hacia arriba a propósito: la gente subestima casi siempre.

### Dependencias (opcional, sin formularios)
- Arrastrar una tarjeta **encima** de otra → "esta va después de aquella".
- O desde el menú de la tarjeta: **"Después de…"** → lista de tareas del día.
- Se muestra como una flechita/chip `↳ después de: Informe mensual`.

### Edición
Clic en la tarjeta → panel mínimo: título, duración, certeza, bloque, épica, dependencias, nota. Nada más.

---

## 🗂️ Épicas (agrupar tareas)

Una **épica** es un objetivo más grande que un día ("Lanzar web", "Mudanza", "Curso de inglés") que agrupa tareas.

### Crear y asignar (igual de simple)
- Escribir `#nombre` en el quick-add crea la épica si no existe y le asigna la tarea.
- Desde la tarjeta: chip **"+ Épica"** → elegir una existente o escribir una nueva.
- Una tarea pertenece a **una sola épica** (o a ninguna). Sin jerarquías ni sub-épicas.

### Bandeja de la épica (backlog)
Cada épica tiene una lista de tareas **sin fecha**: cosas que hay que hacer "algún día" para completarla.
- Se agregan con el mismo quick-add dentro de la épica (`Comprar dominio 15m`).
- Para planificar el día, se **arrastran de la bandeja a AM o PM** (o botón "→ Hoy AM / Hoy PM").
- Si no se terminan, vuelven a "Pendientes de ayer" como cualquier tarea, sin perder la épica.

### Qué muestra una épica
```
┌─ 🟣 Lanzar web ─────────────────────── 6/14 ✓ ─┐
│  ████████░░░░░░░░  43%                           │
│  Quedan ~9h30 de trabajo (≈ 2 bloques)           │
│  Fecha objetivo: vie 14 nov · 🟡 64% a tiempo    │
│                                                  │
│  Bandeja (sin fecha)                             │
│  [+ Agregar tarea a la épica…          ]         │
│  ☐ Comprar dominio            15m   [→ AM][→ PM] │
│  ☐ Textos de la home ◆        2h    [→ AM][→ PM] │
│  ☐ ↳ Revisión final ?         1h    [→ AM][→ PM] │
└──────────────────────────────────────────────────┘
```

- **Progreso**: tareas hechas / totales.
- **Trabajo restante**: Σ TE de las tareas no hechas, expresado en horas y en "bloques" (usando la duración de tus bloques AM/PM).
- **Fecha objetivo (opcional)**: si se define, PERT calcula la probabilidad de terminar a tiempo con la capacidad de los bloques que quedan hasta esa fecha.
- **Dependencias** dentro de la épica pueden cruzar días: una tarea cuyo predecesor no está hecho aparece como 🔒 *bloqueada* (se puede planificar, pero con aviso).

### En la vista del día
- Cada tarjeta lleva un **punto de color** de su épica.
- Filtro rápido arriba: `Todas · 🟣 Lanzar web · 🟢 Mudanza…` para ver solo una épica.
- Debajo de cada bloque, una línea resumen: "AM: 2h en 🟣 Lanzar web · 1h sin épica".

### Ciclo de vida
- Una épica se **completa** sola cuando todas sus tareas están hechas (con confirmación) y se archiva.
- Archivar/borrar una épica no borra sus tareas ya hechas; las pendientes quedan "sin épica".

---

## 🖥️ Interfaz

```
┌──────────────── Cabe Todo · Martes 10 nov ────────────────┐
│  ☀️ MAÑANA 08:00–13:00          🌙 TARDE 14:00–19:00       │
│  [+ Escribe una tarea…    ]     [+ Escribe una tarea…    ] │
│  ████████████░░  4h10 / 5h      ██████████████▓▓ 5h40 / 5h │
│  ✅ 82% a tiempo                ⚠️ 31% a tiempo            │
│                                 → Sugerencia: mover        │
│  ☐ Responder correos   30m        "Llamar a Juan" a mañana │
│  ☐ Informe mensual ◆   2h       ☐ Revisar PR ?    1h       │
│  ☐ ↳ Enviar informe    15m      ☐ Reunión equipo  1h       │
│  ☑ Café con Ana        30m      …                          │
│                                                            │
│  📥 Pendientes de ayer (2)  [mover a AM] [mover a PM]       │
└────────────────────────────────────────────────────────────┘
◆ = crítica (otras tareas dependen de ella)
```

- **Barra de capacidad** por bloque: suma de TE vs. horas disponibles.
- **Semáforo de probabilidad**: ✅ ≥ 80% · 🟡 50–80% · ⚠️ < 50%.
- **Sugerencia automática** cuando un bloque se pasa: mover la tarea con más holgura y sin dependencias al otro bloque (un clic para aceptar).
- **Hora estimada** al pasar el mouse por una tarjeta: "terminarías ~10:45 (holgura 2h15)".
- **Estado** = checkbox (hecho / no hecho). "En progreso" = la primera tarea no hecha del bloque actual, se resalta sola.
- Las tareas no terminadas pasan al día siguiente como **"Pendientes de ayer"**.

---

## 🛠️ Stack (lo más simple)
- **Vanilla JS + HTML + CSS**, sin framework ni build step. Se carga como extensión "unpacked" directamente.
- **Chrome Side Panel API** como vista principal (queda abierta al lado mientras trabajas).
- **`chrome.storage.local`** para persistencia (sin backend, sin cuenta).
- Drag & drop con la API nativa de HTML5.
- Opcional fase 2: `chrome.alarms` + notificaciones ("se acabó la mañana, te quedan 2 tareas").

### Estructura de archivos
Ver la sección **Estructura del proyecto** del [README](../README.md).

---

## 📋 Modelo de Datos

**Regla:** se guarda solo lo que el usuario decide. Todo lo derivado (TE, varianza, holgura, crítica) se **calcula al vuelo** y nunca se persiste → no hay datos desincronizados.

### Tarea (persistida)
```json
{
  "id": "t_8f3k2",
  "title": "Informe mensual",
  "note": "",
  "date": "2026-11-10",     // null = en la bandeja de su épica (sin fecha)
  "block": "am",            // "am" | "pm" | null (si date es null)
  "order": 2,                // posición manual dentro del bloque o la bandeja
  "minutes": 120,            // M: lo único que el usuario estima
  "certainty": "normal",     // "sure" | "normal" | "unsure"
  "epic_id": "e_web",        // null = sin épica
  "dependencies": [],        // ids del mismo día, o de la misma épica (pueden cruzar días)
  "done": false,
  "done_at": null,
  "created_at": "2026-11-10T19:00:00Z"
}
```

### Épica (persistida)
```json
{
  "id": "e_web",
  "name": "Lanzar web",
  "color": "#8b5cf6",        // asignado automáticamente de una paleta fija
  "target_date": "2026-11-14", // opcional
  "archived": false,
  "created_at": "2026-11-10T19:00:00Z"
}
```

> El progreso, el trabajo restante y la probabilidad de la épica **no se guardan**: se calculan desde sus tareas.

### Configuración
```json
{
  "am": { "start": "08:00", "end": "13:00" },
  "pm": { "start": "14:00", "end": "19:00" },
  "default_minutes": 30
}
```

### Derivados (en memoria, `pert.js`)
```js
O, M, P        // según tabla de certeza
TE = (O + 4M + P) / 6
V  = ((P - O) / 6) ** 2
start, finish  // hora estimada, recorriendo el bloque en orden
slack          // fin del bloque − finish
is_critical    // tiene dependientes no terminados
```

### Probabilidad de terminar el bloque a tiempo
```
capacidad = minutos del bloque restantes (desde ahora si el bloque ya empezó)
μ = Σ TE  (tareas no hechas)
σ = √(Σ V)
P(a tiempo) = Φ((capacidad − μ) / σ)     // Φ = normal acumulada
```

### Probabilidad de terminar una épica a tiempo
```
capacidad = minutos de bloques restantes hasta target_date
            − minutos ya ocupados en esos bloques por tareas de OTRAS épicas
μ = Σ TE  (tareas no hechas de la épica)
σ = √(Σ V)
P(a tiempo) = Φ((capacidad − μ) / σ)
```
Mismo cálculo que el bloque, a otra escala: un solo `pert.js` sirve para ambos.

### Reglas de orden y validación
- Dentro de un bloque: orden topológico por dependencias; empates se resuelven con `order` manual.
- Si A depende de B y B está en PM, A no puede estar en AM → se mueve sola a PM (con aviso).
- Detectar ciclos al crear una dependencia y rechazarla.
- Al borrar una tarea, se quita de las `dependencies` de las demás.
- Una dependencia entre días distintos solo se permite si ambas tareas son de la **misma épica**.
- Si una tarea cambia de épica, se eliminan sus dependencias entre días con la épica anterior (con aviso).

---

## 🚀 Fases

### Fase 1 — MVP (lo mínimo útil)
- [x] Manifest V3 + side panel
- [x] Dos columnas AM/PM con quick-add (título + duración + am/pm)
- [x] Checkbox de hecho, borrar, drag & drop entre bloques
- [x] Barra de capacidad por bloque
- [x] Persistencia en `chrome.storage.local`

### Fase 2 — PERT
- [x] Certeza (`?` / `!`) y derivación O/M/P
- [x] Probabilidad de terminar a tiempo + semáforo
- [x] Hora estimada y holgura por tarjeta
- [x] Dependencias (drag sobre tarjeta / menú "Después de…") + ruta crítica

### Fase 3 — Épicas
- [x] Token `#épica` en el quick-add + autocompletado
- [x] Punto de color en tarjetas y filtro por épica
- [x] Vista de épica: progreso, trabajo restante, bandeja sin fecha
- [x] Arrastrar de la bandeja a AM/PM
- [x] Fecha objetivo + probabilidad de terminar a tiempo
- [x] Dependencias entre días dentro de la épica (🔒 bloqueada)

### Fase 4 — Comodidad
- [x] Sugerencia automática de mover tareas cuando un bloque se pasa
- [x] "Pendientes de ayer"
- [x] Notificaciones de fin de bloque
- [x] Ajustes de horario AM/PM
- [x] Atajo de teclado global para abrir el panel y escribir

---

## ❓ Decisiones abiertas
- ¿Mostrar el % de probabilidad o solo el semáforo? (propuesta: semáforo + % al pasar el mouse)
- ¿Permitir un bloque "Noche" opcional más adelante?
- ¿Dónde vive la vista de épicas? (propuesta: pestaña "Épicas" en el mismo side panel, junto a "Hoy")
- ¿Sugerir automáticamente qué tareas de la bandeja meter hoy si sobra tiempo en un bloque? (priorizando las críticas y las de épicas con fecha objetivo cercana)
- ¿Aprender de la duración real? (registrar cuánto tardó cada tarea y ajustar los multiplicadores de certeza del usuario con el tiempo)
