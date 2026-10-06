/* Langfuse-Wächter (#1293) – die regelmäßige Auswertung und der Erfassungsschutz verschwinden nicht still.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Zwei Regeln hängen an Prosa, die sonst leise zurückdriftet:
 *   1. Die Checkliste „Langfuse-Status überprüfen" steht genau einmal (docs/model-routing.md), das
 *      wiederkehrende Ticket (Position 20) und seine Folgen-Mechanik in docs/ticket-reihenfolge.md;
 *      das Sammelticket löst keine Langfuse-Auswertung mehr aus (keine Doppelung).
 *   2. Harness-Änderungen an Agenten, Subagenten, MCP, Hooks oder Plugins belegen, dass Langfuse sie
 *      weiter erfasst (AGENTS.md). Dazu der statische Teil: die Konfiguration, die die Erfassung trägt.
 *
 * Jede Prüfung ist ein benanntes Prädikat, das gegen das echte Artefakt UND ein rotes Gegenbeispiel
 * läuft (Vorbild review-context.test.ts), damit ein aufgeweichtes Prädikat seinen Gegenbeweis fallen lässt.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string): string => readFileSync(resolve(ROOT, p), "utf8");

const abschnitt = (md: string, kopf: RegExp): string => {
  const zeilen = md.split("\n");
  const start = zeilen.findIndex((z) => kopf.test(z));
  if (start < 0) return "";
  const ebene = /^#+/.exec(zeilen[start])?.[0].length ?? 1;
  let ende = zeilen.length;
  for (let i = start + 1; i < zeilen.length; i++) {
    const m = /^(#+)\s/.exec(zeilen[i]);
    if (m && m[1].length <= ebene) {
      ende = i;
      break;
    }
  }
  return zeilen.slice(start, ende).join("\n");
};

const CHECKLISTE = [
  "Datenvollständigkeit",
  "Funktioniert alles?",
  "Tokenfresser",
  "Wiederkehrende Fehlschläge",
  "Wirkung",
  "Code-Qualität/Prozess",
];

/** Der AGENTS.md-Bullet zur Erfassungsregel: nennt die vier Änderungsarten und verlinkt den Ablauf. */
const hatErfassungsRegel = (agentsMd: string): boolean => {
  const bullet = agentsMd.split("\n").find((z) => /Langfuse-Erfassung erhalten/.test(z)) ?? "";
  return (
    /\bAgenten\b/.test(bullet) &&
    /Subagenten/.test(bullet) &&
    /Probe-Lauf/.test(bullet) &&
    /MCP/.test(bullet) &&
    /Hooks/.test(bullet) &&
    /Plugins/.test(bullet) &&
    /model-routing\.md#langfuse-erfassung-belegen-1293/.test(bullet)
  );
};

