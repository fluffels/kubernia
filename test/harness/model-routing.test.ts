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
 *   1. **Der Hebel verschwindet.** Die Frontmatter-Zeile `model:` im kubernia-Skill
 *      ist eine Zeile – gelöscht/umformuliert fällt die Umsetzung wortlos auf das
 *      Session-Modell zurück, ohne dass irgendein Gate meckert.
 *   2. **Der Review wird still mitdemoviert.** `model:` gilt für den Hauptagenten
 *      für den Rest des Turns. Liefen die Lens-Pässe wie früher INLINE im
 *      Hauptagenten, zöge die Coding-Tier-Zeile den Review von Opus auf Sonnet –
 *      Fix der einen Konventionshälfte, Regression der anderen. Darum spawnt
 *      review-lenses seine Lenses als eigene Subagenten mit explizitem Opus-Routing.
 *   3. **Prosa-Drift.** Eine Doku, die weiter „Session-Default" als Ist-Zustand der
 *      Umsetzung behauptet, schickt den nächsten Agenten auf die alte Fährte. Genau
 *      diese Klasse sieht `check:docdrift` (#529) nicht – es prüft Kommandos/Links.
 *
 * Seit #1065 gilt zusätzlich: jede `agent()`-Aufrufstelle im Workflow setzt `effort` und
 * `model` (oder `agentType`), settings.json trägt den Projekt-Default `sonnet` (Hebel gegen den
 * Claude-Code-Bug anthropics/claude-code#98898), es gibt keine festen Modell-IDs mehr und genau
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
 *   - Beim `effort:` wird nur die **Anwesenheit** geprüft, nicht die Stufe (siehe dort).
 *   - Der Workflow-Pfad wird nur auf Anwesenheit von `model`/`effort` je Aufrufstelle geprüft,
 *     nicht welche Phase welchen Alias bekommt – die Zuordnung steht in docs/model-routing.md.
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

/** Der Skill, der die Umsetzung tippt – hier MUSS der Coding-Tier stehen (#1035). */
const UMSETZUNGS_SKILL = ".claude/skills/kubernia/SKILL.md";
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
    term: "Session-Default",
    home: `seit #1035 tippt die Umsetzung auf beiden Pfaden den Coding-Tier – im Workflow per agent({model}), im Skill per Frontmatter in ${UMSETZUNGS_SKILL}`,
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
        "Ohne die Zeile schreibt der Hauptagent den Code auf dem Session-Modell – aus einer Opus-Session " +
        `also die komplette Umsetzung auf Opus (#1035). Gefunden: model=„${fm.model ?? "(fehlt)"}".`,
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

  test(`${REVIEW_SKILL} hält die Lenses auf dem starken Tier (kein Mitziehen durch den Coding-Tier)`, () => {
    const md = read(REVIEW_SKILL);
    // Bewusst an den `Agent({…})`-Spawn-Block gebunden, nicht datei-weit: sonst hält ein
    // beliebiger Prosa-Satz („historisch stand hier model: opus") den Test grün, während
    // die Lenses längst wieder inline laufen – genau die Regression, die er fangen soll.
    assert.match(
      md,
      /Agent\(\{[^}]*model:\s*["']?opus/s,
      `${REVIEW_SKILL} muss seine Lens-Pässe in einem \`Agent({…})\`-Spawn explizit auf den starken Tier ` +
        `routen (\`model: "opus"\`). ` +
        "Das Frontmatter-`model:` des kubernia-Skills gilt für den REST DES TURNS – laufen die Lenses inline " +
        "im Hauptagenten, reviewt Sonnet statt Opus, und der finale Blick wäre zudem ein Self-Grading des " +
        "eigenen Fixes (#1012).",
    );
  });

  test("der Workflow-Pfad routet weiterhin explizit (Umsetzung Sonnet, Lenses Opus)", () => {
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
      /LENS_SCHEMA[^}]*model:\s*["']opus["']/s,
      "Im Phasen-Workflow fehlt der starke Tier am Lens-`agent()` (`model: 'opus'`) – " +
        "der Review darf nicht auf den Coding-Tier absacken (#1012/#1035).",
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

  test(".claude/settings.json setzt den Projekt-Default auf den Alias sonnet", () => {
    const settings = JSON.parse(read(".claude/settings.json")) as { model?: string };
    assert.equal(
      settings.model,
      "sonnet",
      'Ohne `"model": "sonnet"` läuft der Hauptagent auf dem Session-Modell: das Skill-Frontmatter wird beim ' +
        "Skill-Tool-Aufruf ignoriert (anthropics/claude-code#98898).",
    );
  });

  test("Planer opus/xhigh, Loop-Spawn mit model und effort, Lenses opus/high", () => {
    const planer = frontmatter(read(".claude/agents/kubernia-planner.md"));
    assert.equal(planer.model, "opus");
    assert.equal(planer.effort, "xhigh");
    assert.match(read(".claude/skills/kubernia-loop/SKILL.md"), /model:\s*"sonnet"[^\n]*effort:\s*"/, "Loop-Spawn ohne effort (#1047)");
    assert.match(read(REVIEW_SKILL), /Agent\(\{[^}]*model:\s*"opus"[^}]*effort:\s*"high"/s, "Lenses müssen opus/high sein");
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
    assert.deepEqual(retiredRoutingClaims("Der Begriff `Session-Default` ist abgelegt."), [], "Backticks = Zitat");
    assert.deepEqual(retiredRoutingClaims("```\nSession-Default\n```\n"), [], "im Codeblock zählt nicht");
    assert.deepEqual(
      retiredRoutingClaims("Ein Subagent ohne Modell-Angabe erbt das Session-Modell."),
      [],
      "die weiterhin gültige Warnung darf NICHT rot werden",
    );
  });
});
