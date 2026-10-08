/* Hauptchat-Kosten nach Tätigkeit (#1356): Turn-Erkennung, Kategorien, Ticket-Fenster, Fork-Zuordnung.
 * Rein pur: synthetische Transkript-Zeilen mit synthetischen Pfaden, kein IO.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

// Reines Node-Tooling-Skript ohne Declaration-File (wie scripts/check-diffsize.mjs).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as hcModule from "../scripts/hauptchat-zerlegung.mjs";

type Row = Record<string, unknown>;
type Zeile = { kategorie: string; quelle: string; modell: string; calls: number; cost: number };
type Fenster = { nr: number; art: string; startTs: string; closedAt: string | null; modelle: Record<string, number> };
type Ergebnis = { rows: Zeile[]; fenster: Fenster[]; kubernia: { calls: number; cost: number }; ohnePreis: number; ohnePreisModelle: Record<string, number> };
type Sub = { meta: { agentType?: string; description?: string; parentAgentId?: string }; zeilen: Row[] };
type Eingabe = {
  sessions: { id: string; main: Row[]; subagents?: Sub[] }[];
  von?: string;
  bis?: string;
  brainRoots?: string[];
  closedAtOf?: (nr: number) => string | null;
};
const hc = hcModule as {
  zerlegeHauptchat: (e: Eingabe) => Ergebnis;
  slugFuerPfad: (p: string) => string;
  renderMarkdown: (r: Ergebnis) => string;
};

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
let seq = 0;
const iso = (min: number) => new Date(Date.UTC(2026, 9, 5, 10, min, 0)).toISOString();

const user = (min: number, text: string): Row => ({ type: "user", timestamp: iso(min), message: { role: "user", content: text } });
const slash = (min: number, name: string): Row =>
  user(min, `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>`);
const toolResult = (min: number): Row => ({
  type: "user",
  timestamp: iso(min),
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] },
});
const notification = (min: number): Row => user(min, "<task-notification>\n<task-id>abc</task-id>\n</task-notification>");
/** Ein Assistant-Call (Sonnet: 10 $/Mio Output); `output` steuert die Kosten. */
const call = (min: number, model: string, tool?: { name: string; input: Record<string, unknown> }, output = 1000): Row => {
  seq += 1;
  return {
    type: "assistant",
    timestamp: iso(min),
    uuid: `u${seq}`,
    message: {
      id: `m${seq}`,
      role: "assistant",
      model,
      usage: { input_tokens: 0, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      content: tool ? [{ type: "tool_use", id: `t${seq}`, name: tool.name, input: tool.input }] : [{ type: "text", text: "x" }],
    },
  };
};
const bash = (cmd: string) => ({ name: "Bash", input: { command: cmd } });
const read = (path: string) => ({ name: "Read", input: { file_path: path } });
const skill = (name: string) => ({ name: "Skill", input: { skill: name } });
const claim = (nr: number) => bash(`gh issue edit ${nr} --add-assignee @me`);

const zeile = (r: Ergebnis, kategorie: string, modell: string, quelle = "Hauptchat") =>
  r.rows.find((z) => z.kategorie === kategorie && z.modell === modell && z.quelle === quelle);
const calls = (r: Ergebnis, kategorie: string, modell: string, quelle = "Hauptchat") => zeile(r, kategorie, modell, quelle)?.calls ?? 0;

describe("zerlegeHauptchat: Kategorien", () => {
  test("Happy Path: Ad-hoc, Ticket-Fenster, Benachrichtigung, Nachlauf, Brain, brain-input", () => {
    const main: Row[] = [
      user(0, "frag mal was"),
      call(1, OPUS),
      slash(10, "kubernia"),
      call(11, SONNET, claim(7)),
      toolResult(12),
      call(13, SONNET),
      notification(20),
      call(21, OPUS),
      call(31, OPUS), // nach dem Merge (closedAt min 30) im selben Turn: Nachlauf
      user(40, "danke, noch eine Frage"),
      call(41, OPUS),
      user(50, "lies die Notiz"),
      call(51, OPUS, read("/x/notizen/a.md")),
      user(60, "brain-input bitte"),
      call(61, OPUS, skill("brain-input")),
      call(62, OPUS),
    ];
    const r = hc.zerlegeHauptchat({
      sessions: [{ id: "s1", main }],
      brainRoots: ["/x/notizen"],
      closedAtOf: (nr) => (nr === 7 ? iso(30) : null),
    });
    assert.equal(calls(r, "Ad-hoc", OPUS), 1);
    assert.equal(calls(r, "Ticket-Orchestrierung", SONNET), 2);
    assert.equal(calls(r, "Ticket-Orchestrierung", OPUS), 1);
    assert.equal(calls(r, "Nachlauf", OPUS), 2); // Call 31 und der Folgeturn 41
    assert.equal(calls(r, "Brain", OPUS), 3); // Read-Turn (1) + brain-input-Turn (2)
    const gesamt = r.rows.reduce((s, z) => s + z.calls, 0);
    assert.equal(gesamt, 9);
    assert.equal(r.fenster.length, 1);
    assert.equal(r.fenster[0].nr, 7);
    assert.equal(r.fenster[0].art, "Slash");
    assert.deepEqual(r.fenster[0].modelle, { [SONNET]: 2, [OPUS]: 1 });
  });

  test("Kosten je Zeile stimmen mit der Preistabelle (Sonnet: 10 $/Mio Output)", () => {
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main: [user(0, "hi"), call(1, SONNET, undefined, 1_000_000)] }] });
    assert.ok(Math.abs((zeile(r, "Ad-hoc", SONNET)?.cost ?? 0) - 10) < 1e-9);
  });

  test("remove-assignee und gh issue view sind kein Claim", () => {
    const main = [user(0, "x"), call(1, OPUS, bash("gh issue edit 5 --remove-assignee @me")), call(2, OPUS, bash("gh issue view 5 --json state"))];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main }] });
    assert.equal(r.fenster.length, 0);
    assert.equal(calls(r, "Ad-hoc", OPUS), 2);
  });

  test("Ad-hoc-Turn vor dem Claim-Turn bleibt Ad-hoc", () => {
    const main = [user(0, "a"), call(1, OPUS), user(5, "b"), call(6, OPUS, claim(3)), call(7, OPUS)];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main }] });
    assert.equal(calls(r, "Ad-hoc", OPUS), 1);
    assert.equal(calls(r, "Ticket-Orchestrierung", OPUS), 2);
  });

  test("offenes Issue ohne closedAt: Fenster bis Session-Ende", () => {
    const main = [user(0, "a"), call(1, OPUS, claim(3)), user(100, "weiter"), call(101, OPUS)];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main }], closedAtOf: () => null });
    assert.equal(calls(r, "Ticket-Orchestrierung", OPUS), 2);
    assert.equal(calls(r, "Nachlauf", OPUS), 0);
    assert.equal(r.fenster[0].closedAt, null);
  });

  test("zweiter Claim beendet das erste Fenster; Nachlauf liegt dazwischen", () => {
    const main = [
      user(0, "a"),
      call(1, OPUS, claim(1)),
      user(20, "danach"),
      call(21, OPUS),
      user(30, "nächstes"),
      call(31, OPUS, claim(2)),
    ];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main }], closedAtOf: (nr) => (nr === 1 ? iso(10) : null) });
    assert.equal(calls(r, "Nachlauf", OPUS), 1);
    assert.equal(calls(r, "Ticket-Orchestrierung", OPUS), 2);
    assert.deepEqual(r.fenster.map((f) => f.nr), [1, 2]);
  });

  test("tool_result und task-notification sind kein Turn-Start", () => {
    const main = [user(0, "a"), call(1, OPUS, claim(1)), toolResult(2), notification(3), call(4, OPUS)];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main }] });
    assert.equal(calls(r, "Ticket-Orchestrierung", OPUS), 2);
    assert.equal(calls(r, "Ad-hoc", OPUS), 0);
  });
});