/** Der Checklisten-Abschnitt trägt alle sechs fetten Punkte. */
const hatChecklisteVollstaendig = (modelRouting: string): boolean => {
  const a = abschnitt(modelRouting, /^### Langfuse-Status überprüfen \(#1293\)/);
  return a !== "" && CHECKLISTE.every((p) => a.includes(`**${p}`));
};

/** Der Beleg-Ablauf steht in model-routing.md. */
const hatBelegAblauf = (modelRouting: string): boolean => {
  const a = abschnitt(modelRouting, /^### Langfuse-Erfassung belegen \(#1293\)/);
  return a !== "" && /Probe-Lauf/.test(a) && /usageDetails/.test(a) && /kubernia/.test(a);
};

/** Keine Doppelung: kein alter „Langfuse-Blick"-Abschnitt, die Checklistenpunkte nur in model-routing.md. */
const hatKeineDoppelung = (
  modelRouting: string,
  ticketReihenfolge: string,
  agentsMd: string,
  umsetzer: string,
): boolean =>
  !/^#+ Langfuse-Blick/m.test(modelRouting) &&
  !/Langfuse-Blick/.test(umsetzer) &&
  !/Langfuse-Blick/.test(ticketReihenfolge) &&
  !/Langfuse-Blick/.test(agentsMd) &&
  !CHECKLISTE.slice(0, 3).every((p) => ticketReihenfolge.includes(`**${p}`));

/** Der Mechanik-Abschnitt des wiederkehrenden Tickets. */
const hatWiederkehrendesTicket = (ticketReihenfolge: string): boolean => {
  const a = abschnitt(ticketReihenfolge, /^## Wiederkehrendes Ticket „Langfuse-Status überprüfen"/);
  return (
    a !== "" &&
    /Position 20/.test(a) &&
    /ganz oben/.test(a) &&
    /model-routing\.md#langfuse-status-überprüfen-1293/.test(a)
  );
};

/** Das Sammelticket verweist nicht mehr auf eine Langfuse-Auswertung beim Abarbeiten. */
const sammelticketOhneLangfuse = (ticketReihenfolge: string, agentsMd: string): boolean => {
  // Weder „Abarbeiten" des Sammeltickets noch der Harness-Befunde-Bullet nennen eine Langfuse-Auswertung
  // (egal in welchem Wortlaut); die Ausnahme-Klausel zum Status-Ticket ist ausgenommen.
  const abarbeiten = ticketReihenfolge.split("\n").find((z) => z.startsWith("- **Abarbeiten:**")) ?? "";
  const bullet = agentsMd.split("\n").find((z) => /Harness-Befunde sind Zeilen, keine Tickets/.test(z)) ?? "";
  const ohneAusnahme = bullet.split("**Ausnahme:**")[0];
  return abarbeiten !== "" && ohneAusnahme !== "" && !/Langfuse/i.test(abarbeiten + ohneAusnahme);
};

/** Die Konfiguration, die die Erfassung trägt (statischer Erfassungsschutz). */
const erfassungKonfigIntakt = (settingsJson: string): boolean => {
  const s = JSON.parse(settingsJson) as {
    enabledPlugins?: Record<string, boolean>;
    env?: Record<string, string>;
    disableAllHooks?: boolean;
  };
  return (
    s.enabledPlugins?.["langfuse-observability@langfuse-observability"] === true &&
    (s.env?.CC_LANGFUSE_TRACE_TAGS ?? "").split(",").map((t) => t.trim()).includes("kubernia") &&
    s.disableAllHooks !== true
  );
};

describe("Langfuse-Status und Erfassungsschutz (#1293)", () => {
  const agents = read("AGENTS.md");
  const mr = read("docs/model-routing.md");
  const tr = read("docs/ticket-reihenfolge.md");
  const um = read(".claude/agents/kubernia-umsetzer.md");

  test("AGENTS.md: Erfassungsregel nennt Agenten, Subagenten, MCP, Hooks, Plugins und den Ablauf", () => {
    assert.ok(hatErfassungsRegel(agents));
    // darf NICHT passieren: Regel ohne eine der Änderungsarten oder ohne Link
    const voll =
      "- **Langfuse-Erfassung erhalten (#1293).** Agenten, Subagenten, MCP-Server, Hooks oder Plugins: Probe-Lauf, [Ablauf](docs/model-routing.md#langfuse-erfassung-belegen-1293).";
    assert.ok(hatErfassungsRegel(voll));
    // je Bedingung ein eigenes Gegenbeispiel
    for (const weg of ["Agenten, ", "Subagenten, ", "MCP-Server, ", "Hooks", "Plugins", "Probe-Lauf", "#langfuse-erfassung-belegen-1293"]) {
      assert.ok(!hatErfassungsRegel(voll.replace(weg, "")), `ohne ${weg}`);
    }
    assert.ok(!hatErfassungsRegel(""));
  });

  test("model-routing.md: Checkliste mit allen sechs Punkten", () => {
    assert.ok(hatChecklisteVollstaendig(mr));
    assert.ok(!hatChecklisteVollstaendig(mr.replace("**Tokenfresser:**", "Tokenfresser:")));
    assert.ok(!hatChecklisteVollstaendig("### Langfuse-Status überprüfen (#1293)\n\n**Wirkung**"));
  });

  test("model-routing.md: Beleg-Ablauf mit Probe-Lauf und Usage", () => {
    assert.ok(hatBelegAblauf(mr));
    assert.ok(!hatBelegAblauf(mr.replace(/### Langfuse-Erfassung belegen/, "### Anderes")));
    assert.ok(!hatBelegAblauf("### Langfuse-Erfassung belegen (#1293)\n\nnur Text"));
  });

  test("keine Doppelung mit dem Sammelticket", () => {
    assert.ok(hatKeineDoppelung(mr, tr, agents, um));
    assert.ok(!hatKeineDoppelung(`${mr}\n### Langfuse-Blick beim Sammelticket`, tr, agents, um));
    assert.ok(!hatKeineDoppelung(mr, `${tr}\nzuerst der Langfuse-Blick`, agents, um));
    assert.ok(!hatKeineDoppelung(mr, tr, `${agents}\nLangfuse-Blick`, um));
    assert.ok(!hatKeineDoppelung(mr, tr, agents, `${um}\nBeim Sammelticket den Langfuse-Blick machen`));
    assert.ok(!hatKeineDoppelung(mr, `${CHECKLISTE.slice(0, 3).map((p) => `**${p}:**`).join(" ")}`, agents, um));
  });

  test("ticket-reihenfolge.md: wiederkehrendes Ticket auf Position 20, Folgen ganz oben", () => {
    assert.ok(hatWiederkehrendesTicket(tr));
    assert.ok(!hatWiederkehrendesTicket(tr.replace(/Position 20/g, "Position 7")));
    assert.ok(!hatWiederkehrendesTicket(tr.replace(/ganz oben/g, "irgendwo")));
    assert.ok(!hatWiederkehrendesTicket(""));
  });

  test("Sammelticket löst keine Langfuse-Auswertung aus", () => {
    assert.ok(sammelticketOhneLangfuse(tr, agents));
    // darf NICHT passieren: die Auswertung kehrt in anderem Wortlaut zurück
    assert.ok(!sammelticketOhneLangfuse(tr.replace("- **Abarbeiten:**", "- **Abarbeiten:** zuerst die Langfuse-Auswertung,"), agents));
    assert.ok(!sammelticketOhneLangfuse(tr, agents.replace("Kommt es dran: abarbeiten", "Kommt es dran: zuerst Langfuse auswerten, abarbeiten")));
    assert.ok(!sammelticketOhneLangfuse("", agents));
  });

  test("Erfassungs-Konfiguration in settings.json intakt", () => {
    assert.ok(erfassungKonfigIntakt(read(".claude/settings.json")));
    const ok = {
      enabledPlugins: { "langfuse-observability@langfuse-observability": true },
      env: { CC_LANGFUSE_TRACE_TAGS: "kubernia" },
    };
    assert.ok(erfassungKonfigIntakt(JSON.stringify(ok)));
    assert.ok(!erfassungKonfigIntakt(JSON.stringify({ ...ok, enabledPlugins: {} })));
    assert.ok(!erfassungKonfigIntakt(JSON.stringify({ ...ok, env: { CC_LANGFUSE_TRACE_TAGS: "x" } })));
    assert.ok(!erfassungKonfigIntakt(JSON.stringify({ ...ok, disableAllHooks: true })));
  });
});

// ── #1311: Hook-Patch-Stand, Messbehauptungen, Gruppe C ─────────────────────────

/** Nennt die Hook-Patch-Doku die Prüfregel mit der gepflegten Zahl und KEINE offene Lücke bei fortgesetzten Subagenten mehr? */
const patchDokuStimmig = (mr: string, zahl: number): boolean =>
  new RegExp(`grep -c "LOCAL PATCH" langfuse_hook\\.py\` → \`${zahl}\``).test(mr) &&
  /Patch-Teil fortgesetzte Subagenten/.test(mr) &&
  !/Für solche Läufe den Transkript-Modus nehmen/.test(mr) &&
  !/\*\*Lücke:\*\* Ein per `SendMessage` fortgesetzter/.test(mr);

/** Verlangen Lens-Rolle UND Review-Skill, Messbehauptungen nur gegen mitgelieferte Rohwerte zu prüfen? */
const messbehauptungsRegel = (text: string): boolean => /Messbehauptung/.test(text) && /Rohwerte/.test(text) && /nicht belegt/.test(text);

describe("Hook-Patch, Messbehauptungen, Gruppe C (#1311)", () => {
  const mr = read("docs/model-routing.md");

  test("Prüfregel steht auf 15 und fortgesetzte Subagenten sind keine offene Lücke mehr", () => {
    assert.ok(patchDokuStimmig(mr, 15));
    // darf NICHT passieren: alte Zahl oder die alte Lücke
    assert.ok(!patchDokuStimmig(mr.replace("→ `15`", "→ `4`"), 15));
    assert.ok(!patchDokuStimmig(mr + "\nFür solche Läufe den Transkript-Modus nehmen.", 15));
    assert.ok(!patchDokuStimmig(mr.replace("Patch-Teil fortgesetzte Subagenten", "Patch-Teil x"), 15));
  });

  test("Lens, Review-Skill und Workflow: Messbehauptungen nur gegen Rohwerte", () => {
    assert.ok(messbehauptungsRegel(read(".claude/agents/kubernia-lens.md")), "kubernia-lens.md");
    assert.ok(messbehauptungsRegel(read(".claude/skills/review-lenses/SKILL.md")), "review-lenses/SKILL.md");
    assert.ok(messbehauptungsRegel(read(".claude/workflows/kubernia-ticket.js")), "kubernia-ticket.js");
    assert.ok(!messbehauptungsRegel("Prüfe alles."));
    assert.ok(!messbehauptungsRegel("Messbehauptungen prüfst du gegen Rohwerte."), "ohne den Befund „nicht belegt“ unvollständig");
  });

  test("die Lens hat keine Langfuse-Tools (darum liefert der Auftrag die Rohwerte)", () => {
    assert.doesNotMatch(read(".claude/agents/kubernia-lens.md"), /^tools:.*mcp__langfuse/m);
  });

  test("Gruppe C ist dauerhaft definiert, „Haupt“ meint den dünnen Hauptchat, der Vermerk steht nicht mehr in der Verdichtungszeile", () => {
    assert.match(mr, /\| C \(Umsetzer-Subagent, #1280\) \|/);
    assert.match(mr, /„Haupt“ und „Sockel Haupt“ meinen ab #1280 den dünnen Hauptchat/);
    assert.match(mr, /Neue Läufe werden hier unter C fortgeführt/);
    const zeile = mr.split("\n").find((z) => z.startsWith("| #1278-Merge bis #1276-Claim")) ?? "";
    assert.notEqual(zeile, "");
    assert.doesNotMatch(zeile, /ab #1280 der dünne Hauptchat/);
    assert.match(zeile, /issuecomment-6019725674/, "der Sockel-Wert verlinkt den Beleg je Lauf");
  });
});
