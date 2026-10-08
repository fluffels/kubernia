/* Wächter für den gemeinsamen Anzeigetext-Sammler (test/support/anzeigetexte.ts, #1526).
 *
 * Der Sammler speist den Platzhalter-/Tag-Wächter, den Wording-Wächter und den Kurzform-Wächter. Fiele eine Schritt-Art
 * still heraus, blieben alle drei für sie blind. Darum prüft dieser Test den Abstieg je Container-Art an einer Mini-Quest
 * mit genau einem Schritt je Typ gegen die vollständige Label-Liste (Endungs-Muster auf den echten Quests würden eine
 * fehlende Art durch eine andere Art verdecken).
 */
import { describe, expect, test } from "vitest";
import type { Quest } from "../src/types";
import { questAnzeigeFelder } from "./support/anzeigetexte";

const quest = {
  id: "q",
  title: "T",
  giver: "g",
  topic: "t",
  rewardXp: 1,
  rewardCoins: 1,
  steps: [
    { type: "dialog", npc: "n", lines: ["d0", "d1"] },
    { type: "choice", npc: "n", q: "cq", options: [{ t: "ot", ok: true, reply: "or" }] },
    { type: "teach", brief: "tb", cmd: { id: "c", text: "ctext", accept: [], solution: "SOL", hint: "chint", why: "cwhy", intro: "cintro" } },
    { type: "drill", brief: "db", pool: [], count: 1, intro: "dintro" },
    {
      type: "terminal",
      brief: "tmb",
      tasks: [
        { id: "t1", text: "t1text", accept: [], solution: "S1", hint: "t1hint" }, // ohne why: kein Label
        { id: "t2", text: "t2text", accept: [], solution: "S2", hint: "t2hint", why: "t2why" },
      ],
    },
    { type: "minigame", npc: "n", game: "stack", brief: "mb" },
  ],
} as unknown as Quest;

describe("questAnzeigeFelder (#1526)", () => {
  test("steigt in jede Container-Art ab: genau die Markup-Felder, mit den Label-Formen je Art", () => {
    const labels = questAnzeigeFelder([quest]).map(([label]) => label).sort();
    expect(labels).toEqual(
      [
        "q.title",
        "q#0.lines[0]", "q#0.lines[1]",
        "q#1.q", "q#1.options[0].t", "q#1.options[0].reply",
        "q#2.brief", "q#2.text", "q#2.hint", "q#2.why", "q#2.intro",
        "q#3.brief", "q#3.intro",
        "q#4.brief", "q#4/t1.text", "q#4/t1.hint", "q#4/t2.text", "q#4/t2.hint", "q#4/t2.why",
        "q#5.brief",
      ].sort(),
    );
  });

  test("Texte stimmen, `solution` (escaped) und Daten-Felder fehlen, ein fehlendes optionales `why` erzeugt kein Label", () => {
    const felder = new Map(questAnzeigeFelder([quest]));
    expect(felder.get("q#2.text")).toBe("ctext");
    expect(felder.get("q#4/t2.why")).toBe("t2why");
    expect(felder.has("q#4/t1.why")).toBe(false);
    expect([...felder.values()]).not.toContain("SOL");
  });

  test("Negativfall: ein als markup klassifiziertes Feld mit falschem Typ wirft statt still übersprungen zu werden", () => {
    expect(() => questAnzeigeFelder([{ ...quest, title: 42 } as unknown as Quest])).toThrow(/markup/);
    expect(() => questAnzeigeFelder([{ ...quest, steps: [{ type: "dialog", npc: "n", lines: ["a", 7] }] } as unknown as Quest])).toThrow(/markup/);
  });
});
