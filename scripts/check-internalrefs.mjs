// Kein Shebang: dieses Skript wird über `node scripts/check-internalrefs.mjs`
// (npm run check:internalrefs) gestartet UND von test/internalrefs.test.ts importiert. Ein
// `#!`-Token bricht sonst den Vitest/esbuild-Import (gleiche Falle wie bei check-size.mjs).
/**
 * Interne-Referenzen-Wächter (#990) — hält Arbeitgeber-/Kundenbezüge und (#1218) den Klarnamen der
 * Maintainerin aus dem öffentlichen Repo (Anonymitätsregel in AGENTS.md).
 *
 * Hintergrund: #978/#980 hat interne Projektreferenzen aus dem damaligen Stand entfernt, aber
 * nichts verhinderte einen Rückfall. Die Fehlerquelle ist strukturell, nicht Nachlässigkeit:
 * Vorbilder und Ideen stammen aus dem beruflichen Kontext, und die Herkunftsnennung rutscht
 * beim Formulieren einer Begründung mit rein (genau so passiert in #532/#533).
 *
 * WARUM das ein Gate ist und keine Bitte in AGENTS.md: der Fehler ist praktisch irreversibel.
 * Ein History-Rewrite (`git filter-repo`) säubert `refs/heads/*` — aber GitHub pflegt pro Pull
 * Request eine eigene `refs/pull/<nr>/head`-Ref, die davon unberührt bleibt und weiter auf die
 * alten Objekte zeigt (2026-08-01 am echten Remote nachgeprüft). Der Inhalt bleibt damit über
 * die PR-Ansicht öffentlich abrufbar, bis GitHub-Support die Objekte purged. Einmal gemergt
 * heißt hier faktisch: dauerhaft veröffentlicht. Ein grep vor dem Commit kostet Millisekunden,
 * die Bereinigung danach kostet einen Support-Fall.
 *
 * WARUM die Liste base64-kodiert ist: eine Klartext-Liste würde genau die Begriffe ins
 * öffentliche Repo schreiben, die der Wächter fernhalten soll — er würde sich selbst rot
 * machen. Das ist ausdrücklich **Obfuskierung, kein Schutz**: sie verhindert, dass die Begriffe
 * per Textsuche/Suchmaschinen-Index im Repo auffindbar sind, nicht dass jemand sie gezielt
 * dekodiert. Für den Zweck („soll nicht auffindbar rumstehen") genügt das; für echte Geheimnisse
 * wäre es das NICHT — Secrets gehören nie ins Repo, auch nicht kodiert.
 *
 * Herkunftsbegriffe (ENCODED_TERMS) brauchen für Flexionsformen einen eigenen Eintrag (Wortgrenzen:
 * der Grundbegriff trifft z.B. den Genitiv nicht); Namensbezüge (ENCODED_NAME_TERMS) matchen als
 * Wortstamm und decken Flexion/Komposita ab. Geprüft werden getrackte Dateien UND die Commit-Messages
 * des Branches (`origin/main..HEAD`); PR-Titel/-Body per `--text` über stdin. Wer in einem Content-Ticket einen NPC-/Ortsnamen wählt und hier rot wird, wählt
 * einen anderen Namen — der Begriff bleibt in der Liste.
 *
 * Liste erweitern, ohne Klartext anzufassen:
 *   node scripts/check-internalrefs.mjs --add "<begriff>"
 *
 * Bewusst ein reines Node-Skript (nur Builtins), analog zu check-size.mjs/check-context-size.mjs.
 * Die Prüflogik ist pure/exportiert und wird von test/internalrefs.test.ts importiert — EINE
 * Quelle der Wahrheit für CLI und Test.
 *
 * Ausführen mit:  npm run check:internalrefs   (oder als Teil von: npm run verify)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), "..");

/** Verbotene Begriffe, base64-kodiert (siehe Datei-Kopf: Obfuskierung, kein Schutz).
 *  Nur über `--add` pflegen, damit hier nie Klartext landet. */
export const ENCODED_TERMS = ["d3Bz", "a2ktZmFicmlr"];

/** Namensbezüge der Maintainerin (Vorname, Kurzformen), base64-kodiert. Anders als ENCODED_TERMS
 *  matchen diese Einträge als **Wortstamm** (`\bTerm\w*`): Flexion und Komposita (Genitiv-s,
 *  „…-Review“, „…Skript“) brauchen keinen eigenen Eintrag. Meldung und Rat sind namensspezifisch.
 *  Der Nachname ist bewusst NICHT gelistet: er ist ein gewöhnliches deutsches Wort und würde das
 *  Gate dauerhaft mit Fehltreffern belegen. Pflege: `--add-name "<begriff>"`. */
export const ENCODED_NAME_TERMS = ["S2F0aGFyaW5h"];

