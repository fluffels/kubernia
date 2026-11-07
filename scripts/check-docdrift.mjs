// Kein Shebang — analog zu scripts/check-docmap.mjs: dieses Skript wird über
// `node scripts/check-docdrift.mjs` (npm run check:docdrift) gestartet UND von
// test/docdrift.test.ts importiert. Ein `#!` bricht genau diesen Vitest/esbuild-Import.
/**
 * Harness-Drift-Wächter (#529) — hält die "Doku als Kontext-Selektor" ehrlich,
 * jenseits der Datei-Landkarte (die bewacht #482 / check-docmap.mjs).
 *
 * Hintergrund: AGENTS.md lädt JEDE KI-Session als Kontext; README und die Befehls-
 * Referenz docs/referenz/befehle.md (#1078) werden on-demand gelesen. Sie nennen (1) `npm run <x>`-Kommandos, die es in package.json
 * geben MUSS, und (2) viele interne Markdown-Links + `#anker` zwischen den Docs.
 * Beides kann leise veralten — ein Agent tippt dann ein totes Kommando oder folgt
 * einem toten Link ins Leere. Der Datei-Landkarten-Wächter (#482) deckt das NICHT
 * ab. Dieser Wächter macht genau diesen Drift **rot**:
 *
 *   1. Tote Kommandos: jedes in der Doku erwähnte `npm run <x>` (bzw. `npm test`)
 *      existiert als Skript in package.json.
 *   2. Undokumentierte Kern-Skripte: jedes package.json-Skript (außer der bewusst
 *      ausgenommenen Entwickler-Convenience) wird in mind. einem der drei
 *      Kern-Docs (AGENTS.md/README/docs/referenz/befehle.md) erwähnt.
 *   3. Tote Links: jeder interne, repo-relative Markdown-Link zeigt auf eine
 *      existierende Datei/ein Verzeichnis.
 *   4. Tote Anker: jeder `#anker` (gleiche Datei oder auf eine .md) trifft eine
 *      real vorhandene Überschrift (GitHub-Slug-Regel).
 *   5. Verify-Ketten-Kopien: jede in der Doku kopierte verify-Kette stimmt mit package.json › scripts.verify überein.
 *   6. ADR-Fortschreibungen (#90): jede Datei unter docs/adr/fortschreibungen/ hat Namen, Kopfzeile
 *      und einen Zeiger im ADR.
 *   7. Tote Test-Pfade (#97): jeder Backtick-Token `test/…` existiert (ADRs und Dateien mit
 *      Datum im Namen ausgenommen; nackte Dateinamen und Markdown-Links prüft das nicht).
 *      Im Bezieher (gültiger Sync-Stand, lesbares Manifest) prüft das Gate einen Verweis aus
 *      verteiltem Factory-Besitz (Ganz-Datei- und Block-Einheiten, keine JSON-Schlüssel) nur,
 *      wenn das Ziel selbst Besitz ist; Projekt-Text bleibt voll geprüft (#110).
 *   8. Abschnittsverweise (factory#157): ein Textverweis auf einen Abschnitt einer Markdown-Datei
 *      trifft eine Überschrift oder einen Fettdruck-Anfang der Zieldatei. Geschlossene Musterliste
 *      (Kern der Regex: Pfad auf `.md`, ein Leerzeichen, dann das Trennzeichen):
 *        (a) `<pfad>.md › <Abschnitt>`           (b) `<pfad>.md § <Abschnitt>` (auch `§2a`; deckt `AGENTS.md § …` ab)
 *        (c) Ketten `<pfad>.md › A › B`: jedes Segment wird gegen dieselbe Zieldatei geprüft.
 *      Der Abschnittstext endet am Zeilenende oder an Backtick, `"`, `“`, `”`, `„`, `]`, `|`.
 *      Gescannt: alle Markdown-Dateien des Gates plus `scripts/**` (`.mjs`, `.cjs`, `.js`: Kommentare und
 *      Strings); in Markdown sind Code-Fences und Inline-Code maskiert. Übersprungen: Abschnitt mit `<`
 *      am Anfang (Platzhalter), verweisende ADRs und Dateien mit Datum im Namen. Ziel: repo-relativ,
 *      dann relativ zur verweisenden Datei; ein fehlendes Ziel ist rot. Abschnitte der Zieldatei:
 *      Überschriften außerhalb von Fences und Fettdruck-Anfänge (`**Name**` am Zeilen-/Listenanfang);
 *      eine nummerierte Überschrift zählt auch ohne Nummer. Bezieher: wie Punkt 7 (#110) bleibt ein
 *      fehlendes Ziel aus verteiltem Besitz-Text still, ein vorhandenes Ziel wird immer geprüft (ein
 *      Anker-Stub, den nur ein Textverweis hält, muss seine Überschrift behalten).
 *      Trefferregel (Präfix-Heuristik): Wörter (klein, ohne Satzzeichen und `(…#<nr>)`-Herkunft) des
 *      Verweises und des Abschnitts stimmen auf einem gemeinsamen Präfix von mindestens
 *      min(Abschnittswörter, Verweiswörter bis zum ersten `. , ; : ( ) ! ?`, 2) Wörtern überein.
 *      Grenze: Prosa direkt hinter dem Abschnittsnamen ohne Satzzeichen („<Datei> › Name gilt“) zählt
 *      zum Namen und ist rot; Abschnittsnamen mit Satzzeichen abschließen. Namen in Anführungszeichen
 *      direkt hinter dem Trenner und Verweise aus Test-Dateien prüft das Gate nicht.
 *
 * Bewusst ein reines Node-Skript (nur Builtins), analog zu check-docmap.mjs/
 * check-size.mjs: läuft plattformübergreifend über `npm run check:docdrift` und
 * im CI (als Teil von `npm run verify`). Die Parse-/Prüf-Logik wird zusätzlich
 * von test/docdrift.test.ts importiert — EINE Quelle der Wahrheit.
 *
 * Ausführen mit:  npm run check:docdrift   (oder als Teil von: npm run verify)
 */

