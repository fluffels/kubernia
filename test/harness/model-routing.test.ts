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
 *   - Der Text-Scan erkennt keine Spread-Konstanten (`{ ...OPTS, label: … }`): `effort`/`model`
 *     aus einer ausgelagerten Konstante sähe er nicht.
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
 * `scripts/check-` ist gate-config-geschützt (Goodhart-Guard #903, Label-Pflicht), und
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
import { runInNewContext } from "node:vm";

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
  if (/\bmodel:\s*['"]/.test(optionen)) out.push(`${kopf}: \`model:\` neben agentType überstimmt das Frontmatter`);
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
const RETIRED_ROUTING_CLAIMS: { term: string; home: string }[] = [
  {
    term: "Opus-Standard-Effort",
    home: "die Lenses tragen `effort: high` im Frontmatter von kubernia-lens und laufen auf beiden Pfaden damit (#1209)",
  },
  {
    term: "Session-Default",
    home: `die Umsetzung tippt auf beiden Pfaden den Coding-Tier – im Workflow per agent({model}), im Skill-Pfad im Subagenten ${UMSETZER} (Frontmatter, #1280)`,
  },
];

/** Zeilen in `md`, die noch den abgelegten Routing-Ist-Zustand behaupten. */
function retiredRoutingClaims(md: string): { line: number; term: string; home: string; text: string }[] {
  const found: { line: number; term: string; home: string; text: string }[] = [];
  stripFencedCode(md)
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.replace(/`[^`\n]*`/g, "");
      for (const { term, home } of RETIRED_ROUTING_CLAIMS) {
        if (line.includes(term)) found.push({ line: i + 1, term, home, text: raw.trim().slice(0, 120) });
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
      /\bmodel:\s*["']/,
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
    const wf = read(".claude/workflows/kubernia-ticket.js");
    // An den echten `agent(…)`-SPAWN gebunden (über sein Schema), nicht datei-weit: die
    // `meta.phases`-Einträge oben tragen dieselben Tier-Namen als reine Anzeige-Labels
    // fürs /workflows-Panel. Ein datei-weiter Match bliebe grün, wenn der Spawn sein
    // `model` verliert und nur die Kosmetik stehen bleibt — ein Gate, das nichts gemessen
    // hat, darf nicht grün melden.
    assert.match(
      wf,
      /UMSETZUNG_SCHEMA[^}]*model:\s*["']sonnet["']/s,
      "Im Phasen-Workflow fehlt der Coding-Tier am Umsetzungs-`agent()` (`model: 'sonnet'`) – " +
        "ohne ihn erbt der Umsetzungs-Subagent das Session-Modell (#910/#1035). " +
        "Achtung: die `meta.phases`-Zeilen oben sind nur Anzeige-Labels und zählen nicht.",
    );
    assert.match(
      wf,
      /LENS_SCHEMA[^}]*agentType:\s*["']kubernia-lens["']/s,
      "Im Phasen-Workflow fehlt `agentType: 'kubernia-lens'` am Lens-`agent()` – " +
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
    const { optionen, aufrufe } = workflowAgentCalls(read(".claude/workflows/kubernia-ticket.js"));
    assert.ok(optionen.length >= 10, `Der Scan fand nur ${optionen.length} Optionsobjekte – er misst nichts mehr.`);
    assert.equal(optionen.length, aufrufe, "Es gibt agent()-Aufrufe ohne Optionsobjekt – sie erben Session-Modell und -Effort.");
    const ungeroutet = optionen.filter((o) => !istGeroutet(o)).map((o) => o.slice(0, 80));
    assert.deepEqual(
      ungeroutet,
      [],
      "Diese agent()-Aufrufe erben still Session-Modell oder -Effort. Jede Stelle braucht `effort` und `model` " +
        `(bzw. \`agentType\`), Matrix in ${ROUTING_SSOT}:\n${ungeroutet.join("\n")}`,
    );
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

  test(".claude/settings.json pinnt kein Modell für den Hauptchat (#1280)", () => {
    const settings = JSON.parse(read(".claude/settings.json")) as { model?: string };
    assert.equal(
      settings.model,
      undefined,
      "Das Routing steht in den Agent-Frontmattern (Umsetzer, Planer, Lenses). Ein Projekt-Default überstimmte " +
        "nur die Modellwahl der Maintainerin für Gespräche und Pre-Flight im Hauptchat und lässt sich per /model ohnehin umgehen.",
    );
  });

  test("Planer opus/xhigh", () => {
    const planer = frontmatter(read(".claude/agents/kubernia-planner.md"));
    assert.equal(planer.model, "opus");
    assert.equal(planer.effort, "xhigh");
  });

  test("genau eine Plan-Aufrufstelle im Workflow", () => {
    const { optionen } = workflowAgentCalls(read(".claude/workflows/kubernia-ticket.js"));
    const planCalls = optionen.filter((o) => /agentType:\s*['"]kubernia-planner['"]/.test(o));
    assert.equal(planCalls.length, 1, "Genau eine Plan-Aufrufstelle im Workflow erwartet.");
  });

  test("jede agentType-Aufrufstelle im Workflow gleicht ihrem Agent-Frontmatter (Drift-Schutz)", () => {
    const { optionen } = workflowAgentCalls(read(".claude/workflows/kubernia-ticket.js"));
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
    assert.deepEqual(retiredRoutingClaims("```\nSession-Default\n```\n"), [], "im Codeblock zählt nicht");
    assert.deepEqual(
      retiredRoutingClaims("Ein Subagent ohne Modell-Angabe erbt das Session-Modell."),
      [],
      "die weiterhin gültige Warnung darf NICHT rot werden",
    );
  });
});

/** Ein aufgezeichneter `agent()`-Aufruf des Workflow-Skripts. */
type AgentAufruf = { label: string; agentType?: string; model?: string; effort?: string; prompt: string };

/**
 * Führt das echte Workflow-Skript per `node:vm` gegen Stub-Globals aus (Präzedenz:
 * test/harness/workflow-args.test.ts) und zeichnet die `agent()`-Aufrufe auf. Das prüft das
 * VERHALTEN der Sonderfall-Zweige statt ihrer Textreihenfolge. Unbekannte Labels brechen laut ab,
 * damit ein neuer früher Aufruf den Stub bewusst erweitern muss.
 */
async function workflowLauf(art: "epic" | "dependabot" | "normal", opts: { planerDa: boolean }) {
  const quelle = read(".claude/workflows/kubernia-ticket.js").replace("export const meta", "const meta");
  const aufrufe: AgentAufruf[] = [];
  const agent = (prompt: string, o: { label: string; agentType?: string; model?: string; effort?: string }) => {
    aufrufe.push({ prompt, label: o.label, agentType: o.agentType, model: o.model, effort: o.effort });
    if (o.label === "auswahl+claim") {
      return Promise.resolve({ ergebnis: "ticket-geclaimt", claimVerifiziert: true, nummer: 42, titel: "Testticket", body: "Body", art });
    }
    if (o.agentType === "kubernia-planner") return Promise.resolve(opts.planerDa ? "PLAN-TEXT" : null);
    if (o.label.startsWith("preflight")) return Promise.resolve({ brauchtKlaerung: true, grund: "Test", offeneFragen: ["?"] });
    if (o.label.startsWith("epic-anlegen") || o.label.startsWith("dependabot")) return Promise.resolve("erledigt");
    return Promise.reject(new Error(`Stub kennt das Label "${o.label}" nicht – in workflowLauf() erweitern.`));
  };
  const kontext = { agent, phase: () => undefined, log: () => undefined, args: undefined, parallel: () => { throw new Error("unerwartet"); } };
  const ergebnis = (await runInNewContext(`(async () => {\n${quelle}\nreturn endstand\n})()`, kontext)) as { ergebnis: string };
  return { aufrufe, ergebnis: ergebnis.ergebnis };
}

describe("Epic-Aufteilung auf dem Planungs-Tier (#1207)", () => {
  test("Epic: Planer (opus-Rolle, Frontmatter-Effort) schlägt vor, ein sonnet-Agent legt an", async () => {
    const planer = frontmatter(read(".claude/agents/kubernia-planner.md"));
    const { aufrufe, ergebnis } = await workflowLauf("epic", { planerDa: true });
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
    const { aufrufe, ergebnis } = await workflowLauf("epic", { planerDa: false });
    assert.deepEqual(aufrufe.map((a) => a.label), ["auswahl+claim", "plan:#42", "epic-anlegen:#42"]);
    assert.doesNotMatch(aufrufe[2].prompt, /PLAN-TEXT/);
    assert.match(aufrufe[2].prompt, /selbst auf/, "Der Fallback-Auftrag muss im Prompt stehen");
    assert.equal(ergebnis, "epic");
  });

  test("Dependabot: darf KEINEN Planer-Lauf verbrennen", async () => {
    const { aufrufe, ergebnis } = await workflowLauf("dependabot", { planerDa: true });
    assert.deepEqual(aufrufe.map((a) => a.label), ["auswahl+claim", "dependabot:#42"]);
    assert.equal(aufrufe[1].model, "sonnet");
    assert.equal(aufrufe[1].effort, "medium");
    assert.equal(ergebnis, "dependabot");
  });

  test("normales Ticket: Plan vor Pre-Flight, Planer-Prompt ohne Epic-Hinweis (Resume-Cache bleibt gültig)", async () => {
    const { aufrufe, ergebnis } = await workflowLauf("normal", { planerDa: true });
    assert.deepEqual(aufrufe.map((a) => a.label), ["auswahl+claim", "plan:#42", "preflight:#42"]);
    assert.doesNotMatch(aufrufe[1].prompt, /Epic/);
    assert.match(
      aufrufe[1].prompt,
      /^Ticket #42: Testticket\n[\s\S]*\n\nArbeitsort: [^\n]*\. Liefere den Plan wie in deiner Rolle beschrieben\.$/,
      "Der Planer-Prompt normaler Tickets darf sich nicht ändern (Resume-Cache)",
    );
    assert.equal(ergebnis, "wartet-auf-klaerung");
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