/** Dateien, die bewusst NICHT geprüft werden. Grund ist in jedem Fall base64-/Binärrauschen,
 *  nicht Bequemlichkeit: `package-lock.json` trägt tausende base64-Integrity-Hashes, in denen
 *  ein kurzer Begriff zufällig zwischen zwei `/` landen und einen Wortgrenzen-Treffer
 *  vortäuschen kann. Textdateien mit eingebettetem base64 (z.B. `fonts.css`) bleiben bewusst
 *  IN der Prüfung — dort schützen die Wortgrenzen zuverlässig (empirisch geprüft: der eine
 *  Zufalls-Substring mitten in den Font-Bytes steht zwischen Wortzeichen und fällt sauber raus). */
export const EXCLUDED_FILES = ["package-lock.json"];

/** Endungen ohne prüfbaren Text (Binärassets). */
export const EXCLUDED_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp",
  ".ttf", ".otf", ".woff", ".woff2",
  ".wav", ".mp3", ".ogg",
  ".zip", ".gz", ".pdf",
];

/** base64 → Klartext. */
export function decodeTerms(encoded = ENCODED_TERMS) {
  return encoded.map((e) => Buffer.from(e, "base64").toString("utf8"));
}

/** Klartext → base64 (Gegenstück zu decodeTerms, für `--add`). */
export function encodeTerm(term) {
  return Buffer.from(String(term), "utf8").toString("base64");
}

/** Escaped Regex-Metazeichen in einem Literal. */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Baut das Suchmuster für einen Begriff: case-insensitive, mit Wortgrenzen — aber nur an den
 *  Seiten, an denen der Begriff überhaupt mit einem Wortzeichen anfängt/endet (`\b` neben einem
 *  Sonderzeichen würde sonst das Gegenteil bewirken und den Treffer verhindern). Die Grenzen
 *  sind der Grund, dass zufällige Substrings in base64-Blobs nicht als Fund gelten. */
export function buildTermPattern(term, { stem = false } = {}) {
  const escaped = escapeRegex(term);
  const left = /^\w/.test(term) ? "\\b" : "";
  const right = !stem && /\w$/.test(term) ? "\\b" : "";
  return new RegExp(`${left}${escaped}${right}`, "i");
}

