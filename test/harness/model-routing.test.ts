/* Modell-Routing-Wächter (#1035) – „Planung stark, Umsetzung schnell" darf nicht
 * ins Leere greifen, und keine Doku darf das Gegenteil behaupten.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Vorgeschichte: AGENTS.md § Modellwahl (#910) verlangt den Coding-Tier für die
 * Umsetzung. Im Phasen-Workflow ist das gesetzt (`agent(..., {model:'sonnet'})`),
 * auf dem **Skill-Pfad** – dem tool-neutralen, maßgeblichen Weg – schreibt aber der
 * **Hauptagent** den Code. Der lief auf dem Session-Modell: startet die Maintainerin
 * aus einer Opus-Session (der Normalfall, weil Planung/Review Opus verlangen), tippte
 * die gesamte Umsetzung auf Opus. Die Regel existierte, der Hebel war nicht gezogen.
 *
 * Der Wächter deckt die drei Fehlklassen ab, die das leise zurückbringen:
 *
 *   1. **Der Hebel verschwindet.** Seit #1280 ist der Hebel das Frontmatter des Subagenten
 *      `kubernia-umsetzer` (Skill-Frontmatter greift wegen anthropics/claude-code#98898 nur bei
 *      `/kubernia`, ein Projekt-Default ließ sich per `/model` überstimmen). Es ist je eine Zeile –
 *      gelöscht/umformuliert fällt die Umsetzung wortlos aufs Session-Modell zurück.
 *   2. **Der Review wird still mitdemoviert.** Umsetzer und Workflow-Phasen laufen auf dem
 *      Coding-Tier. Liefen die Lens-Pässe INLINE in einem orchestrierenden Agenten (Umsetzer oder
 *      Hauptagent), zöge die Coding-Tier-Zeile den Review von Opus auf Sonnet –
 *      Fix der einen Konventionshälfte, Regression der anderen. Darum spawnt
 *      review-lenses seine Lenses als eigene Subagenten mit explizitem Opus-Routing.
 *   3. **Prosa-Drift.** Eine Doku, die weiter „Session-Default" als Ist-Zustand der
 *      Umsetzung behauptet, schickt den nächsten Agenten auf die alte Fährte. Genau
 *      diese Klasse sieht `check:docdrift` (#529) nicht – es prüft Kommandos/Links.
 *
 * Seit #1280 schreibt auf dem Skill-Pfad nicht mehr der Hauptagent den Code, sondern der Subagent
 * `kubernia-umsetzer` mit `sonnet`/`medium` im eigenen Frontmatter: Projekt-Default und Skill-Frontmatter
 * ließen sich per `/model` bzw. durch den Turn-Scope still umgehen. Der Wächter prüft Agent, Spawn ohne
 * `model:`, `Agent`-Tool und vorgeladenes `review-lenses` (sonst Inline-Review), dass kubernia-loop weg ist
 * und dass `.claude/settings.json` kein Modell mehr pinnt (der Hauptchat folgt der Wahl der Maintainerin).
 *
 * Seit #1065 gilt zusätzlich: jede `agent()`-Aufrufstelle im Workflow setzt `effort` und
 * `model` (oder `agentType`), es gibt keine festen Modell-IDs mehr und genau
 * eine Planungs-Oberfläche.
 *
 * Grenzen dieses Wächters (bewusst, ehrlich – ein Wächter, dessen Kopf mehr verspricht
 * als er misst, erzeugt genau das falsche Sicherheitsgefühl):
 *   - Er belegt, dass die Zeile DA ist und die Doku nicht dagegen driftet – NICHT, dass
 *     Claude Code das Frontmatter zur Laufzeit wirklich anwendet. Das ist Tool-Verhalten
 *     und für einen Vitest-Lauf unbeobachtbar (wie die „Grenze"-Notiz in agents-md-native).
 *   - Die Drift-Erkennung ist **literal und case-sensitiv**: „Session Default" ohne
 *     Bindestrich rutscht durch (bekannte Grenze des Begriffs-Ansatzes, identisch in
 *     test/harness/agents-md-native.test.ts).
 *   - Beim `effort:` wird meist nur die **Anwesenheit** geprüft, nicht die Stufe; bewusste
 *     Ausnahme ist der Planer (Wert im Frontmatter + Gleichheit mit der Workflow-Plan-Phase).
 *   - Der Workflow-Pfad wird nur auf Anwesenheit von `model`/`effort` je Aufrufstelle geprüft,
 *     nicht welche Phase welchen Alias bekommt – die Zuordnung steht in docs/model-routing.md.
 *     Ausnahme: der Plan-Effort im Workflow muss dem Frontmatter des kubernia-planner gleichen.
 *   - Die Optionen-Zählung paart Aufrufe und Optionsobjekte nur über die SUMME: ein Aufruf ohne
 *     Optionen plus ein überzähliges Optionsobjekt heben sich auf.
 *   - Spread-Konstanten (`{ label: …, ...CODING }`, #1311) löst der Text-Scan auf, indem er `...NAME` durch
 *     den Rumpf von `const NAME = { … }` ersetzt. Ein Spread, der sich nicht auflösen lässt, gilt als
 *     ungeroutet (rot). Er wertet den Workflow dafür nicht aus: Konstanten, die erst zur Laufzeit
 *     gebaut werden, sähe er nicht.
 *   - `routingFiles()` liest das Dateisystem (nicht `git ls-files`, wie `collectMarkdown`, #1091):
 *     untrackte lokale Dateien in .claude/ werden mitgeprüft und können lokal rot machen, die CI nicht.
 *   - Die Sonderfall-Zweige (Epic, Dependabot) des Workflows werden per `node:vm` gegen Stub-Globals
 *     AUSGEFÜHRT (Epic-Aufteilung über den Planer, #1207); der Stub kennt nur die frühen Phasen und
 *     bricht bei unbekannten Labels laut ab. Der Skill-Pfad wird nur auf den Verweis im Text geprüft.
 *   - Das Agent-Tool hat keinen `effort`-Parameter (docs/model-routing.md §2): der Effort von
 *     Repo-Agenten (kubernia-lens, Explore) kommt aus ihrem Frontmatter; am Spawn wird geprüft, dass
 *     KEIN `model:` das Frontmatter überstimmt. `effort: low` am Explore deklariert nur: Haiku
 *     unterstützt laut Claude-Code-Doku keinen Effort, er wirkt erst bei einem anderen Alias-Ziel.
 *
 * Fitness-Function-Kategorie neben layering/filesize/docmap/agents-md-native, nicht mit
 * Verhaltens-Tests vermischen. Bewusst **ohne** eigenes `scripts/check-*.mjs`:
 * `scripts/check-` ist Gate-Config (Audit-Kommentar-Pflicht), und
 * für rein doku-strukturelle Wächter gibt es die etablierte test-only-Familie.
 *
 * ⚠️ Bekannte Duplikation: die Retired-Claims-Mechanik unten ist strukturgleich zu
 * test/harness/agents-md-native.test.ts (#992). Bei zwei Kopien noch Rule-of-Three-konform, aber
 * beticketet als **#1046** (nach test/support/ ziehen) – jscpd ist bewusst
 * nicht-blockierend, es fängt das also kein Gate automatisch.
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { blockFunktion, workflowBlock } from "./workflow-block";
import { workflowLauf } from "./workflow-lauf";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as brainMetrics from "../../scripts/brain-metrics.mjs";

const pflegeMarker = (brainMetrics as { pflegeMarker: (ev: { tool: string; input: { command: string } }) => "start" | "ende" | null }).pflegeMarker;

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs aus, scripts/ nicht im tsconfig)
// – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkDocDrift from "../../scripts/check-docdrift.mjs";

// Begründete Ausnahme, identisch zu test/harness/agents-md-native.test.ts: das .mjs hat kein
// Declaration-File, der Namespace ist für tsc „error typed". Eng begrenzter
// Inline-Disable statt einer Gate-Config-Änderung.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const stripFencedCode: (md: string) => string = checkDocDrift.stripFencedCode;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const collectMarkdown: (rootDir?: string) => string[] = checkDocDrift.collectMarkdown;

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

/** Der Einstiegs-Skill im Hauptchat; sein Frontmatter gilt nur bei /kubernia (#1035, #1280). */
const UMSETZUNGS_SKILL = ".claude/skills/kubernia/SKILL.md";
/** Der Subagent, der auf dem Skill-Pfad tatsächlich umsetzt (#1280). */
const UMSETZER = ".claude/agents/kubernia-umsetzer.md";
/** Der Skill, dessen Lenses trotz Coding-Tier-Umsetzung auf dem starken Tier bleiben müssen. */
const REVIEW_SKILL = ".claude/skills/review-lenses/SKILL.md";
/** Die SSOT-/Checklisten-Datei für Modell-Pins. */
const ROUTING_SSOT = "docs/model-routing.md";

/**
 * Das YAML-Frontmatter einer Markdown-Datei als flache Key→Value-Map. Bewusst
 * minimal (keine YAML-Abhängigkeit): Frontmatter ist hier immer ein `---`-Block
 * am Dateianfang mit einfachen `key: wert`-Zeilen. Kein Frontmatter ⇒ leere Map.
 */
