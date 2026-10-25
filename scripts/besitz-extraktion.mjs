// Extraktionsliste, Bezug und Test-Hülle (ADR 0022 F10): was außer dem Besitz ins Factory-Repo zieht, Struktur-Prüfung der Liste `.factory/extraktion.json`,
// Bezug eines Tests zum Besitz und die Test-Hülle. Node-Builtins, projekt-config-lib und besitz-lib (Ringe); besitz-lib importiert diese Datei nie (zyklenfrei).
import { posix } from "node:path";
import { PROJEKT_CONFIG } from "./projekt-config-lib.mjs";
import { NUR_FACTORY, RINGE } from "./besitz-lib.mjs";

// ── Extraktionsliste (ADR 0022 F10) ──────────────────────────────────────────
// `.factory/extraktion.json` legt geschlossen fest, was außer dem Besitz ins Factory-Repo zieht (Kern-Tests, Test-Hilfen,
// Fixtures, Infrastruktur, Factory-Seiten, Produkt-Wurzel) und was bleibt (`projekt-test`). Ein Eintrag hat genau eines von
// `muster` (Pfadmuster, `*` = ein Pfadsegment-Teil, nie über `/`) oder `ring` (nur `nur-factory`), dazu `art` und `grund`.

/** Pfad der Extraktionsliste. */
export const EXTRAKTION_PFAD = ".factory/extraktion.json";

const TEST_DATEI = /^test\/.*\.test\.ts$/;
/** Ist `pfad` eine Testdatei (unter `test/`, Endung `.test.ts`)? Die eine Regel für Liste und Fremd-Config-Probe. */
export const istTestDatei = (pfad) => TEST_DATEI.test(pfad);
const IN_TEST = /^test\//;
const CODE_DATEI = /\.(?:mjs|cjs|js|ts)$/;
/** Daten der Kern-Skripte unter `docs/`, die als Infrastruktur oder Anteil ziehen dürfen: die Diagramm-Vorlagen der Doku-Generatoren und das Inventar der Eigenbauten (ein Kern-Test liest es). */
const DOCS_DATEN = /^docs\/(?:diagramme\/[^/]+\.mmd|harness-inventar\.md)$/;

/**
 * Arten der Liste und der Ort, an dem eine Datei dieser Art liegen darf (`null`: nur als Ring-Eintrag). Geschlossen. `quelle` ist die Quellwurzel
 * des Projekts (`struktur.quelle` der Projekt-Config): Infrastruktur liegt weder in `test/`, `docs/` noch dort (einzige Ausnahmen in `docs/`: `docs/diagramme/*.mmd` und `docs/harness-inventar.md`); der Kern kennt keinen festen Namen.
 */
export const extraktionsArten = (quelle) => {
  const ausserTestDocsQuelle = (p) => !["test", "docs", quelle].some((d) => p.startsWith(`${d}/`));
  return {
    "kern-test": (p) => TEST_DATEI.test(p),
    "projekt-test": (p) => TEST_DATEI.test(p),
    "test-hilfe": (p) => IN_TEST.test(p) && !TEST_DATEI.test(p) && CODE_DATEI.test(p),
    fixture: (p) => IN_TEST.test(p) && !TEST_DATEI.test(p),
    infrastruktur: (p) => ausserTestDocsQuelle(p) || DOCS_DATEN.test(p),
    "infrastruktur-anteil": (p) => ausserTestDocsQuelle(p) || DOCS_DATEN.test(p),
    "factory-seite": (p) => /^docs\/.*\.md$/.test(p),
    "produkt-wurzel": (p) => /^\.factory\/produkt\/[^/]+$/.test(p),
    "nur-factory": null,
  };
};

/** Namen der Arten (hängen nicht von der Quellwurzel ab). */
const ART_NAMEN = Object.keys(extraktionsArten(""));

/** Arten, die ins Factory-Repo ziehen: alle außer `projekt-test` (bleibt im Projekt). */
export const MITZIEHEND = ART_NAMEN.filter((a) => a !== "projekt-test");

/** Regex eines Pfadmusters: `*` steht für beliebig viele Zeichen außer `/`, alles andere wörtlich (jedes Zeichen außer Buchstaben, Ziffern und `_` wird maskiert). */
export const musterRegex = (muster) =>
  new RegExp(`^${muster.split("*").map((t) => [...t].map((c) => (/\w/.test(c) ? c : `\\${c}`)).join("")).join("[^/]*")}$`);