import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { codeMaskiert, collectHeadingSlugs, leseConfigObjekt, linkStellen, linkZiel, parseNpmRunMentions, stripFencedCode } from "./docs-gen/markdown.mjs";
import { collectMarkdown } from "./check-basis.mjs";
import { SCHRITT_NAME } from "./regex-lib.mjs";
import { kettenSchritte, SCHRITT_RE } from "./docs-gen/npm-ketten.mjs";
import { fortschreibungsFehler } from "./docs-gen/adr.mjs";
import { besitzSpannen, istGanzeDatei, MANIFEST_PFAD, manifestAusText, wirdVerteilt } from "./besitz-lib.mjs";
import { liesSyncStand } from "./sync-stand-lib.mjs";
import { istAnkerStub } from "./factory-links-lib.mjs";
import { factorySeiteIn } from "./factory-seite.mjs";

// Link- und Anker-Helfer wohnen in docs-gen/markdown.mjs (auch das Export-Werkzeug nutzt sie; ein Einstiegsskript importiert aus keinem anderen); hier nur weitergereicht.
export { collectHeadingSlugs, linkStellen, linkZiel, parseNpmRunMentions, slugify, stripFencedCode } from "./docs-gen/markdown.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Die Docs, die die Befehls-Referenz tragen — nur DIESE zählen als Beleg, dass ein
 *  Kern-Skript dokumentiert ist (Rückwärts-Check). Seit #1078 liegt die vollständige
 *  Befehlsliste on-demand in docs/referenz/befehle.md statt in der immer geladenen
 *  CLAUDE.md; AGENTS.md und README bleiben, weil sie Alltags-Kommandos selbst nennen. */
export const CORE_DOCS = ["AGENTS.md", "README.md", "docs/referenz/befehle.md"];

