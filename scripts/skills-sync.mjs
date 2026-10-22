#!/usr/bin/env node
// Skill-Zeiger-Generator (#1848, ADR 0022 Fortschreibung): Abläufe liegen tool-neutral als Skill-Quelle unter
// `.agents/skills/<name>/SKILL.md`; das Werkzeug-Verzeichnis (Claude Code: `.claude/skills/<name>/SKILL.md`) hält nur einen
// generierten Zeiger: Frontmatter der Quelle wörtlich, darunter Marke und Verweis auf die Quelle. Generator statt Symlink
// (Windows-Clones ohne `core.symlinks`).
//
// Aufruf: node scripts/skills-sync.mjs [--tool claude] [--check] [--prune]
//   Ohne Flag: Zeiger erzeugen/aktualisieren (nie einen Ordner ohne Marke überschreiben). `--check` schreibt nie und
//   endet mit 1 bei jedem Befund (gewinnt über `--prune`). `--prune` entfernt den Zeiger-Ordner eines gelöschten
//   Quell-Skills, aber nur, wenn er die Marke trägt und nur `SKILL.md` enthält; alles andere wird gemeldet.
//   Exit: 0 ok (auch bei gemeldeten Waisen/Volltexten), 1 unbrauchbare Quelle bzw. Befund bei `--check`, 2 Nutzungsfehler.
// Die pure Prüffunktion `pruefeSkills` bewacht test/harness/skills-sync.test.ts.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { parseFrontmatter } from "./docs-gen/markdown.mjs";
import { QUELL_VERZEICHNIS, ZEIGER_MARKE, ZEIGER_WURZEL } from "./skill-pfade.mjs";

export const WERKZEUGE = { claude: ZEIGER_WURZEL };
const FIX = "npm run skills:sync";
const FIX_PRUNE = "npm run skills:sync -- --prune";

const lf = (text) => text.replace(/\r\n/g, "\n");
const traegtMarke = (text) => lf(text).split("\n").includes(ZEIGER_MARKE);

/** Frontmatter-Block (von der ersten `---`-Zeile bis zur nächsten, einschließlich) oder null. */
export function frontmatterBlock(text) {
  const zeilen = lf(text).split("\n");
  if (zeilen[0] !== "---") return null;
  const ende = zeilen.indexOf("---", 1);
  return ende < 0 ? null : zeilen.slice(0, ende + 1).join("\n");
}

/** Quelle brauchbar? `null` oder die Meldung, warum nicht (Frontmatter-Felder über `parseFrontmatter` der Doku-Generatoren). */
export function quellProblem(q) {
  if (q.text === null) return "Ordner ohne SKILL.md";
  if (!frontmatterBlock(q.text)) return "Quelle ohne Frontmatter";
  const felder = parseFrontmatter(frontmatterBlock(q.text));
  const fehlt = ["name", "description"].filter((k) => !felder[k]);
  return fehlt.length ? `Quelle ohne ${fehlt.join(" und ")} im Frontmatter` : null;
}

/** Gewünschter Zeiger-Text zu einer Quelle (immer LF). */
export function zeigerText(name, quelltext) {
  const block = frontmatterBlock(quelltext);
  return `${block}\n\n${ZEIGER_MARKE}\nLies \`${QUELL_VERZEICHNIS}/${name}/SKILL.md\` und folge ihm.\n`;
}

/**
 * Prüft den Stand: quellen `{ordner, text|null}`, zeiger `{ordner, text|null, dateien}`, lose = Dateien direkt unter dem
 * Werkzeug-Verzeichnis; Befunde `{datei, meldung, fix}`. Unter dem Werkzeug-Verzeichnis liegt nur ein Zeiger (kein Volltext, keine lose Datei).
 */
export function pruefeSkills({ quellen, zeiger, lose = [], ziel = WERKZEUGE.claude }) {
  const befunde = [];
  const quellOrdner = new Set(quellen.map((q) => q.ordner));
  const zeigerNach = new Map(zeiger.map((z) => [z.ordner, z]));
  const melde = (datei, meldung, fix = FIX) => befunde.push({ datei, meldung, fix });

  for (const q of quellen) {
    const quelle = `${QUELL_VERZEICHNIS}/${q.ordner}/SKILL.md`;
    const problem = quellProblem(q);
    if (problem) { melde(quelle, problem); continue; }
    const z = zeigerNach.get(q.ordner);
    const datei = `${ziel}/${q.ordner}/SKILL.md`;
    if (!z || z.text === null) melde(datei, `Zeiger fehlt für die Quelle ${quelle}`);
    else if (!traegtMarke(z.text)) melde(datei, `Volltext-Skill neben der Quelle ${quelle}`);
    else if (z.text !== zeigerText(q.ordner, q.text)) melde(datei, `Zeiger weicht von der Quelle ${quelle} ab (von Hand geändert oder Quelle neu)`);
    const fremd = z ? z.dateien.filter((d) => d !== "SKILL.md") : [];
    if (fremd.length) melde(`${ziel}/${q.ordner}/${fremd[0]}`, "fremde Datei im Zeiger-Ordner (nur SKILL.md erlaubt)");
  }

  for (const z of zeiger) {
    if (quellOrdner.has(z.ordner)) continue;
    const datei = `${ziel}/${z.ordner}/SKILL.md`;
    if (z.text !== null && traegtMarke(z.text)) melde(datei, "Zeiger ohne Quelle", FIX_PRUNE);
    else melde(datei, "Volltext-Skill unter dem Werkzeug-Verzeichnis (Quelle nach .agents/skills/ verlegen, hier nur ein Zeiger)");
  }

  for (const datei of lose) melde(`${ziel}/${datei}`, "lose Datei unter dem Werkzeug-Verzeichnis (nur Zeiger-Ordner erlaubt)", "Datei entfernen oder als Skill-Quelle unter .agents/skills/ ablegen");

  return befunde;
}

