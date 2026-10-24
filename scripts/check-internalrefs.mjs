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
 * des Branches (`origin/main..HEAD`); PR-Titel/-Body per `--text` über stdin (in der CI: `.github/workflows/internalrefs-pr-text.yml`). Wer in einem Content-Ticket einen NPC-/Ortsnamen wählt und hier rot wird, wählt
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

import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./hook-io.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { escapeRegex } from "./ticket-namen.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { isCheckable, listTrackedFiles } from "./check-basis.mjs";
import { ladeProjektConfig, repoName } from "./projekt-config-lib.mjs";

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), "..");

/** Verbotene Begriffe, base64-kodiert (siehe Datei-Kopf: Obfuskierung, kein Schutz).
 *  Nur über `--add` pflegen, damit hier nie Klartext landet. */
export const ENCODED_TERMS = ["d3Bz", "a2ktZmFicmlr"];

/** Namensbezüge der Maintainerin, base64-kodiert (gelistet ist der Vorname; Kurzformen sind nicht
 *  erratbar und kommen bei Bedarf per `--add-name` dazu). Anders als ENCODED_TERMS matchen diese
 *  Einträge als **Wortstamm** (`\bTerm\w*`): Flexion und Komposita mit angehängtem Teil (Genitiv-s,
 *  Bindestrich-Zusammensetzungen) brauchen keinen eigenen Eintrag; ein vorangestelltes Teil ohne
 *  Bindestrich trifft er nicht (der Wortanfang bleibt Pflicht). Meldung und Rat sind namensspezifisch.
 *  Der Nachname ist bewusst NICHT gelistet: er ist ein gewöhnliches deutsches Wort und würde das
 *  Gate dauerhaft mit Fehltreffern belegen. Pflege: `--add-name "<begriff>"`. */
export const ENCODED_NAME_TERMS = ["S2F0aGFyaW5h"];

/** base64 → Klartext. */
export function decodeTerms(encoded = ENCODED_TERMS) {
  return encoded.map((e) => Buffer.from(e, "base64").toString("utf8"));
}

