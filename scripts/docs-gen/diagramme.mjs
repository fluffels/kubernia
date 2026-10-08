// Kein Shebang (siehe docs-gen.mjs). Generatoren `agenten-ablauf`, `agenten-sequenz` und
// `leitplanken-schichten` (#1369): Mermaid-Diagramme aus einer Vorlage unter `docs/diagramme/`.
// Die Topologie (wer ruft wen) ist Erzählung und steht in der Vorlage; alles Ableitbare (Namen,
// Modell/Effort, Zahlen, CI-Job-Namen) sind Platzhalter `${art:wert}`, die beim Generieren gegen ihre
// Quelle geprüft werden (ADR 0017: „generiert oder gegen seine Quelle geprüft“). Ein Name ohne
// passende Datei oder eine Zahl ohne Quelle macht den Generator (und damit `check:docgen`) rot.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MERMAID_FRONTMATTER, ganzzahlKonstante, leseJson } from "./markdown.mjs";
import { kettenSchritte } from "./npm-ketten.mjs";
import { harnessKatalog } from "./harness-inventar.mjs";
import { ladeRulesetSpiegel } from "./ruleset-spiegel.mjs";

const PLATZHALTER = /\$\{([a-z-]+):([^}]*)\}/g;
/** Zeichen, die ein Mermaid-Label oder einen Sequenztext brechen können. */
const UNSICHER = /["<>{};#\r\n]/;
/** Arten, die einen Subagenten, Skill oder Workflow *nennen* (zählen für die Vollständigkeit). */
const NAMENSARTEN = ["agent", "agent-modell", "skill", "skill-modell", "workflow"];

const WERT_OHNE_QUOTES = (roh) => {
  const quoted = /^(["'])(.*)\1/.exec(roh);
  return quoted ? quoted[2] : roh.split(/[ \t]#/)[0].trim();
};
const einrueckung = (zeile) => /^[ \t]*/.exec(zeile)[0].length;
const inhaltszeile = (zeile) => zeile.trim() !== "" && !zeile.trim().startsWith("#");

/**
 * Die Job-Namen eines Workflows aus seiner Struktur, nicht aus fester Einrückung (Z2c): `jobs:` in Spalte 0; die
 * Einrückung der Job-Schlüssel gilt für die Datei, die der Job-Kinder ergibt sich aus der ersten Zeile unter dem
 * Job-Schlüssel. Nur ein `name:` genau auf Job-Kind-Ebene zählt; Workflow- und Step-Namen nicht. Anführungszeichen
 * und ` #`-Kommentare wie im Shadowing-Wächter (test/harness/required-check-shadowing.test.ts).
 */
export function jobNamenAus(text) {
  const namen = [];
  let inJobs = false;
  let jobEinr = null;
  let kindEinr = null;
  for (const zeile of text.split(/\r?\n/)) {
    if (!inhaltszeile(zeile)) continue;
    const einr = einrueckung(zeile);
    if (einr === 0) {
      inJobs = /^jobs:\s*(#.*)?$/.test(zeile);
      jobEinr = null;
      kindEinr = null;
      continue;
    }
    if (!inJobs) continue;
    jobEinr ??= einr;
    if (einr === jobEinr) {
      kindEinr = null; // nächster Job-Schlüssel
      continue;
    }
    if (einr < jobEinr) continue;
    kindEinr ??= einr;
    const m = einr === kindEinr ? /^[ \t]*name:[ \t]*(.*)$/.exec(zeile) : null;
    if (m) {
      const wert = WERT_OHNE_QUOTES(m[1].trim());
      if (wert !== "") namen.push(wert);
    }
  }
  return namen;
}

function ciJobNamen(rootDir, dir) {
  const abs = join(rootDir, dir);
  if (!existsSync(abs)) throw new Error(`CI-Workflow-Ordner ${dir} nicht gefunden (Config diagramme.ciWorkflows veraltet?)`);
  const namen = new Set();
  for (const f of readdirSync(abs).filter((n) => /\.ya?ml$/.test(n))) {
    for (const n of jobNamenAus(readFileSync(join(abs, f), "utf8"))) namen.add(n);
  }
  return namen;
}

/**
 * Der Spiegel des Rulesets `main-schutz` (`config.diagramme.ruleset`, Datei unter `.github/`, geschützt): Name, die
 * Required-Check-Kontexte und die Bypass-Akteure, wie sie `gh api repos/{owner}/{repo}/rulesets/<id>` liefert.
 */
function ladeRuleset(rootDir, cfg) {
  const pfad = cfg.ruleset;
  if (!pfad) throw new Error("config.diagramme.ruleset fehlt (Pfad der Ruleset-Spiegeldatei)");
  return ladeRulesetSpiegel(rootDir, pfad);
}

function konstante(rootDir, cfg, schluessel) {
  const k = cfg.konstanten?.[schluessel];
  if (!k) throw new Error(`Konstante "${schluessel}" steht nicht in config.diagramme.konstanten`);
  try {
    return ganzzahlKonstante(rootDir, k.datei, k.name);
  } catch (err) {
    throw new Error(`Konstante "${schluessel}": ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

function gatesAnzahl(rootDir, config, kette) {
  const g = config.gates;
  if (!g || !(g.chains ?? []).includes(kette)) throw new Error(`Gate-Kette "${kette}" steht nicht in config.gates.chains`);
  const scripts = leseJson(rootDir, g.package, "package.json").scripts ?? {};
  if (typeof scripts[kette] !== "string") throw new Error(`Gate-Kette "${kette}" fehlt in ${g.package}`);
  return String(kettenSchritte(scripts, g.chains, kette).length);
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
  let ruleset = null;
  const rulesetDaten = () => (ruleset ??= ladeRuleset(rootDir, cfg));
  const genannteChecks = new Set();
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
      case "required-check": {
        // Ein Required Check gilt nur, wenn ihn das Ruleset (Spiegel) UND ein Workflow-Job führt (Z2c).
        const r = rulesetDaten();
        if (!r.requiredChecks.includes(wert)) throw new Error(`Required Check "${wert}" steht nicht im Ruleset-Spiegel ${cfg.ruleset} (bekannt: ${r.requiredChecks.join(", ")})`);
        if (!cfg.ciWorkflows) throw new Error("config.diagramme.ciWorkflows fehlt (Ordner der CI-Workflows, kein fester Standardpfad)");
        ciNamen ??= ciJobNamen(rootDir, cfg.ciWorkflows);
        if (!ciNamen.has(wert)) throw new Error(`Required Check "${wert}" hat keine passende Job-name:-Zeile in ${cfg.ciWorkflows}`);
        genannteChecks.add(wert);
        return wert;
      }
      case "ruleset": {
        const r = rulesetDaten();
        if (wert === "name") return r.name;
        if (wert === "bypass") {
          // „ohne Bypass“ ist eine Aussage über die echte Konfiguration: der Spiegel muss sie tragen.
          if (r.bypassActors.length > 0) throw new Error(`Ruleset ${r.name} hat Bypass-Akteure (${cfg.ruleset}): „ohne Bypass“ wäre falsch`);
          return "ohne Bypass";
        }
        throw new Error(`unbekannter Ruleset-Wert "${wert}" (erlaubt: name, bypass)`);
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
  // Wer einen Required Check nennt, nennt alle: sonst verschwindet ein neuer Kontext still aus dem Diagramm (Z2c).
  if (genannteChecks.size > 0) {
    const fehlen = rulesetDaten().requiredChecks.filter((c) => !genannteChecks.has(c));
    if (fehlen.length) throw new Error(`Required Check ${fehlen.map((c) => `"${c}"`).join(", ")} aus dem Ruleset-Spiegel fehlt in der Vorlage (Fix: \${required-check:NAME} ergänzen)`);
  }
  return ersetzt;
}

/** Alle Namen, die `text` über eine Namensart nennt. */
export function genannteNamen(text) {
  const namen = new Set();
  for (const [, art, wert] of text.matchAll(PLATZHALTER)) if (NAMENSARTEN.includes(art)) namen.add(wert);
  return namen;
}

/**
 * Wirft, wenn ein Subagent, Skill oder Workflow aus `.claude/` in keiner der Vorlagen vorkommt. `vorlagen` sind
 * `{ pfad, text }`: geprüft wird die Vereinigung, damit ein Diagramm nur einen Teil zeigen darf, solange alle
 * zusammen vollständig sind (Z2b); die Meldung nennt alle beteiligten Vorlagen.
 */
export function pruefeVollstaendigkeit(vorlagen, katalog) {
  const genannt = new Set(vorlagen.flatMap((v) => [...genannteNamen(v.text)]));
  const fehlen = [
    ...katalog.agents.map((a) => ["Subagent", a.name, a.datei]),
    ...katalog.skills.map((s) => ["Skill", s.name, s.datei]),
    ...katalog.workflows.map((w) => ["Workflow", w.name, w.datei]),
  ].filter(([, name]) => !genannt.has(name));
  if (fehlen.length)
    throw new Error(
      `${vorlagen.length === 1 ? "Vorlage" : "Vorlagen"} ${vorlagen.map((v) => v.pfad).join(" + ")}: nicht im Diagramm: ${fehlen.map(([art, name, datei]) => `${art} "${name}" (${datei})`).join(", ")}. ` +
        `Fix: in eine dieser Vorlagen mit \${agent:NAME}, \${skill:NAME} bzw. \${workflow:NAME} aufnehmen, dann npm run docs:gen`,
    );
}

function liesVorlage(rootDir, cfg, name) {
  const pfad = cfg?.vorlagen?.[name];
  if (!pfad) throw new Error(`config.diagramme.vorlagen.${name} fehlt`);
  const abs = join(rootDir, pfad);
  if (!existsSync(abs)) throw new Error(`Vorlage ${pfad} nicht gefunden`);
  return { pfad, text: readFileSync(abs, "utf8").replace(/\r\n/g, "\n").trim() };
}

/** Erzeugt den Generator für die Vorlage `name` aus `config.diagramme.vorlagen`. */
export function diagrammGenerator(name) {
  return ({ rootDir, config }) => {
    const cfg = config.diagramme;
    const { pfad, text: roh } = liesVorlage(rootDir, cfg, name);
    const gruppe = cfg.vollstaendig ?? [];
    if (gruppe.includes(name)) {
      pruefeVollstaendigkeit(gruppe.map((n) => (n === name ? { pfad, text: roh } : liesVorlage(rootDir, cfg, n))), harnessKatalog(rootDir, config.harness));
    }
    try {
      return ["```mermaid", MERMAID_FRONTMATTER, ersetzePlatzhalter(roh, { rootDir, config }), "```"].join("\n");
    } catch (err) {
      throw new Error(`Vorlage ${pfad}: ${err instanceof Error ? err.message.replace(`${pfad}: `, "") : String(err)}`, { cause: err });
    }
  };
}