const unterordner = (pfad) => (existsSync(pfad) ? readdirSync(pfad, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []);
const liesOderNull = (pfad) => (existsSync(pfad) ? readFileSync(pfad, "utf8") : null);

/** Liest den Stand per Dateisystem (nur die Ordner direkt unter den beiden Wurzeln). */
export function liesStand(wurzel, ziel = WERKZEUGE.claude) {
  const lose = existsSync(join(wurzel, ziel)) ? readdirSync(join(wurzel, ziel), { withFileTypes: true }).filter((e) => !e.isDirectory()).map((e) => e.name) : [];
  return {
    lose,
    quellen: unterordner(join(wurzel, QUELL_VERZEICHNIS)).map((ordner) => ({ ordner, text: liesOderNull(join(wurzel, QUELL_VERZEICHNIS, ordner, "SKILL.md")) })),
    zeiger: unterordner(join(wurzel, ziel)).map((ordner) => ({
      ordner,
      text: liesOderNull(join(wurzel, ziel, ordner, "SKILL.md")),
      dateien: readdirSync(join(wurzel, ziel, ordner)),
    })),
  };
}

/** Der Lauf: `{ befunde, unbrauchbar, geschrieben, geloescht, gemeldet }`. `check` schreibt und löscht nie. */
export function lauf({ wurzel, tool = "claude", check = false, prune = false }) {
  if (!Object.hasOwn(WERKZEUGE, tool)) throw new Error(`unbekanntes Tool: ${tool}`);
  const ziel = WERKZEUGE[tool];
  const stand = liesStand(wurzel, ziel);
  const befunde = pruefeSkills({ ...stand, ziel });
  const ergebnis = { befunde, unbrauchbar: [], geschrieben: [], geloescht: [], gemeldet: [] };
  if (check) return ergebnis;
  const zeigerNach = new Map(stand.zeiger.map((z) => [z.ordner, z]));
  for (const q of stand.quellen) {
    if (quellProblem(q)) { ergebnis.unbrauchbar.push(q.ordner); continue; }
    const z = zeigerNach.get(q.ordner);
    if (z && z.text !== null && !traegtMarke(z.text)) { ergebnis.gemeldet.push(`${ziel}/${q.ordner}`); continue; }
    const soll = zeigerText(q.ordner, q.text);
    if (z && z.text === soll) continue;
    mkdirSync(join(wurzel, ziel, q.ordner), { recursive: true });
    writeFileSync(join(wurzel, ziel, q.ordner, "SKILL.md"), soll);
    ergebnis.geschrieben.push(`${ziel}/${q.ordner}/SKILL.md`);
  }
  const quellOrdner = new Set(stand.quellen.map((q) => q.ordner));
  for (const z of stand.zeiger) {
    if (quellOrdner.has(z.ordner)) continue;
    const pfad = `${ziel}/${z.ordner}`;
    const loeschbar = z.text !== null && traegtMarke(z.text) && z.dateien.every((d) => d === "SKILL.md");
    if (prune && loeschbar) { rmSync(join(wurzel, pfad), { recursive: true }); ergebnis.geloescht.push(pfad); }
    else if (z.text !== null && traegtMarke(z.text)) ergebnis.gemeldet.push(pfad);
    else if (prune) ergebnis.gemeldet.push(pfad);
  }
  return ergebnis;
}

function leseArgumente(argv) {
  const { werte, fehler } = flagsLesen(argv, { tool: { type: "string" }, check: { type: "boolean" }, prune: { type: "boolean" } });
  if (fehler) return { fehler: fehler.text };
  const tool = werte.tool ?? "claude";
  if (!Object.hasOwn(WERKZEUGE, tool)) return { fehler: `Unbekanntes Tool: ${tool}` };
  return { tool, check: werte.check === true, prune: werte.prune === true };
}

function main() {
  const opt = leseArgumente(process.argv.slice(2));
  if (opt.fehler) {
    console.error(`${opt.fehler}\nAufruf: node scripts/skills-sync.mjs [--tool ${Object.keys(WERKZEUGE).join("|")}] [--check] [--prune]`);
    process.exit(AUFRUF_EXIT);
  }
  const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
  const e = lauf({ wurzel, ...opt });
  if (opt.check) {
    for (const b of e.befunde) console.error(`✗ ${b.datei}: ${b.meldung} → ${b.fix}`);
    if (e.befunde.length) process.exit(1);
    console.log("✓ Skill-Zeiger stimmen mit den Quellen überein");
    return;
  }
  for (const d of e.geschrieben) console.log(`geschrieben: ${d}`);
  for (const d of e.geloescht) console.log(`entfernt: ${d}`);
  for (const d of e.gemeldet) console.log(`⚠ nicht angefasst (Volltext, fremde Datei oder ohne --prune): ${d}`);
  for (const d of e.unbrauchbar) console.error(`✗ ${QUELL_VERZEICHNIS}/${d}/SKILL.md: Quelle unbrauchbar (SKILL.md, name oder description fehlt)`);
  if (e.unbrauchbar.length) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
