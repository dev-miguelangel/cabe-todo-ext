// Formato de textos para mostrar. Funciones puras.

// Palabras cortas que quedan en minúscula dentro de un título ("Bloques del Día")
const SMALL = new Set(['a', 'al', 'con', 'de', 'del', 'e', 'el', 'en', 'la', 'las', 'lo', 'los', 'ni', 'o', 'para', 'por', 'u', 'un', 'una', 'y', 'sin', 'sobre']);

/**
 * "prueba de la api y seo" → "Prueba de la Api y Seo". Solo cambia la primera letra de cada palabra
 * (no pasa el resto a minúsculas: "iPhone", "PDF" o "SEO" se respetan) y no toca el largo del texto.
 */
export function titleCase(text) {
  if (!text) return text;
  let first = true;
  return text.replace(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu, (word) => {
    const keepSmall = !first && SMALL.has(word.toLowerCase());
    first = false;
    if (keepSmall) return word;
    return word.charAt(0).toLocaleUpperCase('es') + word.slice(1);
  });
}