describe("zerlegeHauptchat: Brain-Erkennung", () => {
  const brainTurn = (pfad: string, roots: string[] | undefined) => {
    const main = [user(0, "x"), call(1, OPUS, read(pfad))];
    return hc.zerlegeHauptchat({ sessions: [{ id: "s", main }], brainRoots: roots });
  };

  test("Wurzel trifft, ähnlicher Präfix nicht", () => {
    assert.equal(calls(brainTurn("/x/notizen/a.md", ["/x/notizen"]), "Brain", OPUS), 1);
    assert.equal(calls(brainTurn("/x/notizen-alt/a.md", ["/x/notizen"]), "Brain", OPUS), 0);
    assert.equal(calls(brainTurn("/x/notizen-alt/a.md", ["/x/notizen"]), "Ad-hoc", OPUS), 1);
  });

  test("Windows-Pfade mit Backslash und abweichender Groß-/Kleinschreibung", () => {
    assert.equal(calls(brainTurn("C:\\Daten\\Notizen\\a.md", ["c:/daten/notizen"]), "Brain", OPUS), 1);
  });

  test("Bash-Befehl mit Wurzel im Text zählt", () => {
    const main = [user(0, "x"), call(1, OPUS, bash("ls '/x/notizen/sub'"))];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main }], brainRoots: ["/x/notizen"] });
    assert.equal(calls(r, "Brain", OPUS), 1);
  });

  test("ohne --brain ist nur der Skill brain-input Brain", () => {
    assert.equal(calls(brainTurn("/x/notizen/a.md", undefined), "Brain", OPUS), 0);
    const main = [user(0, "x"), call(1, OPUS, skill("brain-input"))];
    assert.equal(calls(hc.zerlegeHauptchat({ sessions: [{ id: "s", main }] }), "Brain", OPUS), 1);
  });

  test("Brain hat Vorrang vor dem Ticket-Fenster, auch nach dem Merge", () => {
    const main = [user(0, "x"), call(1, OPUS, claim(1)), user(50, "y"), call(51, OPUS, read("/x/notizen/a.md"))];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main }], brainRoots: ["/x/notizen"], closedAtOf: () => iso(10) });
    assert.equal(calls(r, "Brain", OPUS), 1);
    assert.equal(calls(r, "Nachlauf", OPUS), 0);
  });
});

