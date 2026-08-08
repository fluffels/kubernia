/* Modell-Routing-Wächter (#1035) – „Planung stark, Umsetzung schnell" darf nicht
 * ins Leere greifen, und keine Doku darf das Gegenteil behaupten.
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
 * Dazu hält Test 2 das SSOT-Versprechen von docs/model-routing.md ehrlich („diese
 * ZWEI Dateien anpassen"): jeder harte Modell-Pin unter `.claude/` muss dort gelistet
 * sein und umgekehrt – sonst verrottet die Update-Checkliste beim nächsten Modell.
 *
 * Grenzen dieses Wächters (bewusst, ehrlich – ein Wächter, dessen Kopf mehr verspricht
 * als er misst, erzeugt genau das falsche Sicherheitsgefühl):
 *   - Er belegt, dass die Zeile DA ist und die Doku nicht dagegen driftet – NICHT, dass
 *     Claude Code das Frontmatter zur Laufzeit wirklich anwendet. Das ist Tool-Verhalten
 *     und für einen Vitest-Lauf unbeobachtbar (wie die „Grenze"-Notiz in claude-bridge).
 *   - Die Drift-Erkennung ist **literal und case-sensitiv**: „Session Default" ohne
 *     Bindestrich rutscht durch (bekannte Grenze des Begriffs-Ansatzes, identisch in
 *     test/claude-bridge.test.ts).
 *   - Beim `effort:` wird nur die **Anwesenheit** geprüft, nicht die Stufe (siehe dort).
 *   - Der Workflow-Pfad wird nur grob geprüft (Tier-Aliase vorhanden), nicht welche
 *     Phase welchen Alias bekommt – die Phasen-Zuordnung bleibt Review-Sache.
 *
 * Fitness-Function-Kategorie neben layering/filesize/docmap/claude-bridge, nicht mit
 * Verhaltens-Tests vermischen. Bewusst **ohne** eigenes `scripts/check-*.mjs`:
 * `scripts/check-` ist gate-config-geschützt (Goodhart-Guard #903, Label-Pflicht), und
 * für rein doku-strukturelle Wächter gibt es die etablierte test-only-Familie.
 *
 * ⚠️ Bekannte Duplikation: die Retired-Claims-Mechanik unten ist strukturgleich zu
 * test/claude-bridge.test.ts (#992). Bei zwei Kopien noch Rule-of-Three-konform, aber
 * beticketet als **#1046** (nach test/support/ ziehen) – jscpd ist bewusst
 * nicht-blockierend, es fängt das also kein Gate automatisch.
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs aus, scripts/ nicht im tsconfig)
// – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkDocDrift from "../scripts/check-docdrift.mjs";

// Begründete Ausnahme, identisch zu test/claude-bridge.test.ts: das .mjs hat kein
// Declaration-File, der Namespace ist für tsc „error typed". Eng begrenzter
// Inline-Disable statt einer Gate-Config-Änderung.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const stripFencedCode: (md: string) => string = checkDocDrift.stripFencedCode;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const collectMarkdown: (rootDir?: string) => string[] = checkDocDrift.collectMarkdown;

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

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

/**
 * Alle Markdown-Dateien unter `.claude/` (Skills + Agent-Definitionen), rekursiv.
 * `collectMarkdown` sammelt die Repo-Doku, nicht die Harness-Definitionen – darum hier
 * ein eigener, winziger Walk.
 */
function claudeMarkdown(): string[] {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) out.push(...walk(p));
      else if (e.name.endsWith(".md")) out.push(p);
    }
    return out;
  };
  // Bewusst genau die VERSIONIERTEN Ordner statt „alles außer worktrees": .gitignore trackt
  // unter .claude/ nur skills/, agents/ und workflows/ (+ settings.json). Ein Walk über den
  // ganzen Baum scannte auch lokal abgelegte, untrackte Dateien mit – und verlangte für sie
  // einen Checklisten-Eintrag, den niemand committen kann (lokal rot, CI grün).
  // `workflows` ist mit drin, obwohl dort heute nur .js liegt: `collectMarkdown` klammert
  // `.claude` komplett aus, ein künftiges .claude/workflows/*.md entginge sonst BEIDEN
  // Prüfungen – Pin-Checkliste und Drift-Scan.
  return [`${REPO_ROOT}.claude/skills`, `${REPO_ROOT}.claude/agents`, `${REPO_ROOT}.claude/workflows`].flatMap(walk);
}

