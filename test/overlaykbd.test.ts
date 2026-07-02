/* Tastatur-Bedienbarkeit einfacher Modals (#283).
 *
 * Prüft die pure Entscheidungslogik resolveOverlayKey: Navigation per ↑/↓ (w/s)
 * mit Umlauf über NUR aktivierbare Buttons und Auslösen per Enter/Leer/E
 * (markierter → primary → erster). Inklusive Negativ-/Grenzfälle (disabled,
 * leeres Overlay, irrelevante Tasten, Wrap), damit kein Maus-only-Knopf bleibt.
 */
import { test, expect, describe } from "vitest";
import { resolveOverlayKey, dialogueNav, nextFocusIndex, type OverlayButton } from "../src/overlaykbd";

// Kürzel zum Bauen von Button-Listen.
const b = (o: Partial<OverlayButton> = {}): OverlayButton => ({ disabled: false, primary: false, ...o });

describe("resolveOverlayKey – Auslösen (Enter/Leer/E)", () => {
  test("ohne Markierung löst Enter den primary-Button aus (Stapel-Intro-Fall)", () => {
    // [✕ schließen, … , VERSTANDEN-STAPELN! (primary)]
    const btns = [b(), b({ primary: true })];
    for (const key of ["Enter", " ", "e"]) {
      expect(resolveOverlayKey(btns, -1, key)).toEqual({ kind: "activate", index: 1 });
    }
  });

  test("ohne primary und ohne Markierung trifft Enter den ersten aktivierbaren", () => {
    const btns = [b(), b(), b()];
    expect(resolveOverlayKey(btns, -1, "Enter")).toEqual({ kind: "activate", index: 0 });
  });

  test("ist ein Button markiert, gewinnt der markierte vor dem primary", () => {
    const btns = [b({ primary: true }), b(), b()];
    expect(resolveOverlayKey(btns, 2, "Enter")).toEqual({ kind: "activate", index: 2 });
  });

  test("ein als markiert übergebener disabled-Button fällt auf primary zurück", () => {
    const btns = [b({ primary: true }), b({ disabled: true })];
    // current zeigt auf den deaktivierten Button → nicht auslösen, primary nehmen
    expect(resolveOverlayKey(btns, 1, " ")).toEqual({ kind: "activate", index: 0 });
  });

  test("erster aktivierbarer überspringt führende disabled-Buttons", () => {
    const btns = [b({ disabled: true }), b(), b()];
    expect(resolveOverlayKey(btns, -1, "Enter")).toEqual({ kind: "activate", index: 1 });
  });
});

describe("resolveOverlayKey – Navigation (↑/↓, w/s)", () => {
  test("↓/s aus 'nichts markiert' springt auf den ersten Button", () => {
    const btns = [b(), b(), b()];
    expect(resolveOverlayKey(btns, -1, "ArrowDown")).toEqual({ kind: "nav", sel: 0 });
    expect(resolveOverlayKey(btns, -1, "s")).toEqual({ kind: "nav", sel: 0 });
  });

  test("↑/w aus 'nichts markiert' springt auf den letzten Button", () => {
    const btns = [b(), b(), b()];
    expect(resolveOverlayKey(btns, -1, "ArrowUp")).toEqual({ kind: "nav", sel: 2 });
    expect(resolveOverlayKey(btns, -1, "w")).toEqual({ kind: "nav", sel: 2 });
  });

  test("↓ läuft weiter und wickelt am Ende um", () => {
    const btns = [b(), b(), b()];
    expect(resolveOverlayKey(btns, 0, "ArrowDown")).toEqual({ kind: "nav", sel: 1 });
    expect(resolveOverlayKey(btns, 2, "ArrowDown")).toEqual({ kind: "nav", sel: 0 });
  });

  test("↑ wickelt am Anfang zum letzten um", () => {
    const btns = [b(), b(), b()];
    expect(resolveOverlayKey(btns, 0, "ArrowUp")).toEqual({ kind: "nav", sel: 2 });
  });

  test("Navigation überspringt deaktivierte Buttons", () => {
    // Indizes: 0 aktiv, 1 disabled, 2 aktiv
    const btns = [b(), b({ disabled: true }), b()];
    expect(resolveOverlayKey(btns, 0, "ArrowDown")).toEqual({ kind: "nav", sel: 2 });
    expect(resolveOverlayKey(btns, 2, "ArrowDown")).toEqual({ kind: "nav", sel: 0 });
    expect(resolveOverlayKey(btns, 2, "ArrowUp")).toEqual({ kind: "nav", sel: 0 });
  });
});