describe("zerlegeHauptchat: Start-Art", () => {
  const art = (main: Row[]) => hc.zerlegeHauptchat({ sessions: [{ id: "s", main }] }).fenster[0].art;
  test("Slash, Skill-Tool und frei", () => {
    assert.equal(art([slash(0, "kubernia"), call(1, SONNET, claim(1))]), "Slash");
    assert.equal(art([user(0, "mach #1"), call(1, OPUS, skill("kubernia")), call(2, OPUS, claim(1))]), "Skill-Tool");
    assert.equal(art([user(0, "mach #1"), call(1, OPUS, claim(1))]), "frei");
  });
});

describe("zerlegeHauptchat: Subagenten", () => {
  const sub = (meta: Sub["meta"], zeilen: Row[]): Sub => ({ meta, zeilen });

  test("kubernia-Subagenten und verschachtelte zählen nicht zum Hauptchat, Forks folgen dem Turn", () => {
    const main = [user(0, "a"), call(1, OPUS), user(10, "b"), call(11, OPUS, claim(1))];
    const subagents = [
      sub({ agentType: "kubernia-planner", description: "Plan" }, [call(12, OPUS)]),
      sub({ agentType: "kubernia-umsetzer", description: "Umsetzen" }, [call(13, SONNET)]),
      sub({ agentType: "kubernia-lens", description: "Lens R1", parentAgentId: "x" }, [call(14, OPUS)]),
      sub({ agentType: "general-purpose", description: "Recherche außer der Reihe" }, [call(15, OPUS), call(16, OPUS)]),
      sub({ agentType: "general-purpose", description: "früher Fork" }, [call(2, OPUS)]),
    ];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main, subagents }] });
    assert.equal(r.kubernia.calls, 3);
    assert.equal(calls(r, "Ticket-Orchestrierung", OPUS), 1);
    assert.equal(calls(r, "Ticket-Orchestrierung", OPUS, "Fork"), 2);
    assert.equal(calls(r, "Ad-hoc", OPUS, "Fork"), 1);
    assert.equal(calls(r, "Ad-hoc", OPUS), 1);
  });

  test("Claim eines Workflow-Subagenten (Tiefe 1) eröffnet das Fenster", () => {
    const main = [user(0, "a"), call(1, OPUS)];
    const subagents = [sub({ agentType: "general-purpose", description: "Auswahl" }, [call(5, SONNET, claim(9))])];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main, subagents }] });
    assert.deepEqual(r.fenster.map((f) => f.nr), [9]);
  });
});