/** package.json-Skripte, die bewusst NICHT dokumentiert sein müssen: reine
 *  Entwickler-Convenience, kein Teil der Harness-Story (Gates/Builds/Tests). */
export const DOC_EXEMPT_SCRIPTS = new Set([
  "preview", // Vite-Vorschau des Host-Builds — lokale Convenience
  "preview:offline", // dito für den Offline-Build
  "test:watch", // Watch-Modus von Vitest — lokale Convenience (dokumentiert ist `npm test`)
]);

// ── Kommandos ───────────────────────────────────────────────────────────────────

// `parseNpmRunMentions` (Kommando-Erkennung) wohnt in docs-gen/markdown.mjs, weil auch das Export-Werkzeug sie nutzt; hier weitergereicht.

// ── Links & Anker ────────────────────────────────────────────────────────────────

/** Interne Links: { target, path, anchor } — path repo-/datei-relativ wie geschrieben, anchor ohne
 *  führendes `#` (oder ""). */
export function extractLinks(md) {
  return linkStellen(md).map(({ target, path, anchor }) => ({ target, path, anchor }));
}

// ── verify-Kette ─────────────────────────────────────────────────────────────────

/** Liest die verify-Gate-Sequenz aus dem verify-Skript in package.json aus:
 *  alle `npm run <x>`-Aufrufe in Reihenfolge, gefolgt von `npm test` → `"test"`. */
export function parseVerifyChain(pkgScripts) {
  // Dieselbe Auflösung wie Gate-Tabelle und Diagramm-Zahlen (kettenSchritte, je Schritt einmal); ohne verify-Skript leer.
  const steps = typeof pkgScripts["verify"] === "string" ? kettenSchritte(pkgScripts, ["verify"], "verify") : [];
  // Ein Schritt ohne Skriptnamen (Rohbefehl) ließe sich nicht gegen die Doku abgleichen: laut melden statt still fallen lassen (Z5g).
  const unbenennbar = steps.filter((step) => !SCHRITT_RE.test(step));
  if (unbenennbar.length > 0) {
    throw new Error(`verify enthält Schritte ohne Skriptnamen (nur \`npm run <x>\` und \`npm test\`, Argumente hinter \`--\` erlaubt): ${unbenennbar.join(" | ")}`);
  }
  return steps;
}

/** Findet alle `typecheck → … → test`-Sequenzen in `md` (roh, inkl. Codeblöcke).
 *  Der `→`-Pfeil ist das kanonische Trennzeichen für dokumentierte verify-Ketten
 *  in diesem Repo (docs/referenz/befehle.md, SKILL.md, agent-harness.md). */
export function findDocumentedVerifyChains(md) {
  const chains = [];
  for (const m of md.matchAll(new RegExp(String.raw`\btypecheck(?:\s*→\s*${SCHRITT_NAME})+\s*→\s*test\b`, "g"))) {
    chains.push(m[0].split(/\s*→\s*/).map((s) => s.trim()));
  }
  return chains;
}

/** Prüft alle in Markdown-Dateien dokumentierten verify-Ketten gegen die echte
 *  Kette aus package.json. Gibt je unvollständiger Kette zurück:
 *  { file, chain: string[], missing: string[], extra: string[] }: `missing` = Gates der echten Kette, die in der
 *  Doku fehlen; `extra` = dokumentierte Gates, die es in der echten Kette nicht (mehr) gibt (#1349). Bevorzugt
 *  steht in der Doku gar keine Handkopie, sondern ein Verweis auf `package.json` › `scripts.verify`. */
export function auditVerifyChain(rootDir, mdFiles, content, pkgScripts) {
  const real = parseVerifyChain(pkgScripts);
  const violations = [];
  for (const f of mdFiles) {
    for (const chain of findDocumentedVerifyChains(content.get(f))) {
      const missing = real.filter((g) => !chain.includes(g));
      const extra = chain.filter((g) => !real.includes(g));
      if (missing.length > 0 || extra.length > 0) violations.push({ file: f, chain, missing, extra });
    }
  }
  return violations;
}

