import { describe, it, expect } from "vitest";
import { krallePracticeMilestone } from "../src/kralle";

// Pure Meilenstein-Politik der Kralle-Übungssprüche (#236). Kralle streut nur an
// bestimmten Gesamt-Übungszahlen einen zählbewussten Spruch ein – die DOM-Anzeige
// (ui/quiz.ts) und der persistente Zähler (game/spaced-repetition.ts) hängen daran;
// hier sichern wir nur die Auswahl-Logik ab.
describe("krallePracticeMilestone (#236)", () => {
  it("liefert an den festen Meilensteinen einen Spruch", () => {
    for (const m of [1, 10, 25, 50, 100]) {
      const line = krallePracticeMilestone(m);
      expect(line, `Meilenstein ${m}`).toBeTruthy();
      expect(typeof line).toBe("string");
    }
  });

  it("nennt bei den runden Meilensteinen die tatsächliche Zahl", () => {
    // Der Spruch soll zählbewusst sein – die 50 bzw. 100 muss vorkommen.
    expect(krallePracticeMilestone(50)).toContain("50");
    expect(krallePracticeMilestone(100)).toContain("100");
  });

  it("schweigt zwischen den Meilensteinen (kein Spruch jede Runde)", () => {
    for (const n of [2, 3, 9, 11, 24, 26, 49, 51, 99, 101, 150, 199]) {
      expect(krallePracticeMilestone(n), `Runde ${n}`).toBeNull();
    }
  });

  it("feiert ab 100 jede weiteren 100 mit der echten Zahl", () => {
    expect(krallePracticeMilestone(200)).toContain("200");
    expect(krallePracticeMilestone(300)).toContain("300");
    expect(krallePracticeMilestone(1000)).toContain("1000");
  });

  it("ist robust gegen ungültige Eingaben (0, negativ, Nachkommastellen)", () => {
    for (const bad of [0, -1, -100, 1.5, 10.1, NaN, Infinity]) {
      expect(krallePracticeMilestone(bad), `Eingabe ${bad}`).toBeNull();
    }
  });
});
