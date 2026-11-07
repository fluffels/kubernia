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
 * des Branches (`origin/main..HEAD`); PR-Titel/-Body per `--text` über stdin (in der CI: `.github/workflows/internalrefs-pr-text.yml`). Wer in einem Ticket einen Namen wählt und hier rot wird, wählt
 * einen anderen Namen — der Begriff bleibt in der Liste.
 *
 * Liste erweitern, ohne Klartext anzufassen (`--add-name` für Namensbezüge); der Weg hängt vom Repo ab (factory#169):
 *   Fabrik (ohne `.factory/sync-stand.json`): Kernliste dieser Datei (`ENCODED_TERMS`, `ENCODED_NAME_TERMS`).
 *   Bezieher (mit Sync-Stand): Projektliste `internalrefs.begriffe`/`.namen` in `.factory/projekt.json`, Einträge `b64:<base64>`;
 *   die Kern-Datei bleibt unberührt (kein Factory-Drift). `check:internalrefs` prüft Kern- plus Projektliste; ein Klartext-Eintrag in der Config ist rot.
 *   node scripts/check-internalrefs.mjs --add "<begriff>"
 *
 * Bewusst ein reines Node-Skript (nur Builtins), analog zu check-size.mjs/check-context-size.mjs.
 * Die Prüflogik ist pure/exportiert und wird von test/internalrefs.test.ts importiert — EINE
 * Quelle der Wahrheit für CLI und Test.
 *
 * Ausführen mit:  npm run check:internalrefs   (oder als Teil von: npm run verify)
 */

import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { escapeRegex } from "./regex-lib.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { isCheckable, listTrackedFiles } from "./check-basis.mjs";
import { FIXTURE_WURZELN, KODIER_PRAEFIX, LAUFWERK_KOPF, LAUFWERK_MUSTER, NACHLAUF, PLATZHALTER_NUTZER, decodeTerm, encodeTerm, internalrefsAus, internalrefsMaengel, pfadBefunde } from "./internalrefs-lib.mjs";
import { PROJEKT_CONFIG, ladeProjektConfig, repoName } from "./projekt-config-lib.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";
import { setzeJsonSchluessel } from "./besitz-lib.mjs";

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
  return encoded.map((e) => decodeTerm(e));
}

// Klartext → base64 (Gegenstück zu decodeTerms, für `--add`): steht in `internalrefs-lib.mjs`, hier wieder ausgeführt.
export { encodeTerm };

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

// Daten und Prüffunktion der Pfadregel stehen in `internalrefs-lib.mjs` (hier wieder ausgeführt, damit Tests und Aufrufer sie über dieses Modul kennen).
export { FIXTURE_WURZELN, LAUFWERK_KOPF, LAUFWERK_MUSTER, NACHLAUF, PLATZHALTER_NUTZER, pfadBefunde };


/** Repo-Name aus der Projekt-Config des Repos, `null` ohne nutzbare Config (Regel 3 der Pfadregel entfällt dann). */
function repoNameOderNull(rootDir) {
  try {
    return repoName(ladeProjektConfig({ rootDir }));
  } catch {
    return null;
  }
}

/** Die Projektliste `{ begriffe, namen }` (dekodiert) aus der Config im Wurzelordner. Fail-closed: fehlende oder kaputte Config wirft. */
export function projektListen(rootDir = ROOT) {
  return internalrefsAus(ladeProjektConfig({ rootDir }));
}

/** Kern- plus Projektliste ohne Dubletten. Pur. */
const vereint = (kern, projekt) => [...new Set([...kern, ...projekt])];