// ── Audit ────────────────────────────────────────────────────────────────────────

const isMd = (p) => p.toLowerCase().endsWith(".md");

/** Vergleicht Doku gegen Realität. Gibt strukturierte Befunde zurück (leere
 *  Arrays = ok). `rootDir` überschreibbar für deterministische Tests. */
export function auditDocDrift(rootDir = ROOT) {
  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  const mdFiles = collectMarkdown(rootDir);

  // Doku-Inhalte einmal einlesen (Datei → Roh-Markdown).
  const content = new Map();
  for (const f of mdFiles) content.set(f, readFileSync(join(rootDir, f), "utf8"));

  // Headings je Datei cachen (für Anker-Auflösung).
  const headingCache = new Map();
  const headingsOf = (file) => {
    if (!headingCache.has(file)) {
      const abs = join(rootDir, file);
      headingCache.set(
        file,
        existsSync(abs) && statSync(abs).isFile() && isMd(file)
          ? new Set(collectHeadingSlugs(readFileSync(abs, "utf8")))
          : null,
      );
    }
    return headingCache.get(file);
  };

  // 1. Tote Kommandos: `npm run <x>` in IRGENDEINEM md, das es nicht als Skript gibt.
  const deadCommands = [];
  for (const f of mdFiles) {
    for (const name of parseNpmRunMentions(content.get(f))) {
      if (!scripts.has(name)) deadCommands.push({ file: f, script: name });
    }
  }

  // 2. Undokumentierte Kern-Skripte: package.json-Skript (außer Exempt) in KEINEM
  //    der Kern-Docs erwähnt.
  const coreDocMentions = new Set();
  for (const f of CORE_DOCS) {
    if (content.has(f)) for (const n of parseNpmRunMentions(content.get(f))) coreDocMentions.add(n);
  }
  const undocumentedScripts = [...scripts]
    .filter((s) => !DOC_EXEMPT_SCRIPTS.has(s) && !coreDocMentions.has(s))
    .sort();

  // 3./4. Tote Links & Anker.
  const deadLinks = [];
  const deadAnchors = [];
  for (const f of mdFiles) {
    for (const { target, path, anchor } of extractLinks(content.get(f))) {
      // Reiner Anker (#foo) → Ziel ist die Datei selbst.
      const targetFile = path === "" ? f : linkZiel(f, path);

      if (path !== "") {
        const abs = join(rootDir, targetFile);
        if (!existsSync(abs)) {
          deadLinks.push({ file: f, target, resolved: targetFile });
          continue; // Anker eines toten Ziels nicht separat melden
        }
      }
      if (anchor) {
        const heads = headingsOf(targetFile);
        // Anker nur für Markdown-Ziele prüfen (bei .ts o.ä. ist #Lxx ein Zeilenanker).
        if (heads && !heads.has(anchor)) {
          deadAnchors.push({ file: f, target, resolved: targetFile, anchor });
        }
      }
    }
  }

  // 5. verify-Ketten-Drift: dokumentierte typecheck→…→test-Sequenzen gegen echte Kette.
  const verifyChainViolations = auditVerifyChain(rootDir, mdFiles, content, pkg.scripts ?? {});

  return { mdFiles, scripts: [...scripts], deadCommands, undocumentedScripts, deadLinks, deadAnchors, verifyChainViolations, fortschreibungsFehler: auditFortschreibungen(rootDir), testPfadFehler: auditTestPfade(rootDir, mdFiles, content), abschnittFehler: auditAbschnittVerweise(rootDir, mdFiles, content) };
}

// ── Abschnittsverweise (factory#157) ─────────────────────────────────────────────