function frontmatter(md: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(md);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Pins des Hauptchat-Modells in den Projekt-Settings: der Schlüssel `model` und jeder `env`-Schlüssel mit MODEL (generisch, damit neue Variablennamen nicht durchrutschen). */
function modellPins(settings: { model?: string; env?: Record<string, string> }): string[] {
  const out = settings.model === undefined ? [] : ["model"];
  for (const k of Object.keys(settings.env ?? {})) if (/MODEL/i.test(k)) out.push(`env.${k}`);
  return out;
}

/** Die in der Routing-Doku genannten User-Scope-MCP-Server, deren Namen das Repo voraussetzt. */
function userScopeServer(md: string): string[] {
  const zeile = /User-Scope-MCP-Server, deren Namen das Repo voraussetzt:([^\n]*)/.exec(md)?.[1] ?? "";
  return [...zeile.matchAll(/`([\w-]+)`/g)].map((m) => m[1]);
}

/** Server-Namen aus `mcp__<server>[__tool]`-Regeln, die weder in .mcp.json noch als User-Scope-Server bekannt sind. */
function unbekannteServer(regeln: string[], bekannt: string[]): string[] {
  const namen = regeln.filter((r) => r.startsWith("mcp__")).map((r) => r.split("__")[1]);
  return [...new Set(namen)].filter((n) => !bekannt.includes(n));
}

/** Bezeichnet der Wert den Coding-Tier? Alias `sonnet` ODER eine gepinnte Sonnet-ID. */
const istCodingTier = (wert: string) => /(^|[-\s])sonnet/i.test(wert);

/** Alle versionierten Routing-Dateien: Agents, Skills, Workflows und die Projekt-Settings. */
function routingFiles(): string[] {
  const out = [".claude/settings.json"];
  for (const d of readdirSync(`${REPO_ROOT}.claude/agents`)) out.push(`.claude/agents/${d}`);
  for (const d of readdirSync(`${REPO_ROOT}.claude/skills`)) out.push(`.claude/skills/${d}/SKILL.md`);
  for (const d of readdirSync(`${REPO_ROOT}.claude/workflows`)) out.push(`.claude/workflows/${d}`);
  return out.filter((f) => existsSync(`${REPO_ROOT}${f}`));
}

/** Trägt der Text eine feste Modell-ID (`model: claude-opus-5`, `"model": "claude-haiku-4-5-…"`)? */
const hatHartenPin = (text: string) => /\bmodel["']?\s*:\s*["']?claude-(opus|sonnet|haiku|fable)-\d/i.test(text);

/**
 * Die Optionsobjekte aller `agent()`-Aufrufe im Workflow: jedes `{ label: …}` bis zur passenden
 * schließenden Klammer (Klammern in `${…}` heben sich gegenseitig auf). Zusätzlich die Zahl der
 * echten Aufrufstellen (`agent(` mit Argument, Kommentarzeilen ausgenommen) – weicht sie von der
 * Zahl der Optionsobjekte ab, hat eine Aufrufstelle gar keine Optionen.
 */
function workflowAgentCalls(js: string): { optionen: string[]; aufrufe: number } {
  const code = js
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  const aufrufe = [...code.matchAll(/\bagent\((?!\))/g)].length;
  const optionen: string[] = [];
  for (const m of code.matchAll(/\{\s*label:/g)) {
    let depth = 0;
    for (let i = m.index; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}" && --depth === 0) {
        optionen.push(code.slice(m.index, i + 1));
        break;
      }
    }
  }
  return { optionen, aufrufe };
}

/** Der Rumpf jeder einfachen `const NAME = { … }`-Konstante des Workflows (Tier-Konstanten, #1311). */
function konstanten(js: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of js.matchAll(/^const ([A-Z][A-Z_]*) = \{([^{}]*)\}/gm)) out[m[1]] = m[2];
  return out;
}

/** Ein Optionsobjekt mit eingesetzten Spreads (`...CODING` → Rumpf der Konstante); Unauflösbares bleibt stehen. */
function aufgeloest(optionen: string, konst: Record<string, string>): string {
  return optionen.replace(/\.\.\.([A-Z][A-Z_]*)/g, (voll, name: string) => konst[name] ?? voll);
}

/** Spreads, die sich nicht auf eine Konstante zurückführen lassen. */
const unaufgeloeste = (aufgeloestText: string): string[] => [...aufgeloestText.matchAll(/\.\.\.[A-Za-z_]\w*/g)].map((m) => m[0]);

/** Der Workflow-Text ohne `export const meta = { … }` (reine Anzeige-Labels) und ohne Kommentarzeilen. */
function ohneMetaUndKommentare(js: string): string {
  js = js.replace(/\r\n/g, "\n");
  const von = js.indexOf("export const meta");
  const bis = von >= 0 ? js.indexOf("\n}\n", von) + 3 : -1;
  const code = von >= 0 && bis > von ? js.slice(0, von) + js.slice(bis) : js;
  return code.split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");
}

/** Alle Optionsobjekte des Workflows mit aufgelösten Spreads. */
function workflowOptionen(): string[] {
  const js = read(".claude/workflows/kubernia-ticket.js");
  const konst = konstanten(js);
  return workflowAgentCalls(js).optionen.map((o) => aufgeloest(o, konst));
}

/** Der `effort:`-Wert aus einem Optionsobjekt (undefined, wenn keiner da ist). */
const planEffort = (optionen: string) => /\beffort:\s*['"]([a-z]+)['"]/.exec(optionen)?.[1];

/** Alle Agent-Definitionen unter .claude/agents, nach `name` (nicht Dateiname) mit ihrem Frontmatter. */
function agentenNachName(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const d of readdirSync(`${REPO_ROOT}.claude/agents`).filter((f) => f.endsWith(".md"))) {
    const fm = frontmatter(read(`.claude/agents/${d}`));
    if (fm.name) out[fm.name] = fm;
  }
  return out;
}

/**
 * Verstöße einer Workflow-Aufrufstelle mit `agentType` gegen die Agent-Definition: der Typ muss
 * existieren, `effort` muss dem Frontmatter gleichen, ein `model:` daneben überstimmt es still.
 * Aufrufstellen ohne `agentType` sind nicht betroffen.
 */
function agentTypeVerstoesse(optionen: string, agenten: Record<string, Record<string, string>>): string[] {
  const typ = /agentType:\s*['"]([^'"]+)['"]/.exec(optionen)?.[1];
  if (!typ) return [];
  const kopf = optionen.slice(0, 80);
  const fm = agenten[typ];
  if (!fm) return [`${kopf}: agentType „${typ}" hat keine Agent-Definition`];
  const out: string[] = [];
  const effort = planEffort(optionen);
  if (effort !== fm.effort) out.push(`${kopf}: effort ${effort ?? "(fehlt)"} ≠ Frontmatter ${fm.effort}`);
  if (/\bmodel\s*:/.test(optionen)) out.push(`${kopf}: \`model:\` neben agentType überstimmt das Frontmatter`);
  return out;
}

/** Eine Aufrufstelle ist geroutet: `effort` UND (`model` ODER `agentType`; der Agent trägt sein Modell selbst). */
const istGeroutet = (optionen: string) => /\beffort:/.test(optionen) && /\b(model|agentType):/.test(optionen);

/**
 * Die abgelegte Behauptung. Nach #1035 gibt es keinen wahren Satz mehr, in dem die
 * Umsetzung „auf dem Session-Default" läuft – der Coding-Tier ist auf BEIDEN Pfaden
 * gesetzt (Workflow per `agent({model})`, Skill per Frontmatter).
 *
 * **Escape-Hatch** (gleiche Logik wie test/harness/agents-md-native.test.ts): Wer den Begriff
 * diskutieren muss, setzt ihn in Inline-Backticks oder einen Codeblock – Zitat ist
 * keine Behauptung. Bewusst NICHT gelistet: „Session-Modell". Der Satz „ein Subagent
 * ohne Modell-Angabe erbt das Session-Modell" ist die weiterhin GÜLTIGE Warnung, die
 * überhaupt erst zur Konvention geführt hat.
 */
const RETIRED_ROUTING_CLAIMS: { term: string; home: string; nurWenn?: RegExp; ausser?: RegExp }[] = [
  {
    term: "Opus-Standard-Effort",
    home: "die Lenses tragen `effort: high` im Frontmatter von kubernia-lens und laufen auf beiden Pfaden damit (#1209)",
  },
  {
    term: "Session-Default",
    home: `die Umsetzung tippt auf beiden Pfaden den Coding-Tier – im Workflow per agent({model}), im Skill-Pfad im Subagenten ${UMSETZER} (Frontmatter, #1280)`,
  },
  {
    // „Projekt-Default sonnet in settings.json" ist seit #1280 abgelegt (#1309). `nurWenn`/`ausser` sparen die
    // Historien-Absätze aus (model-routing §5, agent-harness Stufe 3/4), die den Begriff mit Datum/Ticket nennen.
    term: "Projekt-Default",
    nurWenn: /sonnet/i,
    ausser: /#1065|#1280|entfernt|ließe|ließ\b|damals/,
    home: `kein Modell-Pin im Projekt; Umsetzung im Subagenten ${UMSETZER} (#1280)`,
  },
];