/** Kompletter Lauf gegen das echte Repo: getrackte Dateien plus Commit-Messages des Branches. Geprüft wird Kern- plus Projektliste. */
export function runCheck(rootDir = ROOT, io = {}) {
  // Injizierbar, damit die Verdrahtung (beide Begriffslisten, Commit-Messages) testbar ist.
  const {
    listFiles = listTrackedFiles,
    listCommits = listBranchCommitMessages,
    readFile: readDisk = (rel) => readFileSync(join(rootDir, rel), "utf8"),
    terms = decodeTerms(),
    nameTerms = decodeTerms(ENCODED_NAME_TERMS),
    repo = repoNameOderNull(rootDir),
    projekt = projektListen(rootDir),
  } = io;
  const files = listFiles(rootDir).filter((f) => isCheckable(f));
  const texts = new Map(listCommits(rootDir).map((c) => [c.name, c.text]));
  const readFile = (rel) => (texts.has(rel) ? texts.get(rel) : readDisk(rel));
  const all = [...files, ...texts.keys()];
  return { files: all, violations: [...findViolations(all, vereint(terms, projekt.begriffe), readFile, vereint(nameTerms, projekt.namen)), ...pfadBefunde(files, readFile, { repo })] };
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

/** Trägt einen neuen Begriff kodiert in die Projektliste (`internalrefs.<schluessel>`) der Projekt-Config unter `wurzel` ein (Bezieher, factory#169).
 *  `schluessel`: `begriffe` oder `namen`. Schreibt nichts bei Fehler; die Meldung nennt nie den Klartext. */
export function addProjektTerm(term, wurzel, schluessel) {
  const trimmed = String(term).trim();
  if (!trimmed) return { ok: false, reason: "leerer Begriff" };
  const pfad = join(wurzel, ...PROJEKT_CONFIG.split("/"));
  let config, text;
  try {
    text = readFileSync(pfad, "utf8");
    config = JSON.parse(text);
  } catch {
    return { ok: false, reason: `${PROJEKT_CONFIG} fehlt oder ist kein gültiges JSON` };
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) return { ok: false, reason: `${PROJEKT_CONFIG} ist kein JSON-Objekt` };
  const block = config.internalrefs ?? {};
  const mangel = internalrefsMaengel(block);
  if (mangel.length > 0) return { ok: false, reason: `Block internalrefs ist ungültig (${mangel.join("; ")})` };
  const kern = schluessel === "namen" ? ENCODED_NAME_TERMS : ENCODED_TERMS;
  const kodiert = KODIER_PRAEFIX + encodeTerm(trimmed);
  if (kern.includes(encodeTerm(trimmed))) return { ok: false, reason: "Begriff steht schon in der Kernliste" };
  const liste = block[schluessel] ?? [];
  if (liste.includes(kodiert)) return { ok: false, reason: "Begriff steht schon in der Liste" };
  const neu = { ...block, [schluessel]: [...liste, kodiert] };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  // Nur der Wert von `internalrefs` wird ersetzt, der Rest der Datei bleibt byte-gleich (kein Neuformatieren der ganzen Config).
  writeFileSync(pfad, setzeJsonSchluessel(text, "internalrefs", JSON.stringify(neu, null, 2).split("\n").join(`${eol}  `)), "utf8");
  return { ok: true, encoded: kodiert, count: liste.length + 1 };
}

/** Weiche für `--add`/`--add-name`: im Bezieher (Sync-Stand vorhanden, auch kaputt) in die Projektliste, in der Fabrik in die Kernliste dieser Datei. */
function begriffAufnehmen(flag, wert, { self, wurzel }) {
  if (istBezieher(wurzel)) return addProjektTerm(wert, wurzel, flag === "add-name" ? "namen" : "begriffe");
  return addTerm(wert, self, flag === "add-name" ? "ENCODED_NAME_TERMS" : "ENCODED_TERMS");
}

/** Alle geprüften Listen (Kern plus Projekt) für `--text`; wirft bei kaputter Projekt-Config. */
function textListen(wurzel) {
  const projekt = projektListen(wurzel);
  return { terms: vereint(decodeTerms(), projekt.begriffe), names: vereint(decodeTerms(ENCODED_NAME_TERMS), projekt.namen) };
}

/** `--add`/`--add-name`: meldet das Ergebnis von `begriffAufnehmen`, Rückgabe: Exit-Code. */
function aufnehmenLauf(flag, result, { red, green, dim, out, err }) {
  if (!result.ok) {
    err(red(`✖ --${flag} fehlgeschlagen: ${result.reason}`));
    return 1;
  }
  out(green(`✔ Begriff kodiert aufgenommen (${result.count} in der Liste).`));
  out(dim("  Der Klartext steht bewusst nirgends im Repo — auch nicht in der Commit-Message."));
  return 0;
}

/** `--text`: der Text aus `stdin` gegen Kern- plus Projektliste und die Pfadregel (alle drei Regeln, auch Laufwerkspfade ohne Dateipfad im Scope; factory#153). */
function textLauf(stdin, wurzel, ctx) {
  const text = stdin();
  const { terms, names } = textListen(wurzel);
  const pfade = pfadBefunde(["stdin"], () => text, { repo: repoNameOderNull(wurzel), alleLaufwerke: true });
  return bericht([...findViolations(["stdin"], terms, () => text, names), ...pfade], 1, { ...ctx, label: checkedLabel("text") });
}

/** Der Repo-Lauf (`pruefe`: Dateien und Commit-Messages). */
function repoLauf(pruefe, ctx) {
  const { files, violations } = pruefe();
  return bericht(violations, files.length, { ...ctx, label: checkedLabel("repo") });
}

// ── CLI ──────────────────────────────────────────────────────────────────────
/** Einstieg. `deps` (Tests): `self` (die Datei, in die `--add`/`--add-name` in der Fabrik schreiben), `wurzel` (Repo-Wurzel für Projekt-Config und Sync-Stand), `stdin` (Text für `--text`), `out`, `err`, `pruefe` (statt `runCheck` gegen das echte Repo). Rückgabe: Exit-Code. */
export function main(argv = process.argv.slice(2), { self = SELF, wurzel = ROOT, stdin = () => readFileSync(0, "utf8"), out = console.log, err = console.error, pruefe = () => runCheck(wurzel) } = {}) {
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

  const flag = ["add", "add-name"].find((f) => werte[f] !== undefined);
  if (flag) return aufnehmenLauf(flag, begriffAufnehmen(flag, werte[flag], { self, wurzel }), { red, green, dim, out, err });

  // `--text`: Text von stdin prüfen (PR-Titel/-Body vor dem `gh pr create`/`gh pr edit`), z.B.
  //   gh pr view <nr> --json title,body --jq '.title, .body' | node scripts/check-internalrefs.mjs --text
  const ctx = { red, green, out, err };
  try {
    return werte.text ? textLauf(stdin, wurzel, ctx) : repoLauf(pruefe, ctx);
  } catch (e) {
    err(red(`✖ ${e instanceof Error ? e.message : e}`));
    return 1;
  }
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
        `scripts/check-internalrefs.mjs und AGENTS.md › Öffentliches Repo — keine internen Bezüge. Einmal gemergt lässt sich das ` +
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
