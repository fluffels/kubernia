/* Langfuse-Wächter (#1293) – die regelmäßige Auswertung und der Erfassungsschutz verschwinden nicht still.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Zwei Regeln hängen an Prosa, die sonst leise zurückdriftet:
 *   1. Die Checkliste „Langfuse-Status überprüfen" steht genau einmal (docs/model-routing.md), das
 *      wiederkehrende Ticket (Board-Takt board-takt.yml, #1351/#1390) und das Sammelticket
 *      „Langfuse-Befunde (gesammelt)" in docs/ticket-reihenfolge.md; das Harness-Sammelticket löst keine
 *      Langfuse-Auswertung aus (keine Doppelung). Keine Board-Position als Takt mehr.
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
import { lokaleImporteTransitiv } from "./hook-importe";

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
  "Wochenbudget",
  "Kosten gegen Nutzen",
  "Vermeidbare Arbeit",
  "Factory-Kennzahlen",
  "Selbst-Audit",
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

/** Der Checklisten-Abschnitt trägt alle fetten Punkte der CHECKLISTE. */
const hatChecklisteVollstaendig = (modelRouting: string): boolean => {
  const a = abschnitt(modelRouting, /^### Langfuse-Status überprüfen \(#1293\)/);
  return a !== "" && CHECKLISTE.every((p) => a.includes(`**${p}`));
};

/** Der Beleg-Ablauf steht in model-routing.md. */
const hatBelegAblauf = (modelRouting: string): boolean => {
  const a = abschnitt(modelRouting, /^### Langfuse-Erfassung belegen \(#1293\)/);
  return a !== "" && /Probe-Lauf/.test(a) && /usageDetails/.test(a);
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

/** Der Mechanik-Abschnitt des wiederkehrenden Tickets: Wochen-Workflow, keine Board-Position, kein Einweg-Folgeticket. */
const hatWiederkehrendesTicket = (ticketReihenfolge: string): boolean => {
  const a = abschnitt(ticketReihenfolge, /^## Wiederkehrendes Ticket „Langfuse-Status überprüfen"/);
  return (
    a !== "" &&
    /board-takt\.yml/.test(a) &&
    /wöchentlich/.test(a) &&
    /Langfuse-Befunde \(gesammelt\)/.test(a) &&
    /model-routing\.md#langfuse-status-überprüfen-1293/.test(a) &&
    !/Position 20/.test(a) &&
    !/Langfuse-Folgen aus/.test(a)
  );
};

/** Texte, in denen weder die Position-20-Regel noch die Einweg-Folgetickets zurückkehren dürfen (ADRs sind Historie). */
const keinePositionsRegel = (texte: string[]): boolean => texte.every((t) => !/Position 20/.test(t) && !/Langfuse-Folgen aus/.test(t));

/** Der Abschnitt zum Langfuse-Sammelticket: Kommentar-Zeilen, höchstens eines, komplett, nach oben; AGENTS.md verweist darauf. */
const hatLangfuseSammelticket = (ticketReihenfolge: string, agentsMd: string): boolean => {
  const a = abschnitt(ticketReihenfolge, /^### Langfuse-Befunde \(gesammelt\)/);
  const bullet = agentsMd.split("\n").find((z) => /Harness-Befunde sind Zeilen, keine Tickets/.test(z)) ?? "";
  const ausnahme = bullet.split("**Ausnahme:**")[1] ?? "";
  return (
    a !== "" &&
    /gh issue comment/.test(a) &&
    /\*\*Höchstens ein\*\*/.test(a) &&
    /komplett/.test(a) &&
    /--top/.test(a) &&
    /Langfuse-Befunde \(gesammelt\)/.test(ausnahme) &&
    /#langfuse-befunde-gesammelt/.test(ausnahme)
  );
};

/** Der Schritt-Block (zwischen den `- name:`-Grenzen), dessen `run:` genau diesen Befehl ist; sonst "". */
const schrittMitRun = (yml: string, befehl: string): string => {
  const schritte = yml.split(/^\s+- (?=name:)/m);
  return schritte.find((s) => s.split("\n").some((z) => z.trim() === `run: ${befehl}`)) ?? "";
};

/** Die Bedingungen, die den Takt-Workflow robust machen (serialisiert, nicht abbrechend, schreibend, mit Board-Token). */
const taktWorkflowRobust = (yml: string): boolean => {
  const gruppe = /^concurrency:\s*\n\s+group:\s*(\S+)/m.exec(yml)?.[1] ?? "";
  return (
    /^\s+schedule:/m.test(yml) &&
    /^\s+- cron:\s*"[^"]+"/m.test(yml) &&
    /workflow_dispatch/.test(yml) &&
    gruppe !== "" &&
    !gruppe.includes("${{") &&
    /cancel-in-progress:\s*false/.test(yml) &&
    /issues:\s*write/.test(yml) &&
    /^\s+PROJECT_TOKEN:\s*\$\{\{\s*secrets\.PROJECT_TOKEN\s*\}\}\s*$/m.test(schrittMitRun(yml, "node scripts/board-takt.mjs")) && // der Token gehört an den Takt-Schritt, in beliebiger Reihenfolge
    /^\s+run:\s*node scripts\/board-takt\.mjs\s*$/m.test(yml) &&
    !/--dry-run/.test(yml)
  );
};

/** Das Skript fragt Tickets über die konsistente REST-Liste, nie über den verzögerten Such-Index. */
const ohneSuchIndex = (skript: string): boolean => !/search\/issues|--search\b/.test(skript);

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
    s.disableAllHooks !== true
  );
};

/** Der automatische Abgleich (#1578) ist verdrahtet: SessionStart UND SessionEnd starten den Hook, kein Stop/SubagentStop, und das vom Hook gestartete Skript samt Importen ist geschützt. */
const abgleichVerdrahtet = (settingsJson: string, hookQuelle: string, geschuetzt: (rel: string) => boolean, lies: (rel: string) => string): boolean => {
  const HOOK = "scripts/langfuse-abgleich-hook.mjs";
  const s = JSON.parse(settingsJson) as { hooks?: Record<string, { hooks: { args?: string[] }[] }[]> };
  const zeigt = (ereignis: string): boolean => (s.hooks?.[ereignis] ?? []).some((e) => e.hooks.some((h) => (h.args ?? []).some((a) => a.endsWith(HOOK))));
  if (!zeigt("SessionStart") || !zeigt("SessionEnd") || zeigt("Stop") || zeigt("SubagentStop")) return false;
  const ziel = /new URL\("\.\/([\w.-]+\.mjs)", import\.meta\.url\)/.exec(hookQuelle)?.[1];
  if (!ziel) return false;
  return lokaleImporteTransitiv([`scripts/${ziel}`, HOOK], lies).every(geschuetzt);
};

describe("Langfuse-Status und Erfassungsschutz (#1293)", () => {
  const agents = read("AGENTS.md");
  const mr = read("docs/model-routing.md");
  const tr = read("docs/ticket-reihenfolge.md");
  const um = read(".claude/agents/factory-umsetzer.md");

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

  test("model-routing.md: Checkliste mit allen elf Punkten", () => {
    assert.ok(hatChecklisteVollstaendig(mr));
    assert.ok(!hatChecklisteVollstaendig(mr.replace("**Wochenbudget:**", "Wochenbudget:")));
    assert.ok(!hatChecklisteVollstaendig(mr.replace("**Kosten gegen Nutzen", "Kosten gegen Nutzen")));
    assert.ok(!hatChecklisteVollstaendig(mr.replace("**Tokenfresser:**", "Tokenfresser:")));
    assert.ok(!hatChecklisteVollstaendig(mr.replace("**Vermeidbare Arbeit (#1425):**", "Vermeidbare Arbeit (#1425):")));
    assert.ok(!hatChecklisteVollstaendig("### Langfuse-Status überprüfen (#1293)\n\n**Wirkung**"));
  });

  test("model-routing.md: die Checkliste hat genau so viele nummerierte Punkte wie CHECKLISTE", () => {
    const zaehle = (text: string): number =>
      abschnitt(text, /^### Langfuse-Status überprüfen \(#1293\)/)
        .split("\n")
        .filter((z) => /^\d+\. \*\*/.test(z)).length;
    assert.equal(zaehle(mr), CHECKLISTE.length);
    // Drift: ein zwölfter Punkt ohne Eintrag in CHECKLISTE muss auffallen
    const punkt11 = mr.indexOf("11. **Selbst-Audit");
    const zeilenEnde = mr.indexOf("\n", punkt11);
    const mitZwoelf = `${mr.slice(0, zeilenEnde)}\n12. **Neu:** x${mr.slice(zeilenEnde)}`;
    assert.notEqual(zaehle(mitZwoelf), CHECKLISTE.length);
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

  test("ticket-reihenfolge.md: wiederkehrendes Ticket per Wochen-Workflow, ohne Position-20-Regel", () => {
    assert.ok(hatWiederkehrendesTicket(tr));
    assert.ok(!hatWiederkehrendesTicket(tr.replace(/board-takt\.yml/g, "x")), "ohne Workflow-Verweis");
    assert.ok(!hatWiederkehrendesTicket(tr.replace(/wöchentlich/g, "regelmäßig")), "ohne den Wochentakt");
    assert.ok(!hatWiederkehrendesTicket(tr.replace(/Langfuse-Befunde \(gesammelt\)/g, "Folgeticket")), "ohne Sammelticket");
    assert.ok(!hatWiederkehrendesTicket(tr.replace("**Body-Vorlage:**", "Nachfolger auf Position 20. **Body-Vorlage:**")), "Position 20 kehrt zurück");
    assert.ok(!hatWiederkehrendesTicket(tr.replace("**Body-Vorlage:**", "Langfuse-Folgen aus #1. **Body-Vorlage:**")), "Einweg-Folgeticket kehrt zurück");
    assert.ok(!hatWiederkehrendesTicket(""));
  });

  test("keine Position-20-Regel und keine Einweg-Folgetickets in Regeltexten (ADRs sind Historie)", () => {
    const dateien = [
      "AGENTS.md",
      "docs/ticket-reihenfolge.md",
      "docs/model-routing.md",
      ".claude/agents/factory-planer.md",
      ".claude/agents/factory-umsetzer.md",
      ".agents/skills/factory/ablauf.md",
    ];
    assert.ok(keinePositionsRegel(dateien.map(read)));
    assert.ok(!keinePositionsRegel(["alles gut", "Nachfolger auf Position 20"]));
    assert.ok(!keinePositionsRegel(["Langfuse-Folgen aus #1"]));
  });

  test("Langfuse-Sammelticket: Kommentar-Zeilen, höchstens eines, komplett, nach oben, AGENTS.md verweist darauf", () => {
    assert.ok(hatLangfuseSammelticket(tr, agents));
    assert.ok(!hatLangfuseSammelticket(tr.replace("### Langfuse-Befunde (gesammelt)", "### Anderes"), agents));
    assert.ok(!hatLangfuseSammelticket(tr.replace(/gh issue comment/g, "x"), agents));
    assert.ok(!hatLangfuseSammelticket(tr.replace("**Höchstens ein**", "Mehrere"), agents));
    assert.ok(!hatLangfuseSammelticket(tr.replace(/komplett/g, "teilweise"), agents));
    assert.ok(!hatLangfuseSammelticket(tr.replace(/--top/g, "--x"), agents));
    assert.ok(!hatLangfuseSammelticket(tr, agents.replace("#langfuse-befunde-gesammelt", "#x")));
    assert.ok(!hatLangfuseSammelticket("", ""));
    assert.ok(!hatLangfuseSammelticket(tr, agents.replace(/(Ausnahme:\*\*[^\n]*)Langfuse-Befunde \(gesammelt\)/, "$1Anderes")), "Titel fehlt im Ausnahme-Teil von AGENTS.md");
  });

  test("Takt-Workflow: Cron + Dispatch, feste Concurrency-Group ohne Abbruch, schreibende Rechte, Board-Token, echter Lauf", () => {
    const yml = read(".github/workflows/board-takt.yml").replace(/\r\n/g, "\n"); // CRLF im Windows-Checkout
    assert.ok(taktWorkflowRobust(yml));
    const sabotagen: [string, string, string][] = [
      ["schedule:", "pull_request:", "Cron"],
      ['- cron: "17 5 * * 1"', "", "Cron-Zeile weg, schedule: bleibt"],
      ["concurrency:"+"\n  group: board-takt\n  cancel-in-progress: false\n", "", "Concurrency-Block weg"],
      ["  group: board-takt\n", "", "group: weg"],
      ["run: node scripts/board-takt.mjs", "run: echo node scripts/langfuse-takt.mjs", "falsche run-Zeile (echo)"],
      ["run: node scripts/board-takt.mjs", "run: node scripts/anderes.mjs", "falsches Skript"],
      ["workflow_dispatch", "x", "Dispatch"],
      ["group: board-takt", "group: board-${{ github.run_id }}", "variable Group"],
      ["cancel-in-progress: false", "cancel-in-progress: true", "Abbruch"],
      ["issues: write", "issues: read", "Rechte"],
      ["secrets.PROJECT_TOKEN", "secrets.X", "Board-Token"],
      ["run: node scripts/board-takt.mjs", "run: node scripts/board-takt.mjs --dry-run", "Trockenlauf"],
    ];
    for (const [alt, neu, was] of sabotagen) {
      assert.ok(yml.includes(alt), `Vorlage enthält ${alt}`);
      assert.ok(!taktWorkflowRobust(yml.replace(alt, neu)), was);
    }
    assert.ok(!taktWorkflowRobust(""));
  });

  test("Takt-Workflow: Token-Prüfung ist reihenfolgeunabhängig, aber an den Takt-Schritt gebunden", () => {
    const yml = read(".github/workflows/board-takt.yml").replace(/\r\n/g, "\n");
    const tok = "          PROJECT_TOKEN: ${{ secrets.PROJECT_TOKEN }}\n";
    const gh = "          GH_TOKEN: ${{ github.token }}\n";
    assert.ok(yml.includes(gh + "          GITHUB_REPOSITORY: ${{ github.repository }}\n" + tok), "Vorlage");
    // Grün: env-Zeilen vertauscht
    assert.ok(taktWorkflowRobust(yml.replace(tok, "").replace(gh, tok + gh)), "Token zuerst");
    // Grün: env nach run
    const env = "        env:\n" + gh + "          GITHUB_REPOSITORY: ${{ github.repository }}\n" + tok;
    const run = "        run: node scripts/board-takt.mjs\n";
    assert.ok(yml.includes(env + run), "env vor run in der Vorlage");
    assert.ok(taktWorkflowRobust(yml.replace(env + run, run + env)), "env nach run");
    // Rot: Token nur in einem anderen Schritt (ein zweiter Schritt wird angehängt, der Token wandert dorthin)
    const zweiterSchritt = "      - name: Anderer Schritt\n        env:\n          GH_TOKEN: ${{ secrets.PROJECT_TOKEN }}\n" + tok + "        run: echo ok\n";
    const nurAnderswo = yml.replace(tok, "").replace(/\n*$/, "\n") + zweiterSchritt;
    assert.ok(nurAnderswo !== yml.replace(tok, ""), "Vorlage hat den zweiten Schritt");
    assert.ok(!taktWorkflowRobust(nurAnderswo), "Token nur im anderen Schritt");
  });

  test("Takt- und Anlege-Skripte nutzen keinen Such-Index (eventual consistent), nur REST-Listen", () => {
    for (const datei of ["scripts/langfuse-takt.mjs", "scripts/board-takt.mjs", "scripts/sammelticket-anlegen.mjs"]) {
      const skript = read(datei);
      assert.ok(ohneSuchIndex(skript), datei);
      assert.ok(!ohneSuchIndex(`${skript}\ngh api search/issues`));
      assert.ok(!ohneSuchIndex(`${skript}\n--search`));
    }
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
    const ok = { enabledPlugins: { "langfuse-observability@langfuse-observability": true } };
    assert.ok(erfassungKonfigIntakt(JSON.stringify(ok)));
    assert.ok(!erfassungKonfigIntakt(JSON.stringify({ ...ok, enabledPlugins: {} })));
    assert.ok(!erfassungKonfigIntakt(JSON.stringify({ ...ok, disableAllHooks: true })));
  });
});

describe("Automatischer Abgleich verdrahtet (#1578)", () => {
  const settings = read(".claude/settings.json");
  const hookQuelle = read("scripts/langfuse-abgleich-hook.mjs");
  const geschuetztDurch = (eintraege: string[]) => (rel: string): boolean => eintraege.some((p) => p !== "" && rel.startsWith(p.replace(/^\//, "")));
  const echte = (JSON.parse(read(".github/protected-paths.json")) as { harness: string[] }).harness;
  const owners = read(".github/CODEOWNERS")
    .split("\n")
    .map((z) => z.trim().split(/\s+/)[0])
    .filter((p) => p.startsWith("/"));
  const eintrag = (ereignis: string) => ({ [ereignis]: [{ hooks: [{ type: "command", command: "node", args: ["${CLAUDE_PROJECT_DIR}/scripts/langfuse-abgleich-hook.mjs"] }] }] });
  const mit = (hooks: Record<string, unknown>) => JSON.stringify({ hooks });

  test("echte Dateien: beide Hook-Einträge, Spawn-Ziel samt Importen in protected-paths.json UND CODEOWNERS", () => {
    assert.ok(abgleichVerdrahtet(settings, hookQuelle, geschuetztDurch(echte), read));
    assert.ok(abgleichVerdrahtet(settings, hookQuelle, geschuetztDurch(owners), read));
    // die ganze Kette, die der Spawn nachzieht
    for (const n of ["langfuse-abgleich-hook", "langfuse-nachliefern", "langfuse-otlp", "langfuse-abgleich", "langfuse-api", "preise", "transkript", "transkript-calls"]) {
      assert.ok(geschuetztDurch(echte)(`scripts/${n}.mjs`) && geschuetztDurch(owners)(`scripts/${n}.mjs`), n);
    }
  });

  test("rote Gegenbeispiele: SessionEnd fehlt, SessionStart fehlt, Stop/SubagentStop-Eintrag, ungeschütztes Kettenglied, Hook startet ungeschütztes Skript", () => {
    const g = geschuetztDurch(echte);
    assert.ok(abgleichVerdrahtet(mit({ ...eintrag("SessionStart"), ...eintrag("SessionEnd") }), hookQuelle, g, read));
    assert.ok(!abgleichVerdrahtet(mit(eintrag("SessionStart")), hookQuelle, g, read), "SessionEnd fehlt");
    assert.ok(!abgleichVerdrahtet(mit(eintrag("SessionEnd")), hookQuelle, g, read), "SessionStart fehlt");
    assert.ok(!abgleichVerdrahtet(mit({ ...eintrag("SessionStart"), ...eintrag("SessionEnd"), ...eintrag("Stop") }), hookQuelle, g, read), "Stop");
    assert.ok(!abgleichVerdrahtet(mit({ ...eintrag("SessionStart"), ...eintrag("SessionEnd"), ...eintrag("SubagentStop") }), hookQuelle, g, read), "SubagentStop");
    assert.ok(!abgleichVerdrahtet(settings, hookQuelle, geschuetztDurch(echte.filter((p) => !p.includes("langfuse-otlp"))), read), "langfuse-otlp.mjs fehlt in der Liste");
    const ungeschuetzt = hookQuelle.replace("./langfuse-nachliefern.mjs", "./transkript-kopie.mjs");
    assert.ok(!abgleichVerdrahtet(settings, ungeschuetzt, g, (rel) => (rel === "scripts/transkript-kopie.mjs" ? "" : read(rel))), "Spawn-Ziel ungeschützt");
    assert.ok(!abgleichVerdrahtet(settings, "kein Spawn-Ziel", g, read), "Spawn-Ziel nicht erkennbar");
  });
});

// ── #1311: Hook-Patch-Stand, Messbehauptungen, Gruppe C ─────────────────────────

/** Nennt die Hook-Patch-Doku die Prüfregel mit der gepflegten Zahl und KEINE offene Lücke bei fortgesetzten Subagenten mehr? */
const patchDokuStimmig = (mr: string, zahl: number): boolean =>
  new RegExp(`grep -c "LOCAL PATCH" langfuse_hook\\.py\` → \`${zahl}\``).test(mr) &&
  /Patch-Teil fortgesetzte Subagenten/.test(mr) &&
  !/Für solche Läufe den Transkript-Modus nehmen/.test(mr) &&
  !/\*\*Lücke:\*\* Ein per `SendMessage` fortgesetzter/.test(mr);

/** Erklärt die Doku den Abschluss fortgesetzter Subagenten (#1378): task-id-Notification, Selbstheilung, SessionEnd nicht garantiert, Diagnose hängender Turns? */
const resumeAbschlussDokuStimmig = (mr: string): boolean =>
  /Patch-Teil Abschluss fortgesetzter Subagenten/.test(mr) &&
  /<task-id>/.test(mr) &&
  /Diagnose:\*\* `~\/\.claude\/state\/langfuse_state\.json`[\s\S]{0,120}pending_agent_turns/.test(mr) &&
  /Selbstheilung/.test(mr) &&
  /pending_agent_turns/.test(mr) &&
  /SessionEnd[^.]*nicht garantiert/.test(mr);

/** Verlangen Lens-Rolle UND Review-Skill, Messbehauptungen nur gegen mitgelieferte Rohwerte zu prüfen? */
const messbehauptungsRegel = (text: string): boolean => /Messbehauptung/.test(text) && /Rohwerte/.test(text) && /nicht belegt/.test(text);

/** Der Planer kennzeichnet Messbehauptungen ohne Rohwerte als ungeprüfte Hypothese. */
const planerRohwerteRegel = (text: string): boolean => /Messbehauptungen im Plan/.test(text) && /Rohwerte/.test(text) && /ungeprüfte Hypothese/.test(text);
/** Wer einen Plan umsetzt, übernimmt Zahlen nur mit Rohwerten oder nachgemessen. */
const planUebernahmeRegel = (text: string): boolean => /eine Zahl aus dem Plan übernimmst du nur mit ihren Rohwerten oder nachgemessen/i.test(text) && /token-baseline\.mjs/.test(text);
/** Lauf-Historie aus PR/Issue, ein Transkript nur über bekannte Session-ID, nie per Suche über alle Sessions. */
const historieRegel = (text: string): boolean => /Lauf-Historie/.test(text) && /gh pr view/.test(text) && /--session/.test(text) && /nie\*{0,2} per Suche quer über `~\/\.claude\/projects`/.test(text);

describe("Hook-Patch, Messbehauptungen, Gruppe C (#1311)", () => {
  const mr = read("docs/model-routing.md");
  const hp = read("docs/langfuse-hook-patch.md"); // Pflege des Hook-Patches (#1390 Z2)

  test("die Patch-Pflege steht auf der eigenen Brain-Seite, nicht mehr in model-routing.md, und der Index kennt sie", () => {
    assert.ok(/Langfuse-Hook-Patch pflegen/.test(hp));
    assert.ok(!/Patch-Teil/.test(mr), "model-routing.md trägt keine Patch-Teile mehr");
    assert.ok(!/LOCAL PATCH/.test(mr), "die Prüfregel steht auf der Brain-Seite");
    assert.match(mr, /langfuse-hook-patch\.md/, "model-routing.md verweist auf die Seite");
    assert.match(read("docs/referenz/anlaufstellen.md"), /langfuse-hook-patch\.md/, "die Seite hängt im Index");
    // Red-Green: ein zurückgewanderter Patch-Teil fällt auf
    assert.ok(/Patch-Teil/.test(`${mr}\n- **Patch-Teil x:**`));
  });

  test("keine Schnappschuss-Belege auf der Brain-Seite: keine Session-IDs, keine Probe-Zählungen (sie stehen in PR und Issue)", () => {
    const sessionId = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/;
    assert.doesNotMatch(hp, sessionId);
    assert.doesNotMatch(hp, /\bSession `[0-9a-f]{8}`/);
    assert.ok(sessionId.test("Session 14dfbfb5-1f2f-439a-8f23-f2135cfa563a"));
    // gekürzte ID: 8 Hex-Zeichen mit mindestens einer Ziffer und einem Buchstaben a-f.
    // Grenze: Zählwerte und Prosa ohne dieses Muster bleiben unerkannt, die Prüfung ist ein Netz, kein Beweis.
    const kurzId = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8}\b/;
    assert.doesNotMatch(hp, kurzId);
    assert.ok(kurzId.test("Probelauf (Session 42b834f1)"));
    assert.ok(!kurzId.test("Zählung 12345678 und Wort abcdefab"));
  });

  test("Prüfregel steht auf 26 und fortgesetzte Subagenten sind keine offene Lücke mehr", () => {
    assert.ok(patchDokuStimmig(hp, 26));
    // darf NICHT passieren: alte Zahl oder die alte Lücke
    assert.ok(!patchDokuStimmig(hp.replace("→ `26`", "→ `15`"), 26));
    assert.ok(!patchDokuStimmig(hp + "\nFür solche Läufe den Transkript-Modus nehmen.", 26));
    assert.ok(!patchDokuStimmig(hp.replace("Patch-Teil fortgesetzte Subagenten", "Patch-Teil x"), 26));
  });

  test("die Doku nennt das Datum des Stichtags aus langfuse-abgleich-kern.mjs (Drift Doku <-> Konstante)", () => {
    const stichtag = (skript: string): string => /export const STICHTAG = "(\d{4}-\d{2}-\d{2})T/.exec(skript)?.[1] ?? "";
    const datum = stichtag(read("scripts/langfuse-abgleich-kern.mjs"));
    assert.match(datum, /^\d{4}-\d{2}-\d{2}$/);
    const nenntStichtag = (doku: string, d: string): boolean => new RegExp(`\\*\\*Stichtag:\\*\\*[^\\n]*${d}`).test(doku);
    assert.ok(nenntStichtag(hp, datum), `docs/langfuse-hook-patch.md nennt in der Stichtag-Zeile nicht ${datum}`);
    // darf NICHT passieren: Konstante und Doku laufen auseinander
    assert.ok(!nenntStichtag(hp, "2026-10-09"), "das frühere Datum darf nicht mehr in der Stichtag-Zeile stehen");
  });

  test("Abschluss fortgesetzter Subagenten ist erklärt: task-id-Regel, Selbstheilung, SessionEnd, Diagnose (#1378)", () => {
    assert.ok(resumeAbschlussDokuStimmig(hp));
    // darf NICHT passieren: ein Baustein fehlt
    assert.ok(!resumeAbschlussDokuStimmig(hp.replace("Patch-Teil Abschluss fortgesetzter Subagenten", "Patch-Teil x")));
    assert.ok(!resumeAbschlussDokuStimmig(hp.replaceAll("Selbstheilung", "Heilung")));
    assert.ok(!resumeAbschlussDokuStimmig(hp.replaceAll("pending_agent_turns", "x")));
    assert.ok(!resumeAbschlussDokuStimmig(hp.replaceAll("<task-id>", "x")));
    assert.ok(!resumeAbschlussDokuStimmig(hp.replace("**Diagnose:** `~/.claude/state/langfuse_state.json`", "**Diagnose:** `x`")));
    assert.ok(!resumeAbschlussDokuStimmig(hp.replaceAll("nicht garantiert", "garantiert")));
  });

  test("Lens und Review-Skill: Messbehauptungen nur gegen Rohwerte", () => {
    assert.ok(messbehauptungsRegel(read(".claude/agents/factory-lens.md")), "factory-lens.md");
    assert.ok(messbehauptungsRegel(read(".agents/skills/review-lenses/SKILL.md")), "review-lenses/SKILL.md");
    assert.ok(!messbehauptungsRegel("Prüfe alles."));
    assert.ok(!messbehauptungsRegel("Messbehauptungen prüfst du gegen Rohwerte."), "ohne den Befund „nicht belegt“ unvollständig");
  });

  test("Planer und Umsetzer: Zahlen aus dem Plan nur mit Rohwerten (#1322 Z12)", () => {
    assert.ok(planerRohwerteRegel(read(".claude/agents/factory-planer.md")), "factory-planer.md");
    assert.ok(planUebernahmeRegel(read(".claude/agents/factory-umsetzer.md")), "factory-umsetzer.md");
    // darf NICHT passieren: eine Hälfte der Regel fehlt
    assert.ok(!planerRohwerteRegel("Messbehauptungen im Plan nur mit Rohwerten."), "ohne die Kennzeichnung als Hypothese unvollständig");
    assert.ok(!planerRohwerteRegel("Zählungen sind schön."));
    assert.ok(!planUebernahmeRegel("Eine Zahl aus dem Plan übernimmst du nur mit ihren Rohwerten."), "ohne Nachmessen unvollständig");
    assert.ok(!planUebernahmeRegel("Übernimm Zahlen mit Rohwerten oder per token-baseline.mjs."), "ohne den Satzanfang unvollständig");
  });

  test("Planer und Lens: Lauf-Historie aus PR/Issue statt Transkript-Suche (#1322 Z18)", () => {
    assert.ok(historieRegel(read(".claude/agents/factory-planer.md")), "factory-planer.md");
    assert.ok(historieRegel(read(".claude/agents/factory-lens.md")), "factory-lens.md");
    assert.ok(!historieRegel("Lauf-Historie holst du irgendwoher."));
    assert.ok(!historieRegel("Lauf-Historie aus gh pr view, Transkripte per --session."), "ohne das Verbot der Suche unvollständig");
  });

  test("die Lens hat keine Langfuse-Tools (darum liefert der Auftrag die Rohwerte)", () => {
    assert.doesNotMatch(read(".claude/agents/factory-lens.md"), /^tools:.*mcp__langfuse/m);
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

describe("Zuordnung in Langfuse (#1668)", () => {
  const SKRIPT_ZEILEN = ["Brain-Arbeit", "Ticket", "Phase", "Rolle"];
  const ALLE_ZEILEN = ["Projekt", ...SKRIPT_ZEILEN, "Usage-Schlüssel"];

  /** Tabelle je Merkmal vollständig, die vier Skript-Merkmale tragen den Wortlaut, #1266 steht nur in der Überschrift. */
  const hatZuordnung = (mr: string): boolean => {
    const a = abschnitt(mr, /^### Zuordnung in Langfuse \(#1266\)/);
    if (a === "") return false;
    const zeile = (name: string): string => a.split("\n").find((z) => z.startsWith(`| ${name}`)) ?? "";
    const übrig = mr.replace("### Zuordnung in Langfuse (#1266)", "");
    return (
      ALLE_ZEILEN.every((n) => zeile(n) !== "") &&
      SKRIPT_ZEILEN.every((n) => zeile(n).includes("nur über das Skript messbar")) &&
      !/#1266/.test(übrig)
    );
  };

  /** Der Checklisten-Abschnitt nutzt die Rollen-Übersicht und gleicht gegen „Subagent LLM Call“ ab. */
  const nutztRollenUebersicht = (mr: string): boolean => {
    const a = abschnitt(mr, /^### Langfuse-Status überprüfen \(#1293\)/);
    const abgleich = /\*\*Abgleich der Opus-Subagenten:\*\*[^\n]*?(?=\*\*[A-Z]|$)/.exec(a)?.[0] ?? "";
    return a.includes("subagent-laufzeit.mjs --typen") && abgleich.includes("`starts with` `Subagent LLM Call`");
  };

  test("model-routing.md: Zuordnungs-Tabelle mit allen Merkmalen und dem Wortlaut „nur über das Skript messbar“", () => {
    assert.ok(hatZuordnung(read("docs/model-routing.md")));
  });

  test("rote Gegenbeispiele: fehlende Zeile, fehlender Wortlaut, übrig gebliebenes #1266", () => {
    const mr = read("docs/model-routing.md");
    assert.equal(hatZuordnung(mr.replace(/^\| Phase \| nichts.*$/m, "")), false);
    assert.equal(hatZuordnung(mr.replace(/^(\| Rolle \|.*)nur über das Skript messbar/m, "$1")), false);
    assert.equal(hatZuordnung(`${mr}\nSiehe #1266.`), false);
    assert.equal(hatZuordnung(mr.replace("### Zuordnung in Langfuse (#1266)", "### Zuordnung")), false);
  });

  /** Ticket-Zeile warnt vor Kosten je Ticket und nennt die Gründe (a) bis (d); Projekt-Zeile trägt das Schnitt-Datum; das Trace-Tag-Bullet verlinkt nur (die Glossar-Zeile prüft `trace-tag-projekt.test.ts`). */
  const hatTicketGruendeUndDatum = (mr: string): boolean => {
    const a = abschnitt(mr, /^### Zuordnung in Langfuse \(#1266\)/);
    const zeile = (name: string): string => a.split("\n").find((z) => z.startsWith(`| ${name}`)) ?? "";
    const ticket = zeile("Ticket");
    const tag = mr.split("\n").find((z) => z.startsWith("- **Trace-Tag:**")) ?? "";
    return (
      /nicht für Kosten je Ticket verwenden/.test(ticket) &&
      ["(a)", "(b)", "(c)", "(d)"].every((g) => ticket.includes(g)) &&
      /ab 2026-10-05/.test(zeile("Projekt")) &&
      /\*\*Vergleichsschnitt:\*\*[^\n]*2026-10-05/.test(a) &&
      !/2026-10-05|Brain-Arbeit/.test(tag)
    );
  };

  test("Ticket-Zeile (Warnung, Gründe a bis d), Schnitt-Datum und Verlinkung statt Text, Gegenbeispiele rot", () => {
    const mr = read("docs/model-routing.md");
    assert.ok(hatTicketGruendeUndDatum(mr));
    assert.equal(hatTicketGruendeUndDatum(mr.replace("nicht für Kosten je Ticket verwenden", "ok")), false);
    for (const g of ["(a) `CC_", "(b) die Session", "(c) der Hook-Patch", "(d) mehrere Tickets"]) assert.equal(hatTicketGruendeUndDatum(mr.replace(g, "(x)")), false, g);
    assert.equal(hatTicketGruendeUndDatum(mr.replace(/(\*\*Vergleichsschnitt:\*\*[^\n]*?)2026-10-05/, "$1ab Oktober")), false);
    assert.equal(hatTicketGruendeUndDatum(mr.replace("beim Start fest an allen Traces;", "beim Start fest an allen Traces, auch an Brain-Arbeit;")), false);
  });

  test("Checkliste nutzt --typen und den Namen „Subagent LLM Call“, Gegenbeispiel rot", () => {
    const mr = read("docs/model-routing.md");
    assert.ok(nutztRollenUebersicht(mr));
    assert.equal(nutztRollenUebersicht(mr.replaceAll("subagent-laufzeit.mjs --typen", "subagent-laufzeit.mjs")), false);
    assert.equal(nutztRollenUebersicht(mr.replace("**Abgleich der Opus-Subagenten:**", "**Abgleich:**")), false);
    assert.equal(nutztRollenUebersicht(mr.replace("`name` `starts with` `Subagent LLM Call`, Familie `opus`", "`name` `starts with` `Call`, Familie `opus`")), false);
  });
});

/* Messwerte gehören in den Beleg-Kommentar, nicht in die Doku (L1 #1888): docs/langfuse-hook-patch.md
 * trägt nur qualitative Aussagen mit Verweis. Geschlossene Musterliste (jede Erweiterung ist ein
 * bewusster Commit):
 *   `\d+ von \d+`                    Stichprobenanteil („10 von 11“)
 *   `gemessen am \d{4}-\d{2}-\d{2}`  Messdatum
 *   `an \d+ \S+-Läufen`              Lauf-Anzahl der Stichprobe
 *   `(zwei|drei|vier)mal \d+`        Zahl-Wiederholungen
 *   `[−+-]\d+ s`                     Messabweichung in Sekunden
 */
describe("langfuse-hook-patch.md ohne Messwerte (#1888)", () => {
  const MESSWERT_MUSTER = [
    /\d+ von \d+/,
    /gemessen am \d{4}-\d{2}-\d{2}/,
    /an \d+ \S+-Läufen/,
    /(zwei|drei|vier)mal \d+/,
    /[−+-]\d+ s/,
  ];
  const messwerte = (md: string): string[] => MESSWERT_MUSTER.filter((m) => m.test(md)).map(String);

  test("die Doku trägt keinen Messwert", () => {
    assert.deepEqual(messwerte(read("docs/langfuse-hook-patch.md")), []);
  });

  test("rote Gegenbeispiele: jedes Muster schlägt an", () => {
    for (const s of ["10 von 11", "gemessen am 2026-10-10", "an 6 SessionEnd-Läufen", "dreimal 181", "lag +2 s", "lag −1 s"]) {
      assert.equal(messwerte(`x ${s} y`).length > 0, true, s);
    }
    assert.deepEqual(messwerte("fast alle, wenige Sekunden, 5 s Toleranz"), []);
  });
});
