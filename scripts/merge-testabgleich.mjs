// Kein Shebang: wird per `node scripts/merge-testabgleich.mjs` gestartet UND von test/merge-testabgleich.test.ts importiert.
/**
 * Merge-Testabgleich (#1579): hat ein Merge von `origin/main` in den Feature-Branch einen Test verloren?
 *
 *   node scripts/merge-testabgleich.mjs
 *
 * Beim Auflösen eines Konflikts fiel ein Test von `main` still weg; nur die Test-Lens fand es per Sabotage (Delta-Pass: drei Lenses plus neuer
 * Nachweis-Commit). Dieses Skript vergleicht die Testtitel (`test(`, `it(`, `describe(` mit Zeichenketten-Titel) aller `test/**`-Dateien, die eine Seite
 * geändert hat, mit dem Merge-Ergebnis: verloren ist ein Titel, den eine Seite hat, der im Ergebnis fehlt und den die andere Seite nicht bewusst
 * entfernt hat (in der Basis, aber nicht in ihrer Fassung). Während eines Merges (`MERGE_HEAD`) ist das Ergebnis der Arbeitsbaum (vor dem Merge-Commit),
 * danach `HEAD` mit seinen zwei Eltern.
 *
 * Exit 0 = nichts verloren, 1 = verlorene Tests (Liste), 2 = kein Merge oder git-Fehler.
 * Bewusste Grenzen: nur Titel, die als erstes Argument ein Zeichenketten-Literal tragen (`test.each([...])("%s", …)` mit Vorlage zählt als ein Titel, die
 * Tabelle nicht); ein umbenannter Test gilt als bewusst entfernt, wenn der alte Titel in der Fassung der entfernenden Seite fehlt; Dateien außerhalb von `test/` zählen nicht.
 * Pur bis auf das CLI; der Kern ist getestet.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { istDirektaufruf } from "./hook-io.mjs";

// `test(`, `it(`, `describe(` samt `.skip`/`.only`/`.each`-Zusätzen vor der Klammer, dann ein Zeichenketten-Literal als erstes Argument.
const TITEL = /\b(?:test|it|describe)(?:\.\w+)*\s*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** Titel aller Tests und Testgruppen eines Quelltexts (als Menge). Pur. */
export function testTitel(text) {
  return new Set([...String(text ?? "").matchAll(TITEL)].map((m) => m[2]));
}

const ohne = (a, b) => new Set([...a].filter((x) => !b.has(x)));

/**
 * Verlorene Tests: je Datei die Titel einer Seite (`ihre` = main, `unsere` = Feature-Branch), die im Ergebnis fehlen, ohne dass die andere Seite sie
 * bewusst entfernt hat (Titel in der Basis, aber nicht in ihrer Fassung). Eingaben: `{ [pfad]: text | null }` je Fassung (`null`/fehlend = Datei gibt es nicht).
 * Rückgabe: `[{ datei, titel, seite }]`, sortiert. Pur.
 */
export function verloreneTests({ basis, unsere, ihre, ergebnis }) {
  const dateien = new Set([...Object.keys(basis), ...Object.keys(unsere), ...Object.keys(ihre), ...Object.keys(ergebnis)]);
  const verloren = [];
  for (const datei of [...dateien].sort()) {
    const t = (fassung) => testTitel(fassung[datei]);
    const [b, u, i, e] = [t(basis), t(unsere), t(ihre), t(ergebnis)];
    for (const titel of ohne(ohne(i, e), ohne(b, u))) verloren.push({ datei, titel, seite: "ihre" });
    for (const titel of ohne(ohne(u, e), ohne(b, i))) verloren.push({ datei, titel, seite: "unsere" });
  }
  return verloren;
}

/** Textausgabe der Befunde (eine Zeile je verlorenem Test). */
export function formatiere(verloren) {
  if (!verloren.length) return "✔ merge-testabgleich: kein Test des Merges verloren.";
  return [
    `✖ merge-testabgleich: ${verloren.length} Test(s) im Merge-Ergebnis verloren (Seite = wessen Fassung ihn hatte):`,
    ...verloren.map((v) => `  - ${v.datei}: „${v.titel}“ (${v.seite === "ihre" ? "main" : "Feature-Branch"})`),
    "Konfliktauflösung prüfen: den Test aus der Fassung der genannten Seite wieder einfügen (Skill review-lenses › Nach jedem Merge von main).",
  ].join("\n");
}

/**
 * Orchestrierung mit injiziertem IO: `git(args)` liefert stdout oder wirft; `lies(pfad)` liest eine Datei des Arbeitsbaums oder gibt `null` zurück.
 * Rückgabe `{ code, text }` (0 sauber, 1 verloren, 2 kein Merge oder git-Fehler).
 */
export function pruefeMerge({ git, lies }) {
  const versuch = (args) => {
    try {
      return git(args).trim();
    } catch {
      return null;
    }
  };
  const mergeHead = versuch(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  const imMerge = mergeHead !== null && mergeHead !== "";
  let unsereRev;
  let ihreRev;
  if (imMerge) {
    [unsereRev, ihreRev] = ["HEAD", mergeHead];
  } else {
    const eltern = versuch(["rev-list", "--parents", "-n", "1", "HEAD"]);
    const teile = (eltern ?? "").split(/\s+/).filter(Boolean);
    if (teile.length !== 3) return { code: 2, text: "✖ merge-testabgleich: weder ein Merge in Arbeit (MERGE_HEAD) noch ein Merge-Commit auf HEAD (zwei Eltern)." };
    [, unsereRev, ihreRev] = teile;
  }
  const basisRev = versuch(["merge-base", unsereRev, ihreRev]);
  if (!basisRev) return { code: 2, text: "✖ merge-testabgleich: keine Merge-Basis gefunden (flacher Checkout? `git fetch origin`)." };
  const namen = (a, b) => (versuch(["diff", "--name-only", a, b, "--", "test"]) ?? "").split("\n").filter((p) => /^test\/.+\.ts$/.test(p));
  const dateien = [...new Set([...namen(basisRev, unsereRev), ...namen(basisRev, ihreRev)])].sort();
  const aus = (rev) => Object.fromEntries(dateien.map((p) => [p, versuch(["show", `${rev}:${p}`])]));
  const ergebnis = imMerge ? Object.fromEntries(dateien.map((p) => [p, lies(p)])) : aus("HEAD");
  const verloren = verloreneTests({ basis: aus(basisRev), unsere: aus(unsereRev), ihre: aus(ihreRev), ergebnis });
  return { code: verloren.length ? 1 : 0, text: formatiere(verloren) };
}

function main() {
  const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const wurzel = git(["rev-parse", "--show-toplevel"]).trim();
  const lies = (p) => (existsSync(join(wurzel, p)) ? readFileSync(join(wurzel, p), "utf8") : null);
  const r = pruefeMerge({ git, lies });
  (r.code === 0 ? console.log : console.error)(r.text);
  process.exitCode = r.code;
}

if (istDirektaufruf(import.meta.url)) main();
