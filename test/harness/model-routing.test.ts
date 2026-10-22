/* Modell-Routing-Wächter (#1035) – „Planung stark, Umsetzung schnell" darf nicht
 * ins Leere greifen, und keine Doku darf das Gegenteil behaupten.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Vorgeschichte: AGENTS.md § Modellwahl (#910) verlangt den Coding-Tier für die
 * Umsetzung. Auf dem **Skill-Pfad** schrieb aber der
 * **Hauptagent** den Code. Der lief auf dem Session-Modell: startet die Maintainerin
 * aus einer Opus-Session (der Normalfall, weil Planung/Review Opus verlangen), tippte
 * die gesamte Umsetzung auf Opus. Die Regel existierte, der Hebel war nicht gezogen.
 *
 * Der Wächter deckt die drei Fehlklassen ab, die das leise zurückbringen:
 *
 *   1. **Der Hebel verschwindet.** Seit #1280 ist der Hebel das Frontmatter des Subagenten
 *      `kubernia-umsetzer` (Skill-Frontmatter greift wegen anthropics/claude-code#98898 nur bei
 *      `/kubernia`, ein Projekt-Default ließ sich per `/model` überstimmen; seit #1557 gilt `sonnet` als Projekt-Default nur für den Hauptchat). Es ist je eine Zeile –
 *      gelöscht/umformuliert fällt die Umsetzung wortlos aufs Session-Modell zurück.
 *   2. **Der Review wird still mitdemoviert.** Der Umsetzer läuft auf dem
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
 * und dass `.claude/settings.json` den Hauptchat auf `sonnet` setzt (#1557: Projekt-Default, Ad-hoc-Opus per `/model`).
 *
 * Seit #1065 gilt zusätzlich: `model` (oder `agentType`), es gibt keine festen Modell-IDs mehr und genau
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
 *     Ausnahme ist der Planer (Wert im Frontmatter).
 *   - `routingFiles()` liest das Dateisystem (nicht `git ls-files`, wie `collectMarkdown`, #1091):
 *     untrackte lokale Dateien in .claude/ werden mitgeprüft und können lokal rot machen, die CI nicht.
 *   - Die Epic-Aufteilung auf dem Skill-Pfad wird nur auf den Verweis im Text geprüft.
 *   - Das Agent-Tool kennt `effort`, die Konvention setzt ihn nicht am Spawn (docs/model-routing.md §2): der
 *     Effort von Repo-Agenten (kubernia-lens, Explore) kommt aus ihrem Frontmatter; am Spawn wird geprüft, dass
 *     KEIN `model:` das Frontmatter überstimmt. `effort: low` am Explore wirkt, solange `haiku`
 *     auf Haiku 5.5 auflöst (Anthropic-API, Effort unterstützt); auf Cloud-Providern mit Haiku 4.5 nicht.
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
import { workflowDateien } from "./repo-texte";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { parseFrontmatter } from "../../scripts/docs-gen/markdown.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as brainMetrics from "../../scripts/brain-metrics.mjs";

const pflegeMarker = (brainMetrics as { pflegeMarker: (ev: { tool: string; input: { command: string } }) => "start" | "ende" | null }).pflegeMarker;

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs aus, scripts/ nicht im tsconfig)
// – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkDocDrift from "../../scripts/check-docdrift.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkBasis from "../../scripts/check-basis.mjs";
import { liesMitProjektwerten, liesTicketAblauf, TICKET_ABLAUF } from "../support/ticket-ablauf";

// Begründete Ausnahme, identisch zu test/harness/agents-md-native.test.ts: das .mjs hat kein
// Declaration-File, der Namespace ist für tsc „error typed". Eng begrenzter
// Inline-Disable statt einer Gate-Config-Änderung.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const stripFencedCode: (md: string) => string = checkDocDrift.stripFencedCode;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const collectMarkdown: (rootDir?: string) => string[] = checkBasis.collectMarkdown;

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

/** Der Einstiegs-Skill im Hauptchat; sein Frontmatter gilt nur bei /kubernia (#1035, #1280). */
const UMSETZUNGS_SKILL = ".claude/skills/factory-ticket/SKILL.md";
/** Der zweite Ticket-Skill (Bereich agentic); der Ablauf selbst steht in `.claude/skills/factory/ablauf.md` (#1806). */
const FACTORY_SKILL = ".claude/skills/factory/SKILL.md";
/** Der Subagent, der auf dem Skill-Pfad tatsächlich umsetzt (#1280). */
const UMSETZER = ".claude/agents/factory-umsetzer.md";
/** Der Skill, dessen Lenses trotz Coding-Tier-Umsetzung auf dem starken Tier bleiben müssen. */
const REVIEW_SKILL = ".claude/skills/review-lenses/SKILL.md";
/** Die SSOT-/Checklisten-Datei für Modell-Pins. */
const ROUTING_SSOT = "docs/model-routing.md";

/** Das YAML-Frontmatter als flache Key→Value-Map: dieselbe Implementierung wie die Generatoren (#1392). */
const frontmatter = parseFrontmatter as (md: string) => Record<string, string>;

