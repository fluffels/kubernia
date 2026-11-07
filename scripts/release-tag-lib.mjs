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

/** Hinweis für den Sync-Schritt (Tag-Ticket und Update-Meldung): das eigene Werkzeug kennt ein neues Manifest-Format womöglich noch nicht. */
export const WERKZEUG_HINWEIS = "Scheitert das eigene Werkzeug am neuen Manifest („version N unbekannt“), einmal das Werkzeug der Quelle fahren: `node <quelle>/scripts/factory-sync.mjs --quelle <quelle> --tag <tag>`.";

const schritt = (id, befehl, erklaerung, mechanisch = false) => ({ id, befehl, text: `\`${befehl}\`${erklaerung}`, ...(mechanisch ? { mechanisch } : {}) });

/**
 * Die Schritte nach einem Tag-Sync in fester Reihenfolge (factory#208: ein bloßer Sync macht keinen Bezieher grün), einzige Quelle für die Update-Meldung (`factory-update-check.mjs`)
 * und den Ablauf der Vor-Tag-Probe (`tag-takt.mjs`, factory#215). `{TAG}` setzt die Meldung ein, `<pfad>` steht für die Quelle. `mechanisch: true` = die Probe fährt den Befehl vor `verify`.
 */
export const UPDATE_SCHRITTE = [
  { id: "sync", text: `Sync: node scripts/factory-sync.mjs --quelle <pfad> --tag {TAG}. ${WERKZEUG_HINWEIS}` },
  schritt("lint-prune", "npm run lint:prune", " (veraltete eslint-Suppressions entfernen)", true),
  schritt("projektwerte", "node scripts/projektwerte.mjs --write", "", true),
  schritt("docs-gen", "npm run docs:gen", "", true),
  schritt("factorylinks", "npm run check:factorylinks -- --schreiben --quelle <pfad>", " (Refs und Index der Factory-Links)", true),
  { id: "projektkopien", text: "Projektkopien abgelöster Kern-Tests abgleichen (Hinweis `Projektkopie … weicht ab` des Syncs; eine Kopie, die der Kern-Test oder ein Doctor-Punkt ersetzt, entfernen, sonst mit der Quelle abgleichen)" },
  schritt("verify", "node scripts/gate-befehl.mjs verifyKompakt", ", erst dann der Sync-PR"),
];

/** Pur: die Befehle der mechanischen Schritte in Reihenfolge, `<pfad>` durch `quelle` ersetzt. */
export const mechanischeSchritte = (quelle) => UPDATE_SCHRITTE.filter((s) => s.mechanisch).map((s) => s.befehl.replaceAll("<pfad>", quelle));
