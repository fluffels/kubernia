// Pfadregel des Interne-Referenzen-Wächters (#1888), als Bibliothek ohne Direktaufruf-Guard: `check-internalrefs.mjs` und das Export-Werkzeug
// (`factory-export.mjs`, ADR 0022 F10) teilen sie, ohne dass ein Einstiegsskript aus dem anderen importiert (#1398). Die Regeln stehen im Kopf von
// `check-internalrefs.mjs` (Abschnitt Pfadregel); diese Datei hält nur Daten und die pure Prüffunktion.

/** Erlaubte Platzhalter-Segmente hinter `Users/` und `home/` (Klartext, keine echten Namen). */
export const PLATZHALTER_NUTZER = ["x", "y", "z", "u", "Max", "agent", "nutzer", "test", "…"];

/** Erlaubte Fixture-Wurzeln: erstes Segment eines Laufwerkspfads in test/** und scripts/** (klein geschrieben verglichen). */
export const FIXTURE_WURZELN = [
  "a", "a.ts", "andere", "b.txt", "daten", "dev", "docs", "eigen.jsonl", "foo", "gibt-es-nicht", "git", "h", "ignoriert", "msys",
  "other", "pfad", "program", "projekt", "python", "r", "repo", "root", "src", "temp", "temp2", "tempo", "tmp", "tools", "users", "w", "windows", "work", "wt", "x", "…",
];