/** Zeilen in `md`, die noch den abgelegten Routing-Ist-Zustand behaupten. */
function retiredRoutingClaims(md: string): { line: number; term: string; home: string; text: string }[] {
  const found: { line: number; term: string; home: string; text: string }[] = [];
  stripFencedCode(md)
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.replace(/`[^`\n]*`/g, "");
      for (const { term, home, nurWenn, ausser } of RETIRED_ROUTING_CLAIMS) {
        if (!line.includes(term)) continue;
        if (nurWenn && !nurWenn.test(raw)) continue;
        if (ausser?.test(raw)) continue;
        found.push({ line: i + 1, term, home, text: raw.trim().slice(0, 120) });
      }
    });
  return found;
}

describe("Die Umsetzung tippt auf dem Coding-Tier – auch auf dem Skill-Pfad (#1035)", () => {
  test(`${UMSETZUNGS_SKILL} routet per Frontmatter auf den Coding-Tier`, () => {
    const fm = frontmatter(read(UMSETZUNGS_SKILL));
    assert.ok(
      fm.model && istCodingTier(fm.model),
      `Im Frontmatter von ${UMSETZUNGS_SKILL} fehlt ein \`model:\` auf dem Coding-Tier (Alias \`sonnet\`). ` +
        "Die Zeile wirkt nur bei Aufruf als `/kubernia` (anthropics/claude-code#98898); der eigentliche Hebel " +
        `ist der Subagent ${UMSETZER} (#1280). Gefunden: model=„${fm.model ?? "(fehlt)"}".`,
    );
    // Absichtlich nur Anwesenheit, nicht der Wert: die Regel ist „explizit statt erben".
    // Welche Stufe richtig ist, entscheidet docs/model-routing.md und darf sich dort ohne
    // Test-Änderung bewegen – gebunden wäre nur eine Doppelpflege.
    assert.ok(
      fm.effort,
      `Im Frontmatter von ${UMSETZUNGS_SKILL} fehlt \`effort:\` – der Reasoning-Aufwand der Umsetzungsphase ` +
        "wird sonst ebenfalls von der Session geerbt (#1035).",
    );
  });

  test(`${REVIEW_SKILL} spawnt die Lenses über den Agenten kubernia-lens (opus/high), ohne model-Override`, () => {
    const md = read(REVIEW_SKILL);
    // Bewusst an den `Agent({…})`-Spawn-Block gebunden, nicht datei-weit: sonst hält ein
    // beliebiger Prosa-Satz („historisch stand hier model: opus") den Test grün, während
    // die Lenses längst wieder inline oder auf general-purpose laufen.
    const spawn = /Agent\(\{[^}]*\}\)/s.exec(md)?.[0] ?? "";
    assert.match(
      spawn,
      /subagent_type:\s*"kubernia-lens"/,
      `${REVIEW_SKILL} muss die Lens-Pässe in einem \`Agent({…})\`-Spawn über \`kubernia-lens\` starten: ` +
        "nur dessen Frontmatter trägt `effort: high`, das Agent-Tool hat keinen effort-Parameter (#1209). " +
        "Laufen die Lenses inline im Hauptagenten, reviewt Sonnet, und der finale Blick wäre ein Self-Grading (#1012).",
    );
    assert.doesNotMatch(
      spawn,
      /\bmodel\s*:/,
      "Ein `model:` am Spawn überstimmt das Frontmatter von kubernia-lens – das Modell steht nur dort (#1209).",
    );
    const lens = frontmatter(read(".claude/agents/kubernia-lens.md"));
    assert.equal(lens.name, "kubernia-lens");
    assert.equal(lens.model, "opus", "Lenses laufen auf dem starken Tier");
    assert.equal(lens.effort, "high", "Effort der Review-Phase laut Matrix (docs/model-routing.md §1)");
  });

  test("der Workflow-Pfad routet weiterhin explizit (Umsetzung Sonnet, Lenses über kubernia-lens)", () => {
    // AGENTS.md behauptet „BEIDE Ticket-Pfade setzen es explizit" – ein Wächter, der nur
    // den Skill-Pfad prüft, ließe die halbe Aussage ungedeckt. Bewusst grob (Anwesenheit
    // der Tier-Aliase je Phase): die Zuordnung Phase↔Aufruf ist Sache des Workflows,
    // hier geht es nur darum, dass die Overrides nicht ersatzlos verschwinden.
    // An den echten `agent(…)`-SPAWN gebunden (über sein Schema), nicht datei-weit: die
    // `meta.phases`-Einträge oben tragen dieselben Tier-Namen als reine Anzeige-Labels
    // fürs /workflows-Panel. Ein datei-weiter Match bliebe grün, wenn der Spawn sein
    // `model` verliert und nur die Kosmetik stehen bleibt — ein Gate, das nichts gemessen
    // hat, darf nicht grün melden.
    const optionen = workflowOptionen();
    const umsetzen = optionen.find((o) => /schema:\s*UMSETZUNG_SCHEMA/.test(o)) ?? "";
    assert.match(
      umsetzen,
      /\bmodel:\s*["']sonnet["']/,
      "Im Phasen-Workflow fehlt der Coding-Tier am Umsetzungs-`agent()` (`...CODING` bzw. `model: 'sonnet'`) – " +
        "ohne ihn erbt der Umsetzungs-Subagent das Session-Modell (#910/#1035). " +
        "Achtung: die `meta.phases`-Zeilen oben sind nur Anzeige-Labels und zählen nicht.",
    );
    const lens = optionen.find((o) => /schema:\s*LENS_SCHEMA/.test(o)) ?? "";
    assert.match(
      lens,
      /\bagentType:\s*["']kubernia-lens["']/,
      "Im Phasen-Workflow fehlt `agentType: 'kubernia-lens'` am Lens-`agent()` (`...REVIEW`) – " +
        "der Review darf nicht auf den Coding-Tier absacken (#1012/#1035/#1209).",
    );
  });

  test("Erkennung greift wirklich (Red-Green): Frontmatter-Parser + Tier-Erkennung", () => {
    // No-op-Schutz: ein Wächter, der immer grün ist, wäre wertlos.
    assert.deepEqual(frontmatter("---\nname: x\nmodel: sonnet\neffort: medium\n---\nText"), {
      name: "x",
      model: "sonnet",
      effort: "medium",
    });
    assert.deepEqual(frontmatter("# Kein Frontmatter\nmodel: sonnet\n"), {}, "nur ein `---`-Block am Anfang zählt");
    assert.deepEqual(frontmatter('---\nmodel: "claude-opus-5"\n---\n').model, "claude-opus-5", "Quotes fallen weg");
    assert.ok(istCodingTier("sonnet") && istCodingTier("claude-sonnet-5"), "Alias und Pin gelten beide");
    assert.ok(!istCodingTier("opus") && !istCodingTier("claude-opus-5") && !istCodingTier(""), "Opus ist kein Coding-Tier");
  });
});