describe("zerlegeHauptchat: Zeitfenster und Randfälle", () => {
  test("Calls außerhalb von von/bis fallen weg", () => {
    const main = [user(0, "a"), call(1, OPUS), call(50, OPUS)];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main }], von: iso(10), bis: iso(60) });
    assert.equal(calls(r, "Ad-hoc", OPUS), 1);
  });

  test("Call ohne gültigen Zeitstempel landet in „ohne Zeit“, nie still verworfen", () => {
    const kaputt = call(1, OPUS);
    kaputt.timestamp = "kein-datum";
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main: [user(0, "a"), kaputt, call(2, OPUS)] }] });
    assert.equal(calls(r, "ohne Zeit", OPUS), 1);
    assert.equal(calls(r, "Ad-hoc", OPUS), 1);
  });

  test("Modell ohne Preis zählt in ohnePreis, nicht als 0 $ ohne Hinweis", () => {
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main: [user(0, "a"), call(1, "claude-unbekannt-9")] }] });
    assert.equal(r.ohnePreis, 1);
  });

  test("Hinweis nennt die Modelle ohne Preis (#1441); ohne solche Calls keine Hinweiszeile", () => {
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main: [user(0, "a"), call(1, "claude-unbekannt-9"), call(2, "claude-unbekannt-9"), call(3, OPUS)] }] });
    assert.deepEqual(r.ohnePreisModelle, { "claude-unbekannt-9": 2 });
    assert.match(hc.renderMarkdown(r), /2 Calls ohne Preis: claude-unbekannt-9 \(2\) \(Modell in PRICES nachtragen oder Zeitpunkt fehlt\)/);
    const ok = hc.zerlegeHauptchat({ sessions: [{ id: "s", main: [user(0, "a"), call(1, OPUS)] }] });
    assert.doesNotMatch(hc.renderMarkdown(ok), /ohne Preis/);
  });

  test("Slug-Ableitung Windows und POSIX", () => {
    assert.equal(hc.slugFuerPfad("C:\\dev\\kubernia"), "C--dev-kubernia");
    assert.equal(hc.slugFuerPfad("/home/x/kubernia"), "-home-x-kubernia");
  });
});

