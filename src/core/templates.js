// Plantillas de documentación (Ajustes → Plantillas). Funciones puras.
// Variables que se reemplazan al usarla: {{titulo}} (título de la tarea en Titlecase), {{fecha}}, {{epica}}.

import { titleCase } from '../utils/text.js';

export const MAX_TEMPLATES = 12;

const USER_STORY = `# {{titulo}}

## 📋 Descripción General
* **Como:** [Rol del usuario / tipo de usuario]
* **Quiero:** [Acción o funcionalidad que necesita realizar]
* **Para que:** [Beneficio o valor de negocio que aporta]

---

## ✅ Criterios de Aceptación (Definition of Ready / Done)
* [ ] **Criterio 1:** [Condición inicial o requisito funcional que debe cumplirse]
* [ ] **Criterio 2:** [Validación de errores o casos borde esperados]
* [ ] **Criterio 3:** [Restricción de diseño, rendimiento o seguridad]

---

## 🛠️ Especificaciones Técnicas y Notas
* **Endpoints / APIs:** [Detallar rutas o servicios involucrados, si aplica]
* **Modelo de Datos:** [Cambios en base de datos, tablas o estructuras JSON]
* **Dependencias:** [Tareas o servicios previos necesarios]

---

## 📌 Notas Adicionales
* [Cualquier detalle relevante, diseño UX/UI adjunto o restricciones del negocio]
`;

const SIMPLE = '## Objetivo\n[¿Qué se quiere lograr?]\n\n## Notas\n\n\n## Resultado\n\n';

export const DEFAULT_TEMPLATES = [
  { id: 'historia', name: 'Historia de usuario', body: USER_STORY },
  { id: 'simple', name: 'Simple', body: SIMPLE },
];
export const DEFAULT_TEMPLATE_ID = 'historia';

/** Plantillas guardadas → válidas (con id, nombre y contenido); si no hay ninguna, las de siempre. */
export function normalizeTemplates(list) {
  const seen = new Set();
  const valid = (Array.isArray(list) ? list : [])
    .filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.body === 'string'
      && t.name.trim() && t.body.trim() && !seen.has(t.id) && seen.add(t.id))
    .slice(0, MAX_TEMPLATES)
    .map((t) => ({ id: t.id, name: t.name.trim(), body: t.body }));
  return valid.length ? valid : DEFAULT_TEMPLATES.map((t) => ({ ...t }));
}

/** La plantilla por defecto (la indicada si existe; si no, la primera). */
export function defaultTemplate(templates, id) {
  return templates.find((t) => t.id === id) || templates[0];
}

/** Valida plantillas editadas en Ajustes. Devuelve un mensaje o null. */
export function validateTemplates(list) {
  if (!list.length) return 'Necesitas al menos una plantilla.';
  if (list.length > MAX_TEMPLATES) return `Puedes tener hasta ${MAX_TEMPLATES} plantillas.`;
  const names = new Set();
  for (const t of list) {
    const name = t.name.trim();
    if (!name) return 'Cada plantilla necesita un nombre.';
    if (!t.body.trim()) return `"${name}" está vacía.`;
    const key = name.toLowerCase();
    if (names.has(key)) return `Hay dos plantillas llamadas "${name}".`;
    names.add(key);
  }
  return null;
}

/** Reemplaza las variables: {{titulo}}, {{fecha}}, {{epica}} (sin importar mayúsculas ni espacios internos). */
export function fillTemplate(body, { title = '', date = '', epic = '' } = {}) {
  const values = { titulo: titleCase(title), fecha: date, epica: epic ? titleCase(epic) : '' };
  return body.replace(/\{\{\s*(titulo|título|fecha|epica|épica)\s*\}\}/gi, (_, name) => {
    const key = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return values[key] ?? '';
  });
}

/** Primer marcador "[…]" para rellenar (no casillas "[ ]"/"[x]" ni enlaces): [inicio, fin] o null. */
export function firstPlaceholder(text) {
  const re = /\[(?![ xX]\])[^\]\n]{2,}\](?!\()/g;
  const m = re.exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}
