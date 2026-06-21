/* Lernreihenfolge-Wächter (#235, Single Source seit #412): Bei Kralle darf nie eine
 * Karte im Wiederhol-/Quiz-Pool landen, deren Konzept im Spiel noch nicht eingeführt
 * wurde.
 *
 * Der Test fährt die ECHTE Freischalt-Logik (game.ts → registerQuestCards) in
 * Spielreihenfolge ab und vergleicht je Karte die Freischalt-Position mit der
 * Einführungs-Position, die `introOrderFromContent` aus der Single Source der Daten
 * ableitet (chapter/introducedIn der Karten + Choice-reviewId der Quests). Deckt damit
 * beide Pool-Quellen ab: Choice-`reviewId` und CMD_CARDS/CRAB_QUIZ `chapter`.
 *
 * game.ts setzt beim Import (window as any).Game und nutzt localStorage – im
 * Node-Lauf stubben wir window vorher und importieren das Modul dann dynamisch.
 */
import { test, expect, beforeAll, beforeEach } from "vitest";
import { vi } from "vitest";
import { KQContent } from "../src/content";
import { introOrderFromContent, lernpfadVerstoesse } from "../src/content/learnorder";

let Game: typeof import("../src/game").Game;

beforeAll(async () => {
  const map = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => { map.set(k, String(v)); },
      removeItem: (k: string) => { map.delete(k); },
    },
  });
  ({ Game } = await import("../src/game"));
});

beforeEach(() => Game.reset());

/** Früheste Quest-Position, an der jede Karte über IRGENDEINE Quelle in den Pool
 *  kommt – ermittelt über die echte registerQuestCards-Logik. */
function unlockOrder(): Record<string, number> {
  Game.reset();
  const first: Record<string, number> = {};
  KQContent.QUESTS.forEach((q, i) => {
    Game.registerQuestCards(q.id);
    for (const id of Object.keys(Game.state.review)) {
      if (first[id] === undefined) first[id] = i;
    }
  });
  return first;
}

/** Einführungs-Positionen aus der Single Source (chapter/introducedIn + Choice-reviewId). */
function introOrder(): Record<string, number> {
  return introOrderFromContent(KQContent.QUESTS, KQContent.CMD_CARDS, KQContent.CRAB_QUIZ);
}

test("Kralle fragt keine Karte ab, deren Konzept noch nicht eingeführt wurde (#235)", () => {
  const verstoesse = lernpfadVerstoesse(unlockOrder(), introOrder());
  expect(verstoesse, "Lernreihenfolge-Verstöße:\n" + verstoesse.join("\n")).toEqual([]);
});

test("jede freigeschaltete Karte hat eine Einführungs-Position aus der Single Source (#412)", () => {
  // Eine Karte kommt nur über ihr `chapter` (CMD/Quiz) oder eine Choice-`reviewId` in
  // den Pool – beides liefert eine Einführungs-Position. Eine freigeschaltete Karte
  // ohne Einführungs-Position wäre ein Daten-Loch (chapter vergessen) und würde hier
  // auffallen, bevor Kralle sie zu früh zeigt. Ersetzt den früheren CONCEPT_INTRO-
  // Vollständigkeits-Check, der die jetzt entfallene Hand-Map prüfte.
  const intro = introOrder();
  const ohneIntro = Object.keys(unlockOrder()).filter(id => intro[id] === undefined);
  expect(ohneIntro, "freigeschaltete Karten ohne Einführungs-Quest: " + ohneIntro.join(", ")).toEqual([]);
});

/* ---- introOrderFromContent: Ableitung aus der Single Source (#412) ---- */

test("introOrderFromContent: introducedIn überschreibt chapter als Einführungs-Quest (#412)", () => {
  const quests = [{ id: "qa", steps: [] }, { id: "qb", steps: [] }, { id: "qc", steps: [] }];
  // Karte mit chapter=qc (Freischaltung), Konzept aber schon in qa eingeführt:
  const intro = introOrderFromContent(quests, [], [{ id: "k1", chapter: "qc", introducedIn: "qa" }]);
  expect(intro["k1"]).toBe(0); // Position von qa, NICHT qc
  // ohne introducedIn zählt chapter:
  const intro2 = introOrderFromContent(quests, [], [{ id: "k2", chapter: "qc" }]);
  expect(intro2["k2"]).toBe(2);
});

test("introOrderFromContent: Choice-reviewId liefert die Einführungs-Position der Quest", () => {
  const quests = [
    { id: "qa", steps: [] as { type: string; reviewId?: string }[] },
    { id: "qb", steps: [{ type: "choice", reviewId: "k3" }] },
  ];
  const intro = introOrderFromContent(quests, [], []);
  expect(intro["k3"]).toBe(1); // Position von qb
});

/* ---- Red-Green: die reine Prüflogik muss Verstöße WIRKLICH fangen ---- */

test("Red-Green: zu früh freigeschaltete Karte wird gemeldet", () => {
  // Karte an Position 3 freigeschaltet, Konzept aber erst an Position 7 eingeführt.
  const v = lernpfadVerstoesse({ "q-ch2-4": 3 }, { "q-ch2-4": 7 });
  expect(v.length).toBe(1);
  expect(v[0]).toContain("q-ch2-4");
});

test("Red-Green: Karte ohne bekannte Einführungs-Quest wird gemeldet", () => {
  const v = lernpfadVerstoesse({ "q-neu": 2 }, {});
  expect(v).toEqual(["q-neu: keine Einführungs-Quest bekannt (chapter/introducedIn fehlt?)"]);
});

test("Red-Green: rechtzeitig freigeschaltete Karte ist KEIN Verstoß", () => {
  // gleiche Position (eingeführt == freigeschaltet) und später sind beide ok.
  expect(lernpfadVerstoesse({ a: 7 }, { a: 7 })).toEqual([]);
  expect(lernpfadVerstoesse({ a: 9 }, { a: 7 })).toEqual([]);
});
