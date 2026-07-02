/* Logbuch-Übersicht & Navigation: pure Logik (#326, Stufe 1).
 *
 * Prüft die DOM-/Phaser-freien Bausteine des spielerseitigen Quest-Logs:
 *  - buildQuestLogRows: Zustand jeder Quest (done/active/locked) + ob ansehbar,
 *    inkl. der Negativfälle, die zählen (zukünftige Quest = sichtbar ABER gesperrt,
 *    kein Vorausspringen; Endzustand = alles done).
 *  - questLogUnlocked: Freischaltung erst nach Quest 1 (Grenzfall 0 vs. 1).
 *  - buildQuestDetail: Dialoge/Hinweise einer Quest als lesbare Zeilen.
 * Die Tastatur-Navigation lebt im schon getesteten overlaykbd.ts.
 */
import { describe, it, expect } from "vitest";
import {
  buildQuestLogRows,
  questLogUnlocked,
  buildQuestDetail,
  type QuestLogRoadmapEntry,
} from "../src/hud/questlog";
import type { Quest } from "../src/types";

/** Roadmap-Helfer: n Quests, davon die ersten `done` als abgeschlossen markiert. */
function roadmap(n: number, done: number): QuestLogRoadmapEntry[] {
  return Array.from({ length: n }, (_, idx) => ({
    idx,
    id: `q${idx}`,
    title: `Quest ${idx}`,
    completed: idx < done,
  }));
}

describe("buildQuestLogRows – Zustände & Ansehbarkeit (#326)", () => {
  it("markiert abgeschlossene als done und ansehbar", () => {
    const rows = buildQuestLogRows(roadmap(4, 2), 2);
    expect(rows[0].state).toBe("done");
    expect(rows[1].state).toBe("done");
    expect(rows[0].viewable).toBe(true);
    expect(rows[1].viewable).toBe(true);
  });

  it("markiert die aktuelle Quest als active und ansehbar", () => {
    const rows = buildQuestLogRows(roadmap(4, 2), 2);
    expect(rows[2].state).toBe("active");
    expect(rows[2].viewable).toBe(true);
  });

  it("zeigt zukünftige Quests SICHTBAR aber GESPERRT – kein Vorausspringen", () => {
    const rows = buildQuestLogRows(roadmap(4, 2), 2);
    // Quest 3 ist sichtbar (Eintrag existiert) …
    expect(rows[3]).toBeDefined();
    expect(rows[3].title).toBe("Quest 3");
    // … aber gesperrt und NICHT ansehbar.
    expect(rows[3].state).toBe("locked");
    expect(rows[3].viewable).toBe(false);
  });

  it("liefert für jede Quest genau eine Zeile (nichts wird ausgeblendet)", () => {
    expect(buildQuestLogRows(roadmap(5, 1), 1)).toHaveLength(5);
  });

  it("Endzustand (alles durch): jede Quest ist done, keine active/locked", () => {
    const rows = buildQuestLogRows(roadmap(3, 3), 3); // questIdx === Anzahl
    expect(rows.map(r => r.state)).toEqual(["done", "done", "done"]);
    expect(rows.every(r => r.viewable)).toBe(true);
  });

  it("frischer Start (nichts abgeschlossen): nur Quest 0 aktiv, Rest gesperrt", () => {
    const rows = buildQuestLogRows(roadmap(3, 0), 0);
    expect(rows[0].state).toBe("active");
    expect(rows[1].state).toBe("locked");
    expect(rows[2].state).toBe("locked");
  });

  it("leere Roadmap → leere Liste (kein Crash)", () => {
    expect(buildQuestLogRows([], 0)).toEqual([]);
  });
});

describe("questLogUnlocked – Freischaltung nach Quest 1 (#326)", () => {
  it("ist VOR dem ersten Abschluss gesperrt", () => {
    expect(questLogUnlocked(0)).toBe(false);
  });
  it("ist ab der ersten abgeschlossenen Quest frei (Grenzfall)", () => {
    expect(questLogUnlocked(1)).toBe(true);
  });
  it("bleibt mit mehr Abschlüssen frei", () => {
    expect(questLogUnlocked(7)).toBe(true);
  });
});

describe("buildQuestDetail – Dialoge/Hinweise nachlesen (#326)", () => {
  const name = (id: string) => (id === "bo" ? "Bo" : id);

  it("zerlegt einen Dialog-Schritt in einzelne Sprechzeilen mit Sprecher", () => {
    const q: Quest = {
      id: "docker-first-container", title: "T", giver: "bo", topic: "docker", rewardXp: 0, rewardCoins: 0,
      steps: [{ type: "dialog", npc: "bo", lines: ["Hallo Crew.", "Bo stapelt Fracht."] }],
    };
    const det = buildQuestDetail(q, name);
    expect(det).toHaveLength(2);
    expect(det[0]).toEqual({ kind: "dialog", speaker: "Bo", text: "Hallo Crew." });
    expect(det[1].text).toBe("Bo stapelt Fracht.");
  });

  it("zeigt bei einer choice-Frage die richtige Antwort, nicht die falschen", () => {
    const q: Quest = {
      id: "docker-first-container", title: "T", giver: "bo", topic: "docker", rewardXp: 0, rewardCoins: 0,
      steps: [{
        type: "choice", npc: "bo", q: "Image oder Container?",
        options: [
          { t: "Image", ok: false, reply: "Leider nein." },
          { t: "Container", ok: true, reply: "Genau – die laufende Box." },
        ],
      }],
    };
    const det = buildQuestDetail(q, name);
    expect(det).toHaveLength(1);
    expect(det[0].kind).toBe("choice");
    expect(det[0].text).toContain("Image oder Container?");
    expect(det[0].text).toContain("Genau – die laufende Box.");
    expect(det[0].text).not.toContain("Leider nein."); // falsche Antwort taucht NICHT auf
  });

  it("nutzt bei drill den intro-Text, bei teach/terminal den brief", () => {
    const q: Quest = {
      id: "docker-first-container", title: "T", giver: "bo", topic: "docker", rewardXp: 0, rewardCoins: 0,
      steps: [
        { type: "teach", brief: "Lerne docker pull", cmd: { id: "t1", text: "Tippe docker pull", accept: [/pull/], solution: "docker pull nginx", hint: "pull", intro: "x" } },
        { type: "drill", brief: "Üben", pool: ["d1"], count: 1, intro: "Jetzt wird geübt." },
        { type: "terminal", brief: "Showdown", tasks: [] },
      ],
    };
    const det = buildQuestDetail(q, name);
    expect(det.map(d => d.text)).toEqual(["Lerne docker pull", "Jetzt wird geübt.", "Showdown"]);
    expect(det.map(d => d.kind)).toEqual(["teach", "drill", "terminal"]);
  });

  it("leere Quest → leere Detailliste", () => {
    const q: Quest = { id: "q", title: "T", giver: "bo", topic: "docker", rewardXp: 0, rewardCoins: 0, steps: [] };
    expect(buildQuestDetail(q, name)).toEqual([]);
  });
});
