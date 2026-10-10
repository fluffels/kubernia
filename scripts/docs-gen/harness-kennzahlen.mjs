// Kein Shebang (siehe docs-gen.mjs). Generator `harness-kennzahlen` (#1579, ADR 0017): Zählbares des Harness aus versionierten Dateien
// ableiten, damit `check:docgen` die Zahlen in README und docs/agent-harness.md aktuell hält). Jede Zeile nennt ihre Zählregel; ein zusätzliches Skript, ein Wächter-Test, ein Workflow
// oder ein ADR macht den Abschnitt veraltet, bis `npm run docs:gen` läuft. Harness-Stack: setzt npm und GitHub Actions voraus.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readAdrs } from "./adr.mjs";
import { brauche, byCodeUnit, leseJson, renderTable } from "./markdown.mjs";
import { kettenSchritte } from "./npm-ketten.mjs";

/** Wächter-Marker: nur als eigene Kommentar-Zeile (` * @harness-waechter`), wie in test/harness/harness-approval.test.ts. */
const WAECHTER_MARKER = /^\s*(?:\/\*+|\*)?\s*@harness-waechter(?![\w-])/m;
const ueberspringe = new Set(["node_modules", ".git"]);

/** Alle Dateien unter `abs` (rekursiv, ohne node_modules und .git), relativ zu `abs`, sortiert. */
function dateienUnter(abs, rel = "") {
  const out = [];
  for (const e of readdirSync(join(abs, rel), { withFileTypes: true }).sort((a, b) => byCodeUnit(a.name, b.name))) {
    const pfad = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (!ueberspringe.has(e.name)) out.push(...dateienUnter(abs, pfad));
    } else if (e.isFile()) out.push(pfad);
  }
  return out;
}

/** Eine Kennzahl: Name, Wert, Zählregel in der Ausgabe. */
const zeile = (name, wert, regel) => [name, String(wert), regel];

/**
 * Generator `harness-kennzahlen`: Tabelle `Kennzahl | Wert | Zählregel`. Config-Block `kennzahlen`:
 * `package` + `chains` (npm-Ketten, die Schritte zählt `kettenSchritte`), `skripte` (Ordner, rekursiv) + `skriptEndungen`,
 * `waechter` (`ordner`, Dateien `*.test.ts` mit dem Marker `@harness-waechter`), `workflows` (Ordner, `*.yml`/`*.yaml`), `adr` (Ordner wie bei `adr-liste`).
 */
export function harnessKennzahlenGenerator({ rootDir, config }) {
  const cfg = config.kennzahlen;
  if (!cfg) throw new Error('Config-Block "kennzahlen" fehlt');
  const errors = [];
  const rows = [];

  const pkg = leseJson(rootDir, cfg.package, "package.json");
  const scripts = pkg.scripts ?? {};
  for (const kette of cfg.chains ?? []) {
    if (typeof scripts[kette] !== "string") {
      errors.push(`Kette "${kette}" fehlt in ${cfg.package}`);
      continue;
    }
    try {
      const n = kettenSchritte(scripts, cfg.chains, kette).length;
      rows.push(zeile(`Prüfschritte in \`${kette}\``, n, `eigene Schritte der Kette \`${kette}\` in ${cfg.package}, verschachtelte Ketten aufgelöst, je Schritt einmal`));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const endungen = cfg.skriptEndungen ?? [".mjs", ".cjs"];
  const skriptOrdner = cfg.skripte ?? [];
  if (skriptOrdner.every((o) => brauche(rootDir, o, "Skript-Ordner", errors))) {
    const n = skriptOrdner.reduce((s, o) => s + dateienUnter(join(rootDir, o)).filter((f) => endungen.some((e) => f.endsWith(e))).length, 0);
    const endungsListe = endungen.map((e) => `\`${e}\``).join("/");
    rows.push(zeile("Skripte", n, `Dateien ${endungsListe} unter ${skriptOrdner.map((o) => `\`${o}/\``).join(", ")} (rekursiv)`));
  }

  const w = cfg.waechter;
  if (w && brauche(rootDir, w.ordner, "Wächter-Ordner", errors)) {
    const abs = join(rootDir, w.ordner);
    const n = dateienUnter(abs).filter((f) => f.endsWith(".test.ts") && WAECHTER_MARKER.test(readFileSync(join(abs, f), "utf8"))).length;
    rows.push(zeile("Wächter-Tests", n, `\`*.test.ts\` unter \`${w.ordner}/\` (rekursiv) mit dem Marker \`@harness-waechter\` im Kopf`));
  }

  if (cfg.workflows && brauche(rootDir, cfg.workflows, "Workflow-Ordner", errors)) {
    const n = readdirSync(join(rootDir, cfg.workflows), { withFileTypes: true }).filter((e) => e.isFile() && /\.ya?ml$/.test(e.name)).length;
    rows.push(zeile("CI-Workflows", n, `\`*.yml\`/\`*.yaml\` direkt unter \`${cfg.workflows}/\``));
  }

  const adrDir = cfg.adr;
  if (adrDir && brauche(rootDir, adrDir, "ADR-Ordner", errors) && existsSync(join(rootDir, adrDir))) {
    const adrFehler = [];
    const n = readAdrs(rootDir, adrDir, adrFehler).length;
    errors.push(...adrFehler);
    rows.push(zeile("ADRs", n, `\`NNNN-*.md\` unter \`${adrDir}/\` (ohne \`README.md\`), nach \`adr-liste\``));
  }

  if (errors.length) throw new Error(errors.join("; "));
  return renderTable(["Kennzahl", "Wert", "Zählregel"], rows);
}