/** Alle vom Repo getrackten Dateien (via git, damit ignorierte/ungetrackte Pfade außen bleiben). */
export function listTrackedFiles(rootDir = ROOT, exec = execFileSync) {
  const out = exec("git", ["ls-files", "-z"], { cwd: rootDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
}

/** True, wenn die Datei geprüft werden soll. */
export function isCheckable(file, excludedFiles = EXCLUDED_FILES, excludedExts = EXCLUDED_EXTENSIONS) {
  if (excludedFiles.includes(file)) return false;
  const lower = file.toLowerCase();
  return !excludedExts.some((ext) => lower.endsWith(ext));
}

/** Sucht die Begriffe in den Dateien und liefert je Treffer { file, line, term, excerpt }.
 *  `readFile` ist injizierbar (Tests brauchen kein Dateisystem); Dateien, die nicht als Text
 *  lesbar sind, werden übersprungen statt das Gate zu sprengen. */
export function findViolations(files, terms, readFile, nameTerms = []) {
  const patterns = [
    ...terms.map((term) => ({ term, kind: "ref", re: buildTermPattern(term) })),
    ...nameTerms.map((term) => ({ term, kind: "name", re: buildTermPattern(term, { stem: true }) })),
  ];
  const hits = [];

  for (const file of files) {
    let content;
    try {
      content = readFile(file);
    } catch {
      continue; // nicht lesbar/kein Text — kein Grund für ein falsches Rot
    }
    if (content.includes("\0")) continue; // Binär, trotz erlaubter Endung

    const lines = content.split(/\r?\n/);
    lines.forEach((text, i) => {
      for (const { term, kind, re } of patterns) {
        if (!re.test(text)) continue;
        hits.push({ file, line: i + 1, term, kind, excerpt: text.trim().slice(0, 120) });
      }
    });
  }
  return hits;
}

/** Commit-Messages des Branches gegen die Merge-Base (`origin/main..HEAD`) als Pseudo-Dateien
 *  `commit:<sha7>`. Ohne Vergleichs-Basis (flacher Checkout, kein origin/main) leer — fail-open
 *  wie check:diffsize. Die Anonymitätsregel nennt Commits/PR-Metadaten ausdrücklich; `refs/pull/*`
 *  macht sie genauso dauerhaft öffentlich wie Dateiinhalt. */
export function listBranchCommitMessages(rootDir = ROOT, exec = execFileSync) {
  try {
    const out = exec("git", ["log", "origin/main..HEAD", "--format=%H%x00%B%x01"], {
      cwd: rootDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\x01").map((e) => e.trim()).filter(Boolean).map((entry) => {
      const [sha, ...body] = entry.split("\0");
      return { name: `commit:${sha.slice(0, 7)}`, text: body.join("\0") };
    });
  } catch {
    return [];
  }
}

/** Kompletter Lauf gegen das echte Repo: getrackte Dateien plus Commit-Messages des Branches. */
export function runCheck(rootDir = ROOT) {
  const files = listTrackedFiles(rootDir).filter((f) => isCheckable(f));
  const commits = listBranchCommitMessages(rootDir);
  const texts = new Map(commits.map((c) => [c.name, c.text]));
  const readFile = (rel) => (texts.has(rel) ? texts.get(rel) : readFileSync(join(rootDir, rel), "utf8"));
  const all = [...files, ...texts.keys()];
  return { files: all, violations: findViolations(all, decodeTerms(), readFile, decodeTerms(ENCODED_NAME_TERMS)) };
}

/** Trägt einen neuen Begriff kodiert in DIESE Datei ein (idempotent). Gibt zurück, was passiert
 *  ist, damit die CLI es melden kann, ohne selbst zu formatieren. */
export function addTerm(term, selfPath = SELF, listName = "ENCODED_TERMS") {
  const trimmed = String(term).trim();
  if (!trimmed) return { ok: false, reason: "leerer Begriff" };

  const encoded = encodeTerm(trimmed);
  const source = readFileSync(selfPath, "utf8");
  const listPattern = new RegExp(String.raw`(export const ${listName} = \[)([^\]]*)(\])`);
  const match = source.match(listPattern);
  if (!match) return { ok: false, reason: `${listName}-Liste nicht gefunden` };
  if (match[2].includes(`"${encoded}"`)) return { ok: false, reason: "Begriff steht schon in der Liste" };

  const entries = [...match[2].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const rebuilt = [...entries, encoded].map((e) => `"${e}"`).join(", ");
  writeFileSync(selfPath, source.replace(listPattern, `$1${rebuilt}$3`), "utf8");
  return { ok: true, encoded, count: entries.length + 1 };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main(argv = process.argv.slice(2)) {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);
  const dim = (s) => paint("2", s);

  for (const [flag, listName] of [["--add", "ENCODED_TERMS"], ["--add-name", "ENCODED_NAME_TERMS"]]) {
    const addIndex = argv.indexOf(flag);
    if (addIndex === -1) continue;
    const result = addTerm(argv[addIndex + 1] ?? "", SELF, listName);
    if (!result.ok) {
      console.error(red(`✖ ${flag} fehlgeschlagen: ${result.reason}`));
      process.exit(1);
    }
    console.log(green(`✔ Begriff kodiert aufgenommen (${result.count} in der Liste).`));
    console.log(dim("  Der Klartext steht bewusst nirgends im Repo — auch nicht in der Commit-Message."));
    return;
  }

  // `--text`: Text von stdin prüfen (PR-Titel/-Body vor dem `gh pr create`/`gh pr edit`), z.B.
  //   gh pr view <nr> --json title,body --jq '.title, .body' | node scripts/check-internalrefs.mjs --text
  if (argv.includes("--text")) {
    const text = readFileSync(0, "utf8");
    reportAndExit(findViolations(["stdin"], decodeTerms(), () => text, decodeTerms(ENCODED_NAME_TERMS)), 1, red, green);
    return;
  }

  const { files, violations } = runCheck();
  reportAndExit(violations, files.length, red, green);
}

/** Gemeinsame Ausgabe. Der Begriff selbst wird NICHT ausgegeben — die Fundstelle genügt, und eine
 *  Fehlermeldung landet leicht in Logs/CI-Ausgaben, die wieder öffentlich sind. */
function reportAndExit(violations, checked, red, green) {
  if (violations.length === 0) {
    console.log(green(`✔ Keine internen Referenzen (${checked} Quellen geprüft: Dateien, Commit-Messages).`));
    return;
  }

  for (const v of violations) {
    const what = v.kind === "name" ? "Namensbezug im Text" : "interner Bezug im Text";
    console.error(red(`✖ ${v.file}:${v.line} — ${what}`));
  }

  const names = violations.filter((v) => v.kind === "name").length;
  const refs = violations.length - names;
  if (refs > 0) {
    console.error(
      `\n${refs} interne Referenz(en) gefunden. Bitte neutral umformulieren ` +
        `(die Sache benennen, nicht die Herkunft) — Begründung siehe Kopf von ` +
        `scripts/check-internalrefs.mjs und AGENTS.md › Konventionen. Einmal gemergt lässt sich das ` +
        `nicht mehr vollständig zurücknehmen (PR-Refs bleiben).`,
    );
  }
  if (names > 0) {
    console.error(
      `\n${names} Namensbezug/-bezüge gefunden. Neutral „die Maintainerin“ schreiben; in Commits ` +
        `und PR-Texten genauso (AGENTS.md › Anonymität wahren).`,
    );
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
