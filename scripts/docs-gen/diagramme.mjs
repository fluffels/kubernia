// Kein Shebang (siehe docs-gen.mjs). Generatoren `agenten-ablauf`, `agenten-sequenz` und
// `leitplanken-schichten` (#1369): Mermaid-Diagramme aus einer Vorlage unter `docs/diagramme/`.
// Die Topologie (wer ruft wen) ist Erzählung und steht in der Vorlage; alles Ableitbare (Namen,
// Modell/Effort, Zahlen, CI-Job-Namen) sind Platzhalter `${art:wert}`, die beim Generieren gegen ihre
// Quelle geprüft werden (ADR 0017: „generiert oder gegen seine Quelle geprüft“). Ein Name ohne
// passende Datei oder eine Zahl ohne Quelle macht den Generator (und damit `check:docgen`) rot.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MERMAID_FRONTMATTER, parseChain } from "./markdown.mjs";
import { harnessKatalog } from "./harness-inventar.mjs";

const PLATZHALTER = /\$\{([a-z-]+):([^}]*)\}/g;
/** Zeichen, die ein Mermaid-Label oder einen Sequenztext brechen können. */
const UNSICHER = /["<>{};#\r\n]/;
/** Arten, die einen Subagenten, Skill oder Workflow *nennen* (zählen für die Vollständigkeit). */
const NAMENSARTEN = ["agent", "agent-modell", "skill", "skill-modell", "workflow"];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Liest die Job-Namen (`name:` mit 4 Leerzeichen Einrückung unter `jobs.<id>`, Anführungszeichen erlaubt); Workflow- und Step-Namen zählen nicht. */
function ciJobNamen(rootDir, dir) {
  const abs = join(rootDir, dir);
  if (!existsSync(abs)) throw new Error(`CI-Workflow-Ordner ${dir} nicht gefunden (Config diagramme.ciWorkflows veraltet?)`);
  const namen = new Set();
  for (const f of readdirSync(abs).filter((n) => /\.ya?ml$/.test(n))) {
    for (const l of readFileSync(join(abs, f), "utf8").split(/\r?\n/)) {
      const m = /^ {4}name:\s*(.*?)\s*$/.exec(l);
      if (m) namen.add(m[1].replace(/^(["'])(.*)\1$/, "$2"));
    }
  }
  return namen;
}

function konstante(rootDir, cfg, schluessel) {
  const k = cfg.konstanten?.[schluessel];
  if (!k) throw new Error(`Konstante "${schluessel}" steht nicht in config.diagramme.konstanten`);
  const abs = join(rootDir, k.datei);
  if (!existsSync(abs)) throw new Error(`Konstante "${schluessel}": Datei ${k.datei} nicht gefunden`);
  const text = readFileSync(abs, "utf8");
  const decl = new RegExp(`^\\s*(?:export\\s+)?const\\s+${esc(k.name)}\\s*=`, "gm");
  const treffer = text.match(decl) ?? [];
  if (treffer.length === 0) throw new Error(`Konstante "${schluessel}": ${k.name} fehlt in ${k.datei}`);
  if (treffer.length > 1) throw new Error(`Konstante "${schluessel}": ${k.name} steht mehrfach in ${k.datei}`);
  const zahl = new RegExp(`^\\s*(?:export\\s+)?const\\s+${esc(k.name)}\\s*=\\s*(\\d+)\\s*(?:;|//|$)`, "m").exec(text);
  if (!zahl) throw new Error(`Konstante "${schluessel}": ${k.name} in ${k.datei} ist kein Ganzzahl-Literal`);
  return zahl[1];
}

function gatesAnzahl(rootDir, config, kette) {
  const g = config.gates;
  if (!g || !(g.chains ?? []).includes(kette)) throw new Error(`Gate-Kette "${kette}" steht nicht in config.gates.chains`);
  const scripts = JSON.parse(readFileSync(join(rootDir, g.package), "utf8")).scripts ?? {};
  if (typeof scripts[kette] !== "string") throw new Error(`Gate-Kette "${kette}" fehlt in ${g.package}`);
  const schritte = parseChain(scripts[kette]).filter((s) => !g.chains.includes(s));
  return String(schritte.length);
}

const modellText = (eintrag, fallback) => [eintrag.model ?? fallback, eintrag.effort].filter(Boolean).join(" · ");

function finde(liste, name, was) {
  const e = liste.find((x) => x.name === name);
  if (!e) throw new Error(`${was} "${name}" hat keine passende Datei (bekannt: ${liste.map((x) => x.name).join(", ") || "keine"})`);
  return e;
}

/**
 * Ersetzt alle `${art:wert}`-Platzhalter von `text` und prüft sie gegen ihre Quelle.
 * Wirft bei jedem Verstoß (alle Fehlerfälle: siehe test/docgen-diagramme.test.ts).
 */
export function ersetzePlatzhalter(text, { rootDir, config }) {
  const cfg = config.diagramme ?? {};
  const katalog = harnessKatalog(rootDir, config.harness);
  let ciNamen = null;
  const aufloesen = (art, wert) => {
    if (wert.trim() === "") throw new Error(`Platzhalter "${art}" ohne Wert`);
    switch (art) {
      case "agent":
        return finde(katalog.agents, wert, "Subagent").name;
      case "agent-modell":
        return modellText(finde(katalog.agents, wert, "Subagent"), "Session-Modell");
      case "skill":
        return finde(katalog.skills, wert, "Skill").name;
      case "skill-modell":
        return modellText(finde(katalog.skills, wert, "Skill"), "Session-Modell");
      case "workflow":
        return finde(katalog.workflows, wert, "Workflow").name;
      case "konstante":
        return konstante(rootDir, cfg, wert);
      case "gates":
        return gatesAnzahl(rootDir, config, wert);
      case "ci-check": {
        ciNamen ??= ciJobNamen(rootDir, cfg.ciWorkflows ?? ".github/workflows");
        if (!ciNamen.has(wert)) throw new Error(`CI-Check "${wert}" hat keine passende Job-name:-Zeile in ${cfg.ciWorkflows ?? ".github/workflows"}`);
        return wert;
      }
      default:
        throw new Error(`unbekannte Platzhalter-Art "${art}"`);
    }
  };
  const ersetzt = text.replace(PLATZHALTER, (_m, art, wert) => {
    const ersatz = aufloesen(art, wert);
    if (UNSICHER.test(ersatz)) throw new Error(`Ersatzwert für \${${art}:${wert}} enthält ein Zeichen, das Mermaid bricht: ${JSON.stringify(ersatz)}`);
    return ersatz;
  });
  if (ersetzt.includes("${")) throw new Error(`übrig gebliebener Platzhalter-Rest "\${" (Syntax \${art:wert}, ohne } im Wert)`);
  return ersetzt;
}

/** Alle Namen, die `text` über eine Namensart nennt. */
export function genannteNamen(text) {
  const namen = new Set();
  for (const [, art, wert] of text.matchAll(PLATZHALTER)) if (NAMENSARTEN.includes(art)) namen.add(wert);
  return namen;
}

/** Wirft, wenn ein Subagent, Skill oder Workflow aus `.claude/` im Vorlagentext nicht vorkommt. */
export function pruefeVollstaendigkeit(text, katalog, vorlage) {
  const genannt = genannteNamen(text);
  const fehlen = [
    ...katalog.agents.map((a) => ["Subagent", a.name, a.datei]),
    ...katalog.skills.map((s) => ["Skill", s.name, s.datei]),
    ...katalog.workflows.map((w) => ["Workflow", w.name, w.datei]),
  ].filter(([, name]) => !genannt.has(name));
  if (fehlen.length)
    throw new Error(
      `${vorlage}: nicht im Diagramm: ${fehlen.map(([art, name, datei]) => `${art} "${name}" (${datei})`).join(", ")}. ` +
        `Fix: in die Vorlage mit \${agent:NAME}, \${skill:NAME} bzw. \${workflow:NAME} aufnehmen, dann npm run docs:gen`,
    );
}

/** Erzeugt den Generator für die Vorlage `name` aus `config.diagramme.vorlagen`. */
export function diagrammGenerator(name) {
  return ({ rootDir, config }) => {
    const cfg = config.diagramme;
    const pfad = cfg?.vorlagen?.[name];
    if (!pfad) throw new Error(`config.diagramme.vorlagen.${name} fehlt`);
    const abs = join(rootDir, pfad);
    if (!existsSync(abs)) throw new Error(`Vorlage ${pfad} nicht gefunden`);
    const roh = readFileSync(abs, "utf8").replace(/\r\n/g, "\n").trim();
    try {
      if ((cfg.vollstaendig ?? []).includes(name)) pruefeVollstaendigkeit(roh, harnessKatalog(rootDir, config.harness), pfad);
      return ["```mermaid", MERMAID_FRONTMATTER, ersetzePlatzhalter(roh, { rootDir, config }), "```"].join("\n");
    } catch (err) {
      throw new Error(`Vorlage ${pfad}: ${err instanceof Error ? err.message.replace(`${pfad}: `, "") : String(err)}`, { cause: err });
    }
  };
}
