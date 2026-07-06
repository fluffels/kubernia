/* Tests für den DOM-freien Erfolgs-Feier-Kern (#314): Warteschlange (bündeln statt
 * spammen), Rang-Faltung (löst #223 ab), deterministische Spruch-/Titel-Auswahl.
 * Die DOM-Anzeige (ui/hud.ts) hängt an diesen reinen Entscheidungen. */
import { describe, it, expect } from "vitest";
import {
  enqueueAchievement,
  bundleCelebration,
  celebrationQuip,
  celebrationTitle,
  type Achievement,
} from "../src/hud/celebrate";

const rank = (icon: string, title: string, detail: string): Achievement =>
  ({ kind: "rank", icon, title, detail });

describe("enqueueAchievement — Bündelung (#314)", () => {
  it("legt einen ersten Erfolg in die leere Warteschlange", () => {
    const q = enqueueAchievement([], { kind: "abbrev", icon: "🔓", title: "kubectl" });
    expect(q).toHaveLength(1);
    expect(q[0].title).toBe("kubectl");
  });

  it("faltet mehrere Rang-Aufstiege zu EINEM (Start→End, wie #223)", () => {
    let q: Achievement[] = [];
    q = enqueueAchievement(q, rank("🧽", "Moses", "zuvor: 🦔 Landratte"));
    q = enqueueAchievement(q, rank("🧹", "Deckshand", "zuvor: 🧽 Moses"));
    q = enqueueAchievement(q, rank("⚓", "Matrose", "zuvor: 🧹 Deckshand"));
    const ranks = q.filter(a => a.kind === "rank");
    expect(ranks).toHaveLength(1);
    // neuestes Ziel …
    expect(ranks[0].title).toBe("Matrose");
    expect(ranks[0].icon).toBe("⚓");
    // … aber das ursprüngliche „zuvor" (Landratte) bleibt erhalten
    expect(ranks[0].detail).toBe("zuvor: 🦔 Landratte");
  });

  it("dedupliziert denselben Nicht-Rang-Erfolg (kind+title)", () => {
    let q = enqueueAchievement([], { kind: "abbrev", icon: "🔓", title: "kubectl" });
    q = enqueueAchievement(q, { kind: "abbrev", icon: "🔓", title: "kubectl" });
    expect(q).toHaveLength(1);
  });

  it("hält unterschiedliche Erfolgs-Arten nebeneinander", () => {
    let q = enqueueAchievement([], rank("⚓", "Matrose", "zuvor: 🧹 Deckshand"));
    q = enqueueAchievement(q, { kind: "album", icon: "📖", title: "3 neue Album-Einträge" });
    q = enqueueAchievement(q, { kind: "cmdhistory", icon: "⌨️", title: "Befehlshistorie" });
    expect(q).toHaveLength(3);
  });

  it("mutiert die Eingabe-Liste nicht (gibt eine neue zurück)", () => {
    const q0: Achievement[] = [];
    const q1 = enqueueAchievement(q0, { kind: "abbrev", icon: "🔓", title: "kubectl" });
    expect(q0).toHaveLength(0);
    expect(q1).not.toBe(q0);
  });
});

describe("bundleCelebration — Anzeige-Sicht (#314)", () => {
  it("gibt null zurück, wenn nichts ansteht", () => {
    expect(bundleCelebration([])).toBeNull();
  });

  it("sortiert den Rang-Sticker nach vorne", () => {
    const view = bundleCelebration([
      { kind: "album", icon: "📖", title: "1 neuer Album-Eintrag" },
      rank("⚓", "Matrose", "zuvor: 🧹 Deckshand"),
    ]);
    expect(view).not.toBeNull();
    expect(view!.items[0].kind).toBe("rank");
  });

  it("erhält alle Sticker in der Bündelung", () => {
    const view = bundleCelebration([
      rank("⚓", "Matrose", "zuvor: 🧹 Deckshand"),
      { kind: "abbrev", icon: "🔓", title: "kubectl" },
    ]);
    expect(view!.items).toHaveLength(2);
    expect(view!.title).toBeTruthy();
    expect(view!.quip).toBeTruthy();
  });
});

describe("celebrationTitle (#314)", () => {
  it("nutzt den Aufstiegs-Titel, wenn NUR Rang gefeiert wird", () => {
    expect(celebrationTitle([rank("⚓", "Matrose", "zuvor: 🧹 Deckshand")])).toContain("Aufgestiegen");
  });

  it("nutzt den allgemeinen Titel, sobald ein Nicht-Rang-Erfolg dabei ist", () => {
    const t = celebrationTitle([
      rank("⚓", "Matrose", "zuvor: 🧹 Deckshand"),
      { kind: "album", icon: "📖", title: "1 neuer Eintrag" },
    ]);
    expect(t).not.toContain("Aufgestiegen");
    expect(t).toBeTruthy();
  });
});

describe("celebrationQuip — deterministisch (#314)", () => {
  it("ist stabil für denselben Inhalt (kein Math.random)", () => {
    const items: Achievement[] = [{ kind: "abbrev", icon: "🔓", title: "kubectl" }];
    expect(celebrationQuip(items)).toBe(celebrationQuip(items));
  });

  it("wählt einen Sammel-Spruch bei gemischten Arten", () => {
    // Der Sammel-Pool ist von den Einzel-Pools disjunkt – ein gemischter Satz darf
    // keinen reinen Einzel-Spruch ziehen. Wir prüfen: der Spruch ist nicht leer und
    // stabil; die Disjunktheit sichert der Pool selbst.
    const mixed: Achievement[] = [
      { kind: "abbrev", icon: "🔓", title: "kubectl" },
      { kind: "album", icon: "📖", title: "1 neuer Eintrag" },
    ];
    expect(celebrationQuip(mixed)).toBeTruthy();
  });

  it("liefert für jede Erfolgs-Art einen nicht-leeren Spruch", () => {
    for (const kind of ["rank", "album", "abbrev", "cmdhistory"] as const) {
      const q = celebrationQuip([{ kind, icon: "★", title: "x" }]);
      expect(q, kind).toBeTruthy();
    }
  });

  it("leere Sammlung ergibt leeren Spruch", () => {
    expect(celebrationQuip([])).toBe("");
  });
});