describe("zerlegeHauptchat: Grenzfälle aus dem Review (R1)", () => {
  const sub = (meta: Sub["meta"], zeilen: Row[]): Sub => ({ meta, zeilen });
  // Der Brain-Turn zeigt, ob eine Zeile als Turn-Start zählt: ein zusätzlicher Turn spaltet den Brain-Turn auf.
  const brainMitZwischenzeile = (zwischen: Row) => {
    const main = [user(0, "x"), call(1, OPUS, read("/x/notizen/a.md")), zwischen, call(2, OPUS)];
    return hc.zerlegeHauptchat({ sessions: [{ id: "s", main }], brainRoots: ["/x/notizen"] });
  };

  test("Zeilen, die keinen Turn eröffnen, spalten den Brain-Turn nicht auf", () => {
    for (const z of [
      notification(1.5),
      toolResult(1.5),
      user(1.5, "<local-command-stdout>x</local-command-stdout>"),
      user(1.5, "<system-reminder>x</system-reminder>"),
      user(1.5, "[Request interrupted by user]"),
      { ...user(1.5, "meta"), isMeta: true },
      { type: "user", timestamp: iso(1.5), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }, { type: "text", text: "plus Text" }] } },
    ]) {
      const r = brainMitZwischenzeile(z);
      assert.equal(calls(r, "Brain", OPUS), 2, JSON.stringify(z).slice(0, 80));
      assert.equal(calls(r, "Ad-hoc", OPUS), 0);
    }
  });

  test("eine echte Nutzerzeile eröffnet dagegen einen neuen Turn", () => {
    const r = brainMitZwischenzeile(user(1.5, "neue Frage"));
    assert.equal(calls(r, "Brain", OPUS), 1);
    assert.equal(calls(r, "Ad-hoc", OPUS), 1);
  });

  test("Slash /brain-input ohne Skill-Tool zählt als Brain", () => {
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main: [slash(0, "brain-input"), call(1, OPUS)] }] });
    assert.equal(calls(r, "Brain", OPUS), 1);
  });

  test("dasselbe Ticket in zwei Turns geclaimt: das Fenster beginnt beim ersten Claim", () => {
    const main = [user(0, "a"), call(1, OPUS, claim(7)), user(10, "b"), call(11, OPUS), user(20, "c"), call(21, OPUS, claim(7))];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main }] });
    assert.equal(r.fenster.length, 1);
    assert.equal(r.fenster[0].startTs, iso(0));
    assert.equal(calls(r, "Ticket-Orchestrierung", OPUS), 3);
    assert.equal(calls(r, "Ad-hoc", OPUS), 0);
  });

  test("bis schneidet Calls dahinter ab, auch ohne Zeit bleibt der Call sichtbar", () => {
    const kaputt = call(1, OPUS);
    kaputt.timestamp = "kein-datum";
    const main = [user(0, "a"), call(2, OPUS), call(70, OPUS), kaputt];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main }], von: iso(1), bis: iso(60) });
    assert.equal(calls(r, "Ad-hoc", OPUS), 1);
    assert.equal(calls(r, "ohne Zeit", OPUS), 1);
  });

  test("Grenzen sind einschließlich: Call genau auf von, bis und closedAt", () => {
    const main = [user(0, "a"), call(1, OPUS, claim(3)), call(10, OPUS), call(20, OPUS), call(30, OPUS)];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main }], von: iso(1), bis: iso(30), closedAtOf: () => iso(20) });
    assert.equal(calls(r, "Ticket-Orchestrierung", OPUS), 2); // Minute 1 (von) und 10
    assert.equal(calls(r, "Nachlauf", OPUS), 2); // Minute 20 (= closedAt) und 30 (= bis)
  });

  test("ein Fork folgt dem Turn bei seinem ersten Call, auch wenn er später in einen anderen Turn läuft", () => {
    const main = [user(0, "a"), call(1, OPUS), user(10, "b"), call(11, OPUS, claim(1))];
    const subagents = [sub({ agentType: "general-purpose", description: "Fork" }, [call(2, OPUS), call(12, OPUS)])];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main, subagents }] });
    assert.equal(calls(r, "Ad-hoc", OPUS, "Fork"), 2);
    assert.equal(calls(r, "Ticket-Orchestrierung", OPUS, "Fork"), 0);
  });

  test("ein Claim in einem verschachtelten Subagenten eröffnet kein Fenster", () => {
    const main = [user(0, "a"), call(1, OPUS)];
    const subagents = [sub({ agentType: "kubernia-lens", description: "x", parentAgentId: "p" }, [call(2, SONNET, claim(9))])];
    assert.equal(hc.zerlegeHauptchat({ sessions: [{ id: "s", main, subagents }] }).fenster.length, 0);
  });

  test("ein verschachtelter Subagent zählt als kubernia, auch mit fremdem Typ und ohne ersichtliche Phase", () => {
    const subagents = [sub({ agentType: "general-purpose", description: "Erkundung", parentAgentId: "p" }, [call(2, OPUS)])];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main: [user(0, "a")], subagents }] });
    assert.equal(r.kubernia.calls, 1);
    assert.equal(r.rows.length, 0);
  });

  test("Calls ohne Preis eines kubernia-Subagenten zählen in ohnePreis", () => {
    const subagents = [sub({ agentType: "kubernia-planner" }, [call(2, "claude-unbekannt-9")])];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main: [user(0, "a")], subagents }] });
    assert.equal(r.ohnePreis, 1);
    assert.deepEqual(r.ohnePreisModelle, { "claude-unbekannt-9": 1 });
  });
});

