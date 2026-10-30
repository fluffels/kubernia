// Lib ohne Direktaufruf-Guard; `factory-update-check.mjs` und `tag-takt.mjs` importieren sie (Konvention #1398, Folge #103).
/* Release-Tags lesen und vergleichen: nur Tags der Form `v1.2.3` oder `1.2.3` zählen (Pre-Release und Fremdtags nicht). Alles pur, keine Imports. */

const RELEASE = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** Pur: `[major, minor, patch]` eines Release-Tags oder `null`. */
export function teile(tag) {
  const m = typeof tag === "string" ? RELEASE.exec(tag) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Pur: negativ, 0 oder positiv, je nachdem ob `a` vor, gleich oder nach `b` liegt (beide Release-Tags). */
export function vergleiche(a, b) {
  const [x, y] = [teile(a), teile(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** Pur: der höchste Release-Tag der Liste oder `null`; Pre-Release und Fremdtags werden ignoriert. */
export function vergleicheTags(tags) {
  return tags.filter((t) => teile(t)).reduce((hoechster, t) => (hoechster === null || vergleiche(t, hoechster) > 0 ? t : hoechster), null);
}