const NUTZER_MUSTER = /(?:(?<![\w])[A-Z]:[\\/]+Users|(?<![\w.:/\\])\/(?:Users|home))[\\/]+([^\\/\s"'`<>*|]+)/g;
export const LAUFWERK_MUSTER = /(?<![\w])[A-Z]:[\\/]+[^\s"'`<>*|]*/g;
export const LAUFWERK_KOPF = /^[A-Z]:[\\/]+/;
export const NACHLAUF = /[.,;:)\]}]+$/;
const VARIABLE = /^[$%{~]/;
const imScope = (file) => /^(test|scripts)\//.test(file);

/** Findet Pfad-Verstöße (siehe Block oben). `repo`: Repo-Name aus der Projekt-Config oder `null` (Regel 3 entfällt). `alleLaufwerke`: Regel 2 gilt für jede Quelle, nicht nur test/ und scripts/ (`--text`: ein Text hat keinen Dateipfad). Pur. */
export function pfadBefunde(files, readFile, { repo = null, alleLaufwerke = false } = {}) {
  const hits = [];
  const repoKlein = repo ? repo.toLowerCase() : null;
  for (const file of files) {
    let content;
    try {
      content = readFile(file);
    } catch {
      continue;
    }
    if (content.includes("\0")) continue;
    content.split(/\r?\n/).forEach((text, i) => {
      const melde = (term) => hits.push({ file, line: i + 1, term, kind: "pfad", excerpt: text.trim().slice(0, 120) });
      for (const m of text.matchAll(NUTZER_MUSTER)) {
        const seg = m[1].replace(NACHLAUF, "");
        if (seg && !VARIABLE.test(seg) && !PLATZHALTER_NUTZER.includes(seg)) melde("nutzer");
      }
      const laufwerke = [...text.matchAll(LAUFWERK_MUSTER)].map((m) => m[0]);
      if (alleLaufwerke || imScope(file)) {
        for (const p of laufwerke) {
          const wurzel = p.replace(LAUFWERK_KOPF, "").split(/[\\/]+/)[0].replace(NACHLAUF, "");
          if (wurzel && !VARIABLE.test(wurzel) && !FIXTURE_WURZELN.includes(wurzel.toLowerCase())) melde("wurzel");
        }
      }
      if (!repoKlein) return;
      if (laufwerke.some((p) => p.split(/[\\/]+/).some((seg) => seg.replace(NACHLAUF, "").toLowerCase() === repoKlein))) melde("repo");
    });
  }
  return hits;
}

// ── Projektliste (factory#169): Ergänzung der Sperrliste je Bezieher ────────────────────────────────
// Die Kernliste (`ENCODED_TERMS`/`ENCODED_NAME_TERMS` in `check-internalrefs.mjs`) ist Fabrik-Besitz. Ein Bezieher ergänzt sie über den Block
// `internalrefs: { begriffe, namen }` seiner Projekt-Config. Einträge stehen als `b64:<base64>`, nie im Klartext (Obfuskierung, kein Schutz).
// Meldungen nennen nur den Index, nie den Wert: CI-Logs sind öffentlich.

/** Präfix eines kodierten Eintrags der Projektliste; ohne es ließe sich Klartext nicht sicher erkennen. */
export const KODIER_PRAEFIX = "b64:";

/** Klartext → base64 (für `--add`). */
export function encodeTerm(term) {
  return Buffer.from(String(term), "utf8").toString("base64");
}

/** base64 → Klartext. */
export function decodeTerm(kodiert) {
  return Buffer.from(kodiert, "base64").toString("utf8");
}

const BASE64_FORM = /^[A-Za-z0-9+/]+={0,2}$/;
const STEUERZEICHEN = /[\p{Cc}�]/u;

/** Pur: Mangel eines Eintrags (ohne den Wert zu nennen) oder `null`. */
function eintragMangel(eintrag) {
  if (typeof eintrag !== "string" || !eintrag.startsWith(KODIER_PRAEFIX)) return `muss ein kodierter String mit dem Präfix ${KODIER_PRAEFIX} sein (Klartext ist verboten)`;
  const rest = eintrag.slice(KODIER_PRAEFIX.length);
  if (!BASE64_FORM.test(rest) || encodeTerm(decodeTerm(rest)) !== rest) return "ist kein kanonisches base64";
  const klar = decodeTerm(rest);
  if (klar !== klar.trim() || STEUERZEICHEN.test(klar)) return "dekodiert zu einem leeren, ungetrimmten oder ungültigen Begriff";
  return null;
}

/** Pur: prüft den Block `internalrefs` der Projekt-Config; gibt die Mängel zurück (leer = gültig, auch ohne Block). Nennt nie einen Eintragswert. */
export function internalrefsMaengel(block) {
  if (block === undefined) return [];
  if (block === null || typeof block !== "object" || Array.isArray(block)) return ["internalrefs muss ein Objekt mit den Listen begriffe und namen sein"];
  const fehler = Object.keys(block).filter((k) => k !== "begriffe" && k !== "namen").map((k) => `internalrefs.${k} ist kein bekannter Schlüssel (erlaubt: begriffe, namen)`);
  for (const liste of ["begriffe", "namen"]) {
    const werte = block[liste];
    if (werte === undefined) continue;
    if (!Array.isArray(werte)) {
      fehler.push(`internalrefs.${liste} muss eine Liste sein`);
      continue;
    }
    const gesehen = new Set();
    werte.forEach((eintrag, i) => {
      const mangel = eintragMangel(eintrag);
      if (mangel) fehler.push(`internalrefs.${liste}[${i}] ${mangel}`);
      else if (gesehen.has(eintrag)) fehler.push(`internalrefs.${liste}[${i}] ist eine Dublette`);
      else gesehen.add(eintrag);
    });
  }
  return fehler;
}

/** Pur: die dekodierte Projektliste `{ begriffe, namen }` aus der Config; ohne Block beide leer. Wirft mit Fix-Zeile bei kaputter Form (fail-closed). */
export function internalrefsAus(config) {
  const block = config.internalrefs;
  if (block === undefined) return { begriffe: [], namen: [] };
  const fehler = internalrefsMaengel(block);
  if (fehler.length > 0) throw new Error(`${fehler.join("; ")} in der Projekt-Config\nFix: den Block internalrefs (begriffe, namen: Listen von b64:<base64>) korrigieren, neue Einträge nur per node scripts/check-internalrefs.mjs --add`);
  const dekodiert = (liste) => (block[liste] ?? []).map((e) => decodeTerm(e.slice(KODIER_PRAEFIX.length)));
  return { begriffe: dekodiert("begriffe"), namen: dekodiert("namen") };
}
