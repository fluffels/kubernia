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

/** Findet Pfad-Verstöße (siehe Block oben). `repo`: Repo-Name aus der Projekt-Config oder `null` (Regel 3 entfällt). Pur. */
export function pfadBefunde(files, readFile, { repo = null } = {}) {
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
      if (imScope(file)) {
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
