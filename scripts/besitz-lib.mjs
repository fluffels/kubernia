// Besitz-Manifest-Leser und Bearbeitungs-Primitive (ADR 0022 F9): Einheiten des Besitz-Manifests `.factory/besitz.json`
// (ganze Datei, Markdown-Block zwischen Markern, JSON-Schlüssel der obersten Ebene) lesen, prüfen, hashen und setzen.
// Dazu die Projektwert-Stellen (ADR 0022 F3f): Block und Frontmatter-Zeile, die aus der Config gerendert werden; Hash und Wächter
// rechnen auf dem Text mit geleerten Werten. Node-Builtins sowie projekt-config-lib und skill-pfade; Sync-Werkzeug, Drift-Gate und Kern-Wächter teilen diese eine Auslegung.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { altEnvPraefix, PROJEKT_CONFIG } from "./projekt-config-lib.mjs";
import { QUELL_VERZEICHNIS, ZEIGER_WURZEL } from "./skill-pfade.mjs";
import { escapeRegex } from "./ticket-namen.mjs";

/** Ring-Importregel (ADR 0029): Ring des Importeurs -> Ringe, deren Besitz er lokal importieren darf. Ein weiterer Ring ist eine Zeile. */
export const RING_IMPORTE = {
  kern: ["kern"],
  "kern-nach-entkopplung": ["kern", "kern-nach-entkopplung"],
  oberflaeche: ["kern", "kern-nach-entkopplung", "oberflaeche"],
};

/** Alle Ringe: die Schlüssel der Importregel (eine Quelle). */
export const RINGE = Object.keys(RING_IMPORTE);

/** Ringe, die der Factory gehören und nie in ein Projekt verteilt werden (Deny-List: ein unbekannter Ring wird geprüft und verteilt). */
export const NUR_FACTORY = ["oberflaeche"];

/** Wird die Einheit in Projekte verteilt (Sync) und dort auf Drift geprüft? */
export const wirdVerteilt = (e) => !NUR_FACTORY.includes(e.ring);

/** Ist die Einheit eine ganze Datei (kein Block, kein JSON-Schlüssel)? */
export const istGanzeDatei = (e) => e.block === undefined && e.schluessel === undefined;

// ── Extraktionsliste (ADR 0022 F10) ──────────────────────────────────────────
// `.factory/extraktion.json` legt geschlossen fest, was außer dem Besitz ins Factory-Repo zieht (Kern-Tests, Test-Hilfen,
// Fixtures, Infrastruktur, Factory-Seiten, Produkt-Wurzel) und was bleibt (`projekt-test`). Ein Eintrag hat genau eines von
// `muster` (Pfadmuster, `*` = ein Pfadsegment-Teil, nie über `/`) oder `ring` (nur `nur-factory`), dazu `art` und `grund`.

/** Pfad der Extraktionsliste. */
export const EXTRAKTION_PFAD = ".factory/extraktion.json";

const TEST_DATEI = /^test\/.*\.test\.ts$/;
const IN_TEST = /^test\//;
const CODE_DATEI = /\.(?:mjs|cjs|js|ts)$/;

/**
 * Arten der Liste und der Ort, an dem eine Datei dieser Art liegen darf (`null`: nur als Ring-Eintrag). Geschlossen. `quelle` ist die Quellwurzel
 * des Projekts (`struktur.quelle` der Projekt-Config): Infrastruktur liegt weder in `test/`, `docs/` noch dort; der Kern kennt keinen festen Namen.
 */