describe("Jede Routing-Stelle ist explizit gesetzt (#1065)", () => {
  test("jeder agent()-Aufruf im Workflow setzt effort und (model oder agentType)", () => {
    const { aufrufe } = workflowAgentCalls(read(".claude/workflows/kubernia-ticket.js"));
    const optionen = workflowOptionen();
    assert.ok(optionen.length >= 10, `Der Scan fand nur ${optionen.length} Optionsobjekte – er misst nichts mehr.`);
    assert.deepEqual(optionen.flatMap(unaufgeloeste), [], "Ein Spread im Optionsobjekt führt auf keine `const NAME = { … }`-Konstante.");
    assert.equal(optionen.length, aufrufe, "Es gibt agent()-Aufrufe ohne Optionsobjekt – sie erben Session-Modell und -Effort.");
    const ungeroutet = optionen.filter((o) => !istGeroutet(o)).map((o) => o.slice(0, 80));
    assert.deepEqual(
      ungeroutet,
      [],
      "Diese agent()-Aufrufe erben still Session-Modell oder -Effort. Jede Stelle braucht `effort` und `model` " +
        `(bzw. \`agentType\`), Matrix in ${ROUTING_SSOT}:\n${ungeroutet.join("\n")}`,
    );
  });

  test("Tier-Konstanten: Modell und Effort stehen je Tier genau einmal im Workflow-Code (#1311)", () => {
    const code = ohneMetaUndKommentare(read(".claude/workflows/kubernia-ticket.js"));
    const anzahl = (re: RegExp) => [...code.matchAll(re)].length;
    assert.equal(anzahl(/\bmodel:\s*['"]sonnet['"]/g), 1, "`model: 'sonnet'` steht nur in CODING");
    assert.equal(anzahl(/\beffort:\s*['"]medium['"]/g), 1, "`effort: 'medium'` steht nur in CODING");
    assert.equal(anzahl(/\beffort:\s*['"]xhigh['"]/g), 1, "`effort: 'xhigh'` steht nur in PLANUNG");
    assert.equal(anzahl(/\beffort:\s*['"]high['"]/g), 1, "`effort: 'high'` steht nur in REVIEW");
    assert.equal(anzahl(/\bagentType:\s*['"]kubernia-planner['"]/g), 1);
    assert.equal(anzahl(/\bagentType:\s*['"]kubernia-lens['"]/g), 1);
  });

  test("Erkennung greift wirklich (Red-Green): Spread wird aufgelöst, Unbekanntes und Stellen ohne Tier schlagen an", () => {
    const konst = konstanten("const CODING = { model: 'sonnet', effort: 'medium' }\nconst X = { a: { b: 1 } }");
    assert.deepEqual(Object.keys(konst), ["CODING"], "verschachtelte Objekte sind keine Tier-Konstanten");
    const ok = aufgeloest("{ label: 'a', ...CODING }", konst);
    assert.ok(istGeroutet(ok), "aufgelöster Spread zählt als geroutet");
    const unbekannt = aufgeloest("{ label: 'a', ...UNBEKANNT }", konst);
    assert.ok(!istGeroutet(unbekannt), "ein Spread auf eine unbekannte Konstante routet nichts");
    assert.deepEqual(unaufgeloeste(unbekannt), ["...UNBEKANNT"]);
    assert.ok(!istGeroutet(aufgeloest("{ label: 'neu', phase: 'P' }", konst)), "eine neue Stelle ohne Tier ist ungeroutet");
    const meta = "export const meta = {\n  phases: [{ model: 'sonnet' }],\n}\n// model: 'sonnet'\nconst C = { model: 'sonnet' }";
    assert.equal([...ohneMetaUndKommentare(meta).matchAll(/model:\s*'sonnet'/g)].length, 1, "meta-Labels und Kommentare zählen nicht");
  });

  test("Erkennung greift wirklich (Red-Green): fehlender effort bzw. model schlägt an", () => {
    assert.ok(!istGeroutet("{ label: 'x', model: 'sonnet' }"), "model ohne effort ist ungeroutet");
    assert.ok(!istGeroutet("{ label: 'x', phase: 'P' }"), "ohne beides ungeroutet");
    assert.ok(!istGeroutet("{ label: 'x', effort: 'medium' }"), "effort ohne model/agentType ist ungeroutet");
    assert.ok(istGeroutet("{ label: 'x', model: 'sonnet', effort: 'medium' }"));
    assert.ok(istGeroutet("{ label: 'x', agentType: 'kubernia-planner', effort: 'xhigh' }"), "Agent trägt sein Modell selbst");
    const fixture = "const a = await agent(`p ${x}`, { label: `a:${n}`, phase: 'A' })\n// agent() im Kommentar\nawait agent(`q`)";
    const r = workflowAgentCalls(fixture);
    assert.equal(r.optionen.length, 1);
    assert.equal(r.aufrufe, 2, "ein Aufruf ohne Optionen fällt über die Zählung auf");
  });

  test(".claude/settings.json pinnt kein Modell für den Hauptchat (#1280, #1311)", () => {
    const settings = JSON.parse(read(".claude/settings.json")) as { model?: string; env?: Record<string, string> };
    assert.deepEqual(
      modellPins(settings),
      [],
      "Das Routing steht in den Agent-Frontmattern (Umsetzer, Planer, Lenses). Ein Projekt-Default überstimmte " +
        "nur die Modellwahl der Maintainerin für Gespräche und Pre-Flight im Hauptchat und lässt sich per /model ohnehin umgehen. " +
        "Das gilt auch für `env` (`ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_*_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL` …).",
    );
  });

  test("Erkennung greift wirklich (Red-Green): `model` und jeder env-Schlüssel mit MODEL zählt als Pin", () => {
    assert.deepEqual(modellPins({ env: { CC_LANGFUSE_TRACE_TAGS: "kubernia" } }), []);
    assert.deepEqual(modellPins({ model: "opus" }), ["model"]);
    for (const k of ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL", "anthropic_model"]) {
      assert.deepEqual(modellPins({ env: { [k]: "x" } }), [`env.${k}`], k);
    }
  });

  test("Planer opus/xhigh", () => {
    const planer = frontmatter(read(".claude/agents/kubernia-planner.md"));
    assert.equal(planer.model, "opus");
    assert.equal(planer.effort, "xhigh");
  });

  test("genau eine Plan-Aufrufstelle im Workflow", () => {
    const optionen = workflowOptionen();
    const planCalls = optionen.filter((o) => /agentType:\s*['"]kubernia-planner['"]/.test(o));
    assert.equal(planCalls.length, 1, "Genau eine Plan-Aufrufstelle im Workflow erwartet.");
  });

  test("jede agentType-Aufrufstelle im Workflow gleicht ihrem Agent-Frontmatter (Drift-Schutz)", () => {
    const optionen = workflowOptionen();
    const verstoesse = optionen.flatMap((o) => agentTypeVerstoesse(o, agentenNachName()));
    assert.deepEqual(
      verstoesse,
      [],
      "Der Workflow überstimmt sonst still das Frontmatter des Agenten – `agentType` muss existieren, `effort` " +
        `gleich sein und ein \`model:\` darf nicht daneben stehen (#1209):\n${verstoesse.join("\n")}`,
    );
    assert.ok(
      optionen.some((o) => /agentType:\s*['"]kubernia-lens['"]/.test(o)),
      "Die Lens-Aufrufstelle muss agentType kubernia-lens tragen – sonst prüft der Test nichts.",
    );
  });

  test("Erkennung greift wirklich (Red-Green): abweichender Effort, unbekannter Typ, model-Override", () => {
    const agenten = { "kubernia-planner": { effort: "xhigh", model: "opus" }, "kubernia-lens": { effort: "high", model: "opus" } };
    assert.equal(planEffort("{ label: 'p', agentType: 'kubernia-planner', effort: 'xhigh' }"), "xhigh");
    assert.equal(planEffort("{ label: 'p', agentType: 'kubernia-planner' }"), undefined, "ohne effort ⇒ undefined");
    assert.deepEqual(agentTypeVerstoesse("{ label: 'l', agentType: 'kubernia-lens', effort: 'high' }", agenten), [], "konsistent");
    assert.equal(agentTypeVerstoesse("{ label: 'l', agentType: 'kubernia-lens', effort: 'medium' }", agenten).length, 1, "Effort weicht ab");
    assert.equal(agentTypeVerstoesse("{ label: 'l', agentType: 'kubernia-lens' }", agenten).length, 1, "Effort fehlt");
    assert.equal(agentTypeVerstoesse("{ label: 'l', agentType: 'gibt-es-nicht', effort: 'high' }", agenten).length, 1, "unbekannter Typ");
    assert.equal(agentTypeVerstoesse("{ label: 'l', agentType: 'kubernia-lens', model: 'opus', effort: 'high' }", agenten).length, 1, "model-Override");
    assert.equal(agentTypeVerstoesse("{ label: 'l', agentType: 'kubernia-lens', model: opus, effort: 'high' }", agenten).length, 1, "unquotiertes model: überstimmt ebenso (#1309)");
    assert.deepEqual(agentTypeVerstoesse("{ label: 'x', model: 'sonnet', effort: 'medium' }", agenten), [], "ohne agentType nicht betroffen");
  });

  test("Explore: Override des eingebauten Agenten auf haiku/low (#1209)", () => {
    const agenten = agentenNachName();
    const explore = agenten["Explore"];
    assert.ok(
      explore,
      "Es fehlt ein Agent mit exakt `name: Explore` (Groß-/Kleinschreibung zählt): nur so ersetzt er den eingebauten Explore " +
        "und jede Explore-Delegation läuft auf haiku.",
    );
    assert.equal(explore.model, "haiku");
    assert.equal(explore.effort, "low", "Matrix §1: Explore haiku/low (auf Haiku ohne Wirkung, siehe docs/model-routing.md)");
    assert.ok(!agenten["explore"], "Ein klein geschriebener Name würde den Override still verfehlen");
    assert.ok(
      !/\b(Edit|Write|NotebookEdit)\b/.test(explore.tools ?? ""),
      "Explore ist ein reiner Lese-Agent: `tools:` darf weder Edit noch Write enthalten.",
    );
  });

  test("Agent-Namen unter .claude/agents sind eindeutig (sonst entscheidet die Lese-Reihenfolge)", () => {
    const namen = readdirSync(`${REPO_ROOT}.claude/agents`)
      .filter((f) => f.endsWith(".md"))
      .map((f) => frontmatter(read(`.claude/agents/${f}`)).name);
    assert.deepEqual(
      namen.filter((n, i) => namen.indexOf(n) !== i),
      [],
      "Doppelter `name:` in .claude/agents",
    );
  });
});

/** Alle `Agent({…})`-Spawn-Blöcke einer Markdown-Datei (ohne verschachtelte `}` im Block). */
const spawnBloecke = (md: string): string[] => md.match(/Agent\(\{[^}]*\}\)/gs) ?? [];
/** Der Spawn-Block für genau diesen `subagent_type`, sonst `""`. */
const spawnFuer = (md: string, typ: string): string =>
  spawnBloecke(md).find((b) => new RegExp(`subagent_type:\\s*["']${typ}["']`).test(b)) ?? "";


describe("Skill-Pfad: die Umsetzung läuft im Subagenten kubernia-umsetzer, nicht im Hauptchat (#1280)", () => {
  test("Umsetzer-Agent: Coding-Tier und Effort aus der Matrix im eigenen Frontmatter", () => {
    const fm = frontmatter(read(UMSETZER));
    assert.equal(fm.name, "kubernia-umsetzer");
    assert.ok(
      fm.model && istCodingTier(fm.model),
      "Der Umsetzer muss im Frontmatter auf dem Coding-Tier stehen – nur das Agent-Frontmatter wirkt unabhängig " +
        "vom Session-Modell (Skill-Frontmatter gilt nur für den Turn, #98898).",
    );
    assert.equal(fm.effort, "medium", "Matrix §1: Umsetzung sonnet/medium; das Agent-Tool kennt kein effort");
    assert.notEqual(fm.omitClaudeMd, "true", "Der Umsetzer braucht AGENTS.md im Kontext");
  });

  test("Umsetzer kann die Lenses spawnen und hat den Review-Ablauf vorgeladen", () => {
    const fm = frontmatter(read(UMSETZER));
    const tools = (fm.tools ?? "").split(",").map((t) => t.trim());
    for (const tool of ["Agent", "Edit", "Write", "Bash"]) {
      // exakt statt per Wortgrenze: `Agent(kubernia-planner)` schränkt die spawnbaren Typen ein und sperrte die Lenses
      assert.ok(tools.includes(tool), `tools: ohne uneingeschränktes ${tool}`);
    }
    assert.match(
      fm.skills ?? "",
      /\breview-lenses\b/,
      "Ohne `skills: [review-lenses]` kennt der Umsetzer den Review-Ablauf nicht (das Skill-Tool ist per Whitelist gesperrt).",
    );
    const env = (JSON.parse(read(".claude/settings.json")) as { env?: Record<string, string> }).env ?? {};
    const tiefe = env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH;
    assert.ok(
      tiefe === undefined || Number(tiefe) >= 2,
      "Hauptchat → Umsetzer → Lens braucht zwei Ebenen; darunter entzieht Claude Code dem Umsetzer das Agent-Tool.",
    );
  });

  test("Umsetzer hat die MCP-Tools für Browser-Prüfung und Langfuse-Status-Ticket (#1291)", () => {
    const tools = (frontmatter(read(UMSETZER)).tools ?? "").split(",").map((t) => t.trim());
    // Eine Whitelist ohne mcp__-Einträge nimmt dem Subagenten ALLE MCP-Tools: dann gäbe es keine
    // Browser-Prüfung über den Playwright-MCP (AGENTS.md) und keine Langfuse-Auswertung im Status-Ticket.
    // Kernablauf der FAQ (#wie-verifiziere-ich-im-browser) plus Dialoge/Datei-Import des Spiels,
    // dazu die Langfuse-Lesetools: fehlt einer, fällt er still aus der Whitelist.
    for (const tool of [
      "navigate", "evaluate", "take_screenshot", "snapshot", "press_key", "click", "wait_for",
      "console_messages", "handle_dialog", "file_upload",
    ].map((t) => `mcp__playwright__browser_${t}`)) {
      assert.ok(tools.includes(tool), `tools: ohne ${tool}`);
    }
    // Die Langfuse-Lesetools stehen einmal in settings.json `allow` (#1311); die Umsetzer-Whitelist muss
    // mengengleich sein, sonst darf der Hauptchat etwas, was der Umsetzer nicht kann (oder umgekehrt).
    const erlaubt = (JSON.parse(read(".claude/settings.json")) as { permissions: { allow: string[] } }).permissions.allow;
    assert.deepEqual(
      tools.filter((t) => t.startsWith("mcp__langfuse__")).sort(),
      erlaubt.filter((r) => r.startsWith("mcp__langfuse__")).sort(),
      "Langfuse-Tools: Umsetzer-`tools:` und `permissions.allow` in .claude/settings.json müssen dieselbe Menge sein",
    );
    // Darf NICHT passieren: andere Server (PixelLab bleibt im Hauptchat, Claude in Chrome ist
    // gesperrt) und Node-Code im Serverprozess (steht in settings.json bewusst auf ask).
    // Langfuse nur lesend: der Server bietet auch create/update/upsert/delete an.
    const LANGFUSE_LESEN = new Set(["queryMetrics", "getMetricsSchema", "listObservations", "getObservation"]);
    const fremd = tools.filter(
      (t) =>
        t.startsWith("mcp__") &&
        (!/^mcp__(playwright|langfuse)__\w+$/.test(t) ||
          /run_code_unsafe/.test(t) ||
          (t.startsWith("mcp__langfuse__") && !LANGFUSE_LESEN.has(t.slice("mcp__langfuse__".length)))),
    );
    assert.deepEqual(fremd, [], "Unzulässige MCP-Tools in der Umsetzer-Whitelist");
    const server = (JSON.parse(read(".mcp.json")) as { mcpServers?: Record<string, unknown> }).mcpServers ?? {};
    assert.ok(
      "playwright" in server,
      "Die mcp__playwright__*-Namen im Umsetzer setzen den Server-Schlüssel `playwright` in .mcp.json voraus.",
    );
  });

  test("jedes mcp__<server>__-Präfix in allow und den Agent-Whitelists nennt einen bekannten Server (#1311)", () => {
    const projekt = Object.keys((JSON.parse(read(".mcp.json")) as { mcpServers?: Record<string, unknown> }).mcpServers ?? {});
    const userScope = userScopeServer(read(ROUTING_SSOT));
    assert.ok(userScope.includes("langfuse"), "docs/model-routing.md muss `langfuse` als vorausgesetzten User-Scope-Server nennen");
    const settings = JSON.parse(read(".claude/settings.json")) as { permissions: { allow: string[] } };
    const regeln = [...settings.permissions.allow];
    for (const f of readdirSync(`${REPO_ROOT}.claude/agents`).filter((n) => n.endsWith(".md"))) {
      regeln.push(...(frontmatter(read(`.claude/agents/${f}`)).tools ?? "").split(",").map((t) => t.trim()));
    }
    assert.deepEqual(unbekannteServer(regeln, [...projekt, ...userScope]), [], "Ein MCP-Server-Name wurde umbenannt oder ist nirgends dokumentiert");
  });

  test("Erkennung greift wirklich (Red-Green): ein umbenannter Server fällt auf", () => {
    assert.deepEqual(unbekannteServer(["mcp__langfuse__getObservation", "mcp__playwright", "Bash(npm:*)"], ["langfuse", "playwright"]), []);
    assert.deepEqual(unbekannteServer(["mcp__langfuse2__getObservation"], ["langfuse", "playwright"]), ["langfuse2"]);
    assert.deepEqual(userScopeServer("- User-Scope-MCP-Server, deren Namen das Repo voraussetzt: `langfuse`, `x`."), ["langfuse", "x"]);
    assert.deepEqual(userScopeServer("nichts"), []);
  });

  test("Umsetzer-Whitelist ist die vollständige erwartete Menge (#1309): nichts fällt still weg, nichts kommt still dazu", () => {
    const tools = (frontmatter(read(UMSETZER)).tools ?? "").split(",").map((t) => t.trim());
    const erwartet = [
      // Monitor/TaskStop: Abschluss-Regel #1308 (umsetzer-abschluss.test.ts prüft nur die Prosa, diese Liste bindet die Tools)
      "Read", "Grep", "Glob", "Bash", "PowerShell", "Edit", "Write", "WebFetch", "WebSearch", "Agent", "Monitor", "TaskStop", "ToolSearch",
      ...["navigate", "evaluate", "take_screenshot", "snapshot", "press_key", "click", "type", "wait_for", "console_messages", "resize", "tabs", "close", "start_video", "stop_video", "handle_dialog", "file_upload"].map((t) => `mcp__playwright__browser_${t}`),
      ...["queryMetrics", "getMetricsSchema", "listObservations", "getObservation"].map((t) => `mcp__langfuse__${t}`),
    ];
    assert.deepEqual([...tools].sort(), [...erwartet].sort(), "tools: des Umsetzers weicht von der erwarteten Gesamtmenge ab: bewusst ändern = diese Liste mitpflegen");
  });

  test("der kubernia-Skill spawnt den Umsetzer ohne model-Override", () => {
    const spawn = spawnFuer(read(UMSETZUNGS_SKILL), "kubernia-umsetzer");
    assert.notEqual(spawn, "", `${UMSETZUNGS_SKILL} braucht einen \`Agent({ subagent_type: "kubernia-umsetzer", … })\`-Spawn`);
    assert.doesNotMatch(spawn, /\bmodel:/, "Ein `model:` am Spawn (auch ohne Anführungszeichen) überstimmt das Frontmatter des Umsetzers");
  });

  test("Erkennung greift wirklich (Red-Green): spawnFuer trennt Blöcke und erkennt den Override", () => {
    const md =
      'Agent({\n  subagent_type: "kubernia-planner",\n  prompt: "p"\n})\n\n' +
      'Agent({\n  subagent_type: "kubernia-umsetzer",\n  model: "opus",\n  prompt: "u"\n})';
    assert.equal(spawnBloecke(md).length, 2);
    assert.match(spawnFuer(md, "kubernia-umsetzer"), /model:\s*"opus"/, "der Override fällt am richtigen Block auf");
    assert.doesNotMatch(spawnFuer(md, "kubernia-planner"), /model:/, "der Nachbarblock bleibt unberührt");
    assert.equal(spawnFuer(md, "gibt-es-nicht"), "");
  });

  test("der Skill kubernia-loop existiert nicht mehr (ein Umsetzer pro Ticket ersetzt ihn)", () => {
    assert.ok(!existsSync(`${REPO_ROOT}.claude/skills/kubernia-loop`), "kubernia-loop ging im Umsetzer-Subagenten auf (#1280)");
  });
});

describe("Keine festen Modell-IDs, genau eine Planungs-Oberfläche (#1065)", () => {
  test("keine harte Modell-ID in agents, skills, workflows und settings.json", () => {
    const treffer = routingFiles().filter((f) => hatHartenPin(read(f)));
    assert.deepEqual(treffer, [], `Feste Modell-IDs statt Alias (opus/sonnet/haiku) in:\n${treffer.join("\n")}`);
    assert.ok(routingFiles().length >= 7, "Der Datei-Walk darf nicht leer laufen");
  });

  test("Erkennung greift wirklich (Red-Green): ID ja, Alias nein", () => {
    assert.ok(hatHartenPin("---\nmodel: claude-opus-5\n---\n"));
    assert.ok(hatHartenPin("Agent({model: 'claude-haiku-4-5-20251001'})"));
    assert.ok(hatHartenPin('{ "model": "claude-sonnet-5-5" }'));
    assert.ok(!hatHartenPin("---\nmodel: opus\n---\n"));
    assert.ok(!hatHartenPin('{ "model": "sonnet" }'));
  });

  test("der Skill plan-feature existiert nicht mehr, höchstens eine Planungsrolle", () => {
    assert.ok(!existsSync(`${REPO_ROOT}.claude/skills/plan-feature`), "plan-feature ging in den kubernia-planner auf (#1065)");
    const planend = routingFiles()
      .filter((f) => f.endsWith(".md"))
      .filter((f) => {
        const fm = frontmatter(read(f));
        return /plan/i.test(fm.name ?? "") || /plane das ticket|mach mir einen plan/i.test(fm.description ?? "");
      });
    assert.deepEqual(planend, [".claude/agents/kubernia-planner.md"], "Es darf nur EINEN Agent/Skill mit Planungsrolle geben.");
  });
});

describe("Keine Doku behauptet mehr den alten Routing-Ist-Zustand (#1035)", () => {
  test("kein Markdown im Repo schreibt die Umsetzung auf den Session-Default", () => {
    const violations: string[] = [];
    // `collectMarkdown` erfasst seit #1091 auch die versionierten .claude-Ordner und liefert
    // repo-RELATIVE Pfade. Das Auflösen gegen REPO_ROOT entkoppelt den Lauf vom cwd: startet
    // Vitest nicht im Repo-Root, gäbe es sonst ein nacktes ENOENT statt einer Gate-Meldung.
    for (const file of collectMarkdown(REPO_ROOT)) {
      for (const v of retiredRoutingClaims(readFileSync(`${REPO_ROOT}${file}`, "utf8"))) {
        violations.push(`${file}:${v.line} behauptet „${v.term}" – ${v.home}. Zeile: „${v.text}"`);
      }
    }
    assert.deepEqual(
      violations,
      [],
      "Veraltete Routing-Beschreibung gefunden. Entweder nachziehen (der Coding-Tier ist auf beiden Pfaden " +
        `gesetzt) oder – wenn der Begriff bewusst zitiert wird – in Inline-Backticks setzen:\n${violations.join("\n")}`,
    );
  });

  test("Erkennung greift wirklich (Red-Green): Behauptung ja, Zitat/gültige Warnung nein", () => {
    assert.deepEqual(
      retiredRoutingClaims("Der Skill läuft auf dem Session-Default.").map((v) => [v.line, v.term]),
      [[1, "Session-Default"]],
      "eine echte Behauptung muss zählen",
    );
    assert.deepEqual(
      retiredRoutingClaims("Lenses laufen mit dem Opus-Standard-Effort.").map((v) => v.term),
      ["Opus-Standard-Effort"],
      "die alte Lens-Behauptung muss zählen",
    );
    assert.deepEqual(retiredRoutingClaims("Der Begriff `Session-Default` ist abgelegt."), [], "Backticks = Zitat");
    assert.deepEqual(
      retiredRoutingClaims("Die Umsetzung läuft über den Projekt-Default `sonnet` in `.claude/settings.json`.").map((v) => v.term),
      ["Projekt-Default"],
      "die seit #1280 abgelegte Behauptung muss zählen (#1309)",
    );
    assert.deepEqual(
      retiredRoutingClaims("Der Projekt-Default ließ sich per /model überstimmen, sonnet war nur damals gesetzt (#1280)."),
      [],
      "Historienzeilen mit Ticket-Bezug sind keine Behauptung",
    );
    assert.deepEqual(retiredRoutingClaims("Ein Projekt-Default für opus wäre denkbar."), [], "ohne sonnet keine Umsetzungs-Behauptung");
    assert.deepEqual(retiredRoutingClaims("```\nSession-Default\n```\n"), [], "im Codeblock zählt nicht");
    assert.deepEqual(
      retiredRoutingClaims("Ein Subagent ohne Modell-Angabe erbt das Session-Modell."),
      [],
      "die weiterhin gültige Warnung darf NICHT rot werden",
    );
  });
});

describe("Epic-Aufteilung auf dem Planungs-Tier (#1207)", () => {
  test("Epic: Planer (opus-Rolle, Frontmatter-Effort) schlägt vor, ein sonnet-Agent legt an", async () => {
    const planer = frontmatter(read(".claude/agents/kubernia-planner.md"));
    const { aufrufe, ergebnis } = await workflowLauf({ art: "epic" });
    assert.deepEqual(aufrufe.map((a) => a.label), ["auswahl+claim", "plan:#42", "epic-anlegen:#42"]);
    assert.equal(aufrufe[1].agentType, "kubernia-planner");
    assert.equal(aufrufe[1].effort, planer.effort, "Effort der Aufteilung = Effort der Planung");
    assert.match(aufrufe[1].prompt, /Epic/, "Der Planer muss wissen, dass er aufteilen soll");
    assert.equal(aufrufe[2].model, "sonnet", "Das Anlegen ist Tipparbeit");
    assert.equal(aufrufe[2].effort, "medium", "Das Anlegen ist Tipparbeit");
    assert.match(aufrufe[2].prompt, /PLAN-TEXT/, "Der Anlege-Agent bekommt den Plan");
    assert.equal(ergebnis, "epic");
  });

  test("Epic ohne verfügbaren Planer: kein Absturz, Anlege-Agent teilt selbst auf", async () => {
    const { aufrufe, ergebnis } = await workflowLauf({ art: "epic", planerDa: false });
    assert.deepEqual(aufrufe.map((a) => a.label), ["auswahl+claim", "plan:#42", "epic-anlegen:#42"]);
    assert.doesNotMatch(aufrufe[2].prompt, /PLAN-TEXT/);
    assert.match(aufrufe[2].prompt, /selbst auf/, "Der Fallback-Auftrag muss im Prompt stehen");
    assert.equal(ergebnis, "epic");
  });

  test("Dependabot: darf KEINEN Planer-Lauf verbrennen", async () => {
    const { aufrufe, ergebnis } = await workflowLauf({ art: "dependabot" });
    assert.deepEqual(aufrufe.map((a) => a.label), ["auswahl+claim", "dependabot:#42"]);
    assert.equal(aufrufe[1].model, "sonnet");
    assert.equal(aufrufe[1].effort, "medium");
    assert.equal(ergebnis, "dependabot");
  });

  test("normales Ticket: Plan vor Pre-Flight, Planer-Prompt ohne Epic-Hinweis (Resume-Cache bleibt gültig)", async () => {
    const { aufrufe, ergebnis } = await workflowLauf({ preflight: { brauchtKlaerung: true, grund: "Test", offeneFragen: ["?"] } });
    assert.deepEqual(aufrufe.map((a) => a.label), ["auswahl+claim", "plan:#42", "preflight:#42"]);
    assert.doesNotMatch(aufrufe[1].prompt, /Epic/);
    assert.match(
      aufrufe[1].prompt,
      /^Ticket #42: Testticket\n[\s\S]*\n\nArbeitsort: [^\n]*\. Liefere den Plan wie in deiner Rolle beschrieben\.$/,
      "Der Planer-Prompt normaler Tickets darf sich nicht ändern (Resume-Cache)",
    );
    assert.equal(ergebnis, "wartet-auf-klaerung");
  });

  test("Plan-Weiche „Weiche Epic: ja“ (#1309): aus einem normalen Ticket wird die Aufteilung, kein Pre-Flight, kein Umsetzen", async () => {
    const { aufrufe, ergebnis } = await workflowLauf({ plan: "PLAN #42\n7. Weichen\nWeiche Epic: ja, weil zu groß" });
    assert.deepEqual(aufrufe.map((a) => a.label), ["auswahl+claim", "plan:#42", "epic-anlegen:#42"]);
    assert.match(aufrufe[2].prompt, /zu groß/, "Der Anlege-Agent bekommt den Plan mit der Aufteilung");
    assert.equal(ergebnis, "epic");
  });

  test("Plan-Weiche greift nie bei einem Sammelticket („(gesammelt)“ im Titel): normaler Weg", async () => {
    const { aufrufe } = await workflowLauf({ titel: "Harness-Härtung (gesammelt)", plan: "PLAN #42\nWeiche Epic: ja, weil zu groß", preflight: { brauchtKlaerung: true, grund: "Test", offeneFragen: ["?"] } });
    assert.deepEqual(aufrufe.map((a) => a.label), ["auswahl+claim", "plan:#42", "preflight:#42"]);
  });

  test("Plan-Weiche „Weiche Epic: nein“ oder fehlende Zeile: normaler Weg bis zum Pre-Flight", async () => {
    for (const plan of ["PLAN #42\nWeiche Epic: nein", "PLAN #42\n(keine Zeile)"]) {
      const { aufrufe } = await workflowLauf({ plan, preflight: { brauchtKlaerung: true, grund: "Test", offeneFragen: ["?"] } });
      assert.deepEqual(aufrufe.map((a) => a.label), ["auswahl+claim", "plan:#42", "preflight:#42"], plan);
    }
  });

  test("Plan-Weiche: pure Erkennung (Aufzählungszeichen und Fettdruck ja, Prosa und „nein“ nein)", () => {
    const planSagtEpic = blockFunktion<(p: unknown) => boolean>(workflowBlock("// ── Plan-Weiche Epic (#1309) — Anfang", "// ── Plan-Weiche Epic (#1309) — Ende").block, "planSagtEpic");
    for (const ja of ["Weiche Epic: ja", "- Weiche Epic: ja, weil x", "- **Weiche Epic:** ja", "* **Weiche Epic**: Ja, weil x", "text\n  Weiche Epic: ja", "7. Weiche Epic: ja, weil x", "7) **Weiche Epic:** ja", "  12. Weiche Epic: ja"]) assert.equal(planSagtEpic(ja), true, ja);
    for (const nein of ["Weiche Epic: nein", "7. Weiche Epic: nein", "> Weiche Epic: ja", "> 7. Weiche Epic: ja", "Die Weiche Epic: ja steht oft im Text", "Weiche Epic: jahrelang", "", null, undefined, 42]) assert.equal(planSagtEpic(nein), false, String(nein));
  });

  test("Prosa-Bindung (#1309): Planer-Rolle und Skill nennen die Pflichtzeile „Weiche Epic“", () => {
    assert.match(read(".claude/agents/kubernia-planner.md"), /Weiche Epic: nein/);
    assert.match(read(".claude/agents/kubernia-planner.md"), /Weiche Epic: ja/);
    assert.match(read(".claude/agents/kubernia-planner.md"), /verbindliches Format: eine eigene Zeile, nicht zitiert mit `>`/, "Format der Pflichtzeile ist verbindlich vorgeschrieben (#1311)");
    assert.match(read(UMSETZUNGS_SKILL), /Weiche Epic: ja/);
  });

  test("Planer-Rolle: der vom Workflow-Prompt referenzierte Abschnitt „Bei einem Epic“ existiert und verbietet das Anlegen", () => {
    const rolle = read(".claude/agents/kubernia-planner.md");
    assert.match(rolle, /^## Bei einem Epic/m);
    assert.match(rolle, /Lege keine Issues selbst an/);
  });

  test("Skill-Pfad: der Epic-Absatz delegiert die Aufteilung an den kubernia-planner", () => {
    assert.match(read(UMSETZUNGS_SKILL), /\*\*Sonderfall zu großes Epic[^\n]*kubernia-planner/);
  });

  test("Doku: die Matrix-Zeile der Epic-Aufteilung trägt opus", () => {
    const zeile = read(ROUTING_SSOT).split("\n").find((l) => /^\|\s*\*{0,2}Epic-Aufteilung/.test(l));
    assert.ok(zeile, "§1 braucht eine eigene Zeile „Epic-Aufteilung“");
    assert.match(zeile, /`opus`/);
  });
});

describe("Pre-Flight-Weichen entscheidet der Agent selbst (#1279, #1276)", () => {
  test("Weiche ohne Irreversibles: der Lauf hält NICHT an, die Entscheidung geht verbindlich in den Umsetzen-Prompt", async () => {
    const { aufrufe, ergebnis } = await workflowLauf({
      umsetzen: "abbrechen",
      preflight: { brauchtKlaerung: false, entscheidungen: ["Weiche A: Variante X, weil sie bei 10× Inhalt trägt"] },
    });
    assert.deepEqual(aufrufe.map((a) => a.label), ["auswahl+claim", "plan:#42", "preflight:#42", "umsetzen:#42"]);
    assert.equal(ergebnis, "umsetzung-abgebrochen", "der Stub beendet den Lauf nach dem Umsetzen-Aufruf");
    const prompt = aufrufe[3].prompt;
    assert.match(prompt, /Entscheidungen aus Plan\/Pre-Flight \(verbindlich\)/);
    assert.match(prompt, /Weiche A: Variante X, weil sie bei 10× Inhalt trägt/);
    assert.doesNotMatch(prompt, /im PR-Text als/, "der Umsetzen-Agent öffnet keinen PR und dokumentiert dort nichts (#1311)");
  });

  test("Resume mit klaerungAntworten UND entscheidungen: kein Halt, beide Blöcke stehen im Umsetzen-Prompt (#1311)", async () => {
    const { aufrufe, ergebnis } = await workflowLauf({
      umsetzen: "abbrechen",
      args: { nummer: 42, klaerungAntworten: ["A: ja, löschen"] },
      preflight: { brauchtKlaerung: true, grund: "Löschen", offeneFragen: ["?"], entscheidungen: ["Weiche B: Variante Y, weil Z"] },
    });
    assert.equal(ergebnis, "umsetzung-abgebrochen", "mit Antworten hält der Lauf nicht erneut an");
    const prompt = aufrufe.find((a) => a.label === "umsetzen:#42")?.prompt ?? "";
    assert.match(prompt, /Antworten der Maintainerin aus der Pre-Flight-Klärung \(verbindlich\)[\s\S]*A: ja, löschen/);
    assert.match(prompt, /Entscheidungen aus Plan\/Pre-Flight \(verbindlich\)[\s\S]*Weiche B: Variante Y, weil Z/);
  });

  test("Resume-Gegenprobe: brauchtKlaerung ohne Antworten hält an (Red-Green für den Test davor)", async () => {
    const { ergebnis } = await workflowLauf({
      umsetzen: "abbrechen",
      args: { nummer: 42 },
      preflight: { brauchtKlaerung: true, grund: "Löschen", offeneFragen: ["?"], entscheidungen: ["Weiche B"] },
    });
    assert.equal(ergebnis, "wartet-auf-klaerung");
  });

  test("leere und null-Einträge in entscheidungen werden verworfen", async () => {
    const { aufrufe } = await workflowLauf({ umsetzen: "abbrechen", preflight: { brauchtKlaerung: false, entscheidungen: ["", null] } });
    assert.doesNotMatch(aufrufe[3].prompt, /Entscheidungen aus Plan\/Pre-Flight/);
  });

  test("ohne Entscheidungen kein leerer Block im Umsetzen-Prompt", async () => {
    const { aufrufe } = await workflowLauf({ umsetzen: "abbrechen" });
    assert.doesNotMatch(aufrufe[3].prompt, /Entscheidungen aus Plan\/Pre-Flight/);
  });

  test("Pre-Flight-Auftrag: Rückfrage nur bei Irreversiblem/Außenwirkung, Optik und Weichen entscheidet der Agent", () => {
    const quelle = read(".claude/workflows/kubernia-ticket.js");
    assert.doesNotMatch(quelle, /Triff selbst KEINE inhaltliche Entscheidung/);
    assert.match(quelle, /entscheidungen: \{\s*type: 'array'/, "PREFLIGHT_SCHEMA braucht das Feld entscheidungen");
    assert.match(quelle, /Irreversibles oder Außenwirkung/);
    assert.match(quelle, /brauchtKlaerung = true NUR bei Irreversiblem oder Außenwirkung/, "die Prompt-Regel selbst");
  });
});

describe("Umsetzer-Bericht: LERNKANDIDATEN (#1292, #1276)", () => {
  const rolle = read(UMSETZER);
  const skill = read(UMSETZUNGS_SKILL);

  test("das feste Berichtsformat trägt die Zeile LERNKANDIDATEN, nach BEFUNDE", () => {
    assert.match(rolle, /^LERNKANDIDATEN: <max\. 3 Punkte, nur projektübergreifendes Wissen, oder ->$/m);
    assert.ok(rolle.indexOf("\nBEFUNDE:") < rolle.indexOf("\nLERNKANDIDATEN:"), "LERNKANDIDATEN steht hinter BEFUNDE");
  });

  test("Abgrenzung zu BEFUNDE steht in der Rolle, und der Subagent legt nichts selbst ab", () => {
    assert.match(rolle, /BEFUNDE[^\n]*nur kubernia-Spezifisches/);
    assert.match(rolle, /legst (es|sie|nichts) [^\n]*selbst[^\n]*ab|legst du nichts selbst ab/);
  });

  test("der kubernia-Skill reicht LERNKANDIDATEN im Abschlussbericht durch", () => {
    assert.match(skill, /\*\*`gemergt`\*\*[^\n]*LERNKANDIDATEN/);
  });
});

describe("Entscheidungen erreichen den PR-Text auch im Workflow (#1276, #1311)", () => {
  test("der pr+merge-Prompt, der den PR öffnet, bekommt jede Entscheidung samt PR-Text-Auftrag", async () => {
    const { aufrufe } = await workflowLauf({ preflight: { brauchtKlaerung: false, entscheidungen: ["Weiche A: X, weil Y", "Weiche B: P, weil Q"] } });
    const prompt = aufrufe.find((a) => a.label === "pr+merge:#42")?.prompt ?? "";
    assert.match(prompt, /Weiche A: X, weil Y/);
    assert.match(prompt, /Weiche B: P, weil Q/);
    assert.match(prompt, /im PR-Text als „Entscheidung: X, weil Y“/);
  });

  test("ohne Entscheidungen steht kein Block im pr+merge-Prompt", async () => {
    const { aufrufe } = await workflowLauf();
    assert.doesNotMatch(aufrufe.find((a) => a.label === "pr+merge:#42")?.prompt ?? "", /Entscheidungen aus Plan\/Pre-Flight/);
  });

  test("Umsetzen- und pr+merge-Prompt bauen den Block aus demselben Helfer (driftfest)", () => {
    const quelle = read(".claude/workflows/kubernia-ticket.js");
    assert.equal([...quelle.matchAll(/entscheidungsBlock\(\s*entscheidungen,/g)].length, 2);
    assert.match(quelle, /entscheidungen\.map\(\(e, i\)/, "der Helfer nummeriert die Entscheidungen");
  });
});

describe("Workflow-Pfad: Lernkandidaten und PixelLab (#1311)", () => {
  test("der Endstand trägt die lernkandidaten des Umsetzers, leer wenn keine", async () => {
    const mit = await workflowLauf({ umsetzen: { dateien: ["src/a.ts"], extra: { lernkandidaten: ["Lens-Spawn braucht X"] } } });
    assert.deepEqual(mit.endstand.lernkandidaten, ["Lens-Spawn braucht X"]);
    const ohne = await workflowLauf();
    assert.deepEqual(ohne.endstand.lernkandidaten, []);
  });

  test("UMSETZUNG_SCHEMA deckelt lernkandidaten auf 3, der Umsetzen-Prompt nennt PixelLab und den Abbruch ohne Platzhalter", async () => {
    const quelle = read(".claude/workflows/kubernia-ticket.js");
    assert.match(quelle, /lernkandidaten: \{\s*type: 'array',\s*maxItems: 3/);
    const { aufrufe } = await workflowLauf({ umsetzen: "abbrechen" });
    const prompt = aufrufe.find((a) => a.label === "umsetzen:#42")?.prompt ?? "";
    assert.match(prompt, /assets\/pixellab\//);
    assert.match(prompt, /PixelLab-Asset fehlt/);
    assert.match(prompt, /KEIN prozeduraler Platzhalter/);
    assert.match(prompt, /höchstens 3 Punkte/);
  });
});

/**
 * Prosa-Wächter für die Weichen-Regel auf dem Skill-Pfad (#1311): „Weichen selbst entscheiden, Rückfrage nur
 * bei Irreversiblem oder Außenwirkung“. Der Workflow-Pfad ist per Stub getestet (oben); der Skill-Pfad hat nur
 * Text (kubernia/SKILL.md Schritt 3, Planer Abschnitt 7, Umsetzer „entscheidung-noetig“). Ein Prädikat je Stelle,
 * jeweils mit rotem Gegenbeispiel.
 */
const skillSchritt3 = (md: string): string => /^3\. \*\*Pre-Flight\*\*[^\n]*/m.exec(md)?.[0] ?? "";
/** Skill, Schritt 3: Entscheidungen aus Abschnitt 7 verbindlich, AskUserQuestion nur bei Irreversiblem/Außenwirkung. */
const skillRegelOk = (md: string): boolean => {
  const z = skillSchritt3(md);
  return /Entscheidungen aus Abschnitt 7[^.]*verbindlich/.test(z) && /`AskUserQuestion` nur[^.]*Irreversibles oder Außenwirkung/.test(z);
};
/** Planer, Abschnitt 7: entscheiden, „Rückfrage nötig“ nur bei Irreversiblem oder Außenwirkung. */
const planerRegelOk = (md: string): boolean => {
  const z = /^7\. \*\*Weichen und Entscheidungen\*\*[^\n]*/m.exec(md)?.[0] ?? "";
  return /\*\*entscheiden\*\*/.test(z) && /„Rückfrage nötig“ steht nur bei Irreversiblem oder Außenwirkung/.test(z);
};
/** Umsetzer: Ermessensfragen selbst entscheiden, `entscheidung-noetig` nur bei Irreversiblem oder Außenwirkung. */
const umsetzerRegelOk = (md: string): boolean =>
  /Ermessensfragen[^.]*entscheidest du selbst/.test(md) && /`entscheidung-noetig` melden nur bei Irreversiblem oder Außenwirkung/.test(md);

describe("Weichen-Regel im Skill-Pfad (#1311)", () => {
  test("Skill, Planer und Umsetzer tragen die Regel", () => {
    assert.ok(skillRegelOk(read(UMSETZUNGS_SKILL)), `${UMSETZUNGS_SKILL} Schritt 3`);
    assert.ok(planerRegelOk(read(".claude/agents/kubernia-planner.md")), "kubernia-planner.md Abschnitt 7");
    assert.ok(umsetzerRegelOk(read(UMSETZER)), `${UMSETZER}`);
  });

  test("Red-Green: eine aufgeweichte Fassung wird erkannt", () => {
    const skill = read(UMSETZUNGS_SKILL);
    assert.ok(!skillRegelOk(skill.replace("`AskUserQuestion` nur, wenn", "`AskUserQuestion` immer, wenn")), "Skill: Rückfrage nicht mehr eingeschränkt");
    assert.ok(!skillRegelOk(skill.replace("als verbindlich", "als Vorschlag")), "Skill: Entscheidungen nicht mehr verbindlich");
    const planer = read(".claude/agents/kubernia-planner.md");
    assert.ok(!planerRegelOk(planer.replace("steht nur bei Irreversiblem oder Außenwirkung", "steht bei jeder Optik-Weiche")), "Planer");
    assert.ok(!planerRegelOk(planer.replace("**entscheiden**", "vorschlagen")), "Planer: nicht mehr entscheiden");
    const umsetzer = read(UMSETZER);
    assert.ok(!umsetzerRegelOk(umsetzer.replace("`entscheidung-noetig` melden nur bei", "`entscheidung-noetig` melden auch bei")), "Umsetzer");
    assert.ok(!umsetzerRegelOk(umsetzer.replace("entscheidest du selbst", "legst der Maintainerin vor")), "Umsetzer: Ermessen nicht mehr selbst");
    assert.ok(!skillRegelOk("") && !planerRegelOk("") && !umsetzerRegelOk(""), "leerer Text erfüllt keine Regel");
  });
});

describe("Workflow-Pfad räumt Waisen auf wie der SubagentStop-Hook auf dem Skill-Pfad (#1311)", () => {
  test("der cleanup-Agent bekommt den Waisen-Sweep samt Altersgrenze", async () => {
    const { aufrufe } = await workflowLauf();
    const prompt = aufrufe.find((a) => a.label === "cleanup:#42")?.prompt ?? "";
    assert.match(prompt, /node scripts\/cleanup-worktrees\.mjs/);
    assert.match(prompt, /--fix/);
    assert.match(prompt, /unter 5 Minuten/);
  });
});

describe("Pflegeschritt und Brain-Lesen (#1099)", () => {
  /** Marker eines Textes: Code-Spans mit `echo "pflege: …"`, als Bash-Event gewertet. */
  const markerIn = (text: string, nr: string) => {
    const treffer = [...text.matchAll(/`(echo "pflege: [^"`]*")`/g)].map((m) => m[1].replace("<nr>", nr));
    return treffer.map((command) => pflegeMarker({ tool: "Bash", input: { command } }));
  };

  test("Umsetzer-Definition nennt beide Marker als Shell-Befehle, die das Messskript erkennt", () => {
    assert.deepEqual(markerIn(read(UMSETZER), "1"), ["start", "ende"]);
  });

  test("Red-Green: ein verfälschter Marker wird vom Messskript nicht mehr erkannt (#1331)", () => {
    // Das Extraktionsmuster sortiert nicht mehr vor: allein `pflegeMarker` entscheidet.
    const verfaelscht = read(UMSETZER).replace('echo "pflege: start #<nr>"', 'echo "pflege: startklar #<nr>"');
    assert.deepEqual(markerIn(verfaelscht, "1"), [null, "ende"]);
    assert.equal(pflegeMarker({ tool: "Bash", input: { command: 'echo "pflege: startklar #1"' } }), null);
  });

  test("Umsetzen-Prompt des Workflows trägt beide Marker, erkannt vom Messskript", async () => {
    const { aufrufe } = await workflowLauf({ umsetzen: "abbrechen" });
    const prompt = aufrufe.find((a) => a.label === "umsetzen:#42")?.prompt ?? "";
    assert.deepEqual(markerIn(prompt, "42"), ["start", "ende"]);
    assert.match(prompt, /VOR dem abschließenden npm run verify/);
  });

  test("Brain-Lese-Konvention steht in Umsetzer, Lens, Umsetzen- und Nachbessern-Prompt", async () => {
    for (const datei of [UMSETZER, ".claude/agents/kubernia-lens.md"]) {
      const t = read(datei);
      assert.match(t, /anlaufstellen\.md/, datei);
      assert.match(t, /`Read`/, datei);
    }
    const { aufrufe } = await workflowLauf({
      runden: [{ architektur: { lens: "architektur", verdikt: "blockierend", findings: [{ schwere: "blockierend", befund: "B", ort: "a.ts:1", begruendung: "b" }] } }, {}],
    });
    for (const label of ["umsetzen:#42", "nachbessern 1/2:#42"]) {
      const prompt = aufrufe.find((a) => a.label === label)?.prompt ?? "";
      assert.match(prompt, /anlaufstellen\.md/, label);
      assert.match(prompt, /Read-Tool/, label);
    }
  });

  test("Messdoku nennt den Marker und ist ohne Platzhalter-Zusage für #1099", () => {
    const doku = read(ROUTING_SSOT);
    assert.match(doku, /pflege: start/);
    assert.doesNotMatch(doku, /kommen mit #1099/);
  });
});
