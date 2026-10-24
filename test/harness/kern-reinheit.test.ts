/* Kern-Reinheits-Wächter (#1610, ADR 0022 F1): zählt Projektliterale je Einheit des Besitz-Manifests
 * `.factory/besitz.json` gegen die Baseline `kern-literale-baseline.json`. Die Baseline darf nur sinken.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Einheiten: ganze Datei (`pfad`), Markdown-Block zwischen Markern (`pfad#<block>`), JSON-Schlüssel
 * (`pfad#/<schluessel>`). Rot bei: neuem Literal, Baseline über Ist (neues Literal) oder unter Ist nicht
 * gesenkt, verwaistem Eintrag, ungültigem Manifest, und bei einer Baseline, die gegen die Diff-Basis angehoben wurde. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { importeAus, kandidatenPfade, lokaleImporteTransitiv, relativeImporte } from "./hook-importe";
import { type ProjektConfig, projektConfig } from "../support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkBasis from "../../scripts/check-basis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawNamen from "../../scripts/ticket-namen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawRegistry from "../../scripts/docs-gen/registry.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { QUELL_VERZEICHNIS, ZEIGER_WURZEL } from "../../scripts/skill-pfade.mjs";

// Begründete Ausnahme wie in repo-texte.ts: das .mjs hat kein Declaration-File.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const escapeRe: (t: string) => string = rawNamen.escapeRegex;

interface BesitzLib {
  markerStart: (id: string) => string;
  markerEnde: (id: string) => string;
  einheitId: (e: Eintrag) => string;
  einheitText: (e: Eintrag, text: string) => string | null;
  normalisierterEinheitText: (e: Eintrag, text: string) => string | null;
  pruefeManifest: (m: Manifest, lies: (pfad: string) => string | null) => string[];
  RINGE: string[];
  RING_IMPORTE: Record<string, string[]>;
  NUR_FACTORY: string[];
  wirdVerteilt: (e: Eintrag) => boolean;
  istGanzeDatei: (e: Eintrag) => boolean;
}
const { markerStart, markerEnde, einheitId, einheitText, normalisierterEinheitText, pruefeManifest, RINGE, RING_IMPORTE, NUR_FACTORY, wirdVerteilt, istGanzeDatei } = rawBesitz as unknown as BesitzLib;

interface PcLib {
  ROLLEN_PFADE: Record<string, string>;
  PFLICHT_AGENTEN: string[];
  TICKET_SKILL_ORDNER: string;
}
const { ROLLEN_PFADE, PFLICHT_AGENTEN, TICKET_SKILL_ORDNER } = rawPc as unknown as PcLib;
const { projektwertStellen } = rawBesitz as unknown as { projektwertStellen: (text: string, pfad?: string) => { zeilen: { schluessel: string; name: string }[] } };

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const MANIFEST = ".factory/besitz.json";
const BASELINE = "test/harness/kern-literale-baseline.json";
const ABDECKUNG = "test/harness/kern-abdeckung.json";

export interface Eintrag {
  pfad: string;
  block?: string;
  schluessel?: string;
  ring: string;
  quelle: string;
}
interface Manifest {
  version: number;
  eintraege: Eintrag[];
}
type Zaehlung = Record<string, number>;
type Baseline = Record<string, Zaehlung>;

/** Loser Eingabetyp von `begriffeAus`: aus dem gemeinsamen Config-Typ abgeleitet, Teil-Fixtures bleiben gültig. */
export type BegriffsConfig = Pick<ProjektConfig, "repo" | "praefixe" | "projektliterale"> & {
  boards: (Pick<ProjektConfig["boards"][number], "besitzer"> & Partial<Pick<ProjektConfig["boards"][number], "statusFeldId">>)[];
  labels: Record<string, string>;
  agenten: Record<string, string>;
  skills?: Record<string, string>;
};


/** Alternative aus wörtlichen Werten: einmalig, längster zuerst (sonst zählt ein Kurzname im Langnamen mit), regex-escaped. */
const alternative = (werte: string[]): string =>
  [...new Set(werte)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join("|");

/** Board-ID (#1875): das generische Muster der Projekt-IDs, dazu die Status-Feld-ID jedes Boards der Config als ganze Zahl
 * (`todoOptionId` zählt nicht: der GitHub-Standardwert steht in jedem Projekt). */
const boardIdRegex = (config: BegriffsConfig): RegExp => {
  const ids = config.boards.flatMap((b) => (b.statusFeldId === undefined ? [] : [String(b.statusFeldId)]));
  const muster = "\\bPVT[A-Z]*_[A-Za-z0-9_-]+";
  return new RegExp(ids.length === 0 ? muster : `${muster}|(?<!\\d)(?:${ids.map(escapeRe).join("|")})(?!\\d)`, "g");
};

/** Die Projektliterale, die ein Kern nicht tragen soll, aus der Projekt-Config (#1611, #1741): Owner (Repo-Owner und Board-Besitzer),
 * Repo-Name, generisches Board-ID-Muster, Commit-Zeilen-Präfix, Branch- und Worktree-Präfix, Labels (nur Werte mit `:`, ein Wort
 * wie `forum` zählt nie), Agentennamen, Skill-Namen (`skills`, ganze Wörter ohne Bindestrich-Anschluss) und die `projektliterale` der Config (als ganze Wörter, Unicode-Wortgrenzen). Präfix, Branch, Worktree, Label und Agent zählen
 * groß/klein-genau; Branch und Worktree überlappen bewusst (ein Branch-Präfix enthält das Worktree-Präfix). */
export function begriffeAus(config: BegriffsConfig): Record<string, RegExp> {
  const [owner = "", name = ""] = config.repo.split("/");
  const owners = [...new Set([owner, ...config.boards.map((b) => b.besitzer)])];
  const out: Record<string, RegExp> = {
    Owner: new RegExp(owners.map(escapeRe).join("|"), "gi"),
    Repo: new RegExp(escapeRe(name), "gi"),
    "Board-ID": boardIdRegex(config),
    Praefix: new RegExp(escapeRe(config.praefixe.commitZeile), "g"),
    Branch: new RegExp(escapeRe(config.praefixe.branch), "g"),
    Worktree: new RegExp(escapeRe(config.praefixe.worktree), "g"),
  };
  // Env (#1824): der Commit-Zeilen-Präfix mit Unterstrich als Umgebungsvariablen-Präfix; die Wortgrenze davor schließt `VITE_<PRAEFIX>_…` und `__<PRAEFIX>_…__` aus.
  const envPraefix = (rawPc as unknown as { altEnvPraefix(c: BegriffsConfig): string | null }).altEnvPraefix(config);
  if (envPraefix !== null) out.Env = new RegExp("\\b" + escapeRe(envPraefix) + "(?=[A-Z0-9])", "g");
  const labels = Object.values(config.labels).filter((l) => l.includes(":"));
  if (labels.length > 0) out.Label = new RegExp(alternative(labels), "g");
  out.Agent = new RegExp(alternative(Object.values(config.agenten)), "g");
  const skills = Object.values(config.skills ?? {});
  if (skills.length > 0) out.Skill = new RegExp(`(?<![\\w-])(?:${alternative(skills)})(?![\\w-])`, "g");
  for (const [begriff, literal] of Object.entries(config.projektliterale ?? {})) out[begriff] = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(literal)}(?![\\p{L}\\p{N}_])`, "giu");
  return out;
}

/** Pfade (#1748): je Pfad und Begriff, der im Pfad vorkommt, eine Meldung. Pur; die Regex der Begriffe sind global, darum `match` statt `test`. */
export function pfadLiterale(pfade: string[], begriffe: Record<string, RegExp>): string[] {
  const out: string[] = [];
  for (const pfad of pfade) {
    for (const [name, re] of Object.entries(begriffe)) {
      if ((pfad.match(re) ?? []).length > 0) out.push(`${pfad}: Projektliteral '${name}' im Pfad`);
    }
  }
  return out;
}

/** Zählung je Begriff (nur > 0), CRLF-neutral. */
export function zaehle(text: string, begriffe: Record<string, RegExp>): Zaehlung {
  const t = text.replace(/\r\n/g, "\n");
  const out: Zaehlung = {};
  for (const [name, re] of Object.entries(begriffe)) {
    const n = (t.match(re) ?? []).length;
    if (n > 0) out[name] = n;
  }
  return out;
}

/** Weg zur Behebung je Begriff (nur wo er vom Standardsatz abweicht). */
const hinweis = (begriff: string): string => (begriff === "Env" ? " (Kern-Umgebungsvariablen heißen FACTORY_<NAME> und werden über umgebungsWert gelesen)" : "");

/** Meldungen (leer = grün): Ist gegen Baseline, nur sinkend. */
export function vergleiche(ist: Baseline, baseline: Baseline): string[] {
  const out: string[] = [];
  for (const [einheit, z] of Object.entries(ist)) {
    const b = baseline[einheit] ?? {};
    for (const [begriff, n] of Object.entries(z)) {
      const bn = b[begriff];
      if (bn === undefined) out.push(`${einheit}: neues Projektliteral '${begriff}' (${n}x), Kern-Einheiten bleiben literalfrei${hinweis(begriff)}`);
      else if (n > bn) out.push(`${einheit}: '${begriff}' ${n}x über Baseline ${bn} (neue Prosa und Literale in Kern-Einheiten ohne Projektwort schreiben (Baseline sinkt nur))${hinweis(begriff)}`);
      else if (n < bn) out.push(`${einheit}: '${begriff}' nur noch ${n}x, Baseline auf ${n} senken (steht ${bn})`);
    }
    for (const begriff of Object.keys(b)) {
      if (!(begriff in z)) out.push(`${einheit}: '${begriff}' kommt nicht mehr vor, Baseline-Eintrag entfernen`);
    }
  }
  for (const einheit of Object.keys(baseline)) {
    if (!(einheit in ist)) out.push(`${einheit}: Baseline-Eintrag ohne Literale oder ohne Einheit, Eintrag entfernen`);
  }
  return out;
}

/** `git diff -M --name-status`-Ausgabe: Map neuer Pfad → alter Pfad (`null` = neu angelegt). */
export function parseNameStatus(out: string): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const zeile of out.split("\n")) {
    const f = zeile.split("\t");
    if (f.length < 2 || f[0] === undefined) continue;
    const s = f[0][0];
    if (s === "A") m.set(f[1] ?? "", null);
    else if (s === "R" || s === "C") m.set(f[2] ?? "", s === "R" ? (f[1] ?? null) : null);
    else if (s === "M" || s === "T") m.set(f[1] ?? "", f[1] ?? null);
  }
  return m;
}

/** Erlaubte Zählung je Einheit an der Diff-Basis (nur geänderte/umbenannte/neue Dateien). */
export function erlaubt(
  einheiten: Eintrag[],
  aenderungen: Map<string, string | null>,
  basisText: (altPfad: string) => string | null,
  begriffe: Record<string, RegExp>,
): Baseline {
  const out: Baseline = {};
  for (const e of einheiten) {
    if (!aenderungen.has(e.pfad)) continue;
    const alt = aenderungen.get(e.pfad) ?? null;
    const text = alt === null ? null : basisText(alt);
    const t = text === null ? null : einheitText(e, text);
    out[einheitId(e)] = t === null ? {} : zaehle(t, begriffe);
  }
  return out;
}

/** Meldungen: Baseline-Werte über dem erlaubten Basiswert. */
export function anhebungen(baseline: Baseline, erl: Baseline): string[] {
  const out: string[] = [];
  for (const [einheit, basis] of Object.entries(erl)) {
    for (const [begriff, n] of Object.entries(baseline[einheit] ?? {})) {
      const b = basis[begriff] ?? 0;
      if (n > b) out.push(`${einheit}: Baseline '${begriff}' ${n} über dem Wert an der Diff-Basis (${b}), anheben ist verboten`);
    }
  }
  return out;
}

/** Anheben-Prüfung gegen die Diff-Basis: `pruefen` (Basis da), `entfaellt` (lokal ohne Basis), `rot` (CI ohne Basis, fail-closed). */
export function diffBasisModus(basis: string | null, env: Record<string, string | undefined>): "pruefen" | "entfaellt" | "rot" {
  if (basis !== null) return "pruefen";
  return env.CI === "true" ? "rot" : "entfaellt";
}

/** Offene Ausnahmen der Schichtdaten-Regel (#1612): Einheit → Grund mit Ticket. Die Liste darf nur schrumpfen. */
export const SCHICHTDATEN_AUSNAHMEN: Record<string, string> = {};

const CODE_ENDUNG = /\.(?:mjs|cjs|js|ts)$/;

/** Einheiten (Ganze-Datei-Einheiten beider Ringe), die die Schichtdaten statisch importieren. Nur direkte Importe
 *  (`relativeImporte`), relativ zum Ordner der importierenden Datei aufgelöst; ein dynamisches `require(cfg.layers)` ist
 *  der erlaubte Weg (der Kern lädt die Schichtdaten über den konfigurierten Pfad). */
export function schichtdatenImporte(eintraege: Eintrag[], lies: (pfad: string) => string | null, schichtdatenPfad: string): string[] {
  const ziel = posix.normalize(schichtdatenPfad);
  const out: string[] = [];
  for (const e of eintraege) {
    if (e.block !== undefined || e.schluessel !== undefined || !CODE_ENDUNG.test(e.pfad)) continue;
    const text = lies(e.pfad);
    if (text === null) continue;
    for (const spec of relativeImporte(text)) {
      const aufgeloest = posix.normalize(posix.join(posix.dirname(e.pfad), spec));
      // Endungslos (`require("../layers")`) trifft das Ziel mit einer Code-Endung.
      if (kandidatenPfade(aufgeloest).includes(ziel)) {
        out.push(e.pfad);
        break;
      }
    }
  }
  return out;
}

/** Meldungen (leer = grün): Verstoß ohne Ausnahme, Ausnahme ohne Ticket, veraltete Ausnahme. */
export function pruefeSchichtdatenRegel(verstoesse: string[], ausnahmen: Record<string, string>): string[] {
  const out: string[] = [];
  for (const v of verstoesse) {
    if (!(v in ausnahmen)) out.push(`${v}: importiert die Schichtdaten statisch, ein Kern-Modul lädt sie über den konfigurierten Pfad (schichten.layers) und nutzt Ableitung/Prüfung aus scripts/schichten-kern.cjs`);
  }
  for (const [pfad, grund] of Object.entries(ausnahmen)) {
    if (!/#\d+/.test(grund)) out.push(`${pfad}: Ausnahme ohne Ticket (#<nr>) im Grund`);
    if (!verstoesse.includes(pfad)) out.push(`${pfad}: Ausnahme veraltet (kein statischer Import mehr), Eintrag entfernen`);
  }
  return out;
}