// Vorkompilierte Muster je Liste (Schlüssel: das Listen-Objekt); ändert sich die Eintragsliste (anderes Array oder andere Länge), wird neu kompiliert.
const KOMPILIERT = new WeakMap();
const kompilierteMuster = (liste) => {
  const eintraege = liste.eintraege ?? [];
  const alt = KOMPILIERT.get(liste);
  if (alt && alt.eintraege === eintraege && alt.laenge === eintraege.length) return alt.muster;
  const muster = eintraege.filter((x) => typeof x.muster === "string").map((x) => ({ re: musterRegex(x.muster), art: x.art }));
  KOMPILIERT.set(liste, { eintraege, laenge: eintraege.length, muster });
  return muster;
};

/** Art der Datei laut Muster-Einträgen der Liste (`null`: nicht eingeordnet); die Muster sind je Liste einmal kompiliert. */
export function artVon(liste, pfad) {
  return kompilierteMuster(liste).find((m) => m.re.test(pfad))?.art ?? null;
}

/** Meldungen (leer = grün): Struktur der Liste gegen die getrackten Dateien, den Besitz (Einträge des Manifests) und die Ring-Tabelle. `quelle` ist die Quellwurzel des Projekts (`struktur.quelle`). */
export function pruefeExtraktion(liste, { getrackt, besitz, quelle, ringe = RINGE, nurFactory = NUR_FACTORY }) {
  if (typeof quelle !== "string" || quelle === "") throw new Error("pruefeExtraktion: quelle (struktur.quelle der Projekt-Config) fehlt");
  const arten = extraktionsArten(quelle);
  const out = [];
  if (liste.version !== 1) out.push(`${EXTRAKTION_PFAD}: version muss 1 sein`);
  const eintraege = Array.isArray(liste.eintraege) ? liste.eintraege : [];
  if (!Array.isArray(liste.eintraege)) out.push(`${EXTRAKTION_PFAD}: eintraege fehlt`);
  const besitzPfade = new Set(besitz.map((e) => e.pfad));
  const treffer = new Map();
  const ringEintraege = [];
  for (const e of eintraege) {
    const id = e.muster ?? (e.ring === undefined ? "?" : `ring ${e.ring}`);
    const hatMuster = typeof e.muster === "string";
    const hatRing = typeof e.ring === "string";
    if (hatMuster === hatRing) {
      out.push(`${id}: genau eines von muster oder ring angeben`);
      continue;
    }
    if (!Object.hasOwn(arten, e.art)) out.push(`${id}: unbekannte art '${e.art}' (erlaubt: ${ART_NAMEN.join(", ")})`);
    if (typeof e.grund !== "string" || e.grund.trim() === "") out.push(`${id}: grund fehlt`);
    if (hatRing) {
      ringEintraege.push(e.ring);
      if (e.art !== "nur-factory") out.push(`${id}: ein Ring-Eintrag hat die art nur-factory`);
      if (!ringe.includes(e.ring)) out.push(`${id}: unbekannter Ring`);
      else if (!nurFactory.includes(e.ring)) out.push(`${id}: der Ring ist nicht nur Factory, sein Besitz wird ohnehin verteilt, Eintrag entfernen`);
      continue;
    }
    if (e.art === "nur-factory") out.push(`${id}: nur-factory gilt nur als Ring-Eintrag`);
    const re = musterRegex(e.muster);
    const trefferEintrag = getrackt.filter((p) => re.test(p));
    if (trefferEintrag.length === 0) out.push(`${id}: Eintrag ohne Treffer (keine getrackte Datei), entfernen`);
    const ort = arten[e.art];
    for (const p of trefferEintrag) {
      treffer.set(p, [...(treffer.get(p) ?? []), e.muster]);
      if (besitzPfade.has(p)) out.push(`${id}: trifft die Besitz-Datei ${p}, Besitz zieht ohnehin um`);
      if (typeof ort === "function" && !ort(p)) out.push(`${id}: ${p} liegt nicht an einem Ort der art ${e.art}`);
    }
  }
  for (const [p, muster] of treffer) if (muster.length > 1) out.push(`${p}: von mehreren Einträgen getroffen (${muster.join(", ")})`);
  for (const r of nurFactory) if (!ringEintraege.includes(r)) out.push(`ring ${r}: Ring ist nur Factory, braucht einen Ring-Eintrag mit art nur-factory`);
  for (const p of getrackt) {
    if (/^\.factory\/produkt\/[^/]+$/.test(p) && artVon(liste, p) !== "produkt-wurzel") out.push(`${p}: Wurzel-Datei des Factory-Repos, als produkt-wurzel eintragen`);
  }
  return out;
}

