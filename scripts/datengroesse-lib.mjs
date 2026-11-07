// Blatt-Modul (factory#7): Urteil und Split-Empfehlung für das Datenbudget von `check:size` (Block `datengroesse` der Projekt-Config). Ohne Importe, alles pur.
// Gemessen werden physische Zeilen wie bei `check:size` (CRLF-neutral). Bekannte Grenzen: einzeiliges oder minifiziertes JSON umgeht das Zeilen-Budget
// (bewusst kein Zeichen-Deckel); die Zeilenangaben der Split-Empfehlung sind eine Schätzung (`JSON.stringify(…, null, 2)`, daher „≈“).

/** Pur: Urteile je Datei. `sizes` = `[{ file, loc }]` (nur Dateien unter dem Datenpfad), `deckel` = `[{ datei, max, grund }]`.
 *  Rückgabe `[{ datei, loc, art, text }]`; `art`: `ueber-budget` (ohne Deckel), `ueber-max`, `unter-max` (Deckel senken), `stale` (Datei fehlt oder liegt nicht mehr über dem Budget),
 *  `geduldet` (Zeilenzahl gleich Deckel, kein Fehler). Über dem Budget heißt strikt größer (`loc === budget` ist grün). */
export function pruefeDatenGroessen(sizes, { budget, deckel = [] }) {
  const eintrag = new Map(deckel.map((d) => [d.datei, d]));
  const bekannt = new Map(sizes.map((s) => [s.file, s.loc]));
  const urteile = [];
  for (const { file, loc } of sizes) {
    if (loc <= budget) continue;
    const d = eintrag.get(file);
    if (!d) urteile.push({ datei: file, loc, art: "ueber-budget", text: `${file}: ${loc} Zeilen > Datenbudget ${budget} ohne Deckel` });
    else if (loc > d.max) urteile.push({ datei: file, loc, art: "ueber-max", text: `${file}: ${loc} Zeilen > Deckel ${d.max}: teilen statt wachsen` });
    else if (loc < d.max) urteile.push({ datei: file, loc, art: "unter-max", text: `${file}: ${loc} Zeilen < Deckel ${d.max}: Deckel auf ${loc} senken (Ratchet)` });
    else urteile.push({ datei: file, loc, art: "geduldet", text: `${file}: ${loc} Zeilen = Deckel ${d.max} – ${d.grund}` });
  }
  for (const d of deckel) {
    const loc = bekannt.get(d.datei);
    if (loc === undefined) urteile.push({ datei: d.datei, loc: 0, art: "stale", text: `Deckel-Eintrag stale: ${d.datei} existiert nicht mehr (oder liegt außerhalb des Datenpfads) – Eintrag entfernen` });
    else if (loc <= budget) urteile.push({ datei: d.datei, loc, art: "stale", text: `Deckel-Eintrag stale: ${d.datei} liegt nicht mehr über ${budget} Zeilen – Eintrag entfernen` });
  }
  return urteile;
}

const istContainer = (v) => typeof v === "object" && v !== null;
const kinderVon = (w) => (Array.isArray(w) ? w.map((k, i) => [`[${i}]`, k]) : Object.entries(w));
const zeilenVon = (w) => JSON.stringify(w, null, 2).split("\n").length;

/** Steigt, solange ein Container genau ein Kind hat und dieses wieder ein Container ist, eine Ebene ab. Rückgabe `{ ort, wert }`. */
function teilungsEbene(wurzel) {
  let ort = "$";
  let wert = wurzel;
  for (;;) {
    const kinder = kinderVon(wert);
    if (kinder.length !== 1 || !istContainer(kinder[0][1])) return { ort, wert };
    const [name, kind] = kinder[0];
    ort += Array.isArray(wert) ? name : `.${name}`;
    wert = kind;
  }
}

/** Pur: Split-Empfehlung (mehrzeiliger Text) für eine Datei über dem Budget. `json` sagt, ob `text` als JSON gelesen werden darf (Endung `.json`); ungültiges JSON oder
 *  eine andere Endung ergibt nur die generische Teilung. `hinweis` ist der optionale Projekttext der Teilung (`datengroesse.hinweis`) und wird angehängt. */
export function splitEmpfehlung(text, { loc, budget, json = true, hinweis }) {
  const teile = Math.ceil(loc / budget);
  const zeilen = [`Teilen in mindestens ${teile} Dateien zu je ≤ ${budget} Zeilen.`];
  let wurzel;
  if (json) {
    try {
      wurzel = JSON.parse(text);
    } catch {
      wurzel = undefined;
    }
  }
  if (!istContainer(wurzel)) zeilen.push("Nach inhaltlicher Einheit teilen (eine Datei je Einheit; keine gliederbare JSON-Struktur erkannt).");
  else {
    const { ort, wert } = teilungsEbene(wurzel);
    const kinder = kinderVon(wert);
    if (kinder.length < 2) zeilen.push(`Die Struktur unter ${ort} lässt sich nicht weiter gliedern: nach inhaltlicher Einheit teilen.`);
    else {
      const top = kinder.map(([name, k]) => ({ name, z: zeilenVon(k) })).sort((a, b) => b.z - a.z).slice(0, 3);
      const art = Array.isArray(wert) ? "Einträge" : "Schlüssel";
      zeilen.push(`Teilungsebene ${ort}: ${kinder.length} ${art}; größte: ${top.map((t) => `${t.name} (≈${t.z} Zeilen)`).join(", ")}.`);
      if (top[0].z > budget) zeilen.push(`${top[0].name} liegt allein über dem Budget: eine Ebene tiefer teilen.`);
    }
  }
  if (hinweis) zeilen.push(`Projekt-Hinweis: ${hinweis}`);
  return zeilen.join("\n");
}