describe("resolveOverlayKey – Negativ-/Grenzfälle", () => {
  test("leeres Overlay liefert null (nichts zu tun)", () => {
    expect(resolveOverlayKey([], -1, "Enter")).toBeNull();
    expect(resolveOverlayKey([], -1, "ArrowDown")).toBeNull();
  });

  test("nur deaktivierte Buttons → null (kein Klick, keine Navigation)", () => {
    const btns = [b({ disabled: true }), b({ disabled: true })];
    expect(resolveOverlayKey(btns, -1, "Enter")).toBeNull();
    expect(resolveOverlayKey(btns, -1, "ArrowDown")).toBeNull();
  });

  test("irrelevante Tasten liefern null und werden nicht geschluckt", () => {
    const btns = [b({ primary: true }), b()];
    for (const key of ["t", "j", "Escape", "Tab", "1", "x"]) {
      expect(resolveOverlayKey(btns, -1, key)).toBeNull();
    }
  });

  test("einzelner Button: ↓ und ↑ bleiben auf ihm, Enter löst ihn aus", () => {
    const btns = [b({ primary: true })];
    expect(resolveOverlayKey(btns, -1, "ArrowDown")).toEqual({ kind: "nav", sel: 0 });
    expect(resolveOverlayKey(btns, 0, "ArrowUp")).toEqual({ kind: "nav", sel: 0 });
    expect(resolveOverlayKey(btns, -1, "Enter")).toEqual({ kind: "activate", index: 0 });
  });
});

describe("dialogueNav – mehrzeilige Lese-Dialoge vor/zurück (#310)", () => {
  test("weiter geht Zeile für Zeile vorwärts", () => {
    expect(dialogueNav(0, 3, 1)).toEqual({ kind: "show", idx: 1 });
    expect(dialogueNav(1, 3, 1)).toEqual({ kind: "show", idx: 2 });
  });

  test("weiter auf der letzten Zeile beendet den Dialog (schließen + onDone)", () => {
    expect(dialogueNav(2, 3, 1)).toEqual({ kind: "finish" });
  });

  test("zurück geht Zeile für Zeile rückwärts (Nachlesen)", () => {
    expect(dialogueNav(2, 3, -1)).toEqual({ kind: "show", idx: 1 });
    expect(dialogueNav(1, 3, -1)).toEqual({ kind: "show", idx: 0 });
  });

  test("zurück auf der ersten Zeile bleibt stehen (geclampt, kein Rückdrehen)", () => {
    expect(dialogueNav(0, 3, -1)).toEqual({ kind: "stay" });
  });

  test("einzeiliger Dialog (Smalltalk): weiter beendet sofort, zurück bleibt stehen", () => {
    expect(dialogueNav(0, 1, 1)).toEqual({ kind: "finish" });
    expect(dialogueNav(0, 1, -1)).toEqual({ kind: "stay" });
  });

  test("Hin und Her ist verlustfrei: vor, dann zurück landet wieder auf derselben Zeile", () => {
    const fwd = dialogueNav(0, 3, 1);
    expect(fwd).toEqual({ kind: "show", idx: 1 });
    if (fwd.kind === "show") {
      expect(dialogueNav(fwd.idx, 3, -1)).toEqual({ kind: "show", idx: 0 });
    }
  });
});

describe("nextFocusIndex – Fokusfalle für Modals (#506)", () => {
  test("Tab vorwärts läuft Schritt für Schritt weiter", () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 1, false)).toBe(2);
  });

  test("Tab am letzten Knoten wickelt zyklisch auf den ersten um (Falle greift)", () => {
    expect(nextFocusIndex(3, 2, false)).toBe(0);
  });

  test("Shift+Tab läuft rückwärts", () => {
    expect(nextFocusIndex(3, 2, true)).toBe(1);
    expect(nextFocusIndex(3, 1, true)).toBe(0);
  });

  test("Shift+Tab am ersten Knoten wickelt auf den letzten um", () => {
    expect(nextFocusIndex(3, 0, true)).toBe(2);
  });

  test("Fokus außerhalb des Modals (-1): Tab → erster, Shift+Tab → letzter", () => {
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
  });

  test("außerhalb liegender/ungültiger current-Index verhält sich wie 'nicht im Modal'", () => {
    // indexOf liefert -1, kann aber theoretisch auch >= count sein → gleicher Einstieg.
    expect(nextFocusIndex(3, 99, false)).toBe(0);
    expect(nextFocusIndex(3, 99, true)).toBe(2);
  });

  test("einzelner Knoten: Tab und Shift+Tab bleiben auf ihm (Fokus kann nicht raus)", () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
  });

  test("kein fokussierbarer Knoten → null (nichts zu fokussieren)", () => {
    expect(nextFocusIndex(0, -1, false)).toBeNull();
    expect(nextFocusIndex(0, 0, true)).toBeNull();
  });
});