// ── Bezug und Test-Hülle (ADR 0022 F10, Teil 5; #1875, #1888) ─────────────────
// Bezug eines Tests: ein relativer Import, der auf eine Ganz-Datei-Besitz-Einheit auflöst, oder die wörtliche Nennung eines Besitz-Pfads im Text.
// Die Hülle verlangt, dass jeder lokale Import und jeder Lese-Bezug eines mitziehenden Test-Codes auf Besitz, die Projekt-Config oder eine Datei einer mitziehenden
// Art zeigt. Erlaubte Ziel-Arten sind alle in `MITZIEHEND`, also auch `infrastruktur-anteil` (die Datei bleibt im Projekt, zieht aber als Vorlage mit:
// ein Kern-Test darf `package.json` oder die ESLint-Konfiguration lesen) und `factory-seite` (die Seite zieht als Kopie mit). Verboten bleiben `projekt-test` und
// eine nicht eingeordnete Datei; `nur-factory` hat keine Muster-Einträge und kommt als Ziel nicht vor. Grenzen (fail-open): ein zusammengesetzter Pfad
// (`join("scripts", name)`) und ein per `readFileSync` gelesener Projekt-Text sind unsichtbar; ein unauflösbarer Spezifizierer zählt nicht.

const IMPORT_ENDUNGEN = ["", ".ts", ".mjs", ".cjs", ".js"];

/**
 * Alle Importspezifizierer eines Quelltexts (ohne Auflösung, mit `node:*` und Paketnamen): statische `import`/`export … from` (auch Side-Effect), `import("…")`,
 * `require("…")`, `createRequire(…)("…")` und die großzügige Aufruf-Form `)("…")` (fail-closed). Nicht erkannt: ein dynamischer Pfad (`require(pfad)`).
 */
