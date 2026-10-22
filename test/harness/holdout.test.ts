/* Holdout-Wächter (#1754, ADR 0022 F13) – die Szenarien der Holdout-Abnahme bleiben im Hauptchat.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Drei statische Regeln (die Laufzeit-Guards stehen in holdout-guard.test.ts; bekannte Grenze dieses Tests: ein Hauptchat, der die Vorlage ignoriert, wird hier nicht gesehen):
 *   1. Kein Übergabeprompt an Planer, Umsetzer, Nachfolger, Gruppen-Umsetzer oder Lens trägt einen Szenario-Platzhalter oder einen
 *      `SZENARIEN`-Kopf; nur die Vorlage der Abnahme darf ihn tragen. Und keine getrackte Datei trägt einen echten Kopf
 *      `SZENARIEN #<ziffern>`: die Szenarien liegen in keiner Datei.
 *   2. Die Tool-Mengen der beiden Agenten sind exakt festgelegt (Szenario-Agent ohne Schreib- und Shell-Tool, Abnahme-Agent ohne Edit und Agent).
 *   3. Im Skill steht der Szenario-Schritt vor dem Planer-Spawn.
 * Dazu die Verdrahtung: beide Agenten tragen ihren Frontmatter-Hook (Matcher und Skript, siehe unten).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { liesMitProjektwerten, liesTicketAblauf } from "../support/ticket-ablauf";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { parseFrontmatter } from "../../scripts/docs-gen/markdown.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const lies = (rel: string): string => readFileSync(ROOT + rel, "utf8");
const NL = String.fromCharCode(10);

/** Alle `Agent({ … })`-Aufrufe eines Textes (Codeblock oder Prosa): von `Agent({` bis zum ersten `})`. */
export function agentBloecke(text: string): string[] {
  return text.match(/Agent\(\{[\s\S]*?\}\)/g) ?? [];
}

/** Szenario-Bezug in einem Text: ein `<…>`-Platzhalter mit „szenari“ oder das Wort `SZENARIEN` (Kopf). */
export function szenarioBezug(text: string): boolean {
  return /<[^>\n]*szenari[^>\n]*>/i.test(text) || /\bSZENARIEN\b/.test(text);
}

const spawnTyp = (block: string): string | null => /subagent_type:\s*"([^"]+)"/.exec(block)?.[1] ?? null;