describe("renderMarkdown", () => {
  const render = (e: Eingabe) => (hcModule as { renderMarkdown: (r: Ergebnis) => string }).renderMarkdown(hc.zerlegeHauptchat(e));

  test("nennt Fenster, warnt bei fehlendem --brain und bei Calls ohne Preis", () => {
    const text = render({ sessions: [{ id: "abcdef123456", main: [slash(0, "kubernia"), call(1, "claude-unbekannt-9", claim(4))] }] });
    assert.match(text, /ohne --brain gemessen/);
    assert.match(text, /1 Calls ohne Preis/);
    assert.match(text, /\| #4 \| abcdef12 \|/);
  });

  test("keine Brain-Warnung, wenn eine Wurzel übergeben wurde", () => {
    const text = render({ sessions: [{ id: "s", main: [user(0, "a"), call(1, OPUS)] }], brainRoots: ["/x/notizen"] });
    assert.doesNotMatch(text, /ohne --brain/);
  });
});

describe("zerlegeHauptchat: frühester Claim über Hauptchat und Subagent", () => {
  test("claimt zuerst ein Tiefe-1-Subagent und später der Hauptchat, beginnt das Fenster beim Subagent-Claim", () => {
    const main = [user(0, "a"), call(1, OPUS), user(10, "b"), call(11, OPUS), user(20, "c"), call(21, OPUS, claim(7))];
    const subagents: Sub[] = [{ meta: { agentType: "general-purpose", description: "Auswahl" }, zeilen: [call(2, SONNET, claim(7))] }];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main, subagents }] });
    assert.equal(r.fenster.length, 1);
    assert.equal(r.fenster[0].startTs, iso(0));
    assert.equal(calls(r, "Ticket-Orchestrierung", OPUS), 3);
    assert.equal(calls(r, "Ad-hoc", OPUS), 0);
  });
});