export function importeAus(text) {
  return [
    ...new Set([
      ...[...text.matchAll(/^\s*(?:import|export)\s+(?:[^;]*?\sfrom\s+)?["']([^"']+)["']/gm)].map((m) => m[1]),
      ...[...text.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...text.matchAll(/\bimport\s+["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
      ...[...text.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
      ...[...text.matchAll(/\bcreateRequire\([^)]*\)\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
      ...[...text.matchAll(/\)\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
    ]),
  ];
}

/** Relative Spezifizierer (`./`, `../`) eines Quelltexts. Grenze (fail-closed, keine Kommentar-Erkennung): ein require-Aufruf mit relativem Pfad in einem Kommentar zählt wie ein echter Import. */
export const relativeImporte = (text) => [...new Set(importeAus(text).filter((s) => /^\.{1,2}\//.test(s)))];

/** Auflösung eines relativen Spezifizierers auf eine getrackte Datei (roh, dann `.ts`, `.mjs`, `.cjs`, `.js`); keine Datei: `null`. */
export function zielDatei(von, spec, getrackt) {
  const roh = posix.normalize(posix.join(posix.dirname(von), spec));
  for (const e of IMPORT_ENDUNGEN) if (getrackt.has(roh + e)) return roh + e;
  return null;
}

/** Testdateien mit Bezug zum Besitz: Import, der auf eine Ganz-Datei-Besitz-Einheit auflöst, oder deren Pfad wörtlich im Text. */
export function bezugsTests(getrackt, lies, ganzerBesitz) {
  const menge = new Set(getrackt);
  return getrackt.filter((von) => {
    if (!TEST_DATEI.test(von)) return false;
    const text = lies(von) ?? "";
    if (relativeImporte(text).some((spec) => ganzerBesitz.has(zielDatei(von, spec, menge) ?? ""))) return true;
    return [...ganzerBesitz].some((p) => text.includes(p));
  });
}

/** Meldungen (leer = grün): jede Testdatei mit Bezug ist als `kern-test` oder `projekt-test` eingeordnet. */
export function zuordnungsLuecken(liste, bezug) {
  return bezug
    .filter((p) => !["kern-test", "projekt-test"].includes(artVon(liste, p) ?? ""))
    .map((p) => `${p}: in ${EXTRAKTION_PFAD} als kern-test (zieht ins Factory-Repo) oder projekt-test (bleibt) eintragen`);
}

const LITERAL = /(?:"[^"\\\n]*"|'[^'\\\n]*'|`[^`$\\\n]*`)/;
const LITERAL_FOLGE = new RegExp(`${LITERAL.source}(?:\\s*,\\s*${LITERAL.source})*`, "g");

/** Lese-Bezüge: getrackte Dateien unter `test/`, die ein String-Literal einer Test-Datei benennt, relativ zu ihrem Ordner oder zur Wurzel: das Literal selbst
 *  (`join(__dirname, "./fixtures/x.json")`, `new URL("../fixtures/x.json", …)`) oder aufeinanderfolgende Literale eines Aufrufs, mit `/` verbunden
 *  (`join(WURZEL, "test", "fixtures", "x.json")`). Grenze: ein Pfad aus Variablen oder ein Literal außerhalb von `test/` bleibt unsichtbar (Projekt-Texte). */
export function lesebezuege(von, text, getrackt) {
  const kandidaten = new Set();
  const code = text.split("\n").filter((z) => !/^\s*(?:\/\/|\/\*|\*)/.test(z)).join("\n");
  for (const folge of code.matchAll(LITERAL_FOLGE)) {
    const teile = [...folge[0].matchAll(new RegExp(LITERAL.source, "g"))].map((m) => m[0].slice(1, -1)).filter((t) => t !== "");
    for (let i = 0; i < teile.length; i++) {
      for (let j = i; j < Math.min(teile.length, i + 6); j++) kandidaten.add(teile.slice(i, j + 1).join("/"));
    }
  }
  const out = new Set();
  for (const c of kandidaten) {
    for (const basis of [posix.dirname(von), ""]) {
      const p = posix.normalize(posix.join(basis, c));
      if (p.startsWith("test/") && p !== von && getrackt.has(p)) out.add(p);
    }
  }
  return [...out];
}

/** Lokale Importe und Lese-Bezüge (`lesebezuege`) aller mitziehenden Test-Dateien (Art `kern-test`, `test-hilfe`, `fixture` mit Code-Endung), die weder auf Besitz
 *  noch auf die Projekt-Config noch auf einen Eintrag mit mitziehender Art zeigen: "<von> -> <nach>". Dateien ohne Text werden übersprungen. */
export function huellenVerstoesse(liste, getrackt, lies, ganzerBesitz) {
  const menge = new Set(getrackt);
  const out = [];
  for (const von of getrackt) {
    const art = artVon(liste, von) ?? "";
    if (!["kern-test", "test-hilfe", "fixture"].includes(art) || !CODE_DATEI.test(von)) continue;
    const text = lies(von);
    if (text === null) continue;
    const ziele = [...relativeImporte(text).map((spec) => zielDatei(von, spec, menge)), ...lesebezuege(von, text, menge)];
    for (const nach of ziele) {
      if (nach === null) continue;
      const erlaubt = ganzerBesitz.has(nach) || nach === PROJEKT_CONFIG || MITZIEHEND.includes(artVon(liste, nach) ?? "");
      if (!erlaubt && !out.includes(`${von} -> ${nach}`)) out.push(`${von} -> ${nach}`);
    }
  }
  return out;
}

/** Meldungen (leer = grün) der Test-Hülle: Verstoß ohne Ausnahme, Ausnahme ohne Ticket, Ausnahme auf die Projekt-Quelle, veraltete Ausnahme. `quelle` ist die Quellwurzel des Projekts. */
export function testHuelle(verstoesse, ausnahmen, quelle) {
  const out = [];
  for (const v of verstoesse) {
    if (v in ausnahmen) continue;
    const nach = v.split(" -> ")[1] ?? "";
    out.push(
      nach.startsWith(`${quelle}/`)
        ? `${v}: ${quelle}/ ist Projektcode: den Test als projekt-test einordnen oder die Abhängigkeit durch ein Fixture ersetzen`
        : `${v}: Ziel als test-hilfe oder fixture eintragen (wenn projektfrei), den Import entfernen oder den Test als projekt-test einordnen`,
    );
  }
  for (const [id, grund] of Object.entries(ausnahmen)) {
    if (!/#\d+/.test(grund)) out.push(`${id}: Ausnahme ohne Ticket (#<nr>) im Grund`);
    if ((id.split(" -> ")[1] ?? "").startsWith(`${quelle}/`)) out.push(`${id}: eine Ausnahme auf ${quelle}/ ist nie erlaubt`);
    if (!verstoesse.includes(id)) out.push(`${id}: Ausnahme veraltet (Import entfällt oder Ziel ist eingetragen), Eintrag entfernen`);
  }
  return out;
}