/**
 * Befunde zum Hauptchat-Modell in den Projekt-Settings (#1557): `model` muss genau `sonnet` sein (der Alias, nie eine feste ID),
 * und kein `env`-Schlüssel mit MODEL darf es überstimmen (`ANTHROPIC_MODEL` hat Vorrang vor dem Settings-`model`; generisch,
 * damit neue Variablennamen nicht durchrutschen); ebenso kein EFFORT-Schlüssel (`CLAUDE_CODE_EFFORT_LEVEL` überstimmt das
 * Agent-Frontmatter). Die 1h-TTL des Hauptchats bleibt Default: kein TTL-Schlüssel (docs/model-routing.md §5).
 */
function hauptchatModellBefunde(settings: { model?: string; promptCacheTtl?: string; experimental?: { cacheTtl?: string }; env?: Record<string, string> }): string[] {
  const out = settings.model === "sonnet" ? [] : [`model=${JSON.stringify(settings.model ?? null)}`];
  for (const k of Object.keys(settings.env ?? {})) if (/MODEL|EFFORT|PROMPT_CACHE_TTL|PROMPT_CACHING/i.test(k)) out.push(`env.${k}`);
  if (settings.promptCacheTtl !== undefined) out.push("promptCacheTtl");
  if (settings.experimental?.cacheTtl !== undefined) out.push("experimental.cacheTtl");
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

/** `agent({…})`-Aufrufe eines Skripts, je Aufruf der Text bis zur nächsten Aufruf-Grenze. */
function agentAufrufe(text: string): string[] {
  return text.split(/\bagent\(\s*\{/).slice(1).map((r) => r.split(/\bagent\(\s*\{/)[0]);
}

/** Aufrufe ohne `model:`/`agentType:` oder ohne `effort:`. */
const unvollstaendigeAufrufe = (text: string) =>
  agentAufrufe(text).filter((a) => !/\b(model|agentType)\s*:/.test(a) || !/\beffort\s*:/.test(a));

/** Alle versionierten Routing-Dateien: Agents, Skills und die Projekt-Settings. */
function routingFiles(): string[] {
  const out = [".claude/settings.json"];
  for (const d of readdirSync(`${REPO_ROOT}.claude/agents`)) out.push(`.claude/agents/${d}`);
  for (const d of readdirSync(`${REPO_ROOT}.claude/skills`)) out.push(`.claude/skills/${d}/SKILL.md`);
  // Skill-Quellen (#1848): Modell und Aufwand eines Skills stehen in der Quelle und im Zeiger.
  if (existsSync(`${REPO_ROOT}.agents/skills`)) for (const d of readdirSync(`${REPO_ROOT}.agents/skills`)) out.push(`.agents/skills/${d}/SKILL.md`);
  out.push(...workflowDateien());
  return out.filter((f) => existsSync(`${REPO_ROOT}${f}`));
}

/** Trägt der Text eine feste Modell-ID (`model: claude-opus-5`, `"model": "claude-haiku-4-5-…"`)? */
const hatHartenPin = (text: string) => /\bmodel["']?\s*:\s*["']?claude-(opus|sonnet|haiku|fable)-\d/i.test(text);

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
 * Die abgelegte Behauptung. Nach #1035 gibt es keinen wahren Satz mehr, in dem die
 * Umsetzung „auf dem Session-Default" läuft – der Coding-Tier ist gesetzt (Subagent per Frontmatter).
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
    home: "die Lenses tragen `effort: high` im Frontmatter von kubernia-lens und laufen damit (#1209)",
  },
  {
    term: "Session-Default",
    home: `die Umsetzung tippt den Coding-Tier – im Subagenten ${UMSETZER} (Frontmatter, #1280)`,
  },
  {
    // „Die Umsetzung läuft über den Projekt-Default sonnet" ist seit #1280 abgelegt (#1309); seit #1557 gilt der Projekt-Default
    // sonnet dem Hauptchat, darum zählt nur die Umsetzungs-Behauptung (`nurWenn`). `ausser` spart die
    // Historien-Absätze aus (model-routing §5, agent-harness Stufe 3/4), die den Begriff mit Datum/Ticket nennen.
    term: "Projekt-Default",
    nurWenn: /(?=.*sonnet)(?=.*Umsetzung)(?=.*läuft)/i,
    ausser: /#1065|#1280|#1557|entfernt|ließe|ließ\b|damals/,
    home: `die Umsetzung läuft im Subagenten ${UMSETZER} (Frontmatter, #1280); der Projekt-Default sonnet gilt dem Hauptchat (#1557)`,
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
  test.each([UMSETZUNGS_SKILL, FACTORY_SKILL])("%s routet per Frontmatter auf den Coding-Tier", (skillDatei) => {
    const fm = frontmatter(read(skillDatei));
    assert.ok(
      fm.model && istCodingTier(fm.model),
      `Im Frontmatter von ${skillDatei} fehlt ein \`model:\` auf dem Coding-Tier (Alias \`sonnet\`). ` +
        "Die Zeile wirkt nur bei Aufruf als `/kubernia` (anthropics/claude-code#98898); der eigentliche Hebel " +
        `ist der Subagent ${UMSETZER} (#1280). Gefunden: model=„${fm.model ?? "(fehlt)"}".`,
    );
    // Absichtlich nur Anwesenheit, nicht der Wert: die Regel ist „explizit statt erben".
    // Welche Stufe richtig ist, entscheidet docs/model-routing.md und darf sich dort ohne
    // Test-Änderung bewegen – gebunden wäre nur eine Doppelpflege.
    assert.ok(
      fm.effort,
      `Im Frontmatter von ${skillDatei} fehlt \`effort:\` – der Reasoning-Aufwand der Umsetzungsphase ` +
        "wird sonst ebenfalls von der Session geerbt (#1035).",
    );
  });

  test(`${REVIEW_SKILL} spawnt die Lenses über den Agenten kubernia-lens (opus/high), ohne model-Override`, () => {
    const md = liesMitProjektwerten(REVIEW_SKILL);
    // Bewusst an den `Agent({…})`-Spawn-Block gebunden, nicht datei-weit: sonst hält ein
    // beliebiger Prosa-Satz („historisch stand hier model: opus") den Test grün, während
    // die Lenses längst wieder inline oder auf general-purpose laufen.
    const spawn = /Agent\(\{[^}]*\}\)/s.exec(md)?.[0] ?? "";
    assert.match(
      spawn,
      /subagent_type:\s*"kubernia-lens"/,
      `${REVIEW_SKILL} muss die Lens-Pässe in einem \`Agent({…})\`-Spawn über \`kubernia-lens\` starten: ` +
        "nur dessen Frontmatter trägt `effort: high`, ein `effort:` am Spawn überstimmte es (#1209). " +
        "Laufen die Lenses inline im Hauptagenten, reviewt Sonnet, und der finale Blick wäre ein Self-Grading (#1012).",
    );
    assert.doesNotMatch(
      spawn,
      /\bmodel\s*:/,
      "Ein `model:` am Spawn überstimmt das Frontmatter von kubernia-lens – das Modell steht nur dort (#1209).",
    );
    const lens = frontmatter(read(".claude/agents/factory-lens.md"));
    assert.equal(lens.name, "kubernia-lens");
    assert.equal(lens.model, "opus", "Lenses laufen auf dem starken Tier");
    assert.equal(lens.effort, "high", "Effort der Review-Phase laut Matrix (docs/model-routing.md §1)");
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
  test(".claude/settings.json setzt den Hauptchat auf sonnet (#1557)", () => {
    const settings = JSON.parse(read(".claude/settings.json")) as { model?: string; env?: Record<string, string> };
    assert.deepEqual(
      hauptchatModellBefunde(settings),
      [],
      "Der Hauptchat orchestriert nur (Claim, Plan weiterreichen, Umsetzer spawnen, melden) und läuft per Projekt-Default auf `sonnet` " +
        "(#1557: 114 von 117 Sessions liefen sonst auf dem Opus-User-Default). Ad-hoc-Arbeit auf Opus geht per `/model opus`. " +
        "`env` darf Modell und Effort nicht überstimmen (`ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_*_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_EFFORT_LEVEL` …) " +
        "und keinen Cache-TTL-Schlüssel setzen (Entscheidung 1h-Default, docs/model-routing.md §5).",
    );
  });

  test("Erkennung greift wirklich (Red-Green): nur der Alias sonnet ist grün, env-Modelle und TTL-Schlüssel sind Befunde", () => {
    assert.deepEqual(hauptchatModellBefunde({ model: "sonnet" }), []);
    assert.deepEqual(hauptchatModellBefunde({ model: "sonnet", env: { CC_LANGFUSE_TRACE_TAGS: "kubernia" } }), []);
    assert.deepEqual(hauptchatModellBefunde({}), ["model=null"], "fehlendes model");
    for (const m of ["opus", "opusplan", "best", "claude-sonnet-5-5", "Sonnet "]) {
      assert.equal(hauptchatModellBefunde({ model: m }).length, 1, m);
    }
    for (const k of ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL", "anthropic_model"]) {
      assert.deepEqual(hauptchatModellBefunde({ model: "sonnet", env: { [k]: "x" } }), [`env.${k}`], k);
    }
    for (const k of ["CLAUDE_CODE_EFFORT_LEVEL", "claude_code_effort_level"]) {
      assert.deepEqual(hauptchatModellBefunde({ model: "sonnet", env: { [k]: "high" } }), [`env.${k}`], k);
    }
    for (const k of ["CLAUDE_CODE_PROMPT_CACHE_TTL", "FORCE_PROMPT_CACHING_5M"]) {
      assert.deepEqual(hauptchatModellBefunde({ model: "sonnet", env: { [k]: "5m" } }), [`env.${k}`], k);
    }
    assert.deepEqual(hauptchatModellBefunde({ model: "sonnet", promptCacheTtl: "5m" }), ["promptCacheTtl"]);
    assert.deepEqual(hauptchatModellBefunde({ model: "sonnet", experimental: { cacheTtl: "5m" } }), ["experimental.cacheTtl"]);
  });

  test("Planer opus/xhigh", () => {
    const planer = frontmatter(read(".claude/agents/factory-planer.md"));
    assert.equal(planer.model, "opus");
    assert.equal(planer.effort, "xhigh");
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
    assert.equal(explore.effort, "low", "Matrix §1: Explore haiku/low (wirkt auf Haiku 5.5, siehe docs/model-routing.md)");
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


/** Ziele der Matrix-Zeilen (§1 der Routing-Doku): Frontmatter-Datei und ob `model` mitgeprüft wird (Subagenten ja, Hauptagent nein). */
const MATRIX_ZIELE: Record<string, { datei: string; mitModel: boolean }> = {
  planner: { datei: ".claude/agents/factory-planer.md", mitModel: true },
  lens: { datei: ".claude/agents/factory-lens.md", mitModel: true },
  umsetzer: { datei: ".claude/agents/factory-umsetzer.md", mitModel: true },
  gruppe: { datei: ".claude/agents/factory-gruppe.md", mitModel: true },
  explore: { datei: ".claude/agents/explore.md", mitModel: true },
  forumLeser: { datei: ".claude/agents/forum-leser.md", mitModel: true },
  holdoutSzenario: { datei: ".claude/agents/holdout-szenario.md", mitModel: true },
  holdoutAbnahme: { datei: ".claude/agents/holdout-abnahme.md", mitModel: true },
  hauptagent: { datei: UMSETZUNGS_SKILL, mitModel: false },
};

const zelleOhneCode = (z: string) => z.replace(/`/g, "").trim();

/**
 * Prüft die Phasen-Matrix (§1) gegen die Frontmatter ihrer Ziele (#1609): je Zeile Ziel über die Skill-Pfad-Zelle bestimmen
 * (Reihenfolge `holdout-szenario`, `holdout-abnahme`, `forum-leser`, `kubernia-planner`, `kubernia-lens`, `kubernia-gruppe`, `kubernia-umsetzer`/„im Umsetzer“, `Explore`, „Hauptagent“), dann `effort`
 * (Spalte „Effort Skill-Pfad“) und bei Subagenten `model` (Spalte „Alias“) gleich dem Frontmatter. Liefert die Verstöße;
 * eine fehlende Spalte, eine fehlende Tabelle oder eine nicht zuordenbare Zeile ist ein Verstoß.
 */
const matrixAbweichungen = (doku: string, fmVon: (datei: string) => Record<string, string>): string[] => {
  const zeilen = doku.split("\n");
  const kopf = zeilen.findIndex((z) => z.startsWith("| Phase |"));
  if (kopf < 0) return ["Matrix-Tabelle (Kopf „| Phase |“) fehlt"];
  const zellen = (z: string) => z.split("|").slice(1, -1).map((c) => c.trim());
  const spalten = zellen(zeilen[kopf]);
  const idx = (name: string) => spalten.indexOf(name);
  const [iAlias, iEffort, iSkill] = [idx("Alias"), idx("Effort Skill-Pfad"), idx("Skill-Pfad (`kubernia`)")];
  if (iAlias < 0 || iEffort < 0 || iSkill < 0) return [`Spalte fehlt (Alias ${iAlias}, Effort Skill-Pfad ${iEffort}, Skill-Pfad ${iSkill})`];
  const fehler: string[] = [];
  for (let i = kopf + 2; i < zeilen.length && zeilen[i].startsWith("|"); i++) {
    const c = zellen(zeilen[i]);
    const phase = zelleOhneCode(c[0] ?? "");
    const skill = c[iSkill] ?? "";
    const ziel = /`holdout-szenario`/.test(skill)
      ? "holdoutSzenario"
      : /`holdout-abnahme`/.test(skill)
        ? "holdoutAbnahme"
        : /`forum-leser`/.test(skill)
      ? "forumLeser"
      : /`kubernia-planner`/.test(skill)
        ? "planner"
        : /`kubernia-lens`/.test(skill)
        ? "lens"
        : /`kubernia-gruppe`/.test(skill)
          ? "gruppe"
          : /kubernia-umsetzer|im Umsetzer/.test(skill)
            ? "umsetzer"
            : /`Explore`/.test(skill)
              ? "explore"
              : /Hauptagent/.test(skill)
                ? "hauptagent"
                : null;
    if (!ziel) {
      fehler.push(`${phase}: Ziel aus der Skill-Pfad-Zelle nicht zuordenbar`);
      continue;
    }
    const fm = fmVon(MATRIX_ZIELE[ziel].datei);
    const effort = zelleOhneCode(c[iEffort] ?? "");
    if (fm.effort !== effort) fehler.push(`${phase}: Effort Skill-Pfad „${effort}“ ≠ Frontmatter ${ziel} „${fm.effort}“`);
    const alias = zelleOhneCode(c[iAlias] ?? "");
    if (MATRIX_ZIELE[ziel].mitModel && fm.model !== alias) fehler.push(`${phase}: Alias „${alias}“ ≠ Frontmatter ${ziel} „${fm.model}“`);
  }
  return fehler;
};

describe("Matrix §1 stimmt mit den Frontmatter ihrer Ziele überein (#1609)", () => {
  const fmEcht = (datei: string) => frontmatter(read(datei));
  test("die echte Matrix hat keine Abweichung", () => {
    assert.deepEqual(matrixAbweichungen(read(ROUTING_SSOT), fmEcht), []);
  });
  test("Negativfälle: Umsetzer-Zelle `high` gegen Frontmatter `medium`, falscher Alias, unbekannte Zeile, fehlende Spalte", () => {
    const doku = read(ROUTING_SSOT);
    const zeile = "| Umsetzung | `sonnet` | `medium` |";
    assert.equal(doku.split(zeile).length, 2, "Anker genau einmal");
    const effortFalsch = doku.replace(zeile, "| Umsetzung | `sonnet` | `high` |");
    assert.match(matrixAbweichungen(effortFalsch, fmEcht).join("\n"), /Umsetzung: Effort Skill-Pfad „high“ ≠ Frontmatter umsetzer „medium“/);
    const aliasFalsch = doku.replace(zeile, "| Umsetzung | `opus` | `medium` |");
    assert.match(matrixAbweichungen(aliasFalsch, fmEcht).join("\n"), /Alias „opus“ ≠ Frontmatter umsetzer „sonnet“/);
    const gruppeZeile = "| Sammelticket-Gruppe | `sonnet` | `medium` |";
    assert.equal(doku.split(gruppeZeile).length, 2, "Gruppen-Zeile genau einmal");
    const gruppeEffort = doku.replace(gruppeZeile, "| Sammelticket-Gruppe | `sonnet` | `high` |");
    assert.match(matrixAbweichungen(gruppeEffort, fmEcht).join("\n"), /Sammelticket-Gruppe: Effort Skill-Pfad „high“ ≠ Frontmatter gruppe „medium“/);
    const gruppeAlias = doku.replace(gruppeZeile, "| Sammelticket-Gruppe | `opus` | `medium` |");
    assert.match(matrixAbweichungen(gruppeAlias, fmEcht).join("\n"), /Alias „opus“ ≠ Frontmatter gruppe „sonnet“/);
    const forumZeile = "| Forum-Triage (Quarantäne) | `sonnet` | `medium` |";
    assert.equal(doku.split(forumZeile).length, 2, "Forum-Zeile genau einmal");
    const forumEffort = doku.replace(forumZeile, "| Forum-Triage (Quarantäne) | `sonnet` | `high` |");
    assert.match(matrixAbweichungen(forumEffort, fmEcht).join("\n"), /Forum-Triage \(Quarantäne\): Effort Skill-Pfad „high“ ≠ Frontmatter forumLeser „medium“/);
    const abnahmeZeile = "| Holdout-Abnahme (nach dem Lens-Review) | `opus` | `medium` |";
    assert.equal(doku.split(abnahmeZeile).length, 2, "Abnahme-Zeile genau einmal");
    const abnahmeEffort = doku.replace(abnahmeZeile, "| Holdout-Abnahme (nach dem Lens-Review) | `opus` | `high` |");
    assert.match(matrixAbweichungen(abnahmeEffort, fmEcht).join("\n"), /Holdout-Abnahme \(nach dem Lens-Review\): Effort Skill-Pfad „high“ ≠ Frontmatter holdoutAbnahme „medium“/);
    const szenarioZeile = "| Holdout-Szenarien (vor dem Planen) | `opus` | `medium` |";
    assert.equal(doku.split(szenarioZeile).length, 2, "Szenario-Zeile genau einmal");
    const szenarioAlias = doku.replace(szenarioZeile, "| Holdout-Szenarien (vor dem Planen) | `sonnet` | `medium` |");
    assert.match(matrixAbweichungen(szenarioAlias, fmEcht).join("\n"), /Alias „sonnet“ ≠ Frontmatter holdoutSzenario „opus“/);
    const unbekannt = doku.replace("| Explore / Recherche |", "| Neue Phase | `haiku` | `low` | irgendwer |\n| Explore / Recherche |");
    assert.match(matrixAbweichungen(unbekannt, fmEcht).join("\n"), /Neue Phase: Ziel aus der Skill-Pfad-Zelle nicht zuordenbar/);
    const ohneSpalte = doku.replace("| Effort Skill-Pfad |", "| Effort |");
    assert.match(matrixAbweichungen(ohneSpalte, fmEcht).join("\n"), /Spalte fehlt/);
    assert.match(matrixAbweichungen("kein Text", fmEcht).join("\n"), /Matrix-Tabelle/);
  });
});

describe("Sammelticket-Gruppen (#1647, ADR 0026): ein Vertrag in Planer, Umsetzer und Gruppe", () => {
  const dateien = [".claude/agents/factory-planer.md", ".claude/agents/factory-umsetzer.md", ".claude/agents/factory-gruppe.md"];
  test("die Kopfzeile `GRUPPE <k>/<n>` steht wortgleich in allen drei Definitionen", () => {
    for (const d of dateien) assert.ok(read(d).includes("GRUPPE <k>/<n>"), `${d} nennt \`GRUPPE <k>/<n>\``);
  });
  test("der Planer nennt das Block-Format, der Umsetzer spawnt kubernia-gruppe ohne isolation", () => {
    assert.ok(read(dateien[0]).includes("GRUPPE <k>/<n> <Name>: L<x>, L<y> | Dateien: … | nach: <k|->"));
    const umsetzer = liesMitProjektwerten(dateien[1]);
    assert.match(umsetzer, /subagent_type: "kubernia-gruppe"/);
    assert.match(umsetzer, /ohne `isolation`/);
  });
  test("die Gruppe pusht nicht, öffnet keinen PR und hat weder Agent noch Playwright noch Web", () => {
    const fm = frontmatter(read(dateien[2]));
    assert.ok(!/\b(Agent|WebFetch|WebSearch)\b|playwright/.test(fm.tools ?? ""), "Werkzeuge der Gruppe minimal");
    assert.match(read(dateien[2]), /Kein Push, kein PR, keine Lenses/);
  });
});

describe("Skill-Pfad: die Umsetzung läuft im Subagenten kubernia-umsetzer, nicht im Hauptchat (#1280)", () => {
  test("Umsetzer-Agent: Coding-Tier und Effort aus der Matrix im eigenen Frontmatter", () => {
    const fm = frontmatter(read(UMSETZER));
    assert.equal(fm.name, "kubernia-umsetzer");
    assert.ok(
      fm.model && istCodingTier(fm.model),
      "Der Umsetzer muss im Frontmatter auf dem Coding-Tier stehen – nur das Agent-Frontmatter wirkt unabhängig " +
        "vom Session-Modell (Skill-Frontmatter gilt nur für den Turn, #98898).",
    );
    assert.equal(fm.effort, "medium", "Matrix §1: Skill-Pfad-Umsetzung sonnet/medium (Gegenprobe low verworfen, #1591); am Spawn steht kein effort");
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
    const spawn = spawnFuer(liesTicketAblauf(), "kubernia-umsetzer");
    assert.notEqual(spawn, "", `${UMSETZUNGS_SKILL} braucht einen \`Agent({ subagent_type: "kubernia-umsetzer", … })\`-Spawn`);
    assert.doesNotMatch(spawn, /\bmodel:/, "Ein `model:` am Spawn (auch ohne Anführungszeichen) überstimmt das Frontmatter des Umsetzers");
  });

  test("kein Agent-Spawn in den Skills setzt effort: oder model: (Effort steht im Frontmatter, #1342)", () => {
    const skills: [string, string][] = [[REVIEW_SKILL, read(REVIEW_SKILL)], [`${UMSETZUNGS_SKILL} (Ablauf ${TICKET_ABLAUF})`, liesTicketAblauf()]];
    for (const [skill, text] of skills) {
      const bloecke = spawnBloecke(text);
      assert.ok(bloecke.length > 0, `${skill} hat Agent-Spawns`);
      for (const b of bloecke) assert.doesNotMatch(b.replace(/\/\/[^\n]*/g, ""), /\b(effort|model)\s*:/, `${skill}: Spawn setzt effort:/model: und überstimmte das Frontmatter`);
    }
    assert.match(spawnBloecke('Agent({ subagent_type: "x", effort: "high" })')[0], /\beffort\s*:/, "Erkennung greift (Red-Green)");
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

  test("genau ein Ticket-Ablauf: kubernia-workflow-Skill und kubernia-ticket-Workflow existieren nicht (ADR 0028)", () => {
    assert.ok(!existsSync(`${REPO_ROOT}.claude/skills/kubernia-workflow`), "der Skill kubernia ist der einzige Ticket-Ablauf");
    assert.ok(!existsSync(`${REPO_ROOT}.claude/workflows/kubernia-ticket.js`), "der Workflow ging im Skill kubernia auf");
  });

  test("jeder agent({…})-Aufruf in .claude/workflows trägt model:/agentType: und effort: (#1740)", () => {
    const fehler = workflowDateien().filter((f) => unvollstaendigeAufrufe(readFileSync(`${REPO_ROOT}${f}`, "utf8")).length > 0);
    assert.deepEqual(fehler, []);
  });

  test("Erkennung greift (Red-Green): Aufruf ohne effort oder ohne model/agentType wird gemeldet", () => {
    assert.equal(unvollstaendigeAufrufe('agent({ agentType: "x", effort: "high", prompt: "p" })').length, 0);
    assert.equal(unvollstaendigeAufrufe('agent({ model: "sonnet", effort: "low" })').length, 0);
    assert.equal(unvollstaendigeAufrufe('agent({ agentType: "x", prompt: "p" })').length, 1);
    assert.equal(unvollstaendigeAufrufe('agent({ effort: "high", prompt: "p" })').length, 1);
    const zwei = 'agent({ model: "sonnet", effort: "low" });\nagent({ prompt: "ohne" })';
    assert.equal(unvollstaendigeAufrufe(zwei).length, 1, "der Nachbaraufruf deckt den zweiten nicht");
    assert.equal(unvollstaendigeAufrufe("kein Aufruf").length, 0);
  });

  test("der Skill kubernia-loop existiert nicht mehr (ein Umsetzer pro Ticket ersetzt ihn)", () => {
    assert.ok(!existsSync(`${REPO_ROOT}.claude/skills/kubernia-loop`), "kubernia-loop ging im Umsetzer-Subagenten auf (#1280)");
  });
});

describe("Keine festen Modell-IDs, genau eine Planungs-Oberfläche (#1065)", () => {
  test("keine harte Modell-ID in agents, skills und settings.json", () => {
    const treffer = routingFiles().filter((f) => hatHartenPin(read(f)));
    assert.deepEqual(treffer, [], `Feste Modell-IDs statt Alias (opus/sonnet/haiku) in:\n${treffer.join("\n")}`);
    assert.ok(routingFiles().length >= 7, "Der Datei-Walk darf nicht leer laufen");
    assert.ok(routingFiles().includes(".agents/skills/forum/SKILL.md"), "die Skill-Quelle forum liegt im Scan");
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
    assert.deepEqual(planend, [".claude/agents/factory-planer.md"], "Es darf nur EINEN Agent/Skill mit Planungsrolle geben.");
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
      "Veraltete Routing-Beschreibung gefunden. Entweder nachziehen (der Coding-Tier ist " +
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
    assert.deepEqual(
      retiredRoutingClaims("Der Hauptchat startet über den Projekt-Default sonnet (#1557)."),
      [],
      "der Hauptchat-Projekt-Default ist wieder wahr und darf nicht als abgelegt zählen (#1557)",
    );
    assert.deepEqual(
      retiredRoutingClaims("Der Hauptchat läuft auf dem Projekt-Default sonnet und orchestriert nur."),
      [],
      "ohne Umsetzungs-Behauptung keine Meldung",
    );
    assert.deepEqual(retiredRoutingClaims("```\nSession-Default\n```\n"), [], "im Codeblock zählt nicht");
    assert.deepEqual(
      retiredRoutingClaims("Ein Subagent ohne Modell-Angabe erbt das Session-Modell."),
      [],
      "die weiterhin gültige Warnung darf NICHT rot werden",
    );
  });
});

describe("Epic-Aufteilung auf dem Planungs-Tier (#1207)", () => {
  test("Prosa-Bindung (#1309): Planer-Rolle und Skill nennen die Pflichtzeile „Weiche Epic“", () => {
    assert.match(read(".claude/agents/factory-planer.md"), /Weiche Epic: nein/);
    assert.match(read(".claude/agents/factory-planer.md"), /Weiche Epic: ja/);
    assert.match(read(".claude/agents/factory-planer.md"), /verbindliches Format: eine eigene Zeile, nicht zitiert mit `>`/, "Format der Pflichtzeile ist verbindlich vorgeschrieben (#1311)");
    assert.match(liesTicketAblauf(), /Weiche Epic: ja/);
  });

  test("Planer-Rolle: der vom Skill (Hinweis „Epic: liefere die Aufteilung“) referenzierte Abschnitt „Bei einem Epic“ existiert und verbietet das Anlegen", () => {
    const rolle = read(".claude/agents/factory-planer.md");
    assert.match(rolle, /^## Bei einem Epic/m);
    assert.match(rolle, /Lege keine Issues selbst an/);
    assert.match(liesTicketAblauf(), /Epic: liefere die Aufteilung/, "der Skill gibt dem Planer den Epic-Hinweis");
  });

  test("Skill-Pfad: der Epic-Absatz delegiert die Aufteilung an den kubernia-planner", () => {
    assert.match(liesTicketAblauf(), /\*\*Sonderfall zu großes Epic[^\n]*kubernia-planner/);
  });

  test("Doku: die Matrix-Zeile der Epic-Aufteilung trägt opus", () => {
    const zeile = read(ROUTING_SSOT).split("\n").find((l) => /^\|\s*\*{0,2}Epic-Aufteilung/.test(l));
    assert.ok(zeile, "§1 braucht eine eigene Zeile „Epic-Aufteilung“");
    assert.match(zeile, /`opus`/);
  });
});

describe("Umsetzer-Bericht: LERNKANDIDATEN (#1292, #1276)", () => {
  const rolle = read(UMSETZER);
  const skill = liesTicketAblauf();

  test("das feste Berichtsformat trägt die Zeile LERNKANDIDATEN, nach BEFUNDE", () => {
    assert.match(rolle, /^LERNKANDIDATEN: <max\. 3 Punkte, nur projektübergreifendes Wissen, oder ->$/m);
    assert.ok(rolle.indexOf("\nBEFUNDE:") < rolle.indexOf("\nLERNKANDIDATEN:"), "LERNKANDIDATEN steht hinter BEFUNDE");
  });

  test("Abgrenzung zu BEFUNDE steht in der Rolle, und der Subagent legt nichts selbst ab", () => {
    assert.match(rolle, /BEFUNDE[^\n]*nur Projektspezifisches/);
    assert.match(rolle, /legst (es|sie|nichts) [^\n]*selbst[^\n]*ab|legst du nichts selbst ab/);
  });

  test("der kubernia-Skill reicht LERNKANDIDATEN im Abschlussbericht durch", () => {
    assert.match(skill, /\*\*`gemergt`\*\*[^\n]*LERNKANDIDATEN/);
  });
});

/**
 * Prosa-Wächter für die Weichen-Regel auf dem Skill-Pfad (#1311): „Weichen selbst entscheiden, Rückfrage nur
 * bei Irreversiblem oder Außenwirkung“. Der Skill-Pfad hat nur
 * Text (`.claude/skills/factory/ablauf.md` Schritt 3, Planer Abschnitt 7, Umsetzer „entscheidung-noetig“). Ein Prädikat je Stelle,
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
    assert.ok(skillRegelOk(liesTicketAblauf()), `${UMSETZUNGS_SKILL} Schritt 3`);
    assert.ok(planerRegelOk(read(".claude/agents/factory-planer.md")), "factory-planer.md Abschnitt 7");
    assert.ok(umsetzerRegelOk(read(UMSETZER)), `${UMSETZER}`);
  });

  test("Red-Green: eine aufgeweichte Fassung wird erkannt", () => {
    const skill = liesTicketAblauf();
    assert.ok(!skillRegelOk(skill.replace("`AskUserQuestion` nur, wenn", "`AskUserQuestion` immer, wenn")), "Skill: Rückfrage nicht mehr eingeschränkt");
    assert.ok(!skillRegelOk(skill.replace("als verbindlich", "als Vorschlag")), "Skill: Entscheidungen nicht mehr verbindlich");
    const planer = read(".claude/agents/factory-planer.md");
    assert.ok(!planerRegelOk(planer.replace("steht nur bei Irreversiblem oder Außenwirkung", "steht bei jeder Optik-Weiche")), "Planer");
    assert.ok(!planerRegelOk(planer.replace("**entscheiden**", "vorschlagen")), "Planer: nicht mehr entscheiden");
    const umsetzer = read(UMSETZER);
    assert.ok(!umsetzerRegelOk(umsetzer.replace("`entscheidung-noetig` melden nur bei", "`entscheidung-noetig` melden auch bei")), "Umsetzer");
    assert.ok(!umsetzerRegelOk(umsetzer.replace("entscheidest du selbst", "legst der Maintainerin vor")), "Umsetzer: Ermessen nicht mehr selbst");
    assert.ok(!skillRegelOk("") && !planerRegelOk("") && !umsetzerRegelOk(""), "leerer Text erfüllt keine Regel");
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

  /** Der kanonische Satz im Kopf von anlaufstellen.md, ohne Backticks. */
  const konvention = () => {
    const m = /\*\*Lese-Konvention:\*\* erst hier die eine passende Seite wählen\. (.+?offset`\/`limit`\)\.)/.exec(read("docs/referenz/anlaufstellen.md"));
    assert.ok(m, "kanonischer Satz in anlaufstellen.md fehlt");
    return m[1].replace(/`/g, "");
  };
  const ohneBackticks = (t: string) => t.replace(/`/g, "");

  test("Die Brain-Lese-Konvention steht wortgleich in Umsetzer und Lens (#1331)", () => {
    const satz = konvention();
    assert.match(satz, /Read-Tool.*nie per cat\/sed\/head\/Get-Content/);
    for (const datei of [UMSETZER, ".claude/agents/factory-lens.md"])
      assert.ok(ohneBackticks(read(datei)).includes(satz), `${datei} trägt den Satz aus anlaufstellen.md nicht wortgleich`);
  });

  test("Red-Green: eine um ein Wort abweichende Kopie fällt auf", () => {
    const satz = konvention();
    const gleich = (text: string) => text.includes(satz);
    for (const datei of [UMSETZER, ".claude/agents/factory-lens.md"]) {
      const text = ohneBackticks(read(datei));
      assert.ok(gleich(text), datei);
      assert.ok(!gleich(text.replace(satz, satz.replace("nie per", "nicht per"))), datei);
    }
  });

  test("Der Umsetzer verlangt gebündelte Befunde und verweist auf die Heimat in AGENTS.md (#1331)", () => {
    const t = read(UMSETZER);
    assert.match(t, /gebündelt/);
    // keine Kopie der Kriterien (#1349 Z8): die Rolle verweist auf die Heimat in AGENTS.md
    assert.match(t, /AGENTS\.md § „Harness-Befunde sind Zeilen/);
    assert.match(t, /§ Befunde sofort festhalten/);
    assert.doesNotMatch(t, /Teil-Akzeptanzkriterien|Kleinkram eine Zeile|gleiches\s+Subsystem/);
    assert.doesNotMatch(t, /roter main|Datenverlust|allein nicht in eine Session/);
  });

  test("Planer prüft den Stand des Checkouts gegen origin/main (#1331)", () => {
    const t = read(".claude/agents/factory-planer.md");
    assert.match(t, /git diff --name-only HEAD origin\/main/);
    assert.match(t, /MSYS_NO_PATHCONV=1 git show origin\/main:<pfad>/);
    assert.match(liesTicketAblauf(), /git diff --quiet <Sitzungsbasis> origin\/main -- \.claude\/agents \.claude\/skills AGENTS\.md/);
  });

  test("Brain-Lese-Konvention steht in Umsetzer und Lens", () => {
    for (const datei of [UMSETZER, ".claude/agents/factory-lens.md"]) {
      const t = read(datei);
      assert.match(t, /anlaufstellen\.md/, datei);
      assert.match(t, /`Read`/, datei);
    }
  });

  test("Messdoku nennt den Marker und ist ohne Platzhalter-Zusage für #1099", () => {
    const doku = read(ROUTING_SSOT);
    assert.match(doku, /pflege: start/);
    assert.doesNotMatch(doku, /kommen mit #1099/);
  });
});