describe("zerlegeHauptchat: Brain ab dem ersten Brain-Ereignis (#1382)", () => {
  const brainRoots = ["/x/notizen"];
  const lauf = (main: Row[], closed: string | null = null) =>
    hc.zerlegeHauptchat({ sessions: [{ id: "s", main }], brainRoots, closedAtOf: () => closed });

  test("Ticket-Turn mit späterem brain-input: Calls davor Ticket, ab dem Ereignis Brain", () => {
    const r = lauf([slash(0, "kubernia"), call(1, OPUS, claim(9)), call(2, OPUS), call(3, OPUS, skill("brain-input")), call(4, OPUS), call(5, OPUS)]);
    assert.equal(calls(r, "Ticket-Orchestrierung", OPUS), 2);
    assert.equal(calls(r, "Brain", OPUS), 3);
  });

  test("ein Turn, der mit /brain-input beginnt, bleibt ganz Brain", () => {
    const r = lauf([slash(0, "brain-input"), call(1, OPUS), call(2, OPUS)]);
    assert.equal(calls(r, "Brain", OPUS), 2);
  });

  test("Brain-Ereignis nach closedAt: Calls zwischen Merge und Ereignis sind Nachlauf", () => {
    const r = lauf([slash(0, "kubernia"), call(1, OPUS, claim(9)), call(5, OPUS), call(8, OPUS), call(9, OPUS, read("/x/notizen/a.md"))], iso(4));
    assert.equal(calls(r, "Ticket-Orchestrierung", OPUS), 1);
    assert.equal(calls(r, "Nachlauf", OPUS), 2);
    assert.equal(calls(r, "Brain", OPUS), 1);
  });

  test("Brain-Wurzel nur als Präfix eines anderen Pfads färbt den Turn nicht ein", () => {
    const r = lauf([user(0, "x"), call(1, OPUS), call(2, OPUS, read("/x/notizen-alt/a.md")), call(3, OPUS)]);
    assert.equal(calls(r, "Brain", OPUS), 0);
  });

  test("zwei Brain-Ereignisse im Turn: Brain beginnt beim ersten, auch die Calls dazwischen sind Brain", () => {
    const r = lauf([slash(0, "kubernia"), call(1, OPUS, claim(9)), call(2, OPUS, read("/x/notizen/a.md")), call(3, OPUS), call(4, OPUS, read("/x/notizen/b.md")), call(5, OPUS)]);
    assert.equal(calls(r, "Ticket-Orchestrierung", OPUS), 1);
    assert.equal(calls(r, "Brain", OPUS), 4);
  });

  test("Brain-Ereignis ohne gültigen Zeitstempel: der Turn bleibt ganz Brain statt still verloren zu gehen", () => {
    const ev = call(2, OPUS, read("/x/notizen/a.md"));
    ev.timestamp = "kein-datum";
    const r = lauf([user(0, "x"), call(1, OPUS), ev, call(3, OPUS)]);
    assert.equal(calls(r, "Brain", OPUS), 2);
    assert.equal(zeile(r, "Brain", OPUS)?.calls, 2);
    assert.equal(r.rows.find((z) => z.kategorie === "ohne Zeit")?.calls, 1);
  });

  test("hauptchatCalls ist die Summe über alle Modelle und Calls des Fensters", () => {
    const main = [slash(0, "kubernia"), call(1, SONNET, claim(5)), call(2, SONNET), call(3, SONNET), call(4, OPUS)];
    const r = hc.zerlegeHauptchat({ sessions: [{ id: "s", main }] }) as Ergebnis & { fenster: { hauptchatCalls: number }[] };
    assert.equal(r.fenster[0].hauptchatCalls, 4);
  });

  test("Fenster ohne Hauptchat-Calls: hauptchatCalls 0 und Ausgabe „0 Calls“ statt „-“", () => {
    const e = { sessions: [{ id: "s", main: [slash(0, "kubernia"), call(1, SONNET, claim(5))] }] };
    const r = hc.zerlegeHauptchat(e) as Ergebnis & { fenster: (Fenster & { hauptchatCalls: number })[] };
    assert.equal(r.fenster[0].hauptchatCalls, 1);
    // Claim-Call in einem Subagent-Claim: Fenster ohne eigene Calls
    const sub: Sub = { meta: { agentType: "x" }, zeilen: [call(1, SONNET, claim(6))] };
    const leer = hc.zerlegeHauptchat({ sessions: [{ id: "s", main: [user(0, "x")], subagents: [sub] }] }) as typeof r;
    assert.equal(leer.fenster[0].hauptchatCalls, 0);
    const text = (hcModule as { renderMarkdown: (r: Ergebnis) => string }).renderMarkdown(leer);
    assert.match(text, /\| 0 Calls \|/);
    assert.doesNotMatch(text, /\| - \|/);
  });
});