const ABSCHNITT_VERWEIS = /(?<![\w./-])([\w./-]*\w\.md) (›|§) ?([^\n`"“”„\]|]*)/g;
const SANFTER_STOPP = /[.,;:()!?]/;

/** Textverweise `<pfad>.md › A › B` und `<pfad>.md § A` in `text` (Muster 8 im Kopfkommentar): `[{ pfad, trenner, segmente, index }]`; leere Segmente und Platzhalter (`<` am Anfang) entfallen. Markdown wird vorher von Code maskiert. */
export function abschnittVerweise(text, { istMarkdown = false } = {}) {
  const quelle = istMarkdown ? codeMaskiert(text) : text;
  const treffer = [];
  for (const m of quelle.matchAll(ABSCHNITT_VERWEIS)) {
    const start = m.index + m[0].length - m[3].length;
    const roh = istMarkdown ? text.slice(start, start + m[3].length).split("`")[0] : m[3]; // Inline-Code beendet den Abschnittstext
    const segmente = roh.split(" › ").map((s) => s.trim()).filter((s) => s !== "" && !s.startsWith("<"));
    if (segmente.length > 0) treffer.push({ pfad: m[1], trenner: m[2], segmente, index: m.index });
  }
  return treffer;
}

/** Normalisierte Wortliste eines Abschnittsnamens: klein, ohne `**`/Backticks/Link-Syntax, `(…#<nr>)`-Herkunft und `§`; Satzzeichen trennen Wörter, reine Striche entfallen. */
function abschnittsWoerter(text) {
  return text
    .toLowerCase()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|`/g, "")
    .replace(/\([^)]*#\d[^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w !== "" && !/^[-–—]+$/.test(w));
}

/** Abschnitte einer Markdown-Datei als Wortlisten: Überschriften (außerhalb von Fences; nummeriert zusätzlich ohne Nummer) und Fettdruck-Anfänge. */
export function abschnittTitel(md) {
  const titel = [];
  for (const zeile of stripFencedCode(md).split("\n")) {
    const kopf = /^#{1,6}\s+(.*\S)\s*$/.exec(zeile);
    const fett = kopf ? null : /^\s*(?:>\s*)?(?:[-*+]|\d+\.)?\s*\*\*(.+?)\*\*/.exec(zeile);
    const roh = kopf?.[1] ?? fett?.[1];
    if (roh === undefined) continue;
    titel.push(abschnittsWoerter(roh));
    const ohneNummer = /^\d+[a-z]?[.)]?\s+(.*)$/.exec(roh);
    if (kopf && ohneNummer) titel.push(abschnittsWoerter(ohneNummer[1]));
  }
  return titel;
}

/** Trifft ein Verweis-Segment einen der Abschnitte (Trefferregel im Kopfkommentar)? Ein Segment ohne Wörter gilt als Treffer. */
export function abschnittTrifft(segment, titel) {
  const kurz = abschnittsWoerter(segment.split(SANFTER_STOPP)[0]);
  if (kurz.length === 0) return true;
  const voll = abschnittsWoerter(segment);
  return titel.some((s) => {
    let l = 0;
    while (l < s.length && l < voll.length && s[l] === voll[l]) l++;
    return l > 0 && l >= Math.min(s.length, kurz.length, 2);
  });
}

function skriptDateien(rootDir, ordner = "scripts") {
  const abs = join(rootDir, ordner);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === "node_modules" ? [] : skriptDateien(rootDir, `${ordner}/${e.name}`);
    return /\.(mjs|cjs|js)$/.test(e.name) ? [`${ordner}/${e.name}`] : [];
  });
}

/** 8. Abschnittsverweise (factory#157): `[{ file, art: "abschnitt" | "ziel", pfad, trenner, segment, ziel }]`. Ziel fehlt → `art: "ziel"`; im Bezieher bleibt das still, wenn der Verweis in verteiltem Besitz-Text steht und das Ziel kein Besitz ist (#110). Ein vorhandenes Ziel wird gegen seine Abschnitte geprüft, außer im Bezieher bei einem Verweis aus Besitz-Text auf einen Anker-Stub (`istAnkerStub`: nur Überschriften, der Fettdruck-Abschnitt fehlt dort; die Fabrik prüft gegen die volle Seite). Der Vertrag für Kern-Verweise auf AGENTS.md-Titel (ein `AGENTS.md`-Verweis trifft den Kern-Block, ein `Projekt-Block`-Verweis die Vorlage) gehört `test/harness/agents-refs.test.ts`. */
function auditAbschnittVerweise(rootDir, mdFiles, content) {
  const abschnittCache = new Map();
  const titelVon = (ziel) => {
    if (!abschnittCache.has(ziel)) abschnittCache.set(ziel, abschnittTitel(readFileSync(join(rootDir, ziel), "utf8")));
    return abschnittCache.get(ziel);
  };
  const istDatei = (p) => existsSync(join(rootDir, p)) && statSync(join(rootDir, p)).isFile();
  const fehler = [];
  const dateien = [...mdFiles.map((f) => [f, true]), ...skriptDateien(rootDir).map((f) => [f, false])];
  fuerDokuTexte(rootDir, dateien, content, ({ f, text, istMarkdown, still, imBesitz }) => {
    for (const v of abschnittVerweise(text, { istMarkdown })) {
      const ziel = [v.pfad, posix.join(posix.dirname(f), v.pfad)].find(istDatei);
      const basis = { file: f, pfad: v.pfad, trenner: v.trenner };
      if (ziel === undefined) {
        if (!still(v.index, v.pfad)) fehler.push({ ...basis, art: "ziel", segment: v.segmente[0], ziel: v.pfad });
        continue;
      }
      if (imBesitz(v.index) && istAnkerStub(readFileSync(join(rootDir, ziel), "utf8"))) continue; // Stub trägt nur Überschriften, nicht den Fettdruck-Abschnitt des Besitz-Verweises (factory#157)
      const titel = titelVon(ziel);
      const tot = v.segmente.find((seg) => !abschnittTrifft(seg, titel));
      if (tot !== undefined) fehler.push({ ...basis, art: "abschnitt", segment: tot, ziel });
    }
  });
  return fehler;
}

/** Gemeinsamer Rahmen der Text-Prüfungen (Abschnittsverweise, Test-Pfade): ADRs (Historie) und Dateien mit Datum im Namen entfallen; je Text `besuche({ f, text, istMarkdown, imBesitz(index), still(index, pfad) })`. Im Bezieher (`besitzAusnahme`) ist `imBesitz` die Frage nach einer verteilten Besitz-Spanne, `still` zusätzlich „und das Ziel `pfad` ist kein Besitz“ (#110); im Factory-Repo ist beides `false`. */
function fuerDokuTexte(rootDir, dateien, content, besuche) {
  const adrPrefix = `${adrOrdner(rootDir)}/`;
  const ausnahme = besitzAusnahme(rootDir);
  for (const [f, istMarkdown] of dateien) {
    if (f.startsWith(adrPrefix) || /\d{4}-\d{2}-\d{2}/.test(f)) continue;
    const text = content.get(f) ?? readFileSync(join(rootDir, f), "utf8");
    const spannen = ausnahme ? ausnahme.spannen(f, text) : [];
    const imBesitz = (index) => spannen.some(([a, b]) => index >= a && index <= b);
    besuche({ f, text, istMarkdown, imBesitz, still: (index, pfad) => imBesitz(index) && !ausnahme.istZiel(pfad) });
  }
}

/** Verteilte Besitz-Einheiten aus dem Manifest (unabhängig vom Sync-Stand), `null` bei fehlendem oder kaputtem Manifest (fail-closed). */
function besitzEinheiten(rootDir) {
  const voll = join(rootDir, ...MANIFEST_PFAD.split("/"));
  const geladen = manifestAusText(existsSync(voll) ? readFileSync(voll, "utf8") : null);
  if (geladen.fehler !== undefined) return null; // fehlt, kein JSON, keine Liste
  const eintraege = geladen.manifest.eintraege;
  if (!eintraege.every((e) => e !== null && typeof e === "object")) return null; // kein Objekt: Manifest kaputt
  const einheiten = eintraege.filter(wirdVerteilt);
  return einheiten.every((e) => typeof e.pfad === "string") ? einheiten : null; // Eintrag ohne Pfad: Manifest kaputt
}

/** Bezieher-Ausnahme (#110): `null` = volle Prüfung (Factory-Repo, kaputter Sync-Stand, fehlendes oder kaputtes Manifest; fail-closed), sonst `{ spannen(file, text), istZiel(pfad) }`. */
function besitzAusnahme(rootDir) {
  if (liesSyncStand(rootDir).zustand !== "ok") return null;
  const einheiten = besitzEinheiten(rootDir);
  if (einheiten === null) return null;
  const istZiel = (pfad) => einheiten.some((e) => (istGanzeDatei(e) && e.pfad === pfad) || e.pfad.startsWith(pfad.endsWith("/") ? pfad : `${pfad}/`));
  return { spannen: (file, text) => besitzSpannen(einheiten, file, text), istZiel };
}

/** 7. Test-Pfade (#97): ein Backtick-Token `test/…` in der Doku muss existieren (Datei oder Ordner). Suffix `#…`/`:<zeile>` wird abgeschnitten, Platzhalter-Tokens (`<`, `*`, `{`) übersprungen. Ausgenommen: ADRs (Historie) und Dateien mit Datum im Namen. Im Bezieher (#110, `besitzAusnahme`) zählt ein Verweis aus verteilter Besitz-Einheit nur, wenn das Ziel selbst Besitz ist; Grenze: nur Ganz-Datei- und Block-Einheiten, JSON-Schlüssel-Einheiten nicht. Grenzen: der Testordner ist fest `test/`, der Datumsausschluss ist eine Heuristik (jedes Datum im Pfad), nackte Dateinamen und Markdown-Links prüft das nicht (Links: deadLinks). */
function auditTestPfade(rootDir, mdFiles, content) {
  const fehler = [];
  fuerDokuTexte(rootDir, mdFiles.map((f) => [f, true]), content, ({ f, text, still }) => {
    for (const m of text.matchAll(/`(test\/[^`\s]*)`/g)) {
      const pfad = m[1].replace(/[#:].*$/, "");
      if (/[<*{]/.test(pfad) || existsSync(join(rootDir, pfad)) || still(m.index, pfad)) continue;
      fehler.push({ file: f, pfad });
    }
  });
  return fehler;
}

/** ADR-Ordner aus scripts/docs-gen/config.json › adr.ordner (#97); ohne Config oder Eintrag `docs/adr`. Eine kaputte Config (kein JSON, kein Objekt) wirft eine Meldung (`leseConfigObjekt`). */
function adrOrdner(rootDir) {
  const cfg = "scripts/docs-gen/config.json";
  const wert = existsSync(join(rootDir, cfg)) ? leseConfigObjekt(rootDir, cfg, "Doku-Generator-Config").adr?.ordner : undefined;
  return typeof wert === "string" && wert !== "" ? wert : "docs/adr";
}

/** 6. ADR-Zeiger (#90): jede `*.md` unter docs/adr/fortschreibungen/ hat Namen, Kopfzeile und Zeiger im ADR; fehlt der Ordner, entfällt die Prüfung. */
function auditFortschreibungen(rootDir) {
  const adrDir = join(rootDir, adrOrdner(rootDir));
  const unter = join(adrDir, "fortschreibungen");
  if (!existsSync(unter)) return [];
  const adrs = Object.fromEntries(readdirSync(adrDir).filter((n) => /^\d{4}-.*\.md$/.test(n)).map((n) => [n, readFileSync(join(adrDir, n), "utf8")]));
  return readdirSync(unter)
    .filter((n) => isMd(n) && n !== "README.md")
    .flatMap((n) => fortschreibungsFehler(n, readFileSync(join(unter, n), "utf8"), adrs));
}

// ── CLI ────────────────────────────────────────────────────────────────────────
function main() {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);

  let audit;
  try {
    audit = auditDocDrift();
  } catch (e) {
    console.error(red(`✖ ${e instanceof Error ? e.message : String(e)}`));
    process.exit(1);
  }
  const { mdFiles, deadCommands, undocumentedScripts, deadLinks, deadAnchors, verifyChainViolations, fortschreibungsFehler: adrFehler, testPfadFehler, abschnittFehler } = audit;

  let bad = false;
  for (const c of deadCommands) {
    bad = true;
    console.error(red(`✖ Totes Kommando: „npm run ${c.script}" in ${c.file} existiert nicht in package.json.`));
  }
  for (const s of undocumentedScripts) {
    bad = true;
    console.error(
      red(
        `✖ Undokumentiertes Kern-Skript „${s}" — in AGENTS.md/README/docs/referenz/befehle.md erwähnen oder (mit Begründung) in scripts/check-docdrift.mjs › DOC_EXEMPT_SCRIPTS aufnehmen.`,
      ),
    );
  }
  for (const l of deadLinks) {
    bad = true;
    console.error(red(`✖ Toter Link: „${l.target}" in ${l.file} zeigt auf ${l.resolved} (existiert nicht).`));
  }
  for (const a of deadAnchors) {
    bad = true;
    console.error(red(`✖ Toter Anker: „${a.target}" in ${a.file} — Überschrift „#${a.anchor}" gibt es in ${a.resolved} nicht.`));
  }
  for (const v of verifyChainViolations) {
    bad = true;
    console.error(
      red(
        `✖ Veraltete verify-Kette in ${v.file}${v.missing.length ? ` — fehlende Gates: ${v.missing.join(", ")}` : ""}${v.extra.length ? ` — überzählige Gates: ${v.extra.join(", ")}` : ""}. Auf den Verweis „package.json › scripts.verify“ umstellen oder die Kette angleichen.`,
      ),
    );
  }

  for (const f of adrFehler) {
    bad = true;
    console.error(red(`✖ ADR-Fortschreibung: ${f}. Fix: Zeiger auf die Datei im ADR ergänzen bzw. Name und Kopfzeile angleichen.`));
  }

  for (const t of testPfadFehler) {
    bad = true;
    console.error(red(`✖ Toter Test-Pfad: „${t.pfad}" in ${t.file} existiert nicht. Auf einen vorhandenen Wächter umzeigen oder den Testbezug streichen (Erstbezug: ${factorySeiteIn(ROOT, "docs/erstbezug.md", "projektdateien")}).`));
  }

  for (const a of abschnittFehler) {
    bad = true;
    const was = a.art === "ziel"
      ? `Totes Verweisziel: „${a.pfad}" (${a.trenner} ${a.segment}) in ${a.file} existiert nicht. Verweis auf eine vorhandene Seite umstellen oder die Seite wiederherstellen.`
      : `Toter Abschnitt: „${a.segment}" (${a.pfad} ${a.trenner}) in ${a.file} — gibt es in ${a.ziel} weder als Überschrift noch als Fettdruck-Anfang. Fix: Verweis auf den heutigen Abschnitt umstellen, den Abschnittsnamen mit Satzzeichen abschließen oder die Überschrift wiederherstellen.`;
    console.error(red(`✖ ${was}`));
  }

  if (bad) {
    console.error(`\nHarness-Doku-Drift. Kommandos/Links/Anker in der Doku bzw. package.json angleichen.`);
    process.exit(1);
  }
  console.log(
    green(
      `✔ Harness-Doku deckt sich mit dem Code (${mdFiles.length} Markdown-Dateien, Kommandos/Links/Anker konsistent).`,
    ),
  );
}

if (istDirektaufruf(import.meta.url)) main();