/**
 * Nur der Abschnitt „Gepinnte Dateien" (die Update-Checkliste) von docs/model-routing.md.
 * Bewusst NICHT die ganze Datei: sie **verlinkt** alias-geroutete Skills auch anderswo
 * (§4 Konvention), und eine Erwähnung dort ist ein Verweis, kein Checklisten-Eintrag —
 * gegen die ganze Datei zu prüfen würde jeden solchen Link als „gepinnt" missverstehen.
 */
function pinChecklistSection(ssot: string): string {
  const lines = ssot.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s.*[Gg]epinnte Dateien/.test(l));
  assert.ok(start >= 0, `In ${ROUTING_SSOT} fehlt der Abschnitt „Gepinnte Dateien" – die Update-Checkliste (#910).`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/**
 * Nur die TABELLENZEILEN der Checkliste (`| … |`). Die Gegenrichtung („was hier steht,
 * muss auch gepinnt sein") darf ausschließlich echte Einträge sehen: im selben Abschnitt
 * steht der Absatz „Nicht nachzuziehen — bewusst per Alias statt Pin", dessen ganzer Zweck
 * es ist, alias-geroutete Dateien zu NENNEN. Verlinkt jemand sie dort regulär mit Pfad
 * (wie §4 es tut), meldete ein abschnittsweiter Scan sie als „stale" – ein Wächter, der
 * bei korrekter Verlinkung rot wird, ist der klassische Abschalt-Kandidat.
 */
const checklistTableRows = (section: string) =>
  section
    .split(/\r?\n/)
    .filter((l) => /^\s*\|/.test(l))
    .join("\n");

/**
 * Trägt die Datei einen HARTEN Modell-Pin (`claude-…`) statt eines Tier-Alias?
 *
 * Bewusst **Frontmatter UND Body**: docs/model-routing.md schreibt für Explore-Subagenten
 * ausdrücklich einen Pin im Skill-*Text* vor (`Agent({model: "claude-haiku-…"})`). Nur das
 * Frontmatter zu prüfen ließe die Checkliste genau bei dem Pin-Typ verrotten, den die SSOT
 * selbst verlangt – wer eine harte ID hinschreibt, muss sie beim nächsten Modell-Release
 * anfassen, egal an welcher Stelle der Datei sie steht.
 *
 * **Escape-Hatch, symmetrisch zu retiredRoutingClaims:** Codeblöcke und Inline-Backticks
 * zählen NICHT. Eine Datei, die eine Modell-ID nur zitiert (Negativbeispiel, historische
 * Notiz, die Anleitung „schreib `model: claude-haiku-…` in den Explore-Spawn"), pinnt
 * nichts – sie deshalb in die Checkliste zu zwingen wäre ein Falsch-Rot, und der von der
 * Fehlermeldung nahegelegte „Fix" wäre sachlich falsch. **Achtung Frontmatter:** das
 * `---`-Preamble ist kein Codeblock und bleibt darum voll geprüft.
 */
function hatHartenPin(md: string): boolean {
  const ohneZitate = stripFencedCode(md).replace(/`[^`\n]*`/g, "");
  return /model:\s*["']?claude-[a-z0-9.-]+/i.test(ohneZitate);
}

/**
 * Die abgelegte Behauptung. Nach #1035 gibt es keinen wahren Satz mehr, in dem die
 * Umsetzung „auf dem Session-Default" läuft – der Coding-Tier ist auf BEIDEN Pfaden
 * gesetzt (Workflow per `agent({model})`, Skill per Frontmatter).
 *
 * **Escape-Hatch** (gleiche Logik wie test/claude-bridge.test.ts): Wer den Begriff
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

describe("Die Pin-Checkliste in docs/model-routing.md bleibt vollständig (#910/#1035)", () => {
  test("jede .claude-Datei mit hartem Modell-Pin steht in der Checkliste – und umgekehrt", () => {
    // BEIDE Richtungen sehen dieselbe Quelle (nur die Tabellenzeilen). Prüfte die
    // Hinrichtung gegen den ganzen Abschnitt, würde eine Datei, die im Fließtext des
    // „Nicht nachzuziehen"-Absatzes verlinkt ist, als „gelistet" gelten — ein später dort
    // hinzugefügter harter Pin rutschte still durch.
    const checkliste = checklistTableRows(pinChecklistSection(read(ROUTING_SSOT)));
    const gepinnt = claudeMarkdown()
      .filter((abs) => hatHartenPin(readFileSync(abs, "utf8")))
      .map((abs) => abs.slice(REPO_ROOT.length).replace(/\\/g, "/"));

    const fehlend = gepinnt.filter((rel) => !checkliste.includes(rel));
    assert.deepEqual(
      fehlend,
      [],
      `Diese Dateien pinnen eine harte Modell-ID, stehen aber nicht in ${ROUTING_SSOT}. Damit verrottet die ` +
        `Update-Checkliste beim nächsten Modell-Release – entweder eintragen oder auf einen Tier-Alias ` +
        `umstellen (Alias schlägt Pin, wo „das jeweils aktuelle Modell dieses Tiers" richtig ist):\n${fehlend.join("\n")}`,
    );

    // Gegenrichtung: die Checkliste darf keine Datei führen, die gar keinen Pin (mehr) trägt.
    const gelistet = [...checkliste.matchAll(/`(\.claude\/[^`]+\.md)`/g)].map((m) => m[1]);
    const stale = gelistet.filter((rel) => !gepinnt.includes(rel));
    assert.deepEqual(
      stale,
      [],
      `${ROUTING_SSOT} listet diese Dateien als gepinnt, sie tragen aber keinen harten \`model: claude-…\`-Pin ` +
        `(mehr). Stale Einträge machen die Checkliste unglaubwürdig – Zeile entfernen:\n${stale.join("\n")}`,
    );
  });

  test("Erkennung greift wirklich (Red-Green): Pin vs. Alias vs. kein Modell", () => {
    assert.ok(hatHartenPin("---\nmodel: claude-opus-5\n---\n"), "harte ID ist ein Pin");
    assert.ok(!hatHartenPin("---\nmodel: sonnet\n---\n"), "Tier-Alias ist KEIN Pin");
    assert.ok(!hatHartenPin("---\nname: x\n---\n"), "ohne model kein Pin");
    assert.ok(hatHartenPin('Spawn: Agent({model: "claude-haiku-4-5-20251001"})'), "Body-Pin zählt");
    assert.ok(!hatHartenPin("Schreibe `model: claude-haiku-4-5` in den Spawn."), "Backtick-Zitat pinnt nichts");
    assert.ok(!hatHartenPin("```\nmodel: claude-opus-5\n```\n"), "Codeblock-Beispiel pinnt nichts");
    assert.ok(claudeMarkdown().length > 0, "der .claude-Walk darf nicht leer laufen (sonst prüft der Test nichts)");
    // Der Abschnitts-Schnitt muss wirklich schneiden – sonst prüfte die Gegenrichtung die ganze Datei.
    const section = pinChecklistSection("## 3. Gepinnte Dateien\ndrin\n## 4. Weiter\ndraußen\n");
    assert.ok(section.includes("drin") && !section.includes("draußen"), "die Checkliste endet an der nächsten ##-Überschrift");
  });
});

describe("Keine Doku behauptet mehr den alten Routing-Ist-Zustand (#1035)", () => {
  test("kein Markdown im Repo schreibt die Umsetzung auf den Session-Default", () => {
    const violations: string[] = [];
    const rel = (abs: string) => abs.replace(/\\/g, "/").replace(REPO_ROOT.replace(/\\/g, "/"), "");
    // `collectMarkdown` liefert repo-RELATIVE Pfade, `claudeMarkdown` absolute. Ohne das
    // Auflösen gegen REPO_ROOT hinge der Lauf am cwd: startet Vitest nicht im Repo-Root,
    // gäbe es ein nacktes ENOENT statt einer verständlichen Gate-Meldung.
    const absolut = (f: string) => (/^([A-Za-z]:|\/)/.test(f) ? f : `${REPO_ROOT}${f}`);
    for (const file of [...collectMarkdown(REPO_ROOT), ...claudeMarkdown()]) {
      for (const v of retiredRoutingClaims(readFileSync(absolut(file), "utf8"))) {
        violations.push(`${rel(file)}:${v.line} behauptet „${v.term}" – ${v.home}. Zeile: „${v.text}"`);
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