// ── Kern-Abdeckung und Import-Hülle (#1613) ──────────────────────────────────

export interface AbdeckEintrag {
  art: string;
  grund: string;
}
const ABDECK_ARTEN = ["projekt", "modul", "offen"];

const musterRe = (muster: string): RegExp => new RegExp(`^${muster.split("*").map(escapeRe).join("[^/]*")}$`);

/** Kern-Verzeichnisse: die Ordner der Ganz-Datei-Einheiten, nicht rekursiv. */
export function kernVerzeichnisse(eintraege: Eintrag[]): Set<string> {
  const out = new Set<string>();
  for (const e of eintraege) if (istGanzeDatei(e)) out.add(posix.dirname(e.pfad));
  return out;
}

/** Feste Wurzeln, unabhängig vom Manifest (wie `projektDateien`): Agenten direkt, Skill-Quellen und Zeiger eine Ebene tiefer. */
const FESTE_FLAECHEN = [
  /^\.claude\/agents\/[^/]+$/,
  new RegExp(`^${escapeRe(ZEIGER_WURZEL as string)}/[^/]+/[^/]+$`),
  new RegExp(`^${escapeRe(QUELL_VERZEICHNIS as string)}/[^/]+/[^/]+$`),
];

/** Meldungen (leer = grün): jede getrackte Datei direkt in einem Kern-Verzeichnis oder in einer festen Wurzel ist Besitz oder steht in der Abdeckungsliste. */
export function pruefeAbdeckung(
  eintraege: Eintrag[],
  getrackt: string[],
  abdeckung: Record<string, AbdeckEintrag>,
  projektGeneratoren: string[] = [],
): string[] {
  const out: string[] = [];
  const verz = kernVerzeichnisse(eintraege);
  for (const g of projektGeneratoren) {
    const dir = posix.dirname(posix.normalize(g));
    if (verz.has(dir)) out.push(`${g}: Projekt-Generator im Kern-Ordner ${dir}, gehört in einen Projektordner (config.generatoren)`);
  }
  const besitz = new Set(eintraege.map((e) => e.pfad));
  const imKern = getrackt.filter((p) => verz.has(posix.dirname(p)) || FESTE_FLAECHEN.some((r) => r.test(p)));
  for (const p of imKern) {
    if (besitz.has(p)) continue;
    if (!Object.keys(abdeckung).some((m) => musterRe(m).test(p))) {
      out.push(`${p}: liegt in einem Kern-Verzeichnis, ist aber weder Besitz (.factory/besitz.json) noch in kern-abdeckung.json eingeordnet`);
    }
  }
  for (const [m, a] of Object.entries(abdeckung)) {
    const re = musterRe(m);
    if (!ABDECK_ARTEN.includes(a.art)) out.push(`${m}: unbekannte art '${a.art}' (erlaubt: ${ABDECK_ARTEN.join(", ")})`);
    if (a.grund.trim() === "") out.push(`${m}: grund fehlt`);
    if (a.art === "offen" && !/#\d+/.test(a.grund)) out.push(`${m}: art 'offen' braucht ein Ticket (#<nr>) im Grund`);
    const treffer = imKern.filter((p) => re.test(p));
    if (treffer.length === 0) out.push(`${m}: Eintrag ohne Treffer (keine getrackte Datei in einem Kern-Verzeichnis), entfernen`);
    for (const p of treffer) if (besitz.has(p)) out.push(`${m}: trifft die Besitz-Datei ${p}, ein Eintrag gilt nur für Nicht-Besitz`);
  }
  return out;
}

const PROJEKT_CONFIG_PFAD = ".factory/projekt.json";
/** Offene Ausnahmen der Import-Hülle: "<von> -> <nach>" → Grund mit Ticket oder ADR-Schritt. Darf nur schrumpfen; nur für Importeure im Ring kern-nach-entkopplung. */
export const KERN_HUELLE_AUSNAHMEN: Record<string, string> = {};

/** Lokale Importe (`relativeImporte` aus hook-importe, auch JSON) jeder Ganz-Datei-Code-Einheit, die weder auf eine Ganz-Datei-Einheit noch auf die Projekt-Config zeigen: "<von> -> <nach>". */
export function huellenVerstoesse(eintraege: Eintrag[], lies: (pfad: string) => string | null): string[] {
  const ganze = new Set(eintraege.filter((e) => istGanzeDatei(e)).map((e) => e.pfad));
  const out: string[] = [];
  for (const von of ganze) {
    if (!CODE_ENDUNG.test(von)) continue;
    const text = lies(von);
    if (text === null) continue;
    for (const spec of relativeImporte(text)) {
      const roh = posix.normalize(posix.join(posix.dirname(von), spec));
      // Endungslos (`require("./b")`) trifft eine Besitz-Datei mit einer Code-Endung.
      const nach = kandidatenPfade(roh).find((p) => ganze.has(p)) ?? roh;
      const id = `${von} -> ${nach}`;
      if (!ganze.has(nach) && nach !== PROJEKT_CONFIG_PFAD && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/** Ring-Regel (#1663, ADR 0029): lokale Importe jeder Ganz-Datei-Code-Einheit, die auf Besitz in einem Ring zeigen, den ihr
 *  Ring laut `RING_IMPORTE` (besitz-lib.mjs) nicht importieren darf ("<von> -> <nach>"). Ein Importeur mit unbekanntem Ring darf
 *  keinen Besitz importieren (fail-closed). Ziele ohne Besitz (Nicht-Besitz, Projekt-Config) sind Sache von `huellenVerstoesse`.
 *  Abhilfe: Ziel in einen erlaubten Ring ziehen (literalfrei) oder den Importeur in einen Ring mit mehr Rechten. */
export function ringVerstoesse(eintraege: Eintrag[], lies: (pfad: string) => string | null): string[] {
  const ring = new Map(eintraege.filter((e) => istGanzeDatei(e)).map((e) => [e.pfad, e.ring]));
  const out: string[] = [];
  for (const [von, ringVon] of ring) {
    if (!CODE_ENDUNG.test(von)) continue;
    const erlaubt = RING_IMPORTE[ringVon] ?? [];
    const text = lies(von);
    if (text === null) continue;
    for (const spec of relativeImporte(text)) {
      const roh = posix.normalize(posix.join(posix.dirname(von), spec));
      const nach = kandidatenPfade(roh).find((p) => ring.has(p));
      if (nach !== undefined && !erlaubt.includes(ring.get(nach) ?? "") && !out.includes(`${von} -> ${nach}`)) out.push(`${von} -> ${nach}`);
    }
  }
  return out;
}

/** Einheiten im Ring kern-nach-entkopplung (Ganz-Datei-Code), die dort nicht gebraucht werden: keine Literal-Einträge in der Baseline
 *  und alle lokalen Importe zeigen auf Besitz im Ring kern oder auf die Projekt-Config (Importe ohne Besitz-Ziel zählen als Grund zu bleiben).
 *  Abhilfe: Ring auf `kern` setzen. Grenze: nur statische lokale Importe (`relativeImporte`) werden gesehen. */
export function ueberfluessigeEntkopplung(eintraege: Eintrag[], baseline: Baseline, lies: (pfad: string) => string | null): string[] {
  const ring = new Map(eintraege.filter((e) => istGanzeDatei(e)).map((e) => [e.pfad, e.ring]));
  const out: string[] = [];
  for (const [pfad, r] of ring) {
    if (r !== "kern-nach-entkopplung" || !CODE_ENDUNG.test(pfad) || Object.keys(baseline[pfad] ?? {}).length > 0) continue;
    const text = lies(pfad);
    if (text === null) continue;
    const nurKern = relativeImporte(text).every((spec) => {
      const roh = posix.normalize(posix.join(posix.dirname(pfad), spec));
      const nach = kandidatenPfade(roh).find((p) => ring.has(p));
      return nach === undefined ? roh === PROJEKT_CONFIG_PFAD : ring.get(nach) === "kern";
    });
    if (nurKern) out.push(pfad);
  }
  return out;
}

/** Meldungen (leer = grün): Verstoß ohne Ausnahme, Ausnahme ohne Ticket/ADR-Schritt, Ausnahme im Ring kern, veraltete Ausnahme. */
export function pruefeHuelle(verstoesse: string[], ausnahmen: Record<string, string>, ringVon: (pfad: string) => string | undefined): string[] {
  const out: string[] = [];
  for (const v of verstoesse) {
    if (!(v in ausnahmen)) out.push(`${v}: ein Kern-Modul importiert nur Besitz oder .factory/projekt.json (Ziel zum Besitz machen, Import entfernen oder per dynamischem Pfad aus der Config laden)`);
  }
  for (const [id, grund] of Object.entries(ausnahmen)) {
    const von = id.split(" -> ")[0] ?? "";
    if (!/#\d+|ADR 0022 F\d+/.test(grund)) out.push(`${id}: Ausnahme ohne Ticket (#<nr>) oder ADR-Schritt (ADR 0022 F<n>) im Grund`);
    if (ringVon(von) !== "kern-nach-entkopplung") out.push(`${id}: Ausnahmen gelten nur für Importeure im Ring kern-nach-entkopplung`);
    if (!verstoesse.includes(id)) out.push(`${id}: Ausnahme veraltet (Import entfällt oder Ziel ist Besitz), Eintrag entfernen`);
  }
  return out;
}

/** Kern-Registry ohne Spiel-Generator (ADR 0022 F6, #1710). Meldungen (leer = grün) für `config.generatoren`:
 *  (1) die Registry importiert die Datei eines Projekt-Generators statisch, (2) der Marker ist zugleich ein Kern-Name,
 *  (3) die Datei eines Projekt-Generators ist Besitz. `registryZiele` sind die aufgelösten Pfade der lokalen Importe der Registry.
 *  Grenze: nur statische lokale Importe (`relativeImporte`) werden gesehen. */
export function spielGeneratorVerstoesse(
  registryZiele: string[],
  kernNamen: string[],
  projektGeneratoren: Record<string, { datei: string }>,
  istBesitz: (pfad: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const [marker, { datei }] of Object.entries(projektGeneratoren)) {
    const pfad = posix.normalize(datei);
    if (registryZiele.includes(pfad)) out.push(`${marker}: die Kern-Registry importiert den Projekt-Generator ${pfad} (laden über config.generatoren)`);
    if (kernNamen.includes(marker)) out.push(`${marker}: Marker ist zugleich ein Kern-Generator`);
    if (istBesitz(pfad)) out.push(`${marker}: ${pfad} ist Factory-Besitz, ein Projekt-Generator gehört dem Projekt`);
  }
  return out;
}

/** Ist-Zählung der Projektliterale je Einheit, über alle Ringe (auch `oberflaeche`, ADR 0029). */
export function istZaehlung(eintraege: Eintrag[], lies: (pfad: string) => string | null, begriffe: Record<string, RegExp>): Baseline {
  const ist: Baseline = {};
  for (const e of eintraege) {
    const t = normalisierterEinheitText(e, lies(e.pfad) ?? "");
    const z = zaehle(t ?? "", begriffe);
    if (Object.keys(z).length > 0) ist[einheitId(e)] = z;
  }
  return ist;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ein = (pfad: string, extra: Partial<Eintrag> = {}): Eintrag => ({ pfad, ring: "kern", quelle: "t", ...extra });

const NEU = {
  praefixe: { commitZeile: "ZD-", branch: "feature/zd-", worktree: "zd-" },
  labels: { harness: "area:werk", festgefahren: "status:steckt", forum: "forum", dependabotInbox: "area:werk" },
  agenten: { planer: "wk-planer", umsetzer: "wk-umsetzer", lens: "wk-lens", gruppe: "wk-gruppe", ticketSkill: "wk" },
};
const FIXTURE: BegriffsConfig = { repo: "acme/demo", boards: [{ besitzer: "acme" }], ...NEU, projektliterale: { Zelda: "zelda" } };
const B = begriffeAus(FIXTURE);

describe("zaehle", () => {
  test("Owner, Repo (auch in Zusammensetzungen), Board-ID und Zelda zählen; Bezeichner PROJECT_ID allein nicht", () => {
    assert.deepEqual(zaehle("Demo DEMO demo-umsetzer", B), { Repo: 3 });
    assert.deepEqual(zaehle("x acme y", B), { Owner: 1 });
    // zur Laufzeit zusammengesetzt: ein ausgeschriebenes Literal dieses Musters wäre in diesem Kern-Test selbst ein Treffer
    const pvt = (rest: string): string => "PVT" + rest;
    assert.deepEqual(zaehle(`${pvt("_kwHOabc")} ${pvt("SSF_xyz_1")}`, B), { "Board-ID": 2 });
    assert.deepEqual(zaehle("const PROJECT_ID = 1", B), {});
    assert.deepEqual(zaehle("docs/zelda-referenz.md", B), { Zelda: 1 });
    assert.deepEqual(zaehle("Größe über Äpfel", B), {});
  });
  test("CRLF und LF liefern dieselbe Zählung", () => {
    assert.deepEqual(zaehle("demo\r\ndemo\r\n", B), zaehle("demo\ndemo\n", B));
  });
});

describe("begriffeAus", () => {
  test("Regex-Zeichen im Repo-Namen sind wörtlich: my.repo zählt myxrepo nicht", () => {
    const b = begriffeAus({ repo: "zz/my.repo", boards: [{ besitzer: "zz" }], ...NEU });
    assert.deepEqual(zaehle("my.repo myxrepo", b), { Repo: 1 });
  });
  test("Repo-Owner und abweichender Board-Besitzer zählen beide als Owner; gleicher Besitzer nicht doppelt", () => {
    const zwei = begriffeAus({ repo: "alice/demo", boards: [{ besitzer: "bob" }], ...NEU });
    assert.deepEqual(zaehle("alice bob", zwei), { Owner: 2 });
    // alle Boards zählen (#1728): der Besitzer des zweiten Boards ist ebenfalls ein Owner-Literal
    const drei = begriffeAus({ repo: "alice/demo", boards: [{ besitzer: "bob" }, { besitzer: "carol" }, { besitzer: "bob" }], ...NEU });
    assert.deepEqual(zaehle("alice bob carol", drei), { Owner: 3 });
    assert.deepEqual(zaehle("acme", B), { Owner: 1 });
  });
  test("projektliterale zählen als ganzes Wort (Unicode-Wortgrenzen): Motor ja, motoRows und Motorx nein", () => {
    const b2 = begriffeAus({ repo: "acme/demo", boards: [{ besitzer: "acme" }], ...NEU, projektliterale: { Motor: "motor" } });
    assert.deepEqual(zaehle("motoRows", b2), {});
    assert.deepEqual(zaehle("Motorx xmotor motor_x 1motor", b2), {});
    assert.deepEqual(zaehle("Motor motor-frei Motor.Scene (Motor) MOTOR", b2), { Motor: 5 });
  });
  test("projektliterale: ein Umlaut grenzt als Buchstabe, Nicht-Buchstaben davor und dahinter nicht", () => {
    const b2 = begriffeAus({ repo: "acme/demo", boards: [{ besitzer: "acme" }], ...NEU, projektliterale: { Hof: "hof" } });
    assert.deepEqual(zaehle("Schöhof hofä", b2), {});
    assert.deepEqual(zaehle("Hof, hof/x „Hof“", b2), { Hof: 3 });
  });
  test("Board-ID (#1875): die Status-Feld-ID jedes Boards zählt als ganze Zahl; ohne statusFeldId kein Zusatz", () => {
    const b2 = begriffeAus({ repo: "acme/demo", boards: [{ besitzer: "acme", statusFeldId: 123 }, { besitzer: "acme", statusFeldId: 456 }], ...NEU });
    assert.deepEqual(zaehle("id 123, 456; 1123 1234 4567 x7123", b2), { "Board-ID": 2 });
    assert.deepEqual(zaehle(["PVT", "kwHOabc"].join("_") + " und 123", b2), { "Board-ID": 2 }, "das Projekt-ID-Muster gilt weiter");
    assert.deepEqual(zaehle("id 123", B), {});
  });
  test("ohne projektliterale entfällt der Zusatzbegriff", () => {
    assert.deepEqual(zaehle("zelda", begriffeAus({ repo: "acme/demo", boards: [{ besitzer: "acme" }], ...NEU })), {});
  });
  test("Praefix zählt groß/klein-genau (ZD- ja, zd- und ZD_ nur als Env)", () => {
    assert.deepEqual(zaehle("ZD-Plan zd-Plan ZD_X", B), { Praefix: 1, Worktree: 1, Env: 1 });
  });
  test("Env: Umgebungsvariablen mit Projektpräfix zählen (auch hinter $ und env.), VITE_- und __-Namen sowie ein nacktes Präfix nicht", () => {
    assert.deepEqual(zaehle("ZD_DIFF_BASE $ZD_X env.ZD_PR_BODY", B), { Env: 3 });
    assert.deepEqual(zaehle("VITE_ZD_PW __ZD_X__ zd_x ZD_ ZD_a", B), {});
  });
  test("Env entfällt ohne gültiges Commit-Zeilen-Präfix", () => {
    const ohne = begriffeAus({ repo: "acme/demo", boards: [{ besitzer: "acme" }], ...NEU, praefixe: { commitZeile: "", branch: "feature/zd-", worktree: "zd-" } });
    assert.equal("Env" in ohne, false);
  });
  test("Branch und Worktree zählen wörtlich; der Branch enthält das Worktree-Präfix, beides zählt (gewollte Doppelzählung)", () => {
    assert.deepEqual(zaehle("feature/zd-12", B), { Branch: 1, Worktree: 1 });
    assert.deepEqual(zaehle("zd-12 und Feature/ZD-12", B), { Worktree: 1, Praefix: 1 });
    assert.deepEqual(zaehle("zdx12", B), {});
  });
  test("Label zählt nur Werte mit Doppelpunkt, doppelte Werte einmal, forum nie, groß/klein-genau", () => {
    assert.deepEqual(zaehle("area:werk status:steckt forum", B), { Label: 2 });
    assert.deepEqual(zaehle("AREA:WERK", B), {});
    const nur = begriffeAus({ repo: "acme/demo", boards: [{ besitzer: "acme" }], ...NEU, labels: { forum: "forum", harness: "x:y" } });
    assert.deepEqual(zaehle("forum x:y", nur), { Label: 1 });
    const keins = begriffeAus({ repo: "acme/demo", boards: [{ besitzer: "acme" }], ...NEU, labels: { forum: "forum" } });
    assert.equal("Label" in keins, false);
  });
  test("Agent: längster Name zuerst (kein Doppeltreffer im Langnamen), groß/klein-genau", () => {
    assert.deepEqual(zaehle("wk-planer wk-umsetzer wk Wk-planer", B), { Agent: 3 });
    // Kurzname steht in der Config vor dem Langnamen, und der Rest des Langnamens ist selbst ein Name: ohne Längen-Sortierung zählte "wk-lens" doppelt.
    const kurzZuerst = begriffeAus({ repo: "acme/demo", boards: [{ besitzer: "acme" }], ...NEU, agenten: { planer: "wk", umsetzer: "wk-lens", lens: "lens", gruppe: "g", ticketSkill: "t" } });
    assert.deepEqual(zaehle("wk-lens", kurzZuerst), { Agent: 1 });
  });
});

describe("begriffeAus Skill", () => {
  test("Skill-Namen aus config.skills zählen als ganze Wörter, groß/klein-genau; ohne skills keine Kategorie", () => {
    const b = begriffeAus({ repo: "acme/demo", boards: [{ besitzer: "acme" }], ...NEU, skills: { abschluss: "zz-abschluss", extra: "zz-extra" } });
    assert.deepEqual(zaehle("zz-abschluss und zz-extra, `zz-abschluss`", b), { Skill: 3 });
    assert.deepEqual(zaehle("zz-abschlussbericht zz-abschluss-bericht Zz-Abschluss mein-zz-abschluss", b), {});
    assert.equal("Skill" in begriffeAus({ repo: "acme/demo", boards: [{ besitzer: "acme" }], ...NEU }), false);
  });
});

describe("einheitText", () => {
  test("Datei, Block, JSON-Schlüssel und nicht Auflösbares", () => {
    assert.equal(einheitText(ein("a"), "x"), "x");
    const blk = ein("a", { block: "b" });
    assert.equal(einheitText(blk, `v\n${markerStart("b")}\ndemo\n${markerEnde("b")}\nn`)?.includes("demo"), true);
    assert.equal(einheitText(blk, `${markerEnde("b")}\n${markerStart("b")}`), null);
    assert.equal(einheitText(blk, `x ${markerEnde("b")} demo`), null);
    const sch = ein("a", { schluessel: "k" });
    assert.equal(einheitText(sch, '{"k":{"x":"acme"},"z":"demo"}'), '{"x":"acme"}');
    assert.equal(einheitText(sch, '{"z":1}'), null);
    assert.equal(einheitText(sch, "kein json"), null);
  });
});

describe("pruefeManifest", () => {
  const lies = (t: string | null) => (): string | null => t;
  const ok = (eintraege: Eintrag[]): Manifest => ({ version: 1, eintraege });
  test("gültige Einheiten aller Arten sind grün", () => {
    const m = ok([ein("a"), ein("b", { block: "x" }), ein("c", { schluessel: "k" })]);
    const lies3 = (p: string): string | null =>
      p === "a" ? "t" : p === "b" ? `${markerStart("x")}\n${markerEnde("x")}` : '{"k":1}';
    assert.deepEqual(pruefeManifest(m, lies3), []);
  });
  test("Negativfälle", () => {
    const blk = ein("a", { block: "x" });
    const meld = (m: Manifest, t: string | null): string => pruefeManifest(m, lies(t)).join("|");
    assert.match(meld(ok([blk]), "nichts"), /genau einmal/);
    assert.match(meld(ok([blk]), `${markerStart("x")}${markerStart("x")}${markerEnde("x")}`), /genau einmal/);
    assert.match(meld(ok([blk]), `${markerEnde("x")}${markerStart("x")}`), /vor dem Start/);
    assert.match(meld(ok([blk]), `${markerStart("x")}${markerEnde("x")}${markerEnde("x")}`), /genau einmal/);
    assert.match(meld(ok([ein("a", { schluessel: "k" })]), '{"z":1}'), /JSON-Schlüssel fehlt/);
    assert.match(meld(ok([ein("a", { schluessel: "k" })]), "{kaputt"), /JSON-Schlüssel fehlt/);
    assert.match(meld(ok([ein("a"), ein("a", { schluessel: "k" })]), '{"k":1}'), /ganz und als Teil/);
    assert.match(meld(ok([ein("a"), ein("a")]), "t"), /doppelte Einheit/);
    assert.match(meld(ok([ein("a", { ring: "x" })]), "t"), /unbekannter Ring/);
    assert.match(meld(ok([ein("a")]), null), /existiert nicht/);
    assert.match(meld({ version: 2, eintraege: [] }, "t"), /version/);
    assert.match(meld(ok([ein("a", { quelle: " " })]), "t"), /quelle fehlt/);
    assert.match(meld(ok([ein("a", { block: "x", schluessel: "k" })]), "t"), /zugleich/);
    for (const unsicher of ["/etc/x", "../x", "a/../x", "a\\b", "a//b", "C:/x", "", "a/./b"]) {
      assert.match(meld(ok([ein(unsicher)]), "t"), /Pfad unsicher/, unsicher);
    }
  });
});

describe("diffBasisModus", () => {
  test("Basis da, lokal ohne Basis entfällt, in der CI ohne Basis rot", () => {
    assert.equal(diffBasisModus("abc", {}), "pruefen");
    assert.equal(diffBasisModus("abc", { CI: "true" }), "pruefen");
    assert.equal(diffBasisModus(null, {}), "entfaellt");
    assert.equal(diffBasisModus(null, { CI: "true" }), "rot");
  });
});

describe("vergleiche", () => {
  test("Gleichstand ist grün", () => {
    assert.deepEqual(vergleiche({ a: { Repo: 2 } }, { a: { Repo: 2 } }), []);
    assert.deepEqual(vergleiche({}, {}), []);
  });
  test("neues Literal nennt Einheit und Begriff", () => {
    const m = vergleiche({ "x.mjs": { Owner: 1 } }, {});
    assert.equal(m.length, 1);
    assert.match(m[0] ?? "", /^x\.mjs: neues Projektliteral 'Owner'/);
  });
  test("über Baseline nennt den Weg: Prosa und Literale in Kern-Einheiten ohne Projektwort schreiben", () => {
    assert.match(vergleiche({ a: { Repo: 3 } }, { a: { Repo: 2 } }).join(), /neue Prosa und Literale in Kern-Einheiten ohne Projektwort schreiben \(Baseline sinkt nur\)/);
  });
  test("Env nennt den Weg FACTORY_<NAME> über umgebungsWert, andere Begriffe nicht", () => {
    assert.match(vergleiche({ "x.mjs": { Env: 1 } }, {}).join(), /FACTORY_<NAME>.*umgebungsWert/);
    assert.match(vergleiche({ "x.mjs": { Env: 2 } }, { "x.mjs": { Env: 1 } }).join(), /FACTORY_<NAME>.*umgebungsWert/);
    assert.doesNotMatch(vergleiche({ "x.mjs": { Owner: 1 } }, {}).join(), /FACTORY_/);
  });
  test("über Baseline, unter Baseline, verwaister Eintrag", () => {
    assert.match(vergleiche({ a: { Repo: 3 } }, { a: { Repo: 2 } }).join(), /'Repo' 3x über Baseline 2/);
    assert.match(vergleiche({ a: { Repo: 1 } }, { a: { Repo: 2 } }).join(), /Baseline auf 1 senken/);
    assert.match(vergleiche({}, { a: { Repo: 2 } }).join(), /a: Baseline-Eintrag ohne Literale/);
    assert.match(vergleiche({ a: { Repo: 1 } }, { a: { Repo: 1, Owner: 1 } }).join(), /'Owner' kommt nicht mehr vor/);
  });
});

describe("parseNameStatus / erlaubt / anhebungen", () => {
  const nameStatus = "M\ta.mjs\nA\tneu.mjs\nR090\talt.mjs\tumbenannt.mjs\nD\tweg.mjs\nC075\tq.mjs\tkopie.mjs\nT\tx.mjs\n";
  const aend = parseNameStatus(nameStatus);
  test("parseNameStatus: geändert, neu, umbenannt; gelöscht fehlt", () => {
    assert.equal(aend.get("a.mjs"), "a.mjs");
    assert.equal(aend.get("neu.mjs"), null);
    assert.equal(aend.get("umbenannt.mjs"), "alt.mjs");
    assert.equal(aend.has("weg.mjs"), false);
    assert.equal(aend.get("kopie.mjs"), null);
    assert.equal(aend.get("x.mjs"), "x.mjs");
  });
  const basis = (p: string): string | null => (p === "a.mjs" ? "demo" : p === "alt.mjs" ? "acme acme" : null);
  const einheiten = [ein("a.mjs"), ein("neu.mjs"), ein("umbenannt.mjs"), ein("unberuehrt.mjs")];
  const erl = erlaubt(einheiten, aend, basis, B);
  test("erlaubt: nur berührte Einheiten; neu = 0; Umbenennung = Zählung des alten Pfads", () => {
    assert.deepEqual(erl, { "a.mjs": { Repo: 1 }, "neu.mjs": {}, "umbenannt.mjs": { Owner: 2 } });
  });
  test("anhebungen: Baseline über Basiswert rot, gleich oder darunter grün", () => {
    assert.match(anhebungen({ "a.mjs": { Repo: 2 } }, erl).join(), /a\.mjs: Baseline 'Repo' 2 über dem Wert an der Diff-Basis \(1\)/);
    assert.match(anhebungen({ "neu.mjs": { Owner: 1 } }, erl).join(), /neu\.mjs/);
    assert.match(anhebungen({ "umbenannt.mjs": { Owner: 3 } }, erl).join(), /umbenannt\.mjs/);
    assert.deepEqual(anhebungen({ "a.mjs": { Repo: 1 }, "umbenannt.mjs": { Owner: 1 } }, erl), []);
    assert.deepEqual(anhebungen({ "unberuehrt.mjs": { Repo: 9 } }, erl), []);
  });
  test("neue Einheit einer bestehenden Datei (Manifest-Zuwachs) ist bis zur Zählung an der Basis erlaubt", () => {
    const e = ein("a.mjs", { block: "b" });
    const aen = new Map<string, string | null>([["a.mjs", "a.mjs"]]);
    const text = `${markerStart("b")} demo ${markerEnde("b")}`;
    assert.deepEqual(erlaubt([e], aen, () => text, B), { "a.mjs#b": { Repo: 1 } });
    assert.deepEqual(erlaubt([e], aen, () => "ohne Marker", B), { "a.mjs#b": {} });
  });
});

describe("schichtdatenImporte / pruefeSchichtdatenRegel (#1612)", () => {
  const LAYERS = "scripts/layers.cjs";
  const mit = (pfad: string, text: string): ((p: string) => string | null) => (p) => (p === pfad ? text : null);
  const hits = (pfad: string, text: string, e: Partial<Eintrag> = {}): string[] => schichtdatenImporte([ein(pfad, e)], mit(pfad, text), LAYERS);
  test("rot bei require, import-from und createRequire auf die Schichtdaten, relativ zur importierenden Datei", () => {
    assert.deepEqual(hits("scripts/docs-gen/x.mjs", 'const l = require("../layers.cjs");'), ["scripts/docs-gen/x.mjs"]);
    assert.deepEqual(hits("scripts/y.mjs", 'import { a } from "./layers.cjs";'), ["scripts/y.mjs"]);
    assert.deepEqual(hits("scripts/z.mjs", 'const m = createRequire(import.meta.url)("./layers.cjs");'), ["scripts/z.mjs"]);
    assert.deepEqual(hits("scripts/docs-gen/w.mjs", 'const l = require("../layers");'), ["scripts/docs-gen/w.mjs"]);
    assert.deepEqual(hits("scripts/docs-gen/v.mjs", 'const l = require("../layers-andere");'), []);
  });
  test("kein Verstoß: dynamischer Pfad, anderer aufgelöster Pfad, Markdown, Block- und Schlüssel-Einheit", () => {
    assert.deepEqual(hits("scripts/a.mjs", "const l = require(cfg.layers);"), []);
    assert.deepEqual(hits("scripts/docs-gen/b.mjs", 'require("./layers.cjs")'), []);
    assert.deepEqual(hits("scripts/c.md", 'require("./layers.cjs")'), []);
    assert.deepEqual(hits("scripts/d.mjs", 'require("./layers.cjs")', { block: "b" }), []);
    assert.deepEqual(hits("scripts/e.mjs", 'require("./layers.cjs")', { schluessel: "k" }), []);
    assert.deepEqual(schichtdatenImporte([ein("scripts/f.mjs")], () => null, LAYERS), []);
  });
  test("Regel: Verstoß ohne Ausnahme, Ausnahme ohne Ticket und veraltete Ausnahme sind rot", () => {
    assert.match(pruefeSchichtdatenRegel(["scripts/a.mjs"], {}).join(), /^scripts\/a\.mjs: importiert die Schichtdaten statisch/);
    assert.match(pruefeSchichtdatenRegel(["scripts/a.mjs"], { "scripts/a.mjs": "später" }).join(), /Ausnahme ohne Ticket/);
    assert.match(pruefeSchichtdatenRegel([], { "scripts/a.mjs": "#9 x" }).join(), /Ausnahme veraltet/);
    assert.deepEqual(pruefeSchichtdatenRegel(["scripts/a.mjs"], { "scripts/a.mjs": "#9 x" }), []);
  });
});

describe("importeAus / lokaleImporteTransitiv (gemeinsamer Helfer, #1646)", () => {
  test("importeAus erkennt alle Formen, auch die großzügige Aufruf-Form; dynamische Pfade nicht", () => {
    assert.deepEqual(importeAus('import { x } from "./a.mjs";'), ["./a.mjs"]);
    assert.deepEqual(importeAus("import './a.mjs';"), ["./a.mjs"]);
    assert.deepEqual(importeAus('import y from "./c.mjs"; import z from "../d.mjs";'), ["./c.mjs", "../d.mjs"]);
    assert.deepEqual(importeAus('export { x } from "./a.mjs";'), ["./a.mjs"]);
    assert.deepEqual(importeAus('const m = await import("./a.mjs");'), ["./a.mjs"]);
    assert.deepEqual(importeAus("const q = require('../layers');"), ["../layers"]);
    assert.deepEqual(importeAus('createRequire(import.meta.url)("./a.cjs")'), ["./a.cjs"]);
    assert.deepEqual(importeAus('const x = f(a)("./b.cjs");'), ["./b.cjs"]);
    assert.deepEqual(importeAus("const q = require(pfad);"), []);
    assert.deepEqual(importeAus("const q = createRequire(import.meta.url)(layersPfad);"), []);
  });
  test("relativeImporte filtert Pakete und node:* heraus und entdoppelt", () => {
    assert.deepEqual(relativeImporte('import "node:fs"; import x from "pkg"; require("./a.cjs"); createRequire(u)("./a.cjs");'), ["./a.cjs"]);
  });
  test("kandidatenPfade: mit Endung nur der Pfad selbst, endungslos je Code-Endung", () => {
    assert.deepEqual(kandidatenPfade("scripts/a.mjs"), ["scripts/a.mjs"]);
    assert.deepEqual(kandidatenPfade("scripts/daten.json"), ["scripts/daten.json"]);
    assert.deepEqual(kandidatenPfade("scripts/a"), ["scripts/a.mjs", "scripts/a.cjs", "scripts/a.js"]);
    // Ein Punkt im Ordnernamen macht den Basisnamen nicht zu einem mit Endung.
    assert.deepEqual(kandidatenPfade("scripts/v1.2/a"), ["scripts/v1.2/a.mjs", "scripts/v1.2/a.cjs", "scripts/v1.2/a.js"]);
  });
  test("bekannte Grenze (fail-closed): ein require-Literal im Kommentar zählt weiter als Import", () => {
    assert.deepEqual(relativeImporte('// siehe require("./x") im Altcode\nconst a = 1;'), ["./x"]);
    assert.deepEqual(relativeImporte("// require(pfad) und require ohne Literal"), []);
  });
  test("endungsloses require wird über lies aufgelöst und gehört zur Kette", () => {
    const dateien: Record<string, string> = { "scripts/a.mjs": 'const l = require("./layers");', "scripts/layers.cjs": "module.exports = {};" };
    const lies = (rel: string): string => {
      if (!(rel in dateien)) throw new Error("ENOENT " + rel);
      return dateien[rel] ?? "";
    };
    assert.deepEqual(lokaleImporteTransitiv(["scripts/a.mjs"], lies), ["scripts/a.mjs", "scripts/layers.cjs"]);
  });
  test("unauflösbarer endungsloser Import wirft (fail-closed)", () => {
    const lies = (rel: string): string => {
      if (rel === "scripts/a.mjs") return 'require("./fehlt")';
      throw new Error("ENOENT " + rel);
    };
    assert.throws(() => lokaleImporteTransitiv(["scripts/a.mjs"], lies), /nicht auflösbar/);
  });
});

describe("kernVerzeichnisse / pruefeAbdeckung (#1613)", () => {
  const E = [ein("scripts/a.mjs"), ein("scripts/b.mjs"), ein(".claude/agents/x.md"), ein("AGENTS.md", { block: "s" }), ein(".claude/settings.json", { schluessel: "k" })];
  const klar = (extra: Record<string, AbdeckEintrag> = {}): Record<string, AbdeckEintrag> => ({ "scripts/c.mjs": { art: "projekt", grund: "Projektdatei" }, ...extra });
  const dateien = ["scripts/a.mjs", "scripts/b.mjs", "scripts/c.mjs", ".claude/agents/x.md", "scripts/docs-gen/tief.mjs", "src/y.ts", ".claude/settings.json"];
  test("Kern-Verzeichnisse sind die Ordner der Ganz-Datei-Einheiten, nicht rekursiv, Teil-Einheiten zählen nicht", () => {
    assert.deepEqual([...kernVerzeichnisse(E)].sort(), [".claude/agents", "scripts"]);
  });
  test("eingeordnete Dateien sind grün; Dateien außerhalb der Kern-Verzeichnisse und tiefer liegende zählen nicht", () => {
    assert.deepEqual(pruefeAbdeckung(E, dateien, klar()), []);
  });
  test("eine nicht eingeordnete Datei im Kern-Verzeichnis ist rot und nennt Datei und Weg", () => {
    const m = pruefeAbdeckung(E, [...dateien, "scripts/neu.mjs", ".claude/agents/neu.md"], klar()).join("|");
    assert.match(m, /scripts\/neu\.mjs: liegt in einem Kern-Verzeichnis.*kern-abdeckung\.json/);
    assert.match(m, /\.claude\/agents\/neu\.md/);
  });
  test("Skill-Quellen, Zeiger und Agenten sind eine feste Fläche, auch wenn das Manifest dort nichts besitzt", () => {
    const skill = [`${QUELL_VERZEICHNIS as string}/s/SKILL.md`, `${ZEIGER_WURZEL as string}/s/SKILL.md`];
    const m = pruefeAbdeckung([ein("scripts/a.mjs")], ["scripts/a.mjs", ...skill, ".claude/agents/neu.md", `${QUELL_VERZEICHNIS as string}/s/tief/x.md`], {}).join("|");
    for (const p of [...skill, ".claude/agents/neu.md"]) assert.ok(m.includes(`${p}: liegt in einem Kern-Verzeichnis`), p);
    assert.ok(!m.includes("tief/x.md"), "tiefer als <skill>/<datei> zählt nicht");
    assert.deepEqual(pruefeAbdeckung([ein("scripts/a.mjs")], ["scripts/a.mjs", ...skill], { [skill[0]]: { art: "projekt", grund: "g" }, [skill[1]]: { art: "projekt", grund: "g" } }), []);
  });
  test("Muster mit * deckt eine Dateigruppe, aber nicht über Ordnergrenzen", () => {
    const abd = klar({ "scripts/neu-*.mjs": { art: "modul", grund: "Modul" } });
    assert.deepEqual(pruefeAbdeckung(E, [...dateien, "scripts/neu-eins.mjs"], abd), []);
    assert.match(pruefeAbdeckung(E, [...dateien, "scripts/neu-eins.mjs", "scripts/neu-x.mjs.bak"], abd).join(), /neu-x\.mjs\.bak: liegt/);
  });
  test("veralteter Eintrag, Eintrag auf Besitz, unbekannte art, leerer Grund, offen ohne Ticket sind rot", () => {
    assert.match(pruefeAbdeckung(E, dateien, klar({ "scripts/weg.mjs": { art: "projekt", grund: "x" } })).join(), /scripts\/weg\.mjs: Eintrag ohne Treffer/);
    assert.match(pruefeAbdeckung(E, dateien, klar({ "scripts/a.mjs": { art: "projekt", grund: "x" } })).join(), /trifft die Besitz-Datei scripts\/a\.mjs/);
    assert.match(pruefeAbdeckung(E, dateien, { "scripts/c.mjs": { art: "egal", grund: "x" } }).join(), /unbekannte art 'egal'/);
    assert.match(pruefeAbdeckung(E, dateien, { "scripts/c.mjs": { art: "projekt", grund: " " } }).join(), /grund fehlt/);
    assert.match(pruefeAbdeckung(E, dateien, { "scripts/c.mjs": { art: "offen", grund: "später" } }).join(), /braucht ein Ticket/);
    assert.deepEqual(pruefeAbdeckung(E, dateien, { "scripts/c.mjs": { art: "offen", grund: "#12 klären" } }), []);
  });
  test("ein Projekt-Generator im Kern-Ordner ist rot, auch mit Abdeckungs-Eintrag; in einem Projektordner grün", () => {
    const abd = klar({ "scripts/docs-gen/x.mjs": { art: "projekt", grund: "g" } });
    const mitX = [...dateien, "scripts/docs-gen/x.mjs"];
    assert.match(pruefeAbdeckung([...E, ein("scripts/docs-gen/r.mjs")], mitX, abd, ["scripts/docs-gen/x.mjs"]).join(), /scripts\/docs-gen\/x\.mjs: Projekt-Generator im Kern-Ordner scripts\/docs-gen/);
    assert.match(pruefeAbdeckung(E, dateien, klar(), ["scripts/x.mjs"]).join(), /scripts\/x\.mjs: Projekt-Generator im Kern-Ordner scripts,/);
    assert.deepEqual(pruefeAbdeckung(E, dateien, klar(), ["scripts/projekt/docs-gen/x.mjs"]), []);
    assert.match(pruefeAbdeckung(E, dateien, klar(), ["./scripts/x.mjs"]).join(), /Projekt-Generator im Kern-Ordner scripts,/);
  });
});

describe("huellenVerstoesse / pruefeHuelle (#1613)", () => {
  const E = [ein("scripts/a.mjs"), ein("scripts/b.mjs", { ring: "kern-nach-entkopplung" }), ein("AGENTS.md", { block: "s" })];
  const mit = (m: Record<string, string>): ((p: string) => string | null) => (p) => m[p] ?? null;
  const ring = (pfad: string): string | undefined => E.find((e) => e.pfad === pfad)?.ring;
  test("Import auf Besitz oder die Projekt-Config ist erlaubt, ein Import auf Nicht-Besitz ist ein Verstoß", () => {
    assert.deepEqual(huellenVerstoesse(E, mit({ "scripts/a.mjs": 'import { x } from "./b.mjs";' })), []);
    assert.deepEqual(huellenVerstoesse(E, mit({ "scripts/a.mjs": 'import c from "../.factory/projekt.json";' })), []);
    assert.deepEqual(huellenVerstoesse(E, mit({ "scripts/a.mjs": 'import { x } from "./proj.mjs";' })), ["scripts/a.mjs -> scripts/proj.mjs"]);
    assert.deepEqual(huellenVerstoesse(E, mit({ "scripts/a.mjs": 'const c = require("../x.cjs");' })), ["scripts/a.mjs -> x.cjs"]);
  });
  test("endungsloser Import wird gegen Besitz aufgelöst; auf Nicht-Besitz und ein .js-Import auf Nicht-Besitz sind Verstöße", () => {
    assert.deepEqual(huellenVerstoesse(E, mit({ "scripts/a.mjs": 'const b = require("./b");' })), []);
    assert.deepEqual(huellenVerstoesse(E, mit({ "scripts/a.mjs": 'const b = require("./proj");' })), ["scripts/a.mjs -> scripts/proj"]);
    assert.deepEqual(huellenVerstoesse(E, mit({ "scripts/a.mjs": 'import "./x.js";' })), ["scripts/a.mjs -> scripts/x.js"]);
    // Jede aufgelöste Endung einzeln: .cjs und .js im Besitz.
    const E2 = [...E, ein("scripts/c.cjs"), ein("scripts/d.js")];
    assert.deepEqual(huellenVerstoesse(E2, mit({ "scripts/a.mjs": 'const c = require("./c"); const d = require("./d");' })), []);
  });
  test("JSON-Importe zählen, fremde JSON-Dateien sind ein Verstoß", () => {
    assert.deepEqual(huellenVerstoesse(E, mit({ "scripts/a.mjs": 'import c from "./daten.json";' })), ["scripts/a.mjs -> scripts/daten.json"]);
  });
  test("Block- und Schlüssel-Einheiten, Nicht-Code-Dateien und fehlende Dateien werden nicht gelesen", () => {
    const eintraege = [ein("AGENTS.md", { block: "s" }), ein("scripts/n.md"), ein("scripts/fehlt.mjs")];
    assert.deepEqual(huellenVerstoesse(eintraege, mit({ "AGENTS.md": 'from "./z.mjs"', "scripts/n.md": 'from "./z.mjs"' })), []);
  });
  test("Regel: Verstoß ohne Ausnahme rot; Ausnahme ohne Grund-Verweis, im Ring kern und veraltet rot", () => {
    const v = "scripts/b.mjs -> scripts/proj.mjs";
    assert.match(pruefeHuelle([v], {}, ring).join(), /scripts\/b\.mjs -> scripts\/proj\.mjs: ein Kern-Modul importiert nur Besitz/);
    assert.deepEqual(pruefeHuelle([v], { [v]: "ADR 0022 F6: Grund" }, ring), []);
    assert.deepEqual(pruefeHuelle([v], { [v]: "#12 Grund" }, ring), []);
    assert.match(pruefeHuelle([v], { [v]: "später" }, ring).join(), /Ausnahme ohne Ticket/);
    const vk = "scripts/a.mjs -> scripts/proj.mjs";
    assert.match(pruefeHuelle([vk], { [vk]: "#12 Grund" }, ring).join(), /nur für Importeure im Ring kern-nach-entkopplung/);
    assert.match(pruefeHuelle([], { [v]: "#12 Grund" }, ring).join(), /Ausnahme veraltet/);
  });
  test("Negativfall: ein Importeur im Ring oberflaeche bekommt keine Ausnahme (ADR 0029)", () => {
    const vo = "scripts/cockpit/o.mjs -> scripts/proj.mjs";
    const ringO = (p: string): string | undefined => (p === "scripts/cockpit/o.mjs" ? "oberflaeche" : ring(p));
    assert.match(pruefeHuelle([vo], { [vo]: "#12 Grund" }, ringO).join(), /nur für Importeure im Ring kern-nach-entkopplung/);
  });
});

describe("ringVerstoesse (Ring-Regel der Import-Hülle, #1663)", () => {
  const E = [
    ein("scripts/a.mjs"),
    ein("scripts/k.mjs"),
    ein("scripts/n.mjs", { ring: "kern-nach-entkopplung" }),
    ein("scripts/m.mjs", { ring: "kern-nach-entkopplung" }),
    ein("AGENTS.md", { block: "s" }),
  ];
  const mit = (m: Record<string, string>): ((p: string) => string | null) => (p) => m[p] ?? null;
  test("Kern importiert Kern oder die Projekt-Config: grün; Importeur im Ring kern-nach-entkopplung darf beide Kern-Ringe importieren", () => {
    assert.deepEqual(ringVerstoesse(E, mit({ "scripts/a.mjs": 'import { x } from "./k.mjs"; import c from "../.factory/projekt.json";' })), []);
    assert.deepEqual(ringVerstoesse(E, mit({ "scripts/n.mjs": 'import { x } from "./a.mjs"; import { y } from "./m.mjs";' })), []);
  });
  test("Negativfall: Kern importiert Besitz im Ring kern-nach-entkopplung, auch endungslos", () => {
    assert.deepEqual(ringVerstoesse(E, mit({ "scripts/a.mjs": 'import { x } from "./n.mjs";' })), ["scripts/a.mjs -> scripts/n.mjs"]);
    assert.deepEqual(ringVerstoesse(E, mit({ "scripts/a.mjs": 'const n = require("./n");' })), ["scripts/a.mjs -> scripts/n.mjs"]);
  });
  test("oberflaeche darf kern, kern-nach-entkopplung und oberflaeche importieren (ADR 0029)", () => {
    const O = [...E, ein("scripts/cockpit/o.mjs", { ring: "oberflaeche" }), ein("scripts/cockpit/p.mjs", { ring: "oberflaeche" })];
    for (const ziel of ["../a.mjs", "../n.mjs", "./p.mjs"]) {
      assert.deepEqual(ringVerstoesse(O, mit({ "scripts/cockpit/o.mjs": `import { x } from "${ziel}";` })), [], ziel);
    }
  });
  test("Negativfall: kern und kern-nach-entkopplung importieren oberflaeche", () => {
    const O = [...E, ein("scripts/cockpit/o.mjs", { ring: "oberflaeche" })];
    assert.deepEqual(ringVerstoesse(O, mit({ "scripts/a.mjs": 'import { x } from "./cockpit/o.mjs";' })), ["scripts/a.mjs -> scripts/cockpit/o.mjs"]);
    assert.deepEqual(ringVerstoesse(O, mit({ "scripts/n.mjs": 'import { x } from "./cockpit/o.mjs";' })), ["scripts/n.mjs -> scripts/cockpit/o.mjs"]);
  });
  test("Negativfall: ein Importeur mit unbekanntem Ring importiert keinen Besitz (fail-closed)", () => {
    const U = [...E, ein("scripts/u.mjs", { ring: "unbekannt" })];
    for (const ziel of ["./a.mjs", "./n.mjs"]) {
      assert.deepEqual(ringVerstoesse(U, mit({ "scripts/u.mjs": `import { x } from "${ziel}";` })), [`scripts/u.mjs -> scripts/${ziel.slice(2)}`], ziel);
    }
  });
  test("Nicht-Besitz-Ziel ist Sache der Import-Hülle; Nicht-Code, Block-Einheit und fehlende Datei werden nicht gelesen", () => {
    assert.deepEqual(ringVerstoesse(E, mit({ "scripts/a.mjs": 'import { x } from "./fremd.mjs";' })), []);
    assert.deepEqual(ringVerstoesse([ein("AGENTS.md", { block: "s" }), ein("scripts/n.md"), ein("scripts/n.mjs", { ring: "kern-nach-entkopplung" })], mit({ "AGENTS.md": 'from "./n.mjs"', "scripts/n.md": 'from "./n.mjs"' })), []);
    assert.deepEqual(ringVerstoesse(E, () => null), []);
  });
});

describe("ueberfluessigeEntkopplung (Ring ohne Grund, #1740)", () => {
  const E = [
    ein("scripts/n.mjs", { ring: "kern-nach-entkopplung" }),
    ein("scripts/k.mjs"),
    ein("scripts/m.mjs", { ring: "kern-nach-entkopplung" }),
  ];
  const mit = (m: Record<string, string>): ((p: string) => string | null) => (p) => m[p] ?? null;
  test("ohne Baseline-Eintrag und nur Kern-Importe (oder keine): gemeldet, auch endungslos und mit Projekt-Config", () => {
    assert.deepEqual(ueberfluessigeEntkopplung(E, {}, mit({ "scripts/n.mjs": 'import { x } from "./k.mjs";' })), ["scripts/n.mjs"]);
    assert.deepEqual(ueberfluessigeEntkopplung(E, {}, mit({ "scripts/n.mjs": 'const k = require("./k");' })), ["scripts/n.mjs"]);
    assert.deepEqual(ueberfluessigeEntkopplung([E[0]], {}, mit({ "scripts/n.mjs": 'import c from "../.factory/projekt.json";' })), ["scripts/n.mjs"]);
    assert.deepEqual(ueberfluessigeEntkopplung([E[0]], {}, mit({ "scripts/n.mjs": "const x = 1;" })), ["scripts/n.mjs"]);
  });
  test("Baseline-Literale, ein Import auf Ring kern-nach-entkopplung oder auf Nicht-Besitz halten die Einheit im Ring", () => {
    assert.deepEqual(ueberfluessigeEntkopplung(E, { "scripts/n.mjs": { Repo: 1 } }, mit({ "scripts/n.mjs": "const x = 1;" })), []);
    assert.deepEqual(ueberfluessigeEntkopplung(E, {}, mit({ "scripts/n.mjs": 'import { x } from "./m.mjs";' })), []);
    assert.deepEqual(ueberfluessigeEntkopplung(E, {}, mit({ "scripts/n.mjs": 'import { x } from "./fremd.mjs";' })), []);
  });
  test("Ring kern, Nicht-Code, Block-Einheit und fehlende Datei werden nicht gemeldet", () => {
    assert.deepEqual(ueberfluessigeEntkopplung(E, {}, mit({ "scripts/k.mjs": "const x = 1;" })), []);
    assert.deepEqual(ueberfluessigeEntkopplung([ein("scripts/n.md", { ring: "kern-nach-entkopplung" }), ein("A.md", { block: "s", ring: "kern-nach-entkopplung" })], {}, mit({ "scripts/n.md": "x", "A.md": "x" })), []);
    // Block- und Schlüssel-Einheiten auf Code-Pfaden fallen am Filter heraus (nicht an der Endung); ein Block mit gleichem Pfad überschreibt den Ring der Ganz-Datei-Einheit nicht.
    const eigen = [
      ein("scripts/b.mjs", { block: "s", ring: "kern-nach-entkopplung" }),
      ein("scripts/s.mjs", { schluessel: "x", ring: "kern-nach-entkopplung" }),
      ein("scripts/g.mjs", { ring: "kern-nach-entkopplung" }),
      ein("scripts/g.mjs", { block: "t", ring: "kern" }),
    ];
    assert.deepEqual(ueberfluessigeEntkopplung(eigen, {}, mit({ "scripts/b.mjs": "const x = 1;", "scripts/s.mjs": "const x = 1;", "scripts/g.mjs": "const x = 1;" })), ["scripts/g.mjs"]);
    assert.deepEqual(ueberfluessigeEntkopplung(E, {}, () => null), []);
  });
});

describe("spielGeneratorVerstoesse (Kern-Registry ohne Spiel-Generator, ADR 0022 F6)", () => {
  const PG = { "wetter-karte": { datei: "scripts/docs-gen/wetter.mjs" } };
  const kein = () => false;
  test("sauber: kein Import, kein Kern-Name, kein Besitz", () => {
    assert.deepEqual(spielGeneratorVerstoesse(["scripts/docs-gen/adr.mjs"], ["adr-liste"], PG, kein), []);
    assert.deepEqual(spielGeneratorVerstoesse([], [], {}, kein), []);
  });
  test("Regel 1: die Registry importiert die Datei eines Projekt-Generators (auch nicht normalisiert in der Config)", () => {
    assert.equal(spielGeneratorVerstoesse(["scripts/docs-gen/wetter.mjs"], [], PG, kein).length, 1);
    assert.equal(spielGeneratorVerstoesse(["scripts/docs-gen/wetter.mjs"], [], { "wetter-karte": { datei: "scripts/docs-gen/../docs-gen/wetter.mjs" } }, kein).length, 1);
    assert.match(spielGeneratorVerstoesse(["scripts/docs-gen/wetter.mjs"], [], PG, kein)[0] ?? "", /importiert den Projekt-Generator/);
  });
  test("Regel 2: der Marker ist zugleich ein Kern-Name", () => {
    assert.match(spielGeneratorVerstoesse([], ["wetter-karte"], PG, kein)[0] ?? "", /zugleich ein Kern-Generator/);
  });
  test("Regel 3: die Datei eines Projekt-Generators ist Besitz", () => {
    assert.match(spielGeneratorVerstoesse([], [], PG, (p) => p === "scripts/docs-gen/wetter.mjs")[0] ?? "", /Factory-Besitz/);
    assert.deepEqual(spielGeneratorVerstoesse([], [], PG, (p) => p === "anderes.mjs"), []);
  });
  test("die Hülle meldet einen Import der Registry auf eine Nicht-Besitz-Datei ebenfalls (Zusammenspiel)", () => {
    assert.notDeepEqual(pruefeHuelle(["scripts/docs-gen/registry.mjs -> scripts/docs-gen/quests.mjs"], {}, () => "kern"), []);
  });
});

// ── Reale Prüfungen ───────────────────────────────────────────────────────────

const lesenWurzel = (pfad: string): string | null => {
  const voll = WURZEL + pfad;
  return existsSync(voll) ? readFileSync(voll, "utf8") : null;
};
/** Dateien der Projekt-Generatoren aus `config.generatoren` (ADR 0022 F10). */
const projektGeneratorPfade = (): string[] => {
  const cfg = JSON.parse(lesenWurzel("scripts/docs-gen/config.json") ?? "{}") as { generatoren?: Record<string, { datei: string }> };
  const pfade = [...new Set(Object.values(cfg.generatoren ?? {}).map((g) => g.datei))];
  if (pfade.length === 0) throw new Error("scripts/docs-gen/config.json: generatoren fehlt oder ist leer");
  return pfade;
};
const manifest = JSON.parse(readFileSync(WURZEL + MANIFEST, "utf8")) as Manifest;
const baseline = JSON.parse(readFileSync(WURZEL + BASELINE, "utf8")) as Baseline;
const echteBegriffe = begriffeAus(projektConfig());

describe("Kern-Reinheit (#1610)", () => {
  test("das Besitz-Manifest ist gültig und nicht trivial", () => {
    assert.deepEqual(pruefeManifest(manifest, lesenWurzel), []);
    assert.ok(manifest.eintraege.length > 50, "Startbestand zu klein");
    assert.ok(manifest.eintraege.some((e) => e.block !== undefined), "kein Block-Eintrag");
    assert.ok(manifest.eintraege.some((e) => e.schluessel !== undefined), "kein Schlüssel-Eintrag");
    assert.ok(manifest.eintraege.some((e) => istGanzeDatei(e)), "kein Datei-Eintrag");
  });

  test("jede Einheit hält ihre Baseline an Projektliteralen, nur sinkend", () => {
    assert.deepEqual(vergleiche(istZaehlung(manifest.eintraege, lesenWurzel, echteBegriffe), baseline), []);
  });

  test("jede getrackte Datei in einem Kern-Verzeichnis ist Besitz oder ausdrücklich eingeordnet (kern-abdeckung.json, #1613)", () => {
    const abdeckung = JSON.parse(readFileSync(WURZEL + ABDECKUNG, "utf8")) as Record<string, AbdeckEintrag>;
    const getrackt = execFileSync("git", ["ls-files"], { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter((p) => p !== "");
    assert.deepEqual(pruefeAbdeckung(manifest.eintraege, getrackt, abdeckung), []);
  });

  test("kein Projekt-Generator aus config.generatoren liegt in einem Kern-Verzeichnis (ADR 0022 F10)", () => {
    const pfade = projektGeneratorPfade();
    assert.ok(pfade.length >= 2, "die Dateien der Projekt-Generatoren stehen in der Config");
    for (const p of pfade) assert.ok(existsSync(WURZEL + p), `${p}: Datei fehlt`);
    assert.deepEqual(pruefeAbdeckung(manifest.eintraege, [], {}, pfade), []);
  });

  test("fehlt der Manifest-Eintrag der Skill-Quelle oder ihres Zeigers, meldet die Abdeckung die Datei (#1866)", () => {
    const abdeckung = JSON.parse(readFileSync(WURZEL + ABDECKUNG, "utf8")) as Record<string, AbdeckEintrag>;
    const getrackt = execFileSync("git", ["ls-files"], { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter((p) => p !== "");
    for (const pfad of [`${QUELL_VERZEICHNIS as string}/review-lenses/SKILL.md`, `${ZEIGER_WURZEL as string}/review-lenses/SKILL.md`]) {
      assert.ok(getrackt.includes(pfad), pfad);
      const ohne = manifest.eintraege.filter((e) => e.pfad !== pfad);
      assert.match(pruefeAbdeckung(ohne, getrackt, abdeckung).join("|"), new RegExp(`${escapeRe(pfad)}: liegt in einem Kern-Verzeichnis`));
    }
  });

  test("jeder lokale Import einer Besitz-Datei ist selbst Besitz oder Projekt-Config (Import-Hülle, #1613)", () => {
    const ringVon = (pfad: string): string | undefined => manifest.eintraege.find((e) => e.pfad === pfad)?.ring;
    assert.deepEqual(pruefeHuelle(huellenVerstoesse(manifest.eintraege, lesenWurzel), KERN_HUELLE_AUSNAHMEN, ringVon), []);
  });

  test("Kern-Registry enthält keinen Spiel-Generator (ADR 0022 F6)", () => {
    const registryPfad = "scripts/docs-gen/registry.mjs";
    assert.deepEqual(KERN_HUELLE_AUSNAHMEN, {}, "keine Ausnahmen der Import-Hülle mehr");
    assert.equal(manifest.eintraege.find((e) => e.pfad === registryPfad && istGanzeDatei(e))?.ring, "kern");
    const cfg = JSON.parse(lesenWurzel("scripts/docs-gen/config.json") ?? "{}") as { generatoren?: Record<string, { datei: string }> };
    assert.ok(cfg.generatoren && Object.keys(cfg.generatoren).length > 0, "scripts/docs-gen/config.json: generatoren fehlt");
    const ziele = relativeImporte(lesenWurzel(registryPfad) ?? "").flatMap((spec) => kandidatenPfade(posix.normalize(posix.join(posix.dirname(registryPfad), spec))));
    const kernNamen = Object.keys((rawRegistry as unknown as { GENERATORS: Record<string, unknown> }).GENERATORS);
    const besitz = new Set(manifest.eintraege.map((e) => e.pfad));
    assert.deepEqual(spielGeneratorVerstoesse(ziele, kernNamen, cfg.generatoren, (p) => besitz.has(p)), []);
  });

  test("kein Importeur verletzt die Ring-Importregel (RING_IMPORTE, #1663, ADR 0029)", () => {
    assert.deepEqual(ringVerstoesse(manifest.eintraege, lesenWurzel), []);
  });

  test("keine Einheit bleibt im Ring kern-nach-entkopplung, die nichts entkoppeln muss (kein Baseline-Eintrag, nur Kern-Importe, #1740)", () => {
    assert.deepEqual(ueberfluessigeEntkopplung(manifest.eintraege, baseline, lesenWurzel), [], "Ring auf kern setzen (kein Literal-Eintrag, nur Kern-Importe)");
  });

  test("kein Kern-Modul importiert die Schichtdaten statisch (Ausnahmen nur mit Ticket, nur schrumpfend, #1612)", () => {
    const cfg = JSON.parse(lesenWurzel("scripts/docs-gen/config.json") ?? "{}") as { schichten?: { layers?: string } };
    const pfad = cfg.schichten?.layers;
    assert.ok(pfad, "scripts/docs-gen/config.json: schichten.layers fehlt");
    const verstoesse = schichtdatenImporte(manifest.eintraege, lesenWurzel, pfad);
    assert.deepEqual(pruefeSchichtdatenRegel(verstoesse, SCHICHTDATEN_AUSNAHMEN), []);
  });

  const git = (args: string[]): string => execFileSync("git", args, { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const basis: string | null = checkBasis.resolveBase(git, process.env) ?? null;

  // In der CI (fail-closed) muss die Basis auflösbar sein; lokal ohne Basis entfällt die Prüfung.
  test.skipIf(diffBasisModus(basis, process.env) === "entfaellt")("die Baseline wurde gegen die Diff-Basis nicht angehoben", () => {
    assert.ok(basis, "keine Diff-Basis auflösbar (FACTORY_DIFF_BASE/origin/main fehlt)");
    const aend = parseNameStatus(git(["diff", "-M", "--name-status", basis]));
    const basisText = (alt: string): string | null => {
      try {
        return git(["show", `${basis}:${alt}`]);
      } catch {
        return null;
      }
    };
    const erl = erlaubt(manifest.eintraege, aend, basisText, echteBegriffe);
    assert.deepEqual(anhebungen(baseline, erl), []);
  });
});

describe("Jedes Projektliteral der Config ist ein Begriff des Wächters (#1843)", () => {
  const literale = Object.entries(projektConfig().projektliterale ?? {});
  test("die Config trägt Projektliterale, sonst wäre der Wächter still aus", () => {
    assert.ok(literale.length > 0, "projektliterale fehlt in der Projekt-Config");
  });
  test.each(literale)("das Literal %s zählt als ganzes Wort, in Wort-Nachbarschaft nicht", (begriff, wert) => {
    const re = echteBegriffe[begriff];
    assert.ok(re, `projektliterale.${begriff} ist kein Begriff des Wächters`);
    // `zaehle` statt `test`: die Regex sind global und tragen lastIndex
    assert.deepEqual(zaehle(wert.toUpperCase(), { [begriff]: re }), { [begriff]: 1 });
    assert.deepEqual(zaehle(`x${wert}x`, { [begriff]: re }), {});
  });
});

describe("Projektliterale nicht im Kern (#1709, ADR 0022 F5)", () => {
  const agentsText = lesenWurzel("AGENTS.md") ?? "";
  const projektBlock = agentsText.slice(agentsText.indexOf("<!-- factory-projekt:start -->"));
  // das erste Projektliteral, das im Projekt-Block der Kontextdatei vorkommt (dort ist es erlaubt)
  const gewaehlt = Object.entries(projektConfig().projektliterale ?? {}).find(([, wert]) => projektBlock.toLowerCase().includes(wert.toLowerCase()));
  assert.ok(gewaehlt, "projektliterale leer oder nicht im Projekt-Block der Kontextdatei");
  const [BEGRIFF, WORT] = gewaehlt;
  const begriff = echteBegriffe[BEGRIFF];
  const IST = (lies: (p: string) => string | null): Baseline => istZaehlung(manifest.eintraege, lies, echteBegriffe);
  const mitAnhang = (pfad: string, anhang: string) => (p: string): string | null => (p === pfad ? (lesenWurzel(p) ?? "") + "\n" + anhang + "\n" : lesenWurzel(p));

  test("der Begriff steht in der Projekt-Config und zählt ohne Beachtung der Groß-/Kleinschreibung", () => {
    assert.ok(begriff, `projektliterale.${BEGRIFF} fehlt in der Projekt-Config, der Wächter wäre still aus`);
    const schreibungen = [WORT.toUpperCase(), WORT.toLowerCase(), WORT[0].toUpperCase() + WORT.slice(1).toLowerCase()].join(" ");
    assert.deepEqual(zaehle(schreibungen, { [BEGRIFF]: begriff }), { [BEGRIFF]: 3 });
  });

  test("keine Kern-Einheit trägt irgendein Projektliteral, die Baseline kennt keines", () => {
    const namen = Object.keys(projektConfig().projektliterale ?? {});
    const treffer = Object.entries(IST(lesenWurzel)).filter(([, z]) => namen.some((n) => n in z)).map(([einheit]) => einheit);
    assert.deepEqual(treffer, []);
    assert.deepEqual(Object.values(baseline).filter((z) => namen.some((n) => n in z)), []);
  });

  test("ein eingeschleuster Treffer ist rot, in einer Markdown- und in einer Skript-Einheit", () => {
    const md = ".claude/agents/factory-planer.md";
    const skript = "scripts/check-size.mjs";
    assert.deepEqual(vergleiche(IST(mitAnhang(md, WORT.toLowerCase())), baseline), [`${md}: neues Projektliteral '${BEGRIFF}' (1x), Kern-Einheiten bleiben literalfrei`]);
    assert.deepEqual(vergleiche(IST(mitAnhang(skript, `// ${WORT.toUpperCase()}`)), baseline), [`${skript}: neues Projektliteral '${BEGRIFF}' (1x), Kern-Einheiten bleiben literalfrei`]);
  });

  test("im Projekt-Block der AGENTS.md ist der Begriff erlaubt (nur der Kern-Block zählt)", () => {
    const einschub = `${WORT} zusätzlich im Projekt-Block`;
    const imBlock = (p: string): string | null => (p === "AGENTS.md" ? agentsText.replace("<!-- factory-projekt:ende -->", `${einschub}\n<!-- factory-projekt:ende -->`) : lesenWurzel(p));
    assert.ok(imBlock("AGENTS.md")?.includes(einschub), "der Anhang landet im Projekt-Block");
    assert.deepEqual(vergleiche(IST(imBlock), baseline), []);
  });
});

describe("Ring-Tabelle (ADR 0029)", () => {
  test("RING_IMPORTE deckt genau die Ringe ab, jede Regel und NUR_FACTORY nennen nur bekannte Ringe", () => {
    assert.deepEqual([...RINGE].sort(), ["kern", "kern-nach-entkopplung", "oberflaeche"]);
    for (const ziele of Object.values(RING_IMPORTE)) assert.ok(ziele.every((r) => RINGE.includes(r)), ziele.join());
    assert.ok(NUR_FACTORY.every((r) => RINGE.includes(r)));
    for (const [ring, ziele] of Object.entries(RING_IMPORTE)) assert.ok(ziele.includes(ring), `${ring} importiert den eigenen Ring`);
    for (const ring of RINGE.filter((r) => !NUR_FACTORY.includes(r))) {
      assert.ok((RING_IMPORTE[ring] ?? []).every((z) => !NUR_FACTORY.includes(z)), `${ring} importiert einen Nur-Factory-Ring`);
    }
  });
  test("pruefeManifest: oberflaeche ist ein Ring, andere Schreibweisen sind unbekannt", () => {
    const m = (ring: string): Manifest => ({ version: 1, eintraege: [ein("a.mjs", { ring })] });
    const lies = (): string | null => "x";
    assert.deepEqual(pruefeManifest(m("oberflaeche"), lies), []);
    for (const ring of ["Oberflaeche", "oberfläche", "oberflaeche "]) assert.match(pruefeManifest(m(ring), lies).join(), /unbekannter Ring/, ring);
  });
  test("wirdVerteilt: nur oberflaeche bleibt in der Factory, ein unbekannter Ring wird verteilt (fail-closed)", () => {
    assert.equal(wirdVerteilt(ein("a", { ring: "oberflaeche" })), false);
    for (const ring of ["kern", "kern-nach-entkopplung", "unbekannt"]) assert.equal(wirdVerteilt(ein("a", { ring })), true, ring);
  });
  test("istZaehlung zählt Projektliterale auch in einer oberflaeche-Einheit (Baseline 0 wird rot)", () => {
    const begriffe = { fremd: /Fremdwort/g };
    const E = [ein("scripts/cockpit/o.mjs", { ring: "oberflaeche" }), ein("scripts/k.mjs")];
    const ist = istZaehlung(E, (p) => (p === "scripts/cockpit/o.mjs" ? "// Fremdwort" : "sauber"), begriffe);
    assert.deepEqual(Object.keys(ist), ["scripts/cockpit/o.mjs"]);
    assert.notDeepEqual(vergleiche(ist, {}), []);
  });
  test("istZaehlung zählt auf dem normalisierten Text: Projektwert-Zeile und -Block zählen nicht, der Rumpf schon (#1746)", () => {
    const begriffe = { fremd: /Fremdwort/g };
    const kopf = "---\n# factory:projektwert agenten.planer\nname: Fremdwort-planer\n---\n";
    const block = "<!-- factory:projektwerte:start -->\n| `agenten.planer` | `Fremdwort` |\n<!-- factory:projektwerte:end -->\n";
    const ist = (text: string): Baseline => istZaehlung([ein("a.md")], () => text, begriffe);
    assert.deepEqual(ist(`${kopf}${block}Text\n`), {});
    assert.deepEqual(Object.values(ist(`${kopf}${block}Fremdwort im Rumpf\n`)), [{ fremd: 1 }]);
    assert.deepEqual(ist(`${kopf}<!-- factory:projektwerte:start -->\nFremdwort\n`), {}); // kaputter Marker: Einheit nicht auflösbar, zählt nichts
  });
  test("istZaehlung: fehlende Datei und Block ohne Marker zählen nichts (null-Guards)", () => {
    const begriffe = { fremd: /Fremdwort/g };
    const E = [ein("fehlt.mjs"), ein("fehlt.md", { block: "b" }), ein("a.md", { block: "b" })];
    assert.deepEqual(istZaehlung(E, (p) => (p === "a.md" ? "Fremdwort ohne Marker" : null), begriffe), {});
  });
});

describe("Kern-Pfade ohne Projektliteral (#1748)", () => {
  // Grenze: geprüft werden nur die Pfade des Manifests und die Rollen-Pfade. Der Repo-Begriff zählt ohne Wortgrenze: ein sehr kurzer Repo-Name kann einen Pfad zufällig treffen.
  test("pfadLiterale: ein Einheitspfad mit Repo-Namen oder Agentennamen ist rot (Negativfall)", () => {
    assert.deepEqual(pfadLiterale([".claude/agents/demo-planer.md"], B), [".claude/agents/demo-planer.md: Projektliteral 'Repo' im Pfad"]);
    assert.deepEqual(pfadLiterale([".claude/agents/wk-planer.md"], B), [".claude/agents/wk-planer.md: Projektliteral 'Agent' im Pfad"]);
    assert.deepEqual(pfadLiterale([".claude/agents/factory-planer.md", ".agents/skills/factory-ticket/SKILL.md"], B), []);
    assert.deepEqual(pfadLiterale([], B), []);
  });
  test("echt: kein Manifest- und kein Rollen-Pfad trägt ein Projektliteral", () => {
    assert.deepEqual(pfadLiterale([...manifest.eintraege.map((e) => e.pfad), ...Object.values(ROLLEN_PFADE)], echteBegriffe), []);
  });
  test("TICKET_SKILL_ORDNER ist der Ordner des Ticket-Skill-Pfads (ohne Dateiname, ohne Schrägstrich am Ende)", () => {
    assert.equal(TICKET_SKILL_ORDNER, ".agents/skills/factory-ticket");
    assert.ok(ROLLEN_PFADE.ticketSkill.startsWith(".agents/skills/"), "der Ticket-Skill-Pfad ist eine Skill-Quelle");
    assert.equal(`${TICKET_SKILL_ORDNER}/SKILL.md`, ROLLEN_PFADE.ticketSkill);
  });
  test("Fitness: die Rollen-Pfade decken genau die Pflicht-Agenten ab, jede Datei existiert und setzt den Namen aus agenten.<rolle>", () => {
    assert.deepEqual(Object.keys(ROLLEN_PFADE), PFLICHT_AGENTEN);
    for (const [rolle, pfad] of Object.entries(ROLLEN_PFADE)) {
      const text = lesenWurzel(pfad);
      assert.notEqual(text, null, `${pfad} fehlt`);
      const stellen = projektwertStellen((text ?? "").replace(/\r\n/g, "\n"), pfad).zeilen;
      assert.ok(stellen.some((s) => s.schluessel === `agenten.${rolle}` && s.name === "name"), `${pfad} setzt name: nicht aus agenten.${rolle}`);
    }
  });
});

// ── Kern-Tests ohne Projektliterale (#1875, #1903, ADR 0022 F10) ──────────────

/** Arten, deren Dateien ins Factory-Repo ziehen und darum Projektliterale zählen: Kern-Tests, ihre Test-Hilfen und Fixtures. */
const GEZAEHLTE_ARTEN = ["kern-test", "test-hilfe", "fixture"];

interface ExtraktionsListe {
  eintraege: { muster?: string; ring?: string; art: string }[];
}
const { artVon, EXTRAKTION_PFAD } = rawBesitz as unknown as { artVon: (liste: ExtraktionsListe, pfad: string) => string | null; EXTRAKTION_PFAD: string };

/** Getrackte Dateien der Arten `kern-test`, `test-hilfe` und `fixture` laut Extraktionsliste. */
export const kernTestPfade = (liste: ExtraktionsListe, getrackt: string[]): string[] => getrackt.filter((p) => GEZAEHLTE_ARTEN.includes(artVon(liste, p) ?? ""));

/** Ist-Zählung je Datei auf dem rohen Text (wie `erlaubt`); Dateien ohne Treffer fehlen. */
export function kernTestIst(pfade: string[], lies: (pfad: string) => string | null, begriffe: Record<string, RegExp>): Baseline {
  const ist: Baseline = {};
  for (const p of pfade) {
    const z = zaehle(lies(p) ?? "", begriffe);
    if (Object.keys(z).length > 0) ist[p] = z;
  }
  return ist;
}

/** Null-Regel (#1903): jeder Treffer in einem Kern-Test, einer Test-Hilfe oder einer Fixture ist rot, ohne Baseline. Leer = grün. */
export function kernTestVerstoesse(pfade: string[], lies: (pfad: string) => string | null, begriffe: Record<string, RegExp>): string[] {
  return vergleiche(kernTestIst(pfade, lies, begriffe), {}).map((m) => `${m} (Kern-Test: Wert aus FREMD bzw. projektConfig() nehmen, Projektinhalt in einen projekt-test)`);
}

describe("Kern-Tests ohne Projektliterale, Null-Regel (#1903)", () => {
  const liste = JSON.parse(readFileSync(WURZEL + EXTRAKTION_PFAD, "utf8")) as ExtraktionsListe;
  const gitIn = (args: string[]): string => execFileSync("git", args, { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const getrackt = gitIn(["ls-files"]).split("\n").filter((p) => p !== "" && existsSync(WURZEL + p));
  const pfade = kernTestPfade(liste, getrackt);
  const config = projektConfig();
  const sprich = (verstoesse: string[]): string[] => verstoesse.map((v) => v.split(" (Kern-Test:")[0]);

  test("kernTestPfade: Kern-Test, Test-Hilfe und Fixture zählen, projekt-test und nicht Eingeordnetes nicht", () => {
    const l: ExtraktionsListe = {
      eintraege: ["kern-test", "projekt-test", "test-hilfe", "fixture", "infrastruktur"].map((art) => ({ muster: `t/${art}.ts`, art })),
    };
    assert.deepEqual(kernTestPfade(l, ["t/kern-test.ts", "t/projekt-test.ts", "t/test-hilfe.ts", "t/fixture.ts", "t/infrastruktur.ts", "t/frei.ts"]), ["t/kern-test.ts", "t/test-hilfe.ts", "t/fixture.ts"]);
  });
  test("im echten Repo trägt keine Datei der drei Arten ein Projektliteral, es gibt keine Baseline", () => {
    assert.ok(pfade.length > 100, "die Kern-Tests werden gefunden (sonst wäre der Wächter still aus)");
    for (const art of GEZAEHLTE_ARTEN) assert.ok(pfade.some((p) => artVon(liste, p) === art), `Art ${art} hat keine Datei, der Wächter wäre dafür still aus`);
    assert.deepEqual(kernTestVerstoesse(pfade, lesenWurzel, echteBegriffe), []);
  });
  test("Negativfall: ein neuer Kern-Test mit einem Commit-Zeilen-Präfix ist rot (eine Meldung mit Datei, Begriff und Weg), auch ohne dass das Literal im Quelltext steht", () => {
    const text = `const zeile = "${config.praefixe.commitZeile}Review: head=abc";\n`;
    const v = kernTestVerstoesse(["test/neu.test.ts"], () => text, echteBegriffe);
    assert.equal(v.length, 1);
    assert.ok(v[0].startsWith("test/neu.test.ts: neues Projektliteral 'Praefix' (1x)"), v[0]);
    assert.ok(v[0].includes("projektConfig()") && v[0].includes("projekt-test"), "die Meldung nennt den Weg");
    assert.deepEqual(kernTestVerstoesse(["test/neu.test.ts"], () => "const x = 1;\n", echteBegriffe), [], "ohne Literal keine Meldung");
  });
  test("Negativfall: jeder Treffer zählt, auch der zweite (kein Baseline-Ausweg)", () => {
    const text = `a ${config.praefixe.commitZeile}1\nb ${config.praefixe.commitZeile}2\n`;
    assert.deepEqual(sprich(kernTestVerstoesse(["test/neu.test.ts"], () => text, echteBegriffe)), ["test/neu.test.ts: neues Projektliteral 'Praefix' (2x), Kern-Einheiten bleiben literalfrei"]);
  });
  test("Negativfall: ein Board-ID-Treffer in einer Fixture und ein Owner-Treffer in einer Test-Hilfe sind rot", () => {
    const statusFeld = config.boards.map((b) => b.statusFeldId).find((id) => id !== undefined);
    assert.ok(statusFeld !== undefined, "die Config trägt ein Status-Feld, sonst wäre die Board-ID-Prüfung stumpf");
    const fixture = kernTestVerstoesse(["test/fixtures/neu.json"], () => `{"feld": "${String(statusFeld)}"}`, echteBegriffe);
    assert.deepEqual(sprich(fixture), ["test/fixtures/neu.json: neues Projektliteral 'Board-ID' (1x), Kern-Einheiten bleiben literalfrei"]);
    const owner = config.repo.split("/")[0];
    const hilfe = kernTestVerstoesse(["test/support/neu.ts"], () => `export const OWNER = "${owner}";\n`, echteBegriffe);
    // `includes` statt Gleichheit: in einer Config mit überlappenden Werten (Owner enthält das Worktree-Präfix) zählen weitere Begriffe mit
    assert.ok(sprich(hilfe).includes("test/support/neu.ts: neues Projektliteral 'Owner' (1x), Kern-Einheiten bleiben literalfrei"), hilfe.join("; "));
  });
  test("Rückfall-Prüfung: ein angehängtes Literal ist in jeder Datei der drei Arten rot, genau eine Meldung", () => {
    const nurPraefix = { Praefix: echteBegriffe.Praefix };
    for (const datei of pfade) {
      const vorher = zaehle(lesenWurzel(datei) ?? "", nurPraefix).Praefix ?? 0; // 0 im Repo ohne Treffer; die Probe mit einer Fremd-Config zählt vorhandene mit
      const text = `${lesenWurzel(datei) ?? ""}\nexpect(x).toBe("${config.praefixe.commitZeile}1");\n`;
      const v = kernTestVerstoesse([datei], () => text, echteBegriffe);
      assert.ok(v.some((m) => m.startsWith(`${datei}: neues Projektliteral 'Praefix' (${vorher + 1}x)`)), `${datei}: ${v.join("; ")}`);
      if (vorher === 0 && Object.keys(kernTestIst([datei], lesenWurzel, echteBegriffe)).length === 0) assert.equal(v.length, 1, `${datei}: genau eine Meldung`);
    }
  });
});
