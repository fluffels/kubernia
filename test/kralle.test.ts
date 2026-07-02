import { describe, it, expect } from "vitest";
import { krallePracticeMilestone, kralleClawAside } from "../src/hud/kralle";

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

// „Running Gag" (#237): Kralle ist eine Krabbe OHNE Krallen und erwähnt das ab und zu
// wehmütig-frech. Bewusst dosiert (nur jede 7. Runde) und nie auf einem Meilenstein.
describe("kralleClawAside (#237)", () => {
  it("streut auf jeder 7. Runde einen Krallen-Spruch ein", () => {
    for (const n of [7, 14, 21, 28, 35]) {
      const line = kralleClawAside(n);
      expect(line, `Runde ${n}`).toBeTruthy();
      expect(typeof line).toBe("string");
    }
  });

  it("schweigt zwischen diesen Runden (nicht jede Runde nerven)", () => {
    for (const n of [2, 5, 6, 8, 13, 15, 20, 27]) {
      expect(kralleClawAside(n), `Runde ${n}`).toBeNull();
    }
  });

  it("lässt dem Meilenstein den Vortritt (kein Doppel-Spruch)", () => {
    // 700 ist Vielfaches von 7 UND ein 100er-Meilenstein – dann hat der Meilenstein Vorrang.
    expect(kralleClawAside(700)).toBeNull();
    expect(krallePracticeMilestone(700)).toBeTruthy();
  });

  it("dreht deterministisch durch den Pool (gleiche Runde -> gleicher Spruch)", () => {
    expect(kralleClawAside(7)).toBe(kralleClawAside(7));
    // Der Pool hat 5 Sprüche; 7 und 7+5*7=42 landen auf demselben Eintrag.
    expect(kralleClawAside(7)).toBe(kralleClawAside(42));
    // Aufeinanderfolgende Krallen-Runden sind verschieden (rotiert wirklich).
    expect(kralleClawAside(7)).not.toBe(kralleClawAside(14));
  });

  it("erwähnt thematisch Krallen oder Scheren", () => {
    const line = kralleClawAside(7)!;
    expect(/krall|scher/i.test(line), line).toBe(true);
  });

  it("ist robust gegen ungültige Eingaben (0, negativ, Nachkommastellen)", () => {
    for (const bad of [0, -1, -7, 7.5, NaN, Infinity]) {
      expect(kralleClawAside(bad), `Eingabe ${bad}`).toBeNull();
    }
  });
});