export const extraktionsArten = (quelle) => {
  const ausserTestDocsQuelle = (p) => !["test", "docs", quelle].some((d) => p.startsWith(`${d}/`));
  return {
    "kern-test": (p) => TEST_DATEI.test(p),
    "projekt-test": (p) => TEST_DATEI.test(p),
    "test-hilfe": (p) => IN_TEST.test(p) && !TEST_DATEI.test(p) && CODE_DATEI.test(p),
    fixture: (p) => IN_TEST.test(p) && !TEST_DATEI.test(p),
    infrastruktur: ausserTestDocsQuelle,
    "infrastruktur-anteil": ausserTestDocsQuelle,
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

export const markerStart = (id) => `<!-- factory-besitz:start ${id} -->`;
export const markerEnde = (id) => `<!-- factory-besitz:ende ${id} -->`;

/** Der Projekt-Block in AGENTS.md: ab dieser Marker-Zeile steht Projektinhalt, den die Verteilung nie anfasst. */
export const PROJEKT_BLOCK_START = "<!-- factory-projekt:start -->";
/** Ende des Projekt-Blocks (Gegenstück zu `PROJEKT_BLOCK_START`). */
export const PROJEKT_BLOCK_ENDE = "<!-- factory-projekt:ende -->";

/** Zeilenenden auf LF (Hash und Vergleich sind CRLF-neutral). */
export const normalisiereEol = (text) => text.replace(/\r\n/g, "\n");

/** Zeilenende-Stil eines Textes: CRLF, sobald eines vorkommt, sonst LF. */
export const eolVon = (text) => (text.includes("\r\n") ? "\r\n" : "\n");

export function einheitId(e) {
  if (e.block !== undefined) return `${e.pfad}#${e.block}`;
  if (e.schluessel !== undefined) return `${e.pfad}#/${e.schluessel}`;
  return e.pfad;
}

const zaehleVorkommen = (text, s) => text.split(s).length - 1;

/** Text der Einheit oder `null`, wenn Block/Schlüssel nicht auflösbar ist. */
export function einheitText(e, text) {
  if (e.block !== undefined) {
    const a = text.indexOf(markerStart(e.block));
    const b = text.indexOf(markerEnde(e.block));
    if (a < 0 || b < a) return null;
    return text.slice(a, b + markerEnde(e.block).length);
  }
  if (e.schluessel !== undefined) {
    try {
      const j = JSON.parse(text);
      return e.schluessel in j ? JSON.stringify(j[e.schluessel]) : null;
    } catch {
      return null;
    }
  }
  return text;
}

/** Ein Manifest-Pfad bleibt im Projekt: relativ, Schrägstrich-Form, keine leeren oder `..`-Segmente. */
export function pfadSicher(pfad) {
  if (typeof pfad !== "string" || pfad === "" || pfad.startsWith("/") || pfad.includes("\\") || /^[A-Za-z]:/.test(pfad)) return false;
  return pfad.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

/** Manifest-Fehler (leer = gültig). `lies` liefert den Dateitext oder `null`. */
export function pruefeManifest(m, lies) {
  const out = [];
  if (m.version !== 1) out.push(`version ${String(m.version)} unbekannt (erwartet 1)`);
  const ids = new Set();
  const ganze = new Set();
  const teile = new Set();
  for (const e of m.eintraege) {
    const id = einheitId(e);
    if (!pfadSicher(e.pfad)) {
      out.push(`${id}: Pfad unsicher (absolut, '..', Backslash oder leeres Segment)`);
      continue;
    }
    if (ids.has(id)) out.push(`${id}: doppelte Einheit`);
    ids.add(id);
    if (!RINGE.includes(e.ring)) out.push(`${id}: unbekannter Ring '${e.ring}'`);
    if (e.quelle.trim() === "") out.push(`${id}: quelle fehlt`);
    if (e.block !== undefined && e.schluessel !== undefined) out.push(`${id}: block und schluessel zugleich`);
    if (istGanzeDatei(e)) ganze.add(e.pfad);
    else teile.add(e.pfad);
    const text = lies(e.pfad);
    if (text === null) {
      out.push(`${id}: Pfad existiert nicht`);
      continue;
    }
    if (e.block !== undefined) {
      const na = zaehleVorkommen(text, markerStart(e.block));
      const nb = zaehleVorkommen(text, markerEnde(e.block));
      if (na !== 1 || nb !== 1) out.push(`${id}: Marker müssen je genau einmal stehen (start ${na}, ende ${nb})`);
      else if (einheitText(e, text) === null) out.push(`${id}: Ende-Marker steht vor dem Start-Marker`);
    } else if (e.schluessel !== undefined && einheitText(e, text) === null) {
      out.push(`${id}: JSON-Schlüssel fehlt oder Datei ist kein gültiges JSON`);
    }
  }
  for (const p of ganze) if (teile.has(p)) out.push(`${p}: Datei ganz und als Teil-Einheit gelistet`);
  return out;
}

// ── Berechtigungs- und Sandbox-Ergänzung (#1874, #1888, ADR 0022 Fortschreibungen 1874 und 1888) ─────────────
// Die einzigen Einheiten mit Projekt-Ergänzung (`ERGAENZBARE_EINHEITEN`): Hash und Sync rechnen auf dem Kern-Anteil (der Wert ohne die Einträge der Ergänzung),
// die Ergänzung steht je Liste als Ende der Liste. `permissions` hat die Listen allow, ask und deny (Einträge sind Strings), `sandbox` die Listen
// `network.allowedDomains` (Strings) und `credentials.envVars` (Objekte, Vergleich über `name`); eine Ergänzung sperrt oder öffnet nur, was die Befunde zulassen. Bekannte Muster der Aufhebe-Prüfung (`ergaenzungsBefunde`): ein allow-Eintrag A hebt eine
// Regel R aus deny oder ask auf, wenn A === R; wenn R eine Server-Regel `mcp__<server>` ohne Tool-Teil ist und A mit `R + "__"` beginnt;
// wenn R auf `*` endet und A mit R ohne `*` beginnt; wenn A auf `*` endet und R mit A ohne `*` beginnt (allow `mcp__*` deckt jede Regel mit dem Präfix). Grenze: andere Platzhalterformen werden nicht erkannt. Legitim bleibt die Kombination
// „allow Server-Regel, ask oder deny einzelnes Tool“.

/** Die Einheiten, die ein Projekt über seine Config ergänzen darf (geschlossene Liste): `berechtigungen` ergänzt `permissions`, `sandbox` ergänzt `sandbox`. */
export const ERGAENZBARE_EINHEITEN = [".claude/settings.json#/permissions", ".claude/settings.json#/sandbox"];

const SANDBOX_EINHEIT = ERGAENZBARE_EINHEITEN[1];

/** Die Listen der Sandbox-Ergänzung: Schlüssel in der Ergänzung, Pfad im Wert und der Name, über den Einträge verglichen werden. */
export const SANDBOX_LISTEN = {
  allowedDomains: { pfad: ["network", "allowedDomains"], name: (x) => x },
  envVars: { pfad: ["credentials", "envVars"], name: (x) => x?.name },
};
const SANDBOX_NAMEN = Object.keys(SANDBOX_LISTEN);

/** Die Regel-Listen der Ergänzung (die Namen von Claude Code). */
export const ERGAENZUNG_LISTEN = ["allow", "ask", "deny"];

/** Eine leere Ergänzung (frisch je Aufruf): die Listen von `permissions` und der Zweig `sandbox`. */
export const leereErgaenzung = () => ({ allow: [], ask: [], deny: [], sandbox: { allowedDomains: [], envVars: [] } });

/** Zahl der Einträge der Ergänzung für die Einheit `e` (alle ihre Listen). */
export const ergaenzungsAnzahlVon = (e, erg) =>
  istSandbox(e) ? SANDBOX_NAMEN.reduce((n, l) => n + (erg?.sandbox?.[l]?.length ?? 0), 0) : ERGAENZUNG_LISTEN.reduce((n, l) => n + (erg?.[l]?.length ?? 0), 0);

/** Ist die Einheit eine ergänzbare? */
export const istErgaenzbar = (e) => ERGAENZBARE_EINHEITEN.includes(einheitId(e));

const istSandbox = (e) => einheitId(e) === SANDBOX_EINHEIT;
const istObjekt = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const sandboxListe = (sb, l) => {
  const [a, b] = SANDBOX_LISTEN[l].pfad;
  const v = sb?.[a]?.[b];
  return Array.isArray(v) ? v : [];
};

/** Pur: der Kern-Anteil von `sandbox`: je Liste ohne die Einträge der Ergänzung (Vergleich über den Namen); eine leere Liste und ein dadurch leerer Zweig entfallen. Ein Nicht-Objekt bleibt unverändert. */
export function kernAnteilSandbox(sb, erg) {
  if (!istObjekt(sb)) return sb;
  const aus = { ...sb };
  for (const l of SANDBOX_NAMEN) {
    const [a, b] = SANDBOX_LISTEN[l].pfad;
    if (!Array.isArray(sb[a]?.[b])) continue;
    const mit = new Set((erg?.[l] ?? []).map(SANDBOX_LISTEN[l].name));
    const rest = sb[a][b].filter((x) => !mit.has(SANDBOX_LISTEN[l].name(x)));
    const zweig = { ...aus[a] };
    if (rest.length === 0) delete zweig[b];
    else zweig[b] = rest;
    if (Object.keys(zweig).length === 0) delete aus[a];
    else aus[a] = zweig;
  }
  return aus;
}

/** Pur: Kern-Anteil von `sandbox` plus Ergänzung, je Liste hinten angehängt; fehlende Zweige werden angelegt. */
export function mitErgaenzungSandbox(kern, erg) {
  const aus = { ...kern };
  for (const l of SANDBOX_NAMEN) {
    const neu = erg?.[l] ?? [];
    if (neu.length === 0) continue;
    const [a, b] = SANDBOX_LISTEN[l].pfad;
    aus[a] = { ...aus[a], [b]: [...sandboxListe(kern, l), ...neu] };
  }
  return aus;
}

/** Pur: Befunde der Sandbox-Ergänzung gegen den zusammengesetzten Wert `sb` (leer = in Ordnung): Eintrag fehlt, steht nicht am Listenende oder doppelt (auch ein Kern-Eintrag gleichen Namens: eine Ergänzung darf ihn nicht überschreiben),
 *  eine Domain besteht nur aus Platzhaltern (öffnet jede Domain), ein envVars-Eintrag der Ergänzung sperrt nicht (`mode` ist nicht `deny`). */
export function sandboxErgaenzungsBefunde(sb, erg) {
  const out = [];
  for (const l of SANDBOX_NAMEN) {
    const neu = erg?.[l] ?? [];
    if (neu.length === 0) continue;
    const { pfad, name } = SANDBOX_LISTEN[l];
    const wo = `sandbox.${pfad.join(".")}`;
    const ist = sandboxListe(sb, l).map(name);
    const neuNamen = neu.map(name);
    const fehlend = neuNamen.filter((n) => !ist.includes(n));
    for (const n of fehlend) out.push(`${wo}: Ergänzung „${n}“ fehlt`);
    for (const n of neuNamen) {
      if (ist.filter((y) => y === n).length > 1) out.push(`${wo}: „${n}“ steht doppelt (Kern-Anteil und Ergänzung); eine Ergänzung darf einen Kern-Eintrag nicht überschreiben`);
    }
    if (fehlend.length === 0 && neuNamen.some((n, i) => ist[ist.length - neuNamen.length + i] !== n)) out.push(`${wo}: die Ergänzung muss als Ende der Liste stehen, in der Reihenfolge der Config`);
  }
  for (const d of erg?.allowedDomains ?? []) {
    if (/^[*.]+$/.test(d)) out.push(`sandbox.network.allowedDomains: Ergänzung „${d}“ erlaubt jede Domain`);
  }
  for (const v of erg?.envVars ?? []) {
    if (v?.mode !== "deny") out.push(`sandbox.credentials.envVars: Ergänzung „${v?.name}“ muss mode deny haben (eine Ergänzung sperrt nur)`);
  }
  return out;
}

/** Pur: Kern-Anteil der ergänzbaren Einheit `e` aus ihrem Wert (`erg` ist die Ergänzung des Projekts). */
export const kernAnteilVon = (e, wert, erg) => (istSandbox(e) ? kernAnteilSandbox(wert, erg?.sandbox) : kernAnteil(wert, erg));

/** Pur: Kern-Anteil der Einheit `e` plus Ergänzung. */
export const mitErgaenzungVon = (e, kern, erg) => (istSandbox(e) ? mitErgaenzungSandbox(kern, erg?.sandbox) : mitErgaenzung(kern, erg));

/** Pur: Befunde der Ergänzung der Einheit `e` gegen ihren zusammengesetzten Wert. */
export const ergaenzungsBefundeVon = (e, wert, erg) => (istSandbox(e) ? sandboxErgaenzungsBefunde(wert, erg?.sandbox) : ergaenzungsBefunde(wert, erg));

/** Pur: der Kern-Anteil von `permissions`: je Liste ohne die Einträge der Ergänzung (mengenbasiert); eine leere Liste entfällt immer
 *  (leer gilt wie fehlend, sonst unterschiede sich Quelle und Ziel nur durch `ask: []`). Ein Nicht-Objekt bleibt unverändert. */
export function kernAnteil(perm, erg) {
  if (perm === null || typeof perm !== "object" || Array.isArray(perm)) return perm;
  const aus = { ...perm };
  for (const l of ERGAENZUNG_LISTEN) {
    if (!Array.isArray(perm[l])) continue;
    const mit = new Set(erg?.[l] ?? []);
    const rest = perm[l].filter((x) => !mit.has(x));
    if (rest.length === 0) delete aus[l];
    else aus[l] = rest;
  }
  return aus;
}

/** Pur: Kern-Anteil plus Ergänzung, je Liste hinten angehängt; eine fehlende Liste wird angelegt. */
export function mitErgaenzung(kern, erg) {
  const aus = { ...kern };
  for (const l of ERGAENZUNG_LISTEN) {
    const neu = erg?.[l] ?? [];
    if (neu.length > 0) aus[l] = [...(kern[l] ?? []), ...neu];
  }
  return aus;
}

/** Pur: hebt der allow-Eintrag `a` die deny- oder ask-Regel `r` auf (Muster im Kopfkommentar dieses Abschnitts)? */
function hebtAuf(a, r) {
  if (a === r) return true;
  if (r.startsWith("mcp__") && !r.slice(5).includes("__") && a.startsWith(`${r}__`)) return true;
  if (r.endsWith("*") && a.startsWith(r.slice(0, -1))) return true;
  return a.endsWith("*") && r.startsWith(a.slice(0, -1));
}

/**
 * Pur: Befunde der Ergänzung gegen den zusammengesetzten Wert `perm` (leer = in Ordnung): ein Eintrag fehlt in seiner Liste, die Ergänzung steht
 * nicht als Ende der Liste, ein Eintrag steht doppelt (auch im Kern-Anteil), oder ein allow der Ergänzung hebt ein deny oder ask auf.
 */
export function ergaenzungsBefunde(perm, erg) {
  const out = [];
  for (const l of ERGAENZUNG_LISTEN) {
    const neu = erg?.[l] ?? [];
    if (neu.length === 0) continue;
    const ist = Array.isArray(perm?.[l]) ? perm[l] : [];
    const fehlend = neu.filter((x) => !ist.includes(x));
    for (const x of fehlend) out.push(`permissions.${l}: Ergänzung „${x}“ fehlt`);
    for (const x of neu) if (ist.filter((y) => y === x).length > 1) out.push(`permissions.${l}: „${x}“ steht doppelt (Kern-Anteil und Ergänzung)`);
    if (fehlend.length === 0 && neu.some((x, i) => ist[ist.length - neu.length + i] !== x)) out.push(`permissions.${l}: die Ergänzung muss als Ende der Liste stehen, in der Reihenfolge der Config`);
  }
  const sperren = [...(perm?.deny ?? []), ...(perm?.ask ?? [])];
  for (const a of erg?.allow ?? []) {
    const r = sperren.find((s) => hebtAuf(a, s));
    if (r !== undefined) out.push(`permissions.allow: Ergänzung „${a}“ hebt die Regel „${r}“ aus deny oder ask auf`);
  }
  return out;
}

/** Einheitentext, LF-normalisiert und (außer bei JSON-Schlüsseln) mit geleerten Projektwerten; `null`, wenn die Einheit nicht
 *  auflösbar ist oder ein Projektwert-Marker kaputt ist. Grundlage für Hash und Literal-Zählung. Die ergänzbare Einheit rechnet
 *  auf dem Kern-Anteil gegen `erg` (die Ergänzung des Projekts, Standard leer). */
export function normalisierterEinheitText(e, text, erg = leereErgaenzung()) {
  const t = einheitText(e, text);
  if (t === null) return t;
  if (istErgaenzbar(e)) return JSON.stringify(kernAnteilVon(e, JSON.parse(t), erg));
  if (e.schluessel !== undefined) return t;
  try {
    return leereProjektwerte(normalisiereEol(t));
  } catch {
    return null;
  }
}

/** `sha256:<hex>` über den normalisierten Einheitentext, `null` wenn die Einheit nicht auflösbar ist. */
export function einheitHash(e, text, erg = leereErgaenzung()) {
  const t = normalisierterEinheitText(e, text, erg);
  if (t === null) return null;
  return `sha256:${createHash("sha256").update(normalisiereEol(t)).digest("hex")}`;
}

/** `sha256:<hex>` über einen Text, LF-normalisiert. */
export function textHash(text) {
  return `sha256:${createHash("sha256").update(normalisiereEol(text)).digest("hex")}`;
}

// ── JSON-Schlüssel der obersten Ebene als Textbereich ─────────────────────────

const WS = /\s/;

function ueberspringeWs(t, i) {
  while (i < t.length && WS.test(t[i])) i++;
  return i;
}

function stringEnde(t, i) {
  // t[i] ist das öffnende Anführungszeichen; Rückgabe: Index nach dem schließenden.
  i++;
  while (i < t.length) {
    if (t[i] === "\\") i += 2;
    else if (t[i] === '"') return i + 1;
    else i++;
  }
  throw new Error("JSON: Zeichenkette nicht abgeschlossen");
}

function wertEnde(t, i) {
  const c = t[i];
  if (c === '"') return stringEnde(t, i);
  if (c === "{" || c === "[") {
    let tiefe = 0;
    while (i < t.length) {
      const z = t[i];
      if (z === '"') {
        i = stringEnde(t, i);
        continue;
      }
      if (z === "{" || z === "[") tiefe++;
      else if (z === "}" || z === "]") tiefe--;
      i++;
      if (tiefe === 0) return i;
    }
    throw new Error("JSON: Klammer nicht abgeschlossen");
  }
  while (i < t.length && !/[\s,}\]]/.test(t[i])) i++;
  return i;
}

/** Alle Eigenschaften der obersten Ebene: `{ name, start, ende, keyStart }` (Textbereich des Werts). Wirft bei ungültigem JSON,
 *  Wurzel ohne Objekt und doppeltem Schlüssel. */
function eigenschaften(text) {
  JSON.parse(text); // wirft bei ungültigem JSON
  const start = ueberspringeWs(text, 0);
  if (text[start] !== "{") throw new Error("JSON: Wurzel ist kein Objekt");
  const out = [];
  const gesehen = new Set();
  let i = ueberspringeWs(text, start + 1);
  while (text[i] !== "}") {
    const keyStart = i;
    const keyEnde = stringEnde(text, i);
    const name = JSON.parse(text.slice(keyStart, keyEnde));
    if (gesehen.has(name)) throw new Error(`JSON: doppelter Schlüssel '${name}' auf oberster Ebene`);
    gesehen.add(name);
    i = ueberspringeWs(text, keyEnde);
    i = ueberspringeWs(text, i + 1); // ':'
    const vStart = i;
    const vEnde = wertEnde(text, i);
    out.push({ name, keyStart, start: vStart, ende: vEnde });
    i = ueberspringeWs(text, vEnde);
    if (text[i] === ",") i = ueberspringeWs(text, i + 1);
  }
  return { objStart: start, objEnde: i, eigenschaften: out };
}

/** Textbereich `{ start, ende }` des Werts von `schluessel` oder `null`, wenn er fehlt. */
export function jsonSchluesselSpanne(text, schluessel) {
  const p = eigenschaften(text).eigenschaften.find((x) => x.name === schluessel);
  return p ? { start: p.start, ende: p.ende } : null;
}

/** Ersetzt den Werttext von `schluessel` wörtlich durch `wertText`; fehlt der Schlüssel, wird er als letzte Eigenschaft
 *  eingefügt (Einrückung der ersten Eigenschaft, Zeilenende des Textes). Alles andere bleibt byte-gleich. */
export function setzeJsonSchluessel(text, schluessel, wertText) {
  const info = eigenschaften(text);
  const vorhanden = info.eigenschaften.find((x) => x.name === schluessel);
  if (vorhanden) return text.slice(0, vorhanden.start) + wertText + text.slice(vorhanden.ende);
  const eol = eolVon(text);
  const zeile = `${JSON.stringify(schluessel)}: ${wertText}`;
  if (info.eigenschaften.length === 0) return `${text.slice(0, info.objStart)}{${eol}  ${zeile}${eol}${text.slice(info.objEnde)}`;
  const erste = info.eigenschaften[0];
  const letzte = info.eigenschaften[info.eigenschaften.length - 1];
  const dazwischen = text.slice(info.objStart + 1, erste.keyStart);
  const nl = dazwischen.lastIndexOf("\n");
  const trenner = nl < 0 ? " " : `${eol}${dazwischen.slice(nl + 1)}`;
  return `${text.slice(0, letzte.ende)},${trenner}${zeile}${text.slice(letzte.ende)}`;
}

/** Ersetzt den Bereich vom Start- bis einschließlich Ende-Marker durch `blockText`; fehlen die Marker, ist das ein Fehler. */
export function setzeBlock(text, block, blockText) {
  const na = zaehleVorkommen(text, markerStart(block));
  const nb = zaehleVorkommen(text, markerEnde(block));
  if (na !== 1 || nb !== 1) throw new Error(`Block '${block}': Marker müssen im Ziel je genau einmal stehen (start ${na}, ende ${nb})`);
  const a = text.indexOf(markerStart(block));
  const b = text.indexOf(markerEnde(block));
  if (b < a) throw new Error(`Block '${block}': Ende-Marker steht vor dem Start-Marker`);
  return text.slice(0, a) + blockText + text.slice(b + markerEnde(block).length);
}

// ── Projektwert-Stellen (ADR 0022 F3f) ────────────────────────────────────────

export const PROJEKTWERT_START = "<!-- factory:projektwerte:start -->";
export const PROJEKTWERT_ENDE = "<!-- factory:projektwerte:end -->";
const PROJEKTWERT_KENNUNG = "factory:projektwert";
const PROJEKTWERT_ZEILE = /^# factory:projektwert (\S+)$/;
const PROJEKTWERT_FOLGE = /^(\s*)([A-Za-z_][\w-]*):/;
export const PROJEKTWERT_GRUPPEN = ["praefixe", "agenten", "labels", "skills"];
/** Muster für `<gruppe.schluessel>`-Platzhalter der Projektwert-Gruppen; frische Instanz (Flag `g`, eigener `lastIndex`) je Aufruf. */
export function platzhalterMuster() {
  return new RegExp(`<(${PROJEKTWERT_GRUPPEN.join("|")})\\.(\\w+)>`, "g");
}
const YAML_BLANK = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
const CONFIG_PFAD = ".factory/projekt.json";

/** Stellen eines LF-Textes: `{ bloecke: [{ start, ende }], zeilen: [{ marker, folge, schluessel, einrueckung, name }] }` (Zeilenindizes ab 0).
 *  Ein Markdown-Marker zählt nur allein auf seiner Zeile, ein Zeilen-Marker nur im führenden Frontmatter direkt vor einer `key:`-Zeile.
 *  Wirft mit allen Funden (`pfad:zeile: ...`) bei Start ohne Ende, Ende ohne Start, verschachteltem Start und kaputtem Zeilen-Marker. */
export function projektwertStellen(text, pfad = "<text>") {
  const zeilen = text.split("\n");
  const fmEnde = zeilen[0].trimEnd() === "---" ? zeilen.findIndex((z, i) => i > 0 && z.trimEnd() === "---") : -1;
  const fehler = [];
  const bloecke = [];
  const stellen = [];
  let offen = -1;
  const melde = (i, msg) => fehler.push(`${pfad}:${i + 1}: ${msg}`);
  for (let i = 0; i < zeilen.length; i++) {
    const t = zeilen[i].trim();
    if (t === PROJEKTWERT_START) {
      if (offen >= 0) melde(i, `Projektwert-Block beginnt, obwohl der Block ab Zeile ${offen + 1} noch offen ist`);
      else offen = i;
    } else if (t === PROJEKTWERT_ENDE) {
      if (offen < 0) melde(i, "Projektwert-Block endet ohne Start");
      else {
        bloecke.push({ start: offen, ende: i });
        offen = -1;
      }
    } else {
      const m = PROJEKTWERT_ZEILE.exec(zeilen[i].trimEnd());
      if (m === null) {
        if (t.startsWith("# " + PROJEKTWERT_KENNUNG)) melde(i, "kaputter Projektwert-Zeilen-Marker (erwartet `# factory:projektwert <schlüssel>` allein auf der Zeile, ohne Einrückung)");
        continue;
      }
      const folge = i + 1 < zeilen.length ? PROJEKTWERT_FOLGE.exec(zeilen[i + 1]) : null;
      if (fmEnde < 0 || i >= fmEnde) melde(i, "Projektwert-Zeilen-Marker steht außerhalb des führenden Frontmatters");
      else if (i + 1 >= fmEnde || folge === null) melde(i, "auf den Projektwert-Zeilen-Marker muss im Frontmatter eine Zeile `schlüssel:` folgen");
      else stellen.push({ marker: i, folge: i + 1, schluessel: m[1], einrueckung: folge[1], name: folge[2] });
    }
  }
  if (offen >= 0) melde(offen, "Projektwert-Block hat kein Ende");
  if (fehler.length > 0) throw new Error(fehler.join("\n"));
  return { bloecke, zeilen: stellen };
}

/** Text mit geleerten Projektwerten (Block-Rumpf entfernt, Wert der Frontmatter-Zeile entfernt). Wirft wie `projektwertStellen`. */
export function leereProjektwerte(text, pfad = "<text>") {
  if (!text.includes(PROJEKTWERT_KENNUNG)) return text;
  const st = projektwertStellen(text, pfad);
  const zeilen = text.split("\n");
  for (const z of st.zeilen) zeilen[z.folge] = `${z.einrueckung}${z.name}:`;
  for (const b of [...st.bloecke].reverse()) zeilen.splice(b.start + 1, b.ende - b.start - 1);
  return zeilen.join("\n");
}

/** Wert zum Schlüssel (`gruppe.name`) aus der Config; wirft bei fehlendem oder nicht-textlichem Wert und bei Zeichen, die den Block brechen. */
export function projektwertWert(config, schluessel) {
  const wert = schluessel.split(".").reduce((o, k) => (o !== null && typeof o === "object" ? o[k] : undefined), config);
  if (typeof wert !== "string" || wert === "") {
    throw new Error(`Projektwert '${schluessel}' fehlt oder ist kein nichtleerer Text in ${CONFIG_PFAD}\nFix: Schlüssel in ${CONFIG_PFAD} ergänzen oder den Marker korrigieren`);
  }
  if (/[`|\r\n]/.test(wert)) {
    throw new Error(`Projektwert '${schluessel}' enthält Backtick, '|' oder Zeilenumbruch und lässt sich nicht einsetzen\nFix: Wert in ${CONFIG_PFAD} ändern`);
  }
  return wert;
}

function blockZeilen(config) {
  const kopf = `Projektwerte aus \`${CONFIG_PFAD}\` (generiert von \`node scripts/projektwerte.mjs --write\`, nicht von Hand ändern).`;
  const out = [PROJEKTWERT_START, kopf, "", "| Schlüssel | Wert |", "| --- | --- |"];
  for (const g of PROJEKTWERT_GRUPPEN) {
    if (config?.[g] === null || typeof config?.[g] !== "object") {
      throw new Error(`Projektwert-Gruppe '${g}' fehlt in ${CONFIG_PFAD}\nFix: Gruppe in ${CONFIG_PFAD} ergänzen`);
    }
    for (const k of Object.keys(config[g])) out.push(`| \`${g}.${k}\` | \`${projektwertWert(config, `${g}.${k}`)}\` |`);
  }
  out.push(PROJEKTWERT_ENDE);
  return out;
}

const YAML_WORT = /^(true|false|null|yes|no|on|off|y|n|~|[0-9].*)$/i;
const yamlWert = (w) => (YAML_BLANK.test(w) && !YAML_WORT.test(w) ? w : JSON.stringify(w));
const zeilenSoll = (z, config) => `${z.einrueckung}${z.name}: ${yamlWert(projektwertWert(config, z.schluessel))}`;
const mitOrt = (pfad, zeile, fn) => {
  try {
    return fn();
  } catch (err) {
    throw new Error(`${pfad}:${zeile + 1}: ${err.message}`, { cause: err });
  }
};
const holeConfig = (config) => (typeof config === "function" ? config() : config);

/** Rendert alle Projektwert-Stellen aus der Config (Wert oder Funktion, die erst bei einer Stelle gerufen wird). Text ohne Stellen bleibt gleich. */
export function rendereProjektwerte(text, config, pfad = "<text>") {
  if (!text.includes(PROJEKTWERT_KENNUNG)) return text;
  const st = projektwertStellen(text, pfad);
  if (st.bloecke.length + st.zeilen.length === 0) return text;
  const cfg = holeConfig(config);
  const ersetze = [
    ...st.zeilen.map((z) => ({ von: z.folge, bis: z.folge + 1, neu: [mitOrt(pfad, z.folge, () => zeilenSoll(z, cfg))] })),
    ...st.bloecke.map((b) => ({ von: b.start, bis: b.ende + 1, neu: mitOrt(pfad, b.start, () => blockZeilen(cfg)) })),
  ].sort((a, b) => b.von - a.von);
  const zeilen = text.split("\n");
  for (const r of ersetze) zeilen.splice(r.von, r.bis - r.von, ...r.neu);
  return zeilen.join("\n");
}

/** Abweichungen der Projektwert-Stellen von der Config (`pfad:zeile: ...`, leer = in Ordnung). Wirft bei kaputtem Marker oder fehlendem Wert. */
export function projektwertAbweichungen(pfad, text, config) {
  if (!text.includes(PROJEKTWERT_KENNUNG)) return [];
  const st = projektwertStellen(text, pfad);
  if (st.bloecke.length + st.zeilen.length === 0) return [];
  const cfg = holeConfig(config);
  const zeilen = text.split("\n");
  const out = [];
  for (const z of st.zeilen) {
    const soll = mitOrt(pfad, z.folge, () => zeilenSoll(z, cfg));
    if (zeilen[z.folge].trimEnd() !== soll) out.push(`${pfad}:${z.folge + 1}: Projektwert '${z.schluessel}' weicht von ${CONFIG_PFAD} ab (erwartet \`${soll}\`)`);
  }
  for (const b of st.bloecke) {
    const soll = mitOrt(pfad, b.start, () => blockZeilen(cfg));
    const ist = zeilen.slice(b.start, b.ende + 1).map((l) => l.trimEnd());
    if (ist.join("\n") !== soll.join("\n")) out.push(`${pfad}:${b.start + 1}: Projektwert-Block weicht von ${CONFIG_PFAD} ab`);
  }
  return out;
}

/**
 * Befunde der Platzhalter-Regel (leer = in Ordnung): ein Platzhalter `<gruppe.schlüssel>` in `text` braucht genau einen Projektwert-Block
 * in derselben Datei, und sein Schlüssel löst in `config` auf. Pur; die Muster steuert `platzhalterMuster`.
 */
export function platzhalterBefunde(pfad, text, config) {
  const treffer = [...text.matchAll(platzhalterMuster())];
  if (treffer.length === 0) return [];
  const out = [];
  const bloecke = projektwertStellen(text, pfad).bloecke.length;
  if (bloecke !== 1) out.push(`${pfad}: ${treffer.length} Platzhalter, aber ${bloecke} Projektwert-Blöcke (genau einer verlangt)`);
  for (const schluessel of new Set(treffer.map((m) => `${m[1]}.${m[2]}`))) {
    try {
      projektwertWert(config, schluessel);
    } catch {
      out.push(`${pfad}: Platzhalter <${schluessel}> löst in der Config nicht auf`);
    }
  }
  return out;
}

const PROJEKTWERT_FLAECHEN = [/^\.claude\/agents\/[^/]+\.md$/, /^\.claude\/skills\/[^/]+\/[^/]+\.md$/, /^\.agents\/skills\/[^/]+\/[^/]+\.md$/];

/** Geschlossene Prüf-Fläche: `.md`-Pfade des Manifests plus Agenten- und Skill-Markdown aus `liste` (alle Projektpfade, Schrägstrich-Form). Sortiert, ohne Doppelte. */
export function projektwertDateien(manifestPfade, liste) {
  const aus = liste.filter((p) => PROJEKTWERT_FLAECHEN.some((r) => r.test(p)));
  return [...new Set([...manifestPfade.filter((p) => pfadSicher(p) && p.endsWith(".md")), ...aus])].sort();
}

/** Alle Agenten-, Skill-Zeiger- und Skill-Quell-Dateien (`.claude/agents`, `.claude/skills`, `.agents/skills`) unter `wurzel` (Schrägstrich-Form, unsortiert). */
export function projektDateien(wurzel) {
  const out = [];
  const unter = (rel) => {
    const voll = join(wurzel, ...rel.split("/"));
    return existsSync(voll) ? readdirSync(voll, { withFileTypes: true }) : [];
  };
  for (const d of unter(".claude/agents")) if (d.isFile()) out.push(`.claude/agents/${d.name}`);
  for (const wurzelOrdner of [ZEIGER_WURZEL, QUELL_VERZEICHNIS]) {
    for (const s of unter(wurzelOrdner)) {
      if (s.isDirectory()) for (const d of unter(`${wurzelOrdner}/${s.name}`)) if (d.isFile()) out.push(`${wurzelOrdner}/${s.name}/${d.name}`);
    }
  }
  return out;
}

/**
 * Prüft (oder schreibt mit `schreiben`) alle Projektwert-Stellen unter `wurzel`. `ladeConfig` wird nur gerufen, wenn eine Datei Stellen hat.
 * Rückgabe: `{ dateien (Zahl der Dateien mit Stellen), fehler, geaendert, abweichungen }`; `abweichungen` sind nur die Funde "Wert weicht von der Config ab" (im Prüfmodus auch in `fehler`), die Aufrufer schlagen daran den `--write`-Fix vor. Geschrieben wird nur, wenn kein Fehler vorliegt.
 */
export function projektwertLauf(wurzel, ladeConfig, { schreiben = false } = {}) {
  const res = { dateien: 0, fehler: [], geaendert: [], abweichungen: [] };
  const lies = (rel) => {
    const voll = join(wurzel, ...rel.split("/"));
    return existsSync(voll) ? readFileSync(voll, "utf8") : null;
  };
  let manifestPfade = [];
  try {
    manifestPfade = JSON.parse(lies(".factory/besitz.json") ?? "{}").eintraege?.map((e) => e.pfad) ?? [];
  } catch {
    // ein kaputtes Manifest meldet das Drift-Gate selbst
  }
  let config;
  const configLaden = () => {
    if (config === undefined) {
      try {
        config = ladeConfig();
      } catch (err) {
        config = null;
        res.fehler.push(`Projekt-Config: ${err.message}`);
      }
    }
    if (config === null) throw new Error(KEINE_CONFIG);
    return config;
  };
  const neu = new Map();
  for (const pfad of projektwertDateien(manifestPfade, projektDateien(wurzel))) {
    const roh = lies(pfad);
    if (roh === null || !roh.includes(PROJEKTWERT_KENNUNG)) continue;
    const text = normalisiereEol(roh);
    try {
      const st = projektwertStellen(text, pfad);
      if (st.bloecke.length + st.zeilen.length === 0) continue;
      res.dateien++;
      const abw = projektwertAbweichungen(pfad, text, configLaden);
      res.abweichungen.push(...abw);
      if (!schreiben) res.fehler.push(...abw);
      if (abw.length > 0) neu.set(pfad, { roh, text: rendereProjektwerte(text, configLaden, pfad) });
    } catch (err) {
      if (err.message !== KEINE_CONFIG) res.fehler.push(err.message);
    }
  }
  if (schreiben && res.fehler.length === 0) {
    for (const [pfad, { roh, text }] of neu) {
      writeFileSync(join(wurzel, ...pfad.split("/")), eolVon(roh) === "\n" ? text : text.replace(/\n/g, "\r\n"));
      res.geaendert.push(pfad);
    }
  }
  return res;
}
const KEINE_CONFIG = "Projekt-Config nicht lesbar";

// ── Projektliterale aus der Config (ADR 0022 F1, F10) ───────────────────────
// Eine Auslegung für den Kern-Wächter und das Export-Werkzeug: welche Begriffe ein Kern nicht tragen soll.

/** Alternative aus wörtlichen Werten: einmalig, längster zuerst (sonst zählt ein Kurzname im Langnamen mit), regex-escaped.
 * @param {string[]} werte */
const alternative = (werte) =>
  [...new Set(werte)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|");

/** Board-ID (#1875): das generische Muster der Projekt-IDs, dazu die Status-Feld-ID jedes Boards der Config als ganze Zahl
 * (`todoOptionId` zählt nicht: der GitHub-Standardwert steht in jedem Projekt).
 * @param {{ boards: { statusFeldId?: string | number }[] }} config */
const boardIdRegex = (config) => {
  const ids = config.boards.flatMap((b) => (b.statusFeldId === undefined ? [] : [String(b.statusFeldId)]));
  const muster = "\\bPVT[A-Z]*_[A-Za-z0-9_-]+";
  return new RegExp(ids.length === 0 ? muster : `${muster}|(?<!\\d)(?:${ids.map(escapeRegex).join("|")})(?!\\d)`, "g");
};

/** Die Projektliterale, die ein Kern nicht tragen soll, aus der Projekt-Config (#1611, #1741): Owner (Repo-Owner und Board-Besitzer),
 * Repo-Name, generisches Board-ID-Muster, Commit-Zeilen-Präfix, Branch- und Worktree-Präfix, Labels (nur Werte mit `:`, ein Wort
 * wie `forum` zählt nie), Agentennamen, Skill-Namen (`skills`, ganze Wörter ohne Bindestrich-Anschluss) und die `projektliterale` der Config (als ganze Wörter, Unicode-Wortgrenzen). Präfix, Branch, Worktree, Label und Agent zählen
 * groß/klein-genau; Branch und Worktree überlappen bewusst (ein Branch-Präfix enthält das Worktree-Präfix).
 * @param {{ repo: string, boards: { besitzer: string, statusFeldId?: string | number }[], praefixe: { commitZeile: string, branch: string, worktree: string },
 *   labels: Record<string, string>, agenten: Record<string, string>, skills?: Record<string, string>, projektliterale?: Record<string, string> }} config
 * @returns {Record<string, RegExp>} */
export function begriffeAus(config) {
  const [owner = "", name = ""] = config.repo.split("/");
  const owners = [...new Set([owner, ...config.boards.map((b) => b.besitzer)])];
  const { commitZeile, branch, worktree } = config.praefixe;
  /** @type {Record<string, RegExp>} */
  const out = {
    Owner: new RegExp(owners.map(escapeRegex).join("|"), "gi"),
    Repo: new RegExp(escapeRegex(name), "gi"),
    "Board-ID": boardIdRegex(config),
    Praefix: new RegExp(escapeRegex(commitZeile), "g"),
    Branch: new RegExp(escapeRegex(branch), "g"),
    Worktree: new RegExp(escapeRegex(worktree), "g"),
  };
  // Env (#1824): der Commit-Zeilen-Präfix mit Unterstrich als Umgebungsvariablen-Präfix; die Wortgrenze davor schließt `VITE_<PRAEFIX>_…` und `__<PRAEFIX>_…__` aus.
  const envPraefix = altEnvPraefix(config);
  if (envPraefix !== null) out.Env = new RegExp("\\b" + escapeRegex(envPraefix) + "(?=[A-Z0-9])", "g");
  const labels = Object.values(config.labels).filter((l) => l.includes(":"));
  if (labels.length > 0) out.Label = new RegExp(alternative(labels), "g");
  out.Agent = new RegExp(alternative(Object.values(config.agenten)), "g");
  const skills = Object.values(config.skills ?? {});
  if (skills.length > 0) out.Skill = new RegExp(`(?<![\\w-])(?:${alternative(skills)})(?![\\w-])`, "g");
  for (const [begriff, literal] of Object.entries(config.projektliterale ?? {})) out[begriff] = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(literal)}(?![\\p{L}\\p{N}_])`, "giu");
  return out;
}
