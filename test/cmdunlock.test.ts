/* Freigeschaltete Befehlsfamilien fürs gefilterte help (#358): pure Logik.
 *
 * Prüft die DOM-/Phaser-freie Ableitung in src/cmdunlock.ts:
 *  - Meta-Befehle help/clear sind IMMER dabei (auch bei leerem Fortschritt).
 *  - Eine Familie wird erst freigeschaltet, sobald ihr Schritt erreicht ist
 *    (Schritt VOR dem aktuellen / frühere Quest), NICHT vorher (Negativfall = Red-Green).
 *  - Der laufende Schritt zählt mit (Befehl erscheint, sobald er gelehrt wird).
 *  - teach UND terminal tragen Familien, drill/dialog/choice nicht.
 *  - Gegen den echten Content: zu Spielbeginn nur Meta-Befehle; ganz am Ende alle.
 */
import { describe, it, expect } from "vitest";
import { unlockedCommandFamilies, ALWAYS_AVAILABLE_COMMANDS } from "../src/cmdunlock";
import { KQContent } from "../src/content";
import type { Quest, QuestStep } from "../src/types";

function teach(solution: string): QuestStep {
  return { type: "teach", brief: "t", cmd: { id: "t", intro: "", text: "", accept: [/x/], solution, hint: "" } };
}
function terminal(...solutions: string[]): QuestStep {
  return { type: "terminal", brief: "t", tasks: solutions.map((s, i) => ({ id: "t" + i, text: "", accept: [/x/], solution: s, hint: "" })) };
}
function dialog(): QuestStep {
  return { type: "dialog", npc: "bo", lines: ["x"] };
}
function drill(): QuestStep {
  return { type: "drill", brief: "d", pool: ["x"], count: 1, intro: "" };
}
function quest(id: string, steps: QuestStep[]): Quest {
  return { id, title: id, giver: "bo", topic: "t", rewardXp: 0, rewardCoins: 0, steps };
}

describe("unlockedCommandFamilies (#358)", () => {
  it("hat die Meta-Befehle help/clear immer dabei – auch bei leerem Fortschritt", () => {
    const fams = unlockedCommandFamilies([], { questIdx: 0, questStep: 0 });
    for (const c of ALWAYS_AVAILABLE_COMMANDS) expect(fams.has(c)).toBe(true);
    expect(fams.size).toBe(ALWAYS_AVAILABLE_COMMANDS.length);
  });

  it("schaltet eine Familie NICHT vor dem Erreichen ihres Schritts frei (Red-Green)", () => {
    const quests = [quest("q", [dialog(), teach("docker pull nginx"), teach("kubectl get pods")])];
    // Auf dem Dialog (Schritt 0): docker/kubectl noch nicht.
    const atStart = unlockedCommandFamilies(quests, { questIdx: 0, questStep: 0 });
    expect(atStart.has("docker")).toBe(false);
    expect(atStart.has("kubectl")).toBe(false);
  });

  it("schaltet den laufenden Schritt mit frei (Befehl erscheint, sobald gelehrt)", () => {
    const quests = [quest("q", [dialog(), teach("docker pull nginx"), teach("kubectl get pods")])];
    // Auf dem docker-Teach (Schritt 1): docker JA, kubectl (Schritt 2) noch NEIN.
    const onDocker = unlockedCommandFamilies(quests, { questIdx: 0, questStep: 1 });
    expect(onDocker.has("docker")).toBe(true);
    expect(onDocker.has("kubectl")).toBe(false);
  });

  it("frühere Quests sind komplett freigeschaltet", () => {
    const quests = [
      quest("q1", [teach("docker pull nginx"), terminal("ls", "cat x.yaml")]),
      quest("q2", [teach("kubectl get pods")]),
    ];
    // In Quest 2, Schritt 0: alles aus q1 (docker/ls/cat) + kubectl.
    const fams = unlockedCommandFamilies(quests, { questIdx: 1, questStep: 0 });
    expect(fams.has("docker")).toBe(true);
    expect(fams.has("ls")).toBe(true);
    expect(fams.has("cat")).toBe(true);
    expect(fams.has("kubectl")).toBe(true);
  });

  it("künftige Quests bleiben verdeckt", () => {
    const quests = [quest("q1", [teach("docker pull nginx")]), quest("q2", [teach("helm install x")])];
    const fams = unlockedCommandFamilies(quests, { questIdx: 0, questStep: 0 });
    expect(fams.has("docker")).toBe(true);
    expect(fams.has("helm")).toBe(false);
  });

  it("drill/dialog/choice führen keine Familie ein", () => {
    const quests = [quest("q", [dialog(), drill()])];
    const fams = unlockedCommandFamilies(quests, { questIdx: 0, questStep: 5 });
    expect(fams.size).toBe(ALWAYS_AVAILABLE_COMMANDS.length); // nur help/clear
  });

  it("gegen den echten Content: zu Spielbeginn nur Meta-Befehle", () => {
    const fams = unlockedCommandFamilies(KQContent.QUESTS, { questIdx: 0, questStep: 0 });
    expect([...fams].sort()).toEqual([...ALWAYS_AVAILABLE_COMMANDS].sort());
    expect(fams.has("docker")).toBe(false);
    expect(fams.has("kubectl")).toBe(false);
  });

  it("gegen den echten Content: am Spielende sind alle Hauptfamilien dabei", () => {
    const last = KQContent.QUESTS.length - 1;
    const fams = unlockedCommandFamilies(KQContent.QUESTS, { questIdx: last, questStep: KQContent.QUESTS[last].steps.length });
    for (const c of ["docker", "kubectl", "helm", "terraform", "git", "argocd", "glab", "nslookup", "curl", "aws", "ls", "cat", "kubeadm"]) {
      expect(fams.has(c), `Familie ${c} sollte am Spielende freigeschaltet sein`).toBe(true);
    }
  });
});