/** Tool-Liste einer Agenten-Definition (Frontmatter `tools:`), getrimmt, in Reihenfolge. */
export function agentTools(md: string): string[] {
  const kopf = (parseFrontmatter as (t: string) => Record<string, string>)(md);
  return (kopf.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
}

/** Abweichungen der Tool-Menge von der erwarteten (als Menge), je Zeile ein Befund; leer = in Ordnung. */
export function toolAbweichungen(ist: string[], erwartet: string[]): string[] {
  return [...ist.filter((t) => !erwartet.includes(t)).map((t) => `zusätzliches Tool ${t}`), ...erwartet.filter((t) => !ist.includes(t)).map((t) => `fehlendes Tool ${t}`)];
}

/** Getrackte Dateien mit einem echten Kopf `SZENARIEN #<ziffern>` (`git grep`; Exit 1 = keine Treffer). */
export function szenarienKoepfe(cwd: string): string[] {
  try {
    return execFileSync("git", ["grep", "-n", "-E", "SZENARIEN #" + "[0-9]+"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split(NL).filter(Boolean);
  } catch (e) {
    if ((e as { status?: number }).status === 1) return [];
    throw e;
  }
}

const SZENARIO_TOOLS = ["Read", "Grep", "Glob"];
const ABNAHME_TOOLS = [
  "Read", "Grep", "Glob", "Bash", "PowerShell", "Write",
  ...["navigate", "evaluate", "take_screenshot", "snapshot", "press_key", "click", "type", "wait_for", "console_messages", "resize", "tabs", "close", "handle_dialog"].map((t) => `mcp__playwright__browser_${t}`),
  // nur lesend: belegt das Kriterium „von Langfuse erfasst“
  ...["listObservations", "getObservation", "queryMetrics", "getMetricsSchema"].map((t) => `mcp__langfuse__${t}`),
];

const SKILL = liesTicketAblauf();
const LENSES = liesMitProjektwerten(".agents/skills/review-lenses/SKILL.md");
const UMSETZER = liesMitProjektwerten(".claude/agents/factory-umsetzer.md");
const GANZE_DATEIEN: [string, string][] = [
  [".claude/agents/factory-planer.md", liesMitProjektwerten(".claude/agents/factory-planer.md")],
  [".claude/agents/factory-umsetzer.md", UMSETZER],
  [".claude/agents/factory-gruppe.md", lies(".claude/agents/factory-gruppe.md")],
  [".claude/agents/factory-lens.md", liesMitProjektwerten(".claude/agents/factory-lens.md")],
  [".agents/skills/review-lenses/SKILL.md", LENSES],
];

/** Befunde zu Regel 1 für Skill, Lenses-Skill und Umsetzer-Definition; leer = in Ordnung. */
export function uebergabeProbleme(skill: string, lenses: string, umsetzer: string): string[] {
  const probleme: string[] = [];
  const bloecke = [...agentBloecke(skill), ...agentBloecke(lenses), ...agentBloecke(umsetzer)];
  const abnahme = bloecke.filter((b) => spawnTyp(b) === "holdout-abnahme");
  if (abnahme.length !== 1) probleme.push(`erwartet genau eine Abnahme-Vorlage, gefunden ${abnahme.length}`);
  else if (!szenarioBezug(abnahme[0])) probleme.push("die Abnahme-Vorlage trägt keinen Szenario-Platzhalter (der Test wäre vakuös)");
  for (const b of bloecke) if (spawnTyp(b) !== "holdout-abnahme" && szenarioBezug(b)) probleme.push(`Vorlage ${spawnTyp(b) ?? "ohne Typ"} trägt Szenario-Bezug`);
  const nachfolger = skill.split(NL).find((z) => z.startsWith("- **`uebergabe`**")) ?? "";
  if (!nachfolger) probleme.push("Bullet uebergabe (Nachfolger-Vorlage) fehlt im Skill");
  else if (szenarioBezug(nachfolger)) probleme.push("Nachfolger-Vorlage (Bullet uebergabe) trägt Szenario-Bezug");
  const gruppen = umsetzer.split(NL).find((z) => z.startsWith("**Gruppen (#1647")) ?? "";
  if (!gruppen) probleme.push("Absatz Gruppen fehlt in der Umsetzer-Definition");
  else if (szenarioBezug(gruppen)) probleme.push("Gruppen-Vorlage trägt Szenario-Bezug");
  return probleme;
}

describe("Holdout-Trennung der Übergabeprompts (#1754 K1)", () => {
  test("echte Dateien: nur die Abnahme-Vorlage trägt Szenario-Bezug", () => {
    assert.deepEqual(uebergabeProbleme(SKILL, LENSES, UMSETZER), []);
  });

  test("Dateien von Planer, Umsetzer, Gruppe, Lens und review-lenses tragen nirgends Szenario-Bezug", () => {
    for (const [name, text] of GANZE_DATEIEN) assert.equal(szenarioBezug(text), false, name);
  });

  test("Negativ: ein Szenario-Platzhalter oder ein SZENARIEN-Kopf in der Planer-, Umsetzer- oder Lens-Vorlage ist rot", () => {
    const planer = 'subagent_type: "kubernia-planner"';
    assert.ok(SKILL.includes(planer));
    const mitPlatzhalter = SKILL.replace(planer, planer + NL + '     prompt: "Body\\n<Szenarien>"');
    assert.match(uebergabeProbleme(mitPlatzhalter, LENSES, UMSETZER).join(NL), /Vorlage kubernia-planner trägt Szenario-Bezug/);
    const mitKopf = SKILL.replace('subagent_type: "kubernia-umsetzer"', 'subagent_type: "kubernia-umsetzer"' + NL + '  prompt: "SZENARIEN #" + "12"');
    assert.match(uebergabeProbleme(mitKopf, LENSES, UMSETZER).join(NL), /Vorlage kubernia-umsetzer trägt Szenario-Bezug/);
    const lens = LENSES.replace('subagent_type: "kubernia-lens"', 'subagent_type: "kubernia-lens"' + NL + "  prompt: \"<Szenario-Auszug>\"");
    assert.match(uebergabeProbleme(SKILL, lens, UMSETZER).join(NL), /Vorlage kubernia-lens trägt Szenario-Bezug/);
  });

  test("Negativ: Nachfolger-Bullet und Gruppen-Absatz mit Szenario-Bezug sind rot", () => {
    const bullet = "- **`uebergabe`** (Phasen-Schnitt";
    assert.ok(SKILL.includes(bullet));
    assert.match(uebergabeProbleme(SKILL.replace(bullet, bullet + " <Szenarien>"), LENSES, UMSETZER).join(NL), /Nachfolger-Vorlage/);
    const gruppen = "**Gruppen (#1647, ADR 0026):**";
    assert.ok(UMSETZER.includes(gruppen));
    assert.match(uebergabeProbleme(SKILL, LENSES, UMSETZER.replace(gruppen, gruppen + " SZENARIEN")).join(NL), /Gruppen-Vorlage/);
  });

  test("Negativ: fehlt die Abnahme-Vorlage oder trägt sie keinen Platzhalter, ist der Test nicht vakuös grün", () => {
    assert.match(uebergabeProbleme(SKILL.replace('subagent_type: "holdout-abnahme"', 'subagent_type: "x"'), LENSES, UMSETZER).join(NL), /genau eine Abnahme-Vorlage/);
    assert.match(uebergabeProbleme(SKILL.replace("<Szenarien aus Schritt 2>", "nichts"), LENSES, UMSETZER).join(NL), /vakuös/);
  });

  test("Negativ: zwei Abnahme-Vorlagen, fehlender Nachfolger-Bullet und fehlender Gruppen-Absatz sind rot (kein stilles Nichtprüfen)", () => {
    const bloecke = agentBloecke(SKILL).filter((b) => spawnTyp(b) === "holdout-abnahme");
    assert.equal(bloecke.length, 1);
    assert.match(uebergabeProbleme(SKILL + NL + bloecke[0], LENSES, UMSETZER).join(NL), /genau eine Abnahme-Vorlage, gefunden 2/);
    assert.match(uebergabeProbleme(SKILL.replace("- **`uebergabe`** (Phasen-Schnitt", "- **`xuebergabe`** (Phasen-Schnitt"), LENSES, UMSETZER).join(NL), /Bullet uebergabe .* fehlt/);
    assert.match(uebergabeProbleme(SKILL, LENSES, UMSETZER.replace("**Gruppen (#1647", "**Gruppe (#1647")).join(NL), /Absatz Gruppen fehlt/);
  });

  test("szenarioBezug: Platzhalter und Kopf zählen, gewöhnliche Wörter und Fremdplatzhalter nicht", () => {
    assert.equal(szenarioBezug("<Szenarien>"), true);
    assert.equal(szenarioBezug("<die Szenario-Liste>"), true);
    assert.equal(szenarioBezug("SZENARIEN #<nr> · holdout-szenario"), true);
    assert.equal(szenarioBezug("ohne Szenarien, <nr> und <Plan>"), false);
  });

  test("keine getrackte Datei trägt einen echten Kopf SZENARIEN #<ziffern>", () => {
    assert.deepEqual(szenarienKoepfe(ROOT), []);
  });

  test("Negativ: szenarienKoepfe wirft bei einem git-Fehler (kein Repo) statt still grün zu sein", () => {
    const dir = mkdtempSync(join(tmpdir(), "kq-holdout-kein-repo-"));
    try {
      assert.throws(() => szenarienKoepfe(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Negativ: szenarienKoepfe findet einen echten Kopf in einer getrackten Datei, einen Platzhalter nicht", () => {
    const dir = mkdtempSync(join(tmpdir(), "kq-holdout-"));
    try {
      const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, stdio: "ignore" });
      git("init", "-q");
      writeFileSync(join(dir, "platzhalter.md"), "SZENARIEN #" + "<nr> · holdout-szenario" + NL);
      git("add", ".");
      git("commit", "-q", "-m", "x");
      assert.deepEqual(szenarienKoepfe(dir), []);
      writeFileSync(join(dir, "echt.md"), "SZENARIEN #" + "1754 · holdout-szenario" + NL);
      git("add", ".");
      assert.match(szenarienKoepfe(dir).join(NL), /^echt\.md:1:SZENARIEN #\d{4}/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Tool-Mengen der Holdout-Agenten (#1754 K2)", () => {
  const szenario = lies(".claude/agents/holdout-szenario.md");
  const abnahme = lies(".claude/agents/holdout-abnahme.md");

  test("Szenario-Agent: genau Read, Grep, Glob (kein Schreib- und kein Shell-Tool)", () => {
    assert.deepEqual(toolAbweichungen(agentTools(szenario), SZENARIO_TOOLS), []);
    for (const verboten of ["Write", "Edit", "Bash", "PowerShell", "NotebookEdit", "Agent"]) assert.ok(!agentTools(szenario).includes(verboten), verboten);
  });

  test("Abnahme-Agent: genau die Liste, ohne Edit, NotebookEdit und Agent, keine Wildcards", () => {
    assert.deepEqual(toolAbweichungen(agentTools(abnahme), ABNAHME_TOOLS), []);
    for (const verboten of ["Edit", "NotebookEdit", "Agent"]) assert.ok(!agentTools(abnahme).includes(verboten), verboten);
    assert.ok(agentTools(abnahme).every((t) => !t.includes("*")));
  });

  test("Negativ: ein zusätzliches oder fehlendes Tool im Frontmatter ist rot", () => {
    assert.deepEqual(toolAbweichungen(agentTools(szenario.replace("tools: Read, Grep, Glob", "tools: Read, Grep, Glob, Bash")), SZENARIO_TOOLS), ["zusätzliches Tool Bash"]);
    assert.deepEqual(toolAbweichungen(agentTools(szenario.replace("tools: Read, Grep, Glob", "tools: Read, Grep")), SZENARIO_TOOLS), ["fehlendes Tool Glob"]);
    assert.deepEqual(toolAbweichungen(agentTools(abnahme.replace("PowerShell, Write,", "PowerShell, Write, Edit,")), ABNAHME_TOOLS), ["zusätzliches Tool Edit"]);
    assert.deepEqual(toolAbweichungen(agentTools(abnahme.replace("Write, mcp__playwright__browser_navigate,", "mcp__playwright__browser_navigate,")), ABNAHME_TOOLS), ["fehlendes Tool Write"]);
    assert.deepEqual(toolAbweichungen(agentTools(abnahme.replace(", mcp__langfuse__queryMetrics", "")), ABNAHME_TOOLS), ["fehlendes Tool mcp__langfuse__queryMetrics"]);
    assert.deepEqual(toolAbweichungen(agentTools(abnahme.replace("mcp__langfuse__getMetricsSchema", "mcp__langfuse__getMetricsSchema, mcp__langfuse__createScore")), ABNAHME_TOOLS), ["zusätzliches Tool mcp__langfuse__createScore"]);
  });

  test("Modell und Effort stehen im Frontmatter beider Agenten (opus, medium)", () => {
    for (const md of [szenario, abnahme]) {
      const kopf = (parseFrontmatter as (t: string) => Record<string, string>)(md);
      assert.equal(kopf.model, "opus");
      assert.equal(kopf.effort, "medium");
    }
  });
});

describe("Laufzeit-Hooks im Frontmatter beider Agenten (Sammelticket #1781)", () => {
  const hookZeilen = (md: string): string => /^---\n([\s\S]*?)\n---/.exec(md.replace(/\r\n/g, NL))?.[1] ?? "";
  const abnahmeKopf = hookZeilen(lies(".claude/agents/holdout-abnahme.md"));
  const szenarioKopf = hookZeilen(lies(".claude/agents/holdout-szenario.md"));

  test("holdout-abnahme: Matcher Write mit holdout-guard.mjs abnahme-write", () => {
    assert.match(abnahmeKopf, /PreToolUse:\s*\n\s+- matcher: "Write"/);
    assert.match(abnahmeKopf, /holdout-guard\.mjs\s*\n\s+- abnahme-write/);
  });

  test("holdout-szenario: Matcher Read|Grep|Glob mit holdout-guard.mjs szenario-lesen", () => {
    assert.match(szenarioKopf, /PreToolUse:\s*\n\s+- matcher: "Read\|Grep\|Glob"/);
    assert.match(szenarioKopf, /holdout-guard\.mjs\s*\n\s+- szenario-lesen/);
  });

  test("Negativ: ohne Hook, mit falschem Matcher oder vertauschtem Modus ist es rot", () => {
    assert.doesNotMatch(abnahmeKopf.replace(/hooks:[\s\S]*$/, ""), /holdout-guard/);
    assert.doesNotMatch(abnahmeKopf.replace('matcher: "Write"', 'matcher: "Edit"'), /matcher: "Write"/);
    assert.doesNotMatch(szenarioKopf.replace("szenario-lesen", "abnahme-write"), /- szenario-lesen/);
  });
});

describe("Reihenfolge im Skill (#1754)", () => {
  test("abnahme.mjs kriterien und der Szenario-Spawn stehen vor dem Planer-Spawn", () => {
    const kriterien = SKILL.indexOf("node scripts/abnahme.mjs kriterien");
    const szenario = SKILL.indexOf('subagent_type: "holdout-szenario"');
    const planer = SKILL.indexOf('subagent_type: "kubernia-planner"');
    assert.ok(kriterien >= 0 && szenario >= 0 && planer >= 0);
    assert.ok(kriterien < szenario && szenario < planer);
  });

  test("Ticket ohne Kriterien: der Skill verweist auf die entfaellt-Zeile statt auf einen Szenario-Agenten", () => {
    assert.match(SKILL, /Keine Akzeptanzkriterien[^\n]*entfaellt/);
  });
});

describe("Handback-Fallback und Werkzeug-Abbruch (#1821 L31, L35, L37)", () => {
  const szenario = lies(".claude/agents/holdout-szenario.md");
  const abnahme = lies(".claude/agents/holdout-abnahme.md");
  const PFLICHT = /Lehnt die Umgebung SubagentHandback ab oder fehlt es: nicht wiederholen, der vollständige Bericht ist die letzte Nachricht als reiner Text, ohne Tool-Aufruf danach\./;

  test("der Pflichtsatz steht in Lens-Spawn-Vorlage, Abnahme- und Szenario-Agent", () => {
    assert.match(LENSES, PFLICHT);
    assert.match(abnahme, PFLICHT);
    assert.match(szenario, PFLICHT);
  });

  test("Negativ: ohne den Satz ist der Wächter rot", () => {
    assert.doesNotMatch(abnahme.replace("nicht wiederholen", "wiederholen"), PFLICHT);
  });

  test("Fehlerwege: fehlender Bericht einmal per SendMessage anfordern, fehlendes Werkzeug ohne Neuversuch", () => {
    assert.match(SKILL, /[Ff]ehlt ein Bericht[^\n]*einmal per `SendMessage`[^\n]*kein Neu-Spawn/);
    assert.match(SKILL, /fehlt dem Typ ein Werkzeug[^\n]*?keinen Neuversuch, direkt der Hand-off/);
  });

  test("Werkzeug-Abbruch entscheidet der Hauptchat nach Entscheidungsprotokoll, nicht die Maintainerin (Skill und Umsetzer)", () => {
    const umsetzer = lies(".claude/agents/factory-umsetzer.md");
    assert.doesNotMatch(SKILL, /bei einem Werkzeug-Abbruch repariert sie das Werkzeug/);
    assert.doesNotMatch(umsetzer, /Maintainerin repariert das Werkzeug/);
    assert.match(umsetzer, /Werkzeug-Abbruch[^\n]*?entscheidet der Hauptchat nach `docs\/factory\/entscheidungsprotokoll\.md`/);
    assert.match(SKILL, /Werkzeug-Abbruch der Abnahme entscheidet der Hauptchat nach dem \[Entscheidungsprotokoll\]\([^)]*#werkzeug-abbruch-der-abnahme\)/);
    assert.match(lies("docs/factory/entscheidungsprotokoll.md"), /Werkzeug-Abbruch der Abnahme/);
  });
});
