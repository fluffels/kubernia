/* Sammelalbum / Glossar: pure Logik (#278).
 *
 * Prüft die DOM-/Phaser-freien Bausteine des Sammelalbums:
 *  - extractTaughtCommand: zieht NUR echte „🆕 Neuer Befehl:"-Intros, weist
 *    „kein neuer Befehl" / „neues Image"-Intros ab (Negativfälle, die zählen).
 *  - albumUnlocked: Freischaltung erst nach Quest 1 (Grenzfall 0 vs. 1).
 *  - buildAlbum: Gruppierung nach Thema, Sammel-Fortschritt, Befehls-Dedup und
 *    die Freischalt-Ableitung aus completedQuests (Befehle) bzw. review (Wissen),
 *    jeweils mit Positiv- UND Negativfall.
 *  - Vollständigkeit gegen den echten Content: jede Quiz-Karte landet im Album
 *    (keine verwaiste, unsammelbare Karte) und jeder Befehl hat eine Heimat.
 */
import { describe, it, expect } from "vitest";
import { buildAlbum, extractTaughtCommand, albumUnlocked, type AlbumUnlockState } from "../src/hud/album";
import { KQContent } from "../src/content";
import type { Quest, TeachStep, ChoiceStep } from "../src/types";
import type { QuizCard, QuestTopic } from "../src/content/loader";

function teach(id: string, intro: string, solution: string): TeachStep {
  return { type: "teach", brief: id, cmd: { id, intro, text: id, accept: [/x/], solution, hint: "" } };
}
function choice(reviewId: string): ChoiceStep {
  return { type: "choice", npc: "bo", q: "Frage?", options: [{ t: "a", ok: true, reply: "" }], reviewId };
}
function quest(id: string, topic: string, steps: Quest["steps"]): Quest {
  return { id, title: "Quest " + id, giver: "bo", topic, rewardXp: 0, rewardCoins: 0, steps };
}
function quiz(id: string, chapter?: string): QuizCard {
  return { id, q: "Wissen " + id, options: ["richtig", "falsch"], correct: 0, explain: "Erklärung " + id, ...(chapter && { chapter }) };
}

const TOPICS: QuestTopic[] = [
  { id: "docker", label: "Docker" },
  { id: "k8s", label: "Kubernetes" },
];

function emptyUnlock(): AlbumUnlockState {
  return { completedQuests: new Set(), reviewIds: new Set() };
}

describe("extractTaughtCommand (#278)", () => {
  it("zieht Befehl + Erklärung aus einem echten „Neuer Befehl:\"-Intro", () => {
    const r = extractTaughtCommand("🆕 Neuer Befehl: <code>docker pull</code> – lädt ein Image aus der Registry.");
    expect(r).toEqual({ command: "docker pull", explanation: "lädt ein Image aus der Registry." });
  });

  it("weist „Kein neuer Befehl\" ab (kein neuer Eintrag)", () => {
    expect(extractTaughtCommand("🆕 Kein neuer Befehl – <code>docker run</code> kennst du. Neu ist nur das Image.")).toBeNull();
  });

  it("weist „nur ein neues Image\" ab (kein neuer Befehl, nur anderes Argument)", () => {
    expect(extractTaughtCommand("🆕 Wieder nur ein neues Image: <code>redis</code>, der Cache.")).toBeNull();
  });
});

describe("albumUnlocked (#278)", () => {
  it("ist erst nach der ersten abgeschlossenen Quest frei", () => {
    expect(albumUnlocked(0)).toBe(false);
    expect(albumUnlocked(1)).toBe(true);
    expect(albumUnlocked(5)).toBe(true);
  });
});