/** Klartext → base64 (Gegenstück zu decodeTerms, für `--add`). */
export function encodeTerm(term) {
  return Buffer.from(String(term), "utf8").toString("base64");
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

// ── Pfadregel (#1888): lokale Pfade verraten Benutzer- und Ordnernamen ──────────────────────────────
// Drei Regeln auf den Zeilen getrackter Dateien (`pfadBefunde`), Treffer tragen `kind: "pfad"`:
//  1. Benutzerordner (`X:\Users\<seg>`, `/Users/<seg>`, `/home/<seg>`, in allen Dateien): `<seg>` muss ein Platzhalter der
//     geschlossenen Liste `PLATZHALTER_NUTZER` sein oder in Klammern/als Variable stehen (`<name>`, `$HOME`, `%USERNAME%`, `*`).
//  2. Laufwerkspfade (`X:\<wurzel>\…`, nur in test/** und scripts/**): `<wurzel>` steht in `FIXTURE_WURZELN`, der einen Liste der
//     erlaubten Fixture-Wurzeln (Verhalten von Pfad-Guards, Temp-Ordnern und Beispiel-Checkouts; keine echten Ordner).
//  3. Repo-Name als Pfadsegment eines Laufwerkspfads (in jeder Datei) ist rot; der Name kommt aus der Projekt-Config
//     (`repoName`), nie als Literal. `/…`-Pfade prüft die Regel nicht: URL-Pfade und der Vite-Basispfad tragen den Namen zu Recht.
// Laufwerkspfade brauchen einen Großbuchstaben als Laufwerk (sonst träfe `a:\n` im JS-Text). Grenzen: Pfade aus Variablen oder Template-Teilen (`${…}`) sieht die Regel nicht (fail-open), UNC- und `file://`-Pfade ebenso.
// Beispiele in Tests und Doku bauen den Pfad aus Teilen oder nutzen einen Platzhalter, sonst trifft die Regel das Beispiel.

/** Erlaubte Platzhalter-Segmente hinter `Users/` und `home/` (Klartext, keine echten Namen). */
export const PLATZHALTER_NUTZER = ["x", "y", "z", "u", "Max", "agent", "nutzer", "test", "…"];

/** Erlaubte Fixture-Wurzeln: erstes Segment eines Laufwerkspfads in test/** und scripts/** (klein geschrieben verglichen). */
export const FIXTURE_WURZELN = [
  "a", "a.ts", "andere", "b.txt", "daten", "dev", "docs", "eigen.jsonl", "foo", "gibt-es-nicht", "git", "h", "ignoriert", "msys",
  "n", "other", "pfad", "program", "projekt", "python", "r", "repo", "root", "src", "temp", "temp2", "tempo", "tmp", "tools", "users", "w", "windows", "work", "wt", "x", "…",
];

const NUTZER_MUSTER = /(?:(?<![\w])[A-Z]:[\\/]+Users|(?<![\w.:/\\])\/(?:Users|home))[\\/]+([^\\/\s"'`<>*|]+)/g;
const LAUFWERK_MUSTER = /(?<![\w])[A-Z]:[\\/]+[^\s"'`<>*|]*/g;
const LAUFWERK_KOPF = /^[A-Z]:[\\/]+/;
const NACHLAUF = /[.,;:)\]}]+$/;
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

/** Repo-Name aus der Projekt-Config des Repos, `null` ohne nutzbare Config (Regel 3 der Pfadregel entfällt dann). */
function repoNameOderNull(rootDir) {
  try {
    return repoName(ladeProjektConfig({ rootDir }));
  } catch {
    return null;
  }
}

/** Kompletter Lauf gegen das echte Repo: getrackte Dateien plus Commit-Messages des Branches. */
export function runCheck(rootDir = ROOT, io = {}) {
  // Injizierbar, damit die Verdrahtung (beide Begriffslisten, Commit-Messages) testbar ist.
  const {
    listFiles = listTrackedFiles,
    listCommits = listBranchCommitMessages,
    readFile: readDisk = (rel) => readFileSync(join(rootDir, rel), "utf8"),
    terms = decodeTerms(),
    nameTerms = decodeTerms(ENCODED_NAME_TERMS),
    repo = repoNameOderNull(rootDir),
  } = io;
  const files = listFiles(rootDir).filter((f) => isCheckable(f));
  const texts = new Map(listCommits(rootDir).map((c) => [c.name, c.text]));
  const readFile = (rel) => (texts.has(rel) ? texts.get(rel) : readDisk(rel));
  const all = [...files, ...texts.keys()];
  return { files: all, violations: [...findViolations(all, terms, readFile, nameTerms), ...pfadBefunde(files, readFile, { repo })] };
}

/** Was die Erfolgsmeldung als „geprüft" nennt: der Repo-Lauf Dateien und Commits, `--text` nur stdin. */
export function checkedLabel(kind) {
  return kind === "text" ? "Text von stdin" : "Dateien, Commit-Messages";
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
/** Einstieg. `deps` (Tests): `self` (die Datei, in die `--add`/`--add-name` schreiben), `out`, `err`. Rückgabe: Exit-Code. */
export function main(argv = process.argv.slice(2), { self = SELF, out = console.log, err = console.error } = {}) {
  const { werte, fehler } = flagsLesen(argv, { add: { type: "string" }, "add-name": { type: "string" }, text: { type: "boolean" } });
  if (fehler) {
    err(`${fehler.text}
Aufruf: node scripts/check-internalrefs.mjs [--add <begriff> | --add-name <begriff> | --text]`);
    return AUFRUF_EXIT;
  }
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);
  const dim = (s) => paint("2", s);

  for (const [flag, listName] of [["add", "ENCODED_TERMS"], ["add-name", "ENCODED_NAME_TERMS"]]) {
    if (werte[flag] === undefined) continue;
    const result = addTerm(werte[flag], self, listName);
    if (!result.ok) {
      err(red(`✖ --${flag} fehlgeschlagen: ${result.reason}`));
      return 1;
    }
    out(green(`✔ Begriff kodiert aufgenommen (${result.count} in der Liste).`));
    out(dim("  Der Klartext steht bewusst nirgends im Repo — auch nicht in der Commit-Message."));
    return 0;
  }

  // `--text`: Text von stdin prüfen (PR-Titel/-Body vor dem `gh pr create`/`gh pr edit`), z.B.
  //   gh pr view <nr> --json title,body --jq '.title, .body' | node scripts/check-internalrefs.mjs --text
  if (werte.text) {
    const text = readFileSync(0, "utf8");
    return bericht(findViolations(["stdin"], decodeTerms(), () => text, decodeTerms(ENCODED_NAME_TERMS)), 1, { red, green, label: checkedLabel("text"), out, err });
  }

  const { files, violations } = runCheck();
  return bericht(violations, files.length, { red, green, label: checkedLabel("repo"), out, err });
}

/** Gemeinsame Ausgabe, Rückgabe: Exit-Code. Der Begriff selbst wird NICHT ausgegeben — die Fundstelle genügt, und eine
 *  Fehlermeldung landet leicht in Logs/CI-Ausgaben, die wieder öffentlich sind. */
function bericht(violations, checked, { red, green, label, out, err }) {
  if (violations.length === 0) {
    out(green(`✔ Keine internen Referenzen (${checked} Quellen geprüft: ${label}).`));
    return 0;
  }

  for (const v of violations) {
    const what = v.kind === "name" ? "Namensbezug im Text" : v.kind === "pfad" ? `lokaler Pfad (${v.term})` : "interner Bezug im Text";
    err(red(`✖ ${v.file}:${v.line} — ${what}`));
  }

  const names = violations.filter((v) => v.kind === "name").length;
  const refs = violations.filter((v) => v.kind === "ref").length;
  const pfade = violations.filter((v) => v.kind === "pfad").length;
  if (refs > 0) {
    err(
      `\n${refs} interne Referenz(en) gefunden. Bitte neutral umformulieren ` +
        `(die Sache benennen, nicht die Herkunft) — Begründung siehe Kopf von ` +
        `scripts/check-internalrefs.mjs und AGENTS.md › Konventionen. Einmal gemergt lässt sich das ` +
        `nicht mehr vollständig zurücknehmen (PR-Refs bleiben).`,
    );
  }
  if (pfade > 0) {
    err(
      `\n${pfade} lokale(r) Pfad(e) gefunden. Platzhalter aus PLATZHALTER_NUTZER, Fixture-Wurzel aus FIXTURE_WURZELN ` +
        `oder den Pfad aus Teilen bauen (Kopf von scripts/check-internalrefs.mjs, Pfadregel).`,
    );
  }
  if (names > 0) {
    err(
      `\n${names} Namensbezug/-bezüge gefunden. Neutral „die Maintainerin“ schreiben; in Commits ` +
        `und PR-Texten genauso (AGENTS.md › Anonymität wahren).`,
    );
  }
  return 1;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = main();