describe("buildAlbum (#278)", () => {
  const quests: Quest[] = [
    quest("docker-1", "docker", [
      teach("t-pull", "🆕 Neuer Befehl: <code>docker pull</code> – lädt ein Image.", "docker pull nginx"),
      choice("q-d1"), // chapterlose Karte, über reviewId verankert
    ]),
    quest("k8s-1", "k8s", [
      teach("t-get", "🆕 Neuer Befehl: <code>kubectl get</code> – listet Ressourcen.", "kubectl get pods"),
      teach("t-pull-again", "🆕 Neuer Befehl: <code>docker pull</code> – Dublette, wird ignoriert.", "docker pull x"),
    ]),
  ];
  const cards: QuizCard[] = [quiz("q-d1"), quiz("q-k1", "k8s-1")];

  it("gruppiert Befehle & Wissen nach Thema, in Taxonomie-Reihenfolge", () => {
    const a = buildAlbum(quests, TOPICS, cards, emptyUnlock());
    expect(a.pages.map(p => p.id)).toEqual(["docker", "k8s"]);
    const docker = a.pages[0];
    expect(docker.entries.map(e => e.kind)).toEqual(["command", "knowledge"]);
    expect(docker.entries[0].title).toBe("docker pull");
    expect(docker.entries[0].example).toBe("docker pull nginx");
    expect(docker.entries[1].title).toBe("Wissen q-d1");
  });

  it("dedupliziert Befehle über Quests hinweg (erster Auftritt gewinnt)", () => {
    const a = buildAlbum(quests, TOPICS, cards, emptyUnlock());
    const allCmds = a.pages.flatMap(p => p.entries).filter(e => e.kind === "command");
    expect(allCmds.filter(e => e.title === "docker pull")).toHaveLength(1);
    // die Dublette im k8s-Topic darf NICHT erscheinen
    expect(a.pages[1].entries.map(e => e.title)).toEqual(["kubectl get", "Wissen q-k1"]);
  });

  it("zählt nichts als gesammelt, solange nichts freigeschaltet ist", () => {
    const a = buildAlbum(quests, TOPICS, cards, emptyUnlock());
    expect(a.collected).toBe(0);
    expect(a.total).toBe(4); // 2 Befehle + 2 Karten
    expect(a.pages.every(p => p.collected === 0)).toBe(true);
  });

  it("schaltet einen Befehl frei, sobald seine Heimat-Quest abgeschlossen ist (Positiv/Negativ)", () => {
    const a = buildAlbum(quests, TOPICS, cards, { completedQuests: new Set(["docker-1"]), reviewIds: new Set() });
    const pull = a.pages[0].entries.find(e => e.title === "docker pull")!;
    const get = a.pages[1].entries.find(e => e.title === "kubectl get")!;
    expect(pull.unlocked).toBe(true);   // docker-1 abgeschlossen
    expect(get.unlocked).toBe(false);   // k8s-1 NICHT abgeschlossen
  });

  it("schaltet Wissen frei, sobald die Karte im Review-Pool ist (Positiv/Negativ)", () => {
    const a = buildAlbum(quests, TOPICS, cards, { completedQuests: new Set(), reviewIds: new Set(["q-k1"]) });
    const k1 = a.pages[1].entries.find(e => e.id === "q-k1")!;
    const d1 = a.pages[0].entries.find(e => e.id === "q-d1")!;
    expect(k1.unlocked).toBe(true);
    expect(d1.unlocked).toBe(false);
    expect(a.collected).toBe(1);
  });

  it("lässt leere Themen als Seite weg", () => {
    const a = buildAlbum([quest("docker-1", "docker", [teach("t", "🆕 Neuer Befehl: <code>ls</code> – listet.", "ls")])], TOPICS, [], emptyUnlock());
    expect(a.pages.map(p => p.id)).toEqual(["docker"]); // k8s ist leer → keine Seite
  });
});

describe("buildAlbum gegen den echten Content (#278)", () => {
  const album = buildAlbum(KQContent.QUESTS, KQContent.QUEST_TOPICS, KQContent.CRAB_QUIZ, emptyUnlock());

  it("baut nicht-leere Seiten mit positivem Gesamt-Total", () => {
    expect(album.pages.length).toBeGreaterThan(0);
    expect(album.total).toBeGreaterThan(0);
  });

  it("nimmt JEDE Quiz-Karte ins Album auf (keine verwaiste, unsammelbare Karte)", () => {
    const knowledge = album.pages.flatMap(p => p.entries).filter(e => e.kind === "knowledge");
    const ids = new Set(knowledge.map(e => e.id));
    expect(ids.size).toBe(knowledge.length); // keine Dubletten
    expect(ids.size).toBe(KQContent.CRAB_QUIZ.length); // jede Karte hat eine Heimat-Quest
  });

  it("hält collected ≤ total auf jeder Seite und in Summe", () => {
    expect(album.collected).toBeLessThanOrEqual(album.total);
    expect(album.pages.every(p => p.collected <= p.total && p.total > 0)).toBe(true);
    expect(album.total).toBe(album.pages.reduce((s, p) => s + p.total, 0));
  });
});
