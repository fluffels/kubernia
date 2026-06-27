/* Tests für die Spiel-Logik (game.ts): Wirtschaft, XP/Rang, Shop, Spaced
 * Repetition. game.ts setzt beim Import (window as any).Game und nutzt
 * window.localStorage über store.ts – im Node-Lauf stubben wir window vorher
 * und importieren das Modul dann dynamisch.
 *
 * Bewusst auch Negativ-/Grenzfälle: kaputte Deployments verdienen nichts,
 * zu wenig Dublonen -> kein Kauf, falsche Antwort -> Box zurück auf 1.
 */
import { test, expect, beforeAll, beforeEach } from "vitest";
import { vi } from "vitest";
import { KQContent } from "../src/content";
import { NPC_SPAWNS, TILE, TALK_RANGE } from "../src/world";
import { setWorldScene } from "../src/runtime";
import { MAP_REGISTRY } from "../src/mapregistry";
import { DAY_CYCLE_MS } from "../src/clock";

let Game: typeof import("../src/game").Game;
let Sim: typeof import("../src/sim").Sim;
let SaveStore: typeof import("../src/store").SaveStore;
let THRESHOLD: number;
let CMD_HISTORY_AT: number;

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
  THRESHOLD = (await import("../src/game")).ABBREV_EARN_THRESHOLD;
  CMD_HISTORY_AT = (await import("../src/game")).CMD_HISTORY_UNLOCK_AT;
  ({ Sim } = await import("../src/sim"));
  ({ SaveStore } = await import("../src/store"));
});

beforeEach(() => {
  Game.reset();          // frischer Default-Spielstand (xp 0, coins 40)
  Game.sim = new Sim({}); // leerer Cluster als bekannte Basis
});

/* ---------- Audio-Einstellungen (#47) ---------- */

test("defaultState: Audio ist standardmäßig an, mit gesetzten Lautstärken", () => {
  expect(Game.state.audio).toEqual({ music: true, sfx: true, musicVol: 0.5, sfxVol: 0.8, track: "hafen" });
});

test("load: alter Spielstand OHNE audio-Feld bekommt die Audio-Defaults", () => {
  // Stand wie vor #47 gespeichert: keine audio-Eigenschaft.
  Game.importData(JSON.stringify({ v: 1, data: { xp: 5, coins: 99 } }));
  Game.load();
  expect(Game.state.coins).toBe(99);                 // Altdaten erhalten
  expect(Game.state.audio).toEqual({ music: true, sfx: true, musicVol: 0.5, sfxVol: 0.8, track: "hafen" });
});

test("load: kaputte/fremde audio-Werte fallen auf Defaults zurück bzw. werden geklemmt", () => {
  // music gültig (false bleibt), sfx falscher Typ -> Default true,
  // musicVol über 1 -> auf 1 geklemmt, sfxVol negativ -> auf 0 geklemmt.
  Game.importData(JSON.stringify({ v: 1, data: { audio: { music: false, sfx: "ja", musicVol: 5, sfxVol: -2 } } }));
  Game.load();
  expect(Game.state.audio).toEqual({ music: false, sfx: true, musicVol: 1, sfxVol: 0, track: "hafen" });
});

/* ---------- „Verdiente Abkürzungen": Freischalt-Mechanik (#287/#297) ---------- */
test("unlockedAbbrev: frischer Stand hat nichts freigeschaltet", () => {
  expect(Game.state.unlockedAbbrev).toEqual([]);
  expect(Game.isAbbrevUnlocked("-a")).toBe(false);
});

test("unlockAbbrev: schaltet gezielt frei, ist idempotent und persistiert über load()", () => {
  Game.unlockAbbrev("-a");
  expect(Game.isAbbrevUnlocked("-a")).toBe(true);
  expect(Game.isAbbrevUnlocked("-n")).toBe(false);     // nur das eine, nicht alles
  expect(Game.state.unlockedAbbrev).toEqual(["-a"]);
  Game.unlockAbbrev("-a");                              // nochmal -> kein Duplikat
  expect(Game.state.unlockedAbbrev).toEqual(["-a"]);
  // persistiert: neu laden liest den gesicherten Stand zurück
  Game.load();
  expect(Game.isAbbrevUnlocked("-a")).toBe(true);
});

test("Migration: Alt-Stand MIT Fortschritt ohne unlockedAbbrev wird grandfathered (alles frei)", () => {
  // Stand wie vor der Mechanik: Fortschritt vorhanden, Feld fehlt ganz.
  Game.importData(JSON.stringify({ v: 1, data: { xp: 120, questIdx: 5, completedQuests: ["docker-first-container", "docker-list-containers"] } }));
  Game.load();
  expect(Game.isAbbrevUnlocked("-a")).toBe(true);      // beliebige ID -> frei
  expect(Game.isAbbrevUnlocked("--irgendwas")).toBe(true);
  expect(Game.state.unlockedAbbrev).toEqual(["*"]);
});

test("Migration: Alt-Stand OHNE Fortschritt ohne unlockedAbbrev startet leer (kein Grandfather)", () => {
  Game.importData(JSON.stringify({ v: 1, data: { coins: 40 } }));   // coins=Default, kein echter Fortschritt
  Game.load();
  expect(Game.state.unlockedAbbrev).toEqual([]);
  expect(Game.isAbbrevUnlocked("-a")).toBe(false);
});

test("Migration: vorhandenes unlockedAbbrev-Feld wird übernommen (kein Pauschal-Unlock)", () => {
  Game.importData(JSON.stringify({ v: 1, data: { xp: 50, unlockedAbbrev: ["-a"] } }));
  Game.load();
  expect(Game.isAbbrevUnlocked("-a")).toBe(true);
  expect(Game.isAbbrevUnlocked("-n")).toBe(false);     // trotz Fortschritt NICHT grandfathered
  expect(Game.state.unlockedAbbrev).toEqual(["-a"]);
});

test("Migration: kaputtes unlockedAbbrev (kein Array) fällt auf leer zurück", () => {
  Game.importData(JSON.stringify({ v: 1, data: { xp: 50, unlockedAbbrev: "alles" } }));
  Game.load();
  expect(Game.state.unlockedAbbrev).toEqual([]);
});

/* ---------- „Verdiente Abkürzung" durch Nutzung: Zähler (#313) ---------- */
test("recordAbbrevLongFormUse: zählt unter der Schwelle und schaltet GENAU bei der Schwelle frei", () => {
  const id = "docker-ps-all";
  expect(Game.isAbbrevUnlocked(id)).toBe(false);
  for (let i = 1; i < THRESHOLD; i++) {
    expect(Game.recordAbbrevLongFormUse(id)).toBe(false);   // unter der Schwelle: nur zählen
    expect(Game.state.abbrevUsage[id]).toBe(i);
    expect(Game.isAbbrevUnlocked(id)).toBe(false);
  }
  expect(Game.recordAbbrevLongFormUse(id)).toBe(true);       // dieser Aufruf verdient sie
  expect(Game.isAbbrevUnlocked(id)).toBe(true);
});

test("recordAbbrevLongFormUse: bereits freigeschaltet → No-op, kein Weiterzählen", () => {
  const id = "docker-ps-all";
  Game.unlockAbbrev(id);
  expect(Game.recordAbbrevLongFormUse(id)).toBe(false);
  expect(Game.state.abbrevUsage[id]).toBeUndefined();        // gar nicht erst gezählt
});

test("recordAbbrevLongFormUse: grandfatherter Stand (*) zählt nicht", () => {
  Game.importData(JSON.stringify({ v: 1, data: { xp: 99 } }));   // → grandfathered "*"
  Game.load();
  expect(Game.recordAbbrevLongFormUse("docker-ps-all")).toBe(false);
  expect(Game.state.abbrevUsage["docker-ps-all"]).toBeUndefined();
});

test("Zähler persistiert über load()", () => {
  Game.recordAbbrevLongFormUse("docker-ps-all");
  Game.recordAbbrevLongFormUse("docker-ps-all");
  expect(Game.state.abbrevUsage["docker-ps-all"]).toBe(2);
  Game.load();
  expect(Game.state.abbrevUsage["docker-ps-all"]).toBe(2);
});

test("Migration: Alt-Stand ohne abbrevUsage → leerer Zähler; kaputte Werte werden gefiltert/geklemmt", () => {
  Game.importData(JSON.stringify({ v: 1, data: { xp: 5, unlockedAbbrev: [], abbrevUsage: { "docker-ps-all": 3, neg: -1, str: "nope", frac: 2.9 } } }));
  Game.load();
  expect(Game.state.abbrevUsage["docker-ps-all"]).toBe(3);
  expect(Game.state.abbrevUsage.neg).toBeUndefined();   // negativ raus
  expect(Game.state.abbrevUsage.str).toBeUndefined();   // falscher Typ raus
  expect(Game.state.abbrevUsage.frac).toBe(2);          // abgerundet
});

test("Migration: frischer Stand hat leeren Zähler", () => {
  Game.importData(JSON.stringify({ v: 1, data: { coins: 40 } }));
  Game.load();
  expect(Game.state.abbrevUsage).toEqual({});
});

/* ---------- Reset: Spielerposition (#295) ---------- */

test("reset: kehrt zur Default-Startposition zurück, auch wenn die WorldScene läuft", () => {
  // Default-Startposition (Spawn bei Ole, #288) bei sauberem Reset ohne laufende Szene.
  setWorldScene(null);
  Game.reset();
  const startPos = { ...Game.state.player };

  // Jetzt das laufende Spiel simulieren: die WorldScene lebt und meldet eine andere
  // Position (Spieler ist herumgelaufen, z.B. aufs Schiff). Beim echten Reset-Button
  // ist genau diese Szene noch da, wenn Game.reset() läuft.
  setWorldScene({ player: { x: 544, y: 496 }, nearestNpc: () => null, burstAtPlayer: () => {} });
  Game.reset();
  setWorldScene(null); // aufräumen für die übrigen Tests

  // Der Reset muss zur Startposition zurückführen – NICHT die Live-Position behalten.
  expect(Game.state.player).toEqual(startPos);
  // Und der persistierte Stand ebenso, sonst holt der reload in ui.resetGame die alte Position zurück.
  const saved = JSON.parse(SaveStore.read()!);
  expect(saved.data.player).toEqual(startPos);
});

test("Registry-Fallback-Spawn (harbor) zeigt auf denselben Ort wie der Spielstand-Default (Ole, #294)", () => {
  // spawnPlayer nutzt getMapEntry("harbor").spawn (in Kacheln, ×TILE) nur als Fallback,
  // falls keine gespeicherte Position existiert. Damit der Fallback NICHT wieder aufs
  // Schiff zeigt (alter Stand vor #288), muss er auf denselben Punkt führen wie der
  // Erststart-Default in game.ts. Dieser Wächter hält beide Quellen zusammen, falls der
  // immer-gesetzt-Guard in spawnPlayer je gelockert wird.
  setWorldScene(null);
  Game.reset();
  const spawn = MAP_REGISTRY.harbor.spawn;
  expect(spawn.x * TILE).toBe(Game.state.player.x);
  expect(spawn.y * TILE).toBe(Game.state.player.y);
});

/* ---------- Spiel-Feel: Cozy-Modus (#71) ---------- */

test("defaultState: Spiel-Feel steht standardmäßig auf 'normal'", () => {
  expect(Game.state.settings).toEqual({ events: "normal" });
});

test("load: alter Spielstand OHNE settings-Feld bekommt 'normal'", () => {
  // Stand wie vor #71 gespeichert: keine settings-Eigenschaft.
  Game.importData(JSON.stringify({ v: 1, data: { xp: 5, coins: 99 } }));
  Game.load();
  expect(Game.state.coins).toBe(99);                 // Altdaten erhalten
  expect(Game.state.settings).toEqual({ events: "normal" });
});

test("load: unbekannte/kaputte Spiel-Feel-Stufe fällt auf 'normal' zurück", () => {
  Game.importData(JSON.stringify({ v: 1, data: { settings: { events: "ultrahart" } } }));
  Game.load();
  expect(Game.state.settings.events).toBe("normal");
  // auch ganz falscher Typ:
  Game.importData(JSON.stringify({ v: 1, data: { settings: 42 } }));
  Game.load();
  expect(Game.state.settings.events).toBe("normal");
});

test("setEventMode: setzt gültige Stufe + persistiert, ignoriert Unsinn", () => {
  Game.setEventMode("cozy");
  expect(Game.state.settings.events).toBe("cozy");
  Game.load(); // aus dem Speicher neu laden -> beweist Persistenz
  expect(Game.state.settings.events).toBe("cozy");

  Game.setEventMode("quatsch" as never);
  expect(Game.state.settings.events).toBe("cozy"); // unveränderter Wert
});

test("eventProfile: normal/cozy/off liefern die richtigen Stellschrauben", () => {
  Game.setEventMode("normal");
  expect(Game.eventProfile()).toMatchObject({ enabled: true, malusFactor: 0, spawnScale: 1 });
  Game.setEventMode("cozy");
  expect(Game.eventProfile()).toMatchObject({ enabled: true, malusFactor: 0.5 });
  expect(Game.eventProfile().spawnScale).toBeGreaterThan(1); // seltener
  Game.setEventMode("off");
  expect(Game.eventProfile()).toMatchObject({ enabled: false, malusFactor: 1 });
  expect(Game.eventProfile().spawnScale).toBe(Infinity); // nie
});

test("incomeRate: Cozy mildert den Verdienst-Malus, Aus hebt ihn auf", () => {
  const cluster = {
    deployments: [
      { name: "gesund", image: "nginx", replicas: 2 },                          // 2 * 0.5 = 1.0
      { name: "kaputt", image: "x", replicas: 4, broken: { type: "imagepull" } }, // 4 Replicas
    ],
  };
  // normal: kaputte Replicas tragen 0 bei -> nur die 2 gesunden zählen.
  Game.setEventMode("normal");
  Game.sim = new Sim(cluster);
  expect(Game.incomeRate()).toBe(1.0);

  // cozy: kaputte zahlen halb -> (2 + 4*0.5) * 0.5 = (2 + 2) * 0.5 = 2.0
  Game.setEventMode("cozy");
  Game.sim = new Sim(cluster);
  expect(Game.incomeRate()).toBe(2.0);

  // off: kein Malus -> alle 6 Replicas zählen voll -> 6 * 0.5 = 3.0
  Game.setEventMode("off");
  Game.sim = new Sim(cluster);
  expect(Game.incomeRate()).toBe(3.0);
});

/* ---------- XP & Rang ---------- */

test("rankIndex: Schwellen greifen genau, nicht zu früh", () => {
  const letzterRang = KQContent.RANKS.length - 1; // abgeleitet, klebt nicht an fester Zahl
  expect(Game.rankIndex(0)).toBe(0);     // Landratte
  expect(Game.rankIndex(109)).toBe(0);   // eins UNTER Moses -> noch Landratte
  expect(Game.rankIndex(110)).toBe(1);   // genau Moses
  expect(Game.rankIndex(Number.MAX_SAFE_INTEGER)).toBe(letzterRang); // höchster Rang
});

test("addXp: meldet Rang-Aufstieg nur, wenn wirklich eine Schwelle überschritten wird", () => {
  Game.state.xp = 100;
  expect(Game.addXp(20)).toBe(true);   // 100 -> 120 überschreitet 110 (Moses)
  expect(Game.state.xp).toBe(120);     // XP wirklich addiert
  expect(Game.addXp(5)).toBe(false);   // 120 -> 125, keine neue Schwelle
  expect(Game.state.xp).toBe(125);
});

/* ---------- Wirtschaft ---------- */

test("incomeRate: gesunde Pods + Services zahlen, kaputte Deployments NICHT", () => {
  Game.sim = new Sim({
    deployments: [
      { name: "gesund", image: "nginx", replicas: 2 },
      { name: "kaputt", image: "x", replicas: 3, broken: { type: "imagepull" } },
    ],
  });
  // 2 gesunde Replicas * 0.5 = 1.0; kaputte 3 Replicas tragen 0 bei
  expect(Game.incomeRate()).toBe(1.0);

  Game.sim = new Sim({
    deployments: [{ name: "gesund", image: "nginx", replicas: 2 }],
    services: [{ name: "gesund", type: "ClusterIP", clusterIP: "10.96.0.2", port: 80 }],
  });
  expect(Game.incomeRate()).toBe(2.0); // 1.0 aus Pods + 1 aus Service
});

test("economyTick: zahlt erst ganze Dublonen aus und schreibt sie gut", () => {
  Game.sim = new Sim({ deployments: [{ name: "a", image: "nginx", replicas: 2 }] });
  // incomeRate 1.0/min -> pro Sekunde 1/60. Ein kurzer Tick zahlt noch nichts.
  expect(Game.economyTick(1)).toBe(0);
  const coinsVorher = Game.state.coins;
  // Großer Tick (120 s) -> >= 2 Dublonen fällig
  const payout = Game.economyTick(120);
  expect(payout).toBeGreaterThanOrEqual(2);
  expect(Game.state.coins).toBe(coinsVorher + payout);
});

test("addCoins: Streak-Multiplikator wirkt und ist bei 10 gedeckelt", () => {
  Game.state.streak.count = 0;
  expect(Game.addCoins(100)).toBe(100);   // Faktor 1.0
  Game.state.streak.count = 10;
  expect(Game.addCoins(100)).toBe(150);   // Faktor 1.5
  Game.state.streak.count = 25;           // über dem Deckel
  expect(Game.addCoins(100)).toBe(150);   // weiterhin 1.5, nicht mehr
});

/* ---------- Shop ---------- */

test("buy: scheitert bei zu wenig Dublonen, ohne etwas abzubuchen", () => {
  Game.state.coins = 10; // Fernrohr kostet 25
  const res = Game.buy("fernrohr");
  expect(res.ok).toBe(false);
  expect(Game.state.coins).toBe(10);                 // nichts abgezogen
  expect(Game.state.inventory["fernrohr"]).toBeFalsy();
});

test("buy: Verbrauchsgut wird gekauft, Dublonen abgezogen, Inventar erhöht", () => {
  Game.state.coins = 100;
  const res = Game.buy("fernrohr");
  expect(res.ok).toBe(true);
  expect(Game.state.coins).toBe(75);                 // 100 - 25
  expect(Game.state.inventory["fernrohr"]).toBe(1);
});

test("buy: nicht-verbrauchbare Ware lässt sich nicht doppelt kaufen", () => {
  Game.state.coins = 1000;
  expect(Game.buy("pet-ratte").ok).toBe(true);       // Haustier (150)
  const zweiter = Game.buy("pet-ratte");
  expect(zweiter.ok).toBe(false);                    // schon im Besitz
  expect(zweiter.msg).toMatch(/schon/i);
});

test("useConsumable: ohne Bestand false, mit Bestand true + Dekrement", () => {
  expect(Game.useConsumable("fernrohr")).toBe(false); // nichts da
  Game.state.inventory["fernrohr"] = 2;
  expect(Game.useConsumable("fernrohr")).toBe(true);
  expect(Game.state.inventory["fernrohr"]).toBe(1);
});

/* ---------- Spaced Repetition (Leitner) ---------- */

test("reviewResult: richtig schiebt die Box hoch (max 5), falsch setzt auf 1 zurück", () => {
  Game.ensureReviewItem("k1");
  expect(Game.state.review["k1"].box).toBe(1);
  Game.reviewResult("k1", true);
  expect(Game.state.review["k1"].box).toBe(2);       // richtig -> hoch
  Game.reviewResult("k1", false);
  expect(Game.state.review["k1"].box).toBe(1);       // falsch -> komplett zurück

  // Deckel bei 5
  for (let i = 0; i < 10; i++) Game.reviewResult("k1", true);
  expect(Game.state.review["k1"].box).toBe(5);
});

test("dueReviewItems: liefert nur fällige Karten, niedrigste Box zuerst", () => {
  const heute = Game.state.streak.lastDay; // today() wurde beim reset gesetzt
  // fällig, hohe Box
  Game.state.review["spaeter"] = { box: 4, due: heute };
  // fällig, niedrige Box -> soll zuerst kommen
  Game.state.review["zuerst"] = { box: 1, due: heute };
  // NICHT fällig (Zukunft) -> darf nicht auftauchen
  Game.state.review["nicht-faellig"] = { box: 1, due: heute + 5 };

  const due = Game.dueReviewItems(10);
  expect(due).toContain("zuerst");
  expect(due).toContain("spaeter");
  expect(due).not.toContain("nicht-faellig"); // Negativfall
  expect(due.indexOf("zuerst")).toBeLessThan(due.indexOf("spaeter")); // Sortierung
});

test("freeReviewItems: liefert ALLE Karten (auch nicht fällige) und ändert den SR-Plan nicht", () => {
  const heute = Game.state.streak.lastDay;
  Game.state.review["faellig"] = { box: 1, due: heute };
  Game.state.review["nicht-faellig"] = { box: 3, due: heute + 5 };

  const free = Game.freeReviewItems(10);
  expect(free).toContain("faellig");
  expect(free).toContain("nicht-faellig");           // Kern: nicht-fällige Karten sind beim freien Üben dabei
  expect(free.length).toBe(2);
  for (const id of free) expect(Game.state.review[id]).toBeTruthy(); // nur echte Karten

  // read-only: Box/Fälligkeit dürfen sich NICHT verändert haben
  expect(Game.state.review["nicht-faellig"].box).toBe(3);
  expect(Game.state.review["nicht-faellig"].due).toBe(heute + 5);

  // limit deckelt die Anzahl
  expect(Game.freeReviewItems(1).length).toBe(1);
});

test("registerQuestCards: schaltet die chapter-Karten der Quest frei (Single Source #412)", () => {
  // q-tools-stack/-monitoring tragen chapter=helm-intro (die frühere EXTRA_CARDS-Hand-Map
  // ist entfallen) → sie kommen beim Abschluss von helm-intro in den Pool.
  Game.registerQuestCards("helm-intro");
  expect(Game.state.review["q-tools-stack"]).toBeTruthy();
  expect(Game.state.review["q-tools-monitoring"]).toBeTruthy();
});

test("registerQuestCards: q-ts-4 (Debug-Mantra) kommt über sein chapter in den Pool (#412)", () => {
  // q-ts-4 war die einzige Pool-Karte ohne `chapter` und hing an EXTRA_CARDS["k8s-debug-imagepull"];
  // seine Choice-reviewId steht erst in der späteren Quest k8s-node-capacity. Seit #412 trägt es
  // chapter=k8s-debug-imagepull als Single Source – sonst rutschte die Freischaltung 2 Quests nach hinten.
  Game.registerQuestCards("k8s-debug-imagepull");
  expect(Game.state.review["q-ts-4"]).toBeTruthy();
});

test("registerQuestCards: die Baustein-Karten (#231) landen an ihrer Einführungs-Quest", () => {
  const cases: [string, string][] = [
    ["docker-list-containers", "q-flag-ps-a"], ["docker-run-options", "q-flag-run-d"], ["docker-run-options", "q-flag-run-name"],
    ["k8s-inspect-pods", "q-flag-kubectl-n"], ["k8s-apply-manifests", "q-flag-apply-f"], ["helm-upgrade-rollback", "q-flag-helm-set"],
    ["git-version-control", "q-flag-git-commit-m"], ["git-feature-branch", "q-flag-git-checkout-b"], ["git-pipeline", "q-flag-git-add-dot"],
  ];
  for (const [quest, card] of cases) {
    Game.reset();
    Game.registerQuestCards(quest);
    expect(Game.state.review[card], `${card} fehlt nach registerQuestCards(${quest})`).toBeTruthy();
  }
});

test("jede über alle Quests freigeschaltete Wiederholungskarte löst zu echtem Inhalt auf (#231)", () => {
  // Schaltet alles frei, was der Spieler im Lauf der Story je gesammelt hätte
  // (Choice-reviewIds + chapter-Karten aus CMD_CARDS/CRAB_QUIZ – Single Source #412).
  // Jeder Eintrag MUSS eine echte Karte sein – sonst zeigt Kralle eine leere Karte.
  // Fängt Tippfehler in chapter/reviewId, bevor sie im Spiel auffallen.
  for (const q of KQContent.QUESTS) Game.registerQuestCards(q.id);
  const unbekannt = Object.keys(Game.state.review).filter(id => !Game.findReviewContent(id));
  expect(unbekannt, "Wiederholungs-IDs ohne Inhalt: " + unbekannt.join(", ")).toEqual([]);
});

test("Red-Green: eine Wiederholungskarte ohne Inhalt wird erkannt", () => {
  // Ein Check, der auch bei einer Geister-ID grün bliebe, wäre wertlos.
  Game.ensureReviewItem("q-gibt-es-nicht");
  const unbekannt = Object.keys(Game.state.review).filter(id => !Game.findReviewContent(id));
  expect(unbekannt).toContain("q-gibt-es-nicht");
});

/* ---------- Defensive Validierung beim Laden (#61) ----------
 * Ein manipulierter Import oder ein über viele Versionen gewanderter Stand kann
 * kaputte/fremde Feldwerte tragen. load() muss daraus IMMER einen konsistenten
 * State machen (kein Crash, keine NaN-Münzen), statt den Müll zu übernehmen.
 * lastSeen wird in den Tests auf 0 gesetzt, damit keine Offline-Einnahmen die
 * geprüften Münzen verändern.
 *
 * Red-Green: mit dem früheren Object.assign(makeDefaultState(), data) blieben
 * String-Münzen, Fremd-Einträge und kaputte Review-Einträge stehen – diese
 * Tests wären rot. */

test("load: kaputte Zahlenfelder (String-Münzen, negative XP) fallen auf Defaults zurück", () => {
  SaveStore.writeState({
    coins: "viel",   // falscher Typ -> KEINE String/NaN-Münzen
    xp: -50,         // negativ = unplausibel
    questIdx: -3,    // negativer Index
    taskIdx: 2.7,    // krumm -> abgerundet
    lastSeen: 0,     // keine Offline-Einnahmen
  } as Parameters<typeof SaveStore.writeState>[0]);
  Game.load();

  expect(Game.state.coins).toBe(40);              // Default, sauber
  expect(Number.isFinite(Game.state.coins)).toBe(true);
  expect(Game.state.xp).toBe(0);
  expect(Game.state.questIdx).toBe(0);
  expect(Game.state.taskIdx).toBe(2);             // 2.7 -> 2 (ganzzahliger Index)
});

test("load: kaputte Sammlungen/Typen werden gefiltert oder verworfen", () => {
  SaveStore.writeState({
    completedQuests: "docker-first-container,docker-list-containers",                       // String statt Array
    owned: ["pet-1", 42, null, "flag"],             // fremde Einträge
    inventory: { potion: 3, ghost: -1, bad: "x" },  // negativ/Nicht-Zahl raus
    character: "Hans",                              // soll number|null sein
    activePet: 7,                                   // soll string|null sein
    review: { good: { box: 2, due: 5 }, bad: "kaputt", over: { box: 99, due: 1 } },
    lastSeen: 0,
  } as Parameters<typeof SaveStore.writeState>[0]);
  Game.load();

  expect(Game.state.completedQuests).toEqual([]);          // String war kein Array
  expect(Game.state.owned).toEqual(["pet-1", "flag"]);     // nur Strings bleiben
  expect(Game.state.inventory).toEqual({ potion: 3 });     // negativ/Nicht-Zahl entfernt
  expect(Game.state.character).toBe(null);                 // falscher Typ -> null
  expect(Game.state.activePet).toBe(null);                 // falscher Typ -> null
  expect(Game.state.review.good).toEqual({ box: 2, due: 5 });
  expect(Game.state.review.bad).toBeUndefined();           // kaputter Eintrag verworfen
  expect(Game.state.review.over.box).toBe(5);              // box auf 1..5 geklemmt
});

test("load: völlig kaputter Stand (kein Objekt) startet sauber mit Defaults, kein Crash", () => {
  SaveStore.write(JSON.stringify({ v: 1, data: 12345 })); // data ist eine Zahl, kein State
  Game.load();
  expect(Game.state.coins).toBe(40);
  expect(Game.state.xp).toBe(0);
  expect(Array.isArray(Game.state.owned)).toBe(true);
});

test("load: ein VOLLSTÄNDIG valider Stand überlebt unverändert (kein Over-Sanitizing)", () => {
  SaveStore.writeState({
    xp: 320, coins: 99, character: 2, player: { x: 100, y: 200 },
    questIdx: 4, questStep: 1, taskIdx: 0,
    completedQuests: ["docker-first-container", "docker-list-containers"], inventory: { potion: 2 }, owned: ["pet-cat"],
    activePet: "pet-cat", activeFlag: null,
    review: { "q-ch1-1": { box: 3, due: 10 } },
    streak: { count: 5, lastDay: 999999 }, streakHintShown: true,
    stats: { commands: 10, reviews: 4, quizRight: 7, quizWrong: 2, piratesBeaten: 1, krakenBeaten: 0, stackBest: 30, stormsFixed: 3 },
    lastSeen: 0, clusterSnapshot: null,
  } as Parameters<typeof SaveStore.writeState>[0]);
  Game.load();

  expect(Game.state.xp).toBe(320);
  expect(Game.state.coins).toBe(99);
  expect(Game.state.character).toBe(2);
  expect(Game.state.player).toEqual({ x: 100, y: 200 });
  expect(Game.state.questIdx).toBe(4);
  expect(Game.state.completedQuests).toEqual(["docker-first-container", "docker-list-containers"]);
  expect(Game.state.owned).toEqual(["pet-cat"]);
  expect(Game.state.inventory).toEqual({ potion: 2 });
  expect(Game.state.review["q-ch1-1"]).toEqual({ box: 3, due: 10 });
  expect(Game.state.streakHintShown).toBe(true);
  expect(Game.state.stats.stackBest).toBe(30);
  expect(Game.state.stats.stormsFixed).toBe(3);            // dynamische Zusatz-Stat bleibt
  expect(Game.state.introSeen).toBe(false);                // ohne Feld -> Default (Intro kommt noch)
});

test("introSeen (#288): Default ist false, valider Wert überlebt, kaputter fällt zurück", () => {
  // Frischer Stand: Intro noch nicht gesehen.
  Game.reset();
  expect(Game.state.introSeen).toBe(false);

  // Spieler hat das Intro gesehen -> bleibt true über Laden/Speichern.
  Game.importData(JSON.stringify({ v: 1, data: { introSeen: true } }));
  Game.load();
  expect(Game.state.introSeen).toBe(true);

  // Kaputter (nicht-boolescher) Wert fällt auf den Default false zurück.
  Game.importData(JSON.stringify({ v: 1, data: { introSeen: "ja" } }));
  Game.load();
  expect(Game.state.introSeen).toBe(false);
});

/* ---------- Befehlshistorie freischalten (#316) ---------- */

test("cmdHistoryUnlocked (#316): Default false, Alt-Stand ohne Feld bleibt gesperrt, kaputt -> false", () => {
  // Frischer Stand: Historie noch gesperrt.
  Game.reset();
  expect(Game.state.cmdHistoryUnlocked).toBe(false);
  expect(Game.isCmdHistoryUnlocked()).toBe(false);

  // Alt-Stand OHNE das Feld (von vor #316) darf nicht brechen -> Default gesperrt.
  Game.importData(JSON.stringify({ v: 3, data: { xp: 50, questIdx: 3 } }));
  Game.load();
  expect(Game.state.cmdHistoryUnlocked).toBe(false);

  // Freigeschalteter Stand überlebt Laden/Speichern.
  Game.importData(JSON.stringify({ v: 3, data: { cmdHistoryUnlocked: true } }));
  Game.load();
  expect(Game.state.cmdHistoryUnlocked).toBe(true);

  // Kaputter (nicht-boolescher) Wert fällt auf den Default false zurück.
  Game.importData(JSON.stringify({ v: 3, data: { cmdHistoryUnlocked: "ja" } }));
  Game.load();
  expect(Game.state.cmdHistoryUnlocked).toBe(false);
});

test("maybeUnlockCmdHistory (#316): schaltet erst an der Schwelle frei, dann idempotent", () => {
  Game.reset();
  // Unter der Schwelle: kein Freischalten.
  Game.state.stats.commands = CMD_HISTORY_AT - 1;
  expect(Game.maybeUnlockCmdHistory()).toBe(false);
  expect(Game.isCmdHistoryUnlocked()).toBe(false);

  // Schwelle erreicht: GENAU dieser Aufruf schaltet frei (true für die einmalige Feier).
  Game.state.stats.commands = CMD_HISTORY_AT;
  expect(Game.maybeUnlockCmdHistory()).toBe(true);
  expect(Game.isCmdHistoryUnlocked()).toBe(true);

  // Danach idempotent: kein zweites Mal feiern.
  expect(Game.maybeUnlockCmdHistory()).toBe(false);

  // Bleibt über einen Reload erhalten (persistiert).
  Game.load();
  expect(Game.state.cmdHistoryUnlocked).toBe(true);
});

test("Erststart-Spawn (#288): neuer Spielstand startet in Redeweite neben Ole", () => {
  Game.reset();
  const ole = NPC_SPAWNS.find(s => s.id === "ole")!;
  // Anker wie in scenes.ts nearestNpc(): NPC-Kachel-Mitte (x*T+8, y*T+8).
  const ax = ole.x * TILE + 8, ay = ole.y * TILE + 8;
  const d = Math.hypot(ax - Game.state.player.x, ay - Game.state.player.y);
  // In Redeweite -> der "!"-Marker/Prompt ist sofort da, der Erst-Dialog holt ab.
  expect(d).toBeLessThan(TALK_RANGE);
});

test("Wiederholungs-Gate (#222): greift nur am Quest-Anfang, wenn Karten fällig sind", () => {
  Game.state.questStep = 0;
  // Keine fälligen Karten -> kein Gate (blockiert nicht)
  expect(Game.shouldReviewGate()).toBe(false);
  // Eine fällige Karte (due in der Vergangenheit) am Quest-Anfang -> Gate
  Game.state.review["q-ch1-1"] = { box: 1, due: 0 };
  expect(Game.dueReviewItems().length).toBeGreaterThan(0);
  expect(Game.shouldReviewGate()).toBe(true);
  // Mitten in der Quest (Schritt > 0) -> NICHT unterbrechen
  Game.state.questStep = 3;
  expect(Game.shouldReviewGate()).toBe(false);
});

test("Wiederholungs-Gate (#222): nicht fällige Karten blockieren nicht", () => {
  Game.state.questStep = 0;
  Game.state.review["q-ch1-1"] = { box: 3, due: 9_999_999 }; // weit in der Zukunft
  expect(Game.dueReviewItems().length).toBe(0);
  expect(Game.shouldReviewGate()).toBe(false);
});

test("Wiederholungs-Gate (#222): nach der letzten Quest kein Gate", () => {
  Game.state.questStep = 0;
  Game.state.review["q-ch1-1"] = { box: 1, due: 0 };
  Game.state.questIdx = KQContent.QUESTS.length; // alle Quests durch
  expect(Game.currentQuest()).toBe(null);
  expect(Game.shouldReviewGate()).toBe(false);
});

test("#323 Quest-Count-Gate: feuert nach ≥ 3 Quests wenn Karten vorhanden (nicht fällig)", () => {
  Game.state.questStep = 0;
  Game.state.questsSinceGate = 3;
  // Karte vorhanden, aber noch nicht fällig
  Game.state.review["q-ch1-1"] = { box: 3, due: 9_999_999 };
  expect(Game.dueReviewItems().length).toBe(0); // keine fälligen
  expect(Game.shouldReviewGate()).toBe(true);   // aber Quest-Count-Gate greift
});

test("#323 Quest-Count-Gate: feuert NICHT nach < 3 Quests ohne fällige Karten", () => {
  Game.state.questStep = 0;
  Game.state.questsSinceGate = 2;
  Game.state.review["q-ch1-1"] = { box: 3, due: 9_999_999 };
  expect(Game.shouldReviewGate()).toBe(false);
});

test("#323 Quest-Count-Gate: feuert NICHT wenn review-Dict leer (gar nichts gelernt)", () => {
  Game.state.questStep = 0;
  Game.state.questsSinceGate = 5;
  Game.state.review = {};
  expect(Game.shouldReviewGate()).toBe(false);
});

/* ---------- Dev-/Test-Sprung: jumpToQuest / getQuestRoadmap (#329) ----------
 * Grundlage fürs Dev-Panel (#325): zu einem beliebigen Quest-Stand springen,
 * statt sich von vorn durchzuspielen. Granularität pro Quest (questStep 0). */

test("getQuestRoadmap: leitet ALLE Quests aus dem Content ab, mit den erwarteten Feldern", () => {
  const roadmap = Game.getQuestRoadmap();
  expect(roadmap.length).toBe(KQContent.QUESTS.length); // abgeleitet, nicht handgepflegt
  roadmap.forEach((entry, i) => {
    const q = KQContent.QUESTS[i];
    expect(entry).toMatchObject({ idx: i, id: q.id, title: q.title, giver: q.giver, steps: q.steps.length });
    expect(typeof entry.giverName).toBe("string");
  });
});

test("getQuestRoadmap: completed spiegelt den Spielstand (vorher nichts, nach Sprung die vorherigen)", () => {
  expect(Game.getQuestRoadmap().every(e => !e.completed)).toBe(true); // frischer Stand
  Game.jumpToQuest(3); // Sprung an den Anfang von Quest 3 -> Quests 0..2 erledigt
  const roadmap = Game.getQuestRoadmap();
  expect(roadmap.slice(0, 3).every(e => e.completed)).toBe(true);
  expect(roadmap[3].completed).toBe(false);
});

test("jumpToQuest: gültiger Index setzt Quest-Stand + completedQuests + Spawn beim Giver", () => {
  setWorldScene(null); // sonst überschreibt save() die gesetzte Spielerposition
  expect(Game.jumpToQuest(3)).toBe(true);
  expect(Game.state.questIdx).toBe(3);
  expect(Game.state.questStep).toBe(0);
  expect(Game.state.taskIdx).toBe(0);
  // genau die Quests VOR dem Ziel gelten als erledigt
  expect(Game.state.completedQuests).toEqual(KQContent.QUESTS.slice(0, 3).map(q => q.id));
  // Figur steht beim Giver der Zielquest (sofern fester Standplatz existiert)
  const spawn = NPC_SPAWNS.find(s => s.id === KQContent.QUESTS[3].giver);
  if (spawn) expect(Game.state.player).toEqual({ x: spawn.x * TILE, y: spawn.y * TILE });
});

test("jumpToQuest(0): leerer Stand, keine Quest erledigt", () => {
  Game.jumpToQuest(5);                       // erst woanders hin
  expect(Game.jumpToQuest(0)).toBe(true);
  expect(Game.state.questIdx).toBe(0);
  expect(Game.state.completedQuests).toEqual([]);
});

test("jumpToQuest(QUESTS.length): erlaubter Endzustand -> allQuestsDone, alle erledigt", () => {
  const end = KQContent.QUESTS.length;
  expect(Game.jumpToQuest(end)).toBe(true);
  expect(Game.state.questIdx).toBe(end);
  expect(Game.allQuestsDone()).toBe(true);
  expect(Game.currentQuest()).toBeNull();
  expect(Game.state.completedQuests.length).toBe(end);
});

test("jumpToQuest: ungültiger Index -> false, Stand bleibt unverändert", () => {
  Game.jumpToQuest(2);                       // bekannter Ausgangsstand
  const before = JSON.stringify(Game.state);
  for (const bad of [-1, KQContent.QUESTS.length + 1, 1.5, NaN, Infinity]) {
    expect(Game.jumpToQuest(bad)).toBe(false);
  }
  expect(JSON.stringify(Game.state)).toBe(before); // nichts angefasst
});

test("jumpToQuest: Sprung persistiert (load() liest denselben Quest-Stand zurück)", () => {
  setWorldScene(null);
  Game.jumpToQuest(4);
  Game.load();
  expect(Game.state.questIdx).toBe(4);
  expect(Game.state.completedQuests).toEqual(KQContent.QUESTS.slice(0, 4).map(q => q.id));
});

test("jumpToQuest: Giver-Position überlebt eine LAUFENDE WorldScene (#335, gleiche Falle wie #295)", () => {
  // Repro des über das Dev-Panel (#325) gemeldeten Bugs: Beim Sprung lebt die WorldScene
  // noch und meldet die AKTUELLE Spielerposition. save() übernahm diese und überschrieb
  // damit die gerade gesetzte Giver-Position – nach dem reload stand man wieder am alten
  // Ort statt beim Quest-Giver (dieselbe Falle wie der Reset-Position-Bug #295/#296).
  // Mit lebender Szene an FALSCHER Position springen und prüfen, dass RAM- UND
  // persistierter Stand beim Giver liegen. (Der vorige #329-Test umging das per
  // setWorldScene(null) und konnte den Bug deshalb nicht fangen – False Positive.)
  const spawn = NPC_SPAWNS.find(s => s.id === KQContent.QUESTS[3].giver)!;
  expect(spawn).toBeTruthy(); // Quest 3 hat einen festen Giver-Standplatz
  const giverPos = { x: spawn.x * TILE, y: spawn.y * TILE };

  setWorldScene({ player: { x: 9999, y: 9999 }, nearestNpc: () => null, burstAtPlayer: () => {} });
  expect(Game.jumpToQuest(3)).toBe(true);
  setWorldScene(null); // aufräumen für die übrigen Tests

  // Im RAM steht die Figur beim Giver – NICHT an der Live-Position der Szene.
  expect(Game.state.player).toEqual(giverPos);
  // Und der persistierte Stand ebenso, sonst holt der reload die alte Position zurück.
  const saved = JSON.parse(SaveStore.read()!);
  expect(saved.data.player).toEqual(giverPos);
});

/* ---------- #353: Quest-Fortschritt per ID statt Zahl-Index (Save-Robustheit) ----------
 * Persistiert wird die Quest-ID (currentQuestId); der numerische questIdx ist nur noch ein
 * abgeleiteter Laufzeitwert. So verschiebt das Einfügen/Umsortieren von Quests keinen
 * bestehenden Fortschritt mehr. Alt-Stände ohne currentQuestId werden aus questIdx migriert.
 * Niemand verliert beim Update seinen Stand. */

test("#353 currentQuestId: frischer Stand zeigt auf die erste Quest", () => {
  Game.reset();
  expect(Game.state.questIdx).toBe(0);
  expect(Game.state.currentQuestId).toBe(KQContent.QUESTS[0].id);
});

test("#353 Migration: Alt-Stand OHNE currentQuestId leitet die ID aus dem questIdx ab", () => {
  // Stand wie vor #353: nur numerischer Index, kein currentQuestId.
  Game.importData(JSON.stringify({ v: 1, data: { xp: 50, questIdx: 3 } }));
  Game.load();
  expect(Game.state.questIdx).toBe(3);                       // Index erhalten
  expect(Game.state.currentQuestId).toBe(KQContent.QUESTS[3].id); // ID ergänzt
});

test("#353 Autorität ID: bei veraltetem questIdx gewinnt currentQuestId (Quest-Einfügen bricht nichts)", () => {
  // Kernschutz: der gespeicherte Zahl-Index ist veraltet (0, z.B. weil vorher Quests
  // eingeschoben wurden), currentQuestId zeigt aber auf die Quest, die AKTUELL an Index 3
  // steht. Nach dem Laden muss der Fortschritt bei DIESER Quest liegen (Index 3 aufgelöst),
  // nicht beim veralteten Zahl-Index 0.
  const ziel = KQContent.QUESTS[3].id;
  Game.importData(JSON.stringify({ v: 2, data: { xp: 50, questIdx: 0, currentQuestId: ziel } }));
  Game.load();
  expect(Game.state.questIdx).toBe(3);
  expect(Game.state.currentQuestId).toBe(ziel);
});

test("#353 unbekannte currentQuestId (Quest entfernt) -> Fallback auf questIdx, kein Verlust", () => {
  Game.importData(JSON.stringify({ v: 2, data: { questIdx: 2, currentQuestId: "gibt-es-nicht-mehr" } }));
  Game.load();
  expect(Game.state.questIdx).toBe(2);                       // Fallback rettet den Fortschritt
  expect(Game.state.currentQuestId).toBe(KQContent.QUESTS[2].id); // kanonisiert auf die echte ID
});

test("#353 Endzustand: alle Quests durch -> currentQuestId leer, round-trippt", () => {
  setWorldScene(null);
  const end = KQContent.QUESTS.length;
  Game.jumpToQuest(end);
  expect(Game.state.currentQuestId).toBe("");
  Game.load(); // persistiert + zurückgelesen
  expect(Game.state.questIdx).toBe(end);
  expect(Game.state.currentQuestId).toBe("");
  expect(Game.allQuestsDone()).toBe(true);
});

test("#353 jumpToQuest hält currentQuestId synchron zum Index (auch über load)", () => {
  setWorldScene(null);
  Game.jumpToQuest(5);
  expect(Game.state.currentQuestId).toBe(KQContent.QUESTS[5].id);
  Game.load();
  expect(Game.state.questIdx).toBe(5);
  expect(Game.state.currentQuestId).toBe(KQContent.QUESTS[5].id);
});

test("#353 advanceStep: Quest-Abschluss zieht currentQuestId auf die nächste Quest", () => {
  setWorldScene(null);
  Game.jumpToQuest(0);
  const stepCount = KQContent.QUESTS[0].steps.length;
  let result: ReturnType<typeof Game.advanceStep> = {};
  for (let i = 0; i < stepCount; i++) result = Game.advanceStep();
  expect(result).toMatchObject({ questDone: KQContent.QUESTS[0] }); // Quest 0 abgeschlossen
  expect(Game.state.questIdx).toBe(1);
  expect(Game.state.currentQuestId).toBe(KQContent.QUESTS[1].id);
});

/* ---------- #354: Save-Migration alter (numerischer) Quest-IDs -> sprechende Slugs ----------
 * Quest-IDs sind in Spielständen persistiert (completedQuests + currentQuestId). Beim Umbenennen
 * darf KEIN bestehender Stand brechen: alte IDs (q5, q14, q2b …) werden beim Laden auf die neuen
 * Slugs gehoben. Bestehende Spieler behalten ihren exakten Fortschritt. */

test("#354 Migration: Alt-Stand (post-#353) mit alten IDs -> neue Slugs, Fortschritt bleibt", () => {
  // Stand vor #354: completedQuests + currentQuestId tragen alte numerische IDs.
  Game.importData(JSON.stringify({ v: 2, data: { xp: 100, questIdx: 7, completedQuests: ["q0", "q1", "q2", "q2b", "q3", "q3b", "q4"], currentQuestId: "q5" } }));
  Game.load();
  // currentQuestId auf neuen Slug gemappt, Index folgt der ID (q5 = k8s-inspect-pods,
  // durch die Einschübe #448 docker-common-images und #449 docker-registry jetzt Index 9):
  expect(Game.state.currentQuestId).toBe("k8s-inspect-pods");
  expect(Game.state.questIdx).toBe(9);
  // completedQuests vollständig auf neue Slugs gehoben – nichts verloren:
  expect(Game.state.completedQuests).toEqual([
    "onboarding-sign-on", "docker-first-container", "docker-list-containers",
    "docker-stack-minigame", "docker-run-options", "docker-build-image", "k8s-first-deployment",
  ]);
});

test("#354 Migration: Alt-Stand (pre-#353, nur questIdx) mit alten completedQuests migriert auch", () => {
  // Noch älter: kein currentQuestId, Fortschritt nur über questIdx + alte completedQuests.
  Game.importData(JSON.stringify({ v: 1, data: { xp: 50, questIdx: 2, completedQuests: ["q0", "q1"] } }));
  Game.load();
  expect(Game.state.questIdx).toBe(2);
  expect(Game.state.currentQuestId).toBe("docker-common-images"); // Index 2 -> neuer Slug (Warenkunde-Einschub #448)
  expect(Game.state.completedQuests).toEqual(["onboarding-sign-on", "docker-first-container"]);
});

test("#354 Migration: ein eingeschobener alter Slug (q2b/q26) wird korrekt übersetzt", () => {
  // q2b und q26 sind Einschübe – ihre Reihenfolge kommt aus quest-order.json, nicht der Nummer.
  Game.importData(JSON.stringify({ v: 2, data: { questIdx: 3, completedQuests: ["q14", "q26"], currentQuestId: "q2b" } }));
  Game.load();
  expect(Game.state.currentQuestId).toBe("docker-stack-minigame");          // q2b
  expect(Game.state.completedQuests).toEqual(["kraken-boss", "k8s-configmap-secret"]); // q14, q26
});

test("#354 Migration: neue Slugs bleiben unverändert (idempotent, kein Doppel-Mapping)", () => {
  // Ein bereits migrierter Stand (neue Slugs) darf nicht erneut angefasst werden.
  Game.importData(JSON.stringify({ v: 3, data: { questIdx: 9, completedQuests: ["onboarding-sign-on", "docker-first-container"], currentQuestId: "k8s-inspect-pods" } }));
  Game.load();
  expect(Game.state.currentQuestId).toBe("k8s-inspect-pods");
  expect(Game.state.questIdx).toBe(9);
  expect(Game.state.completedQuests).toEqual(["onboarding-sign-on", "docker-first-container"]);
});

/* ---------- #410: Quest-Fortschritt als Menge offener Quests (parallel/optional) ----------
 * Die Persistenz-Autorität ist activeQuests (Quest-ID -> {step,task}); die linearen Felder
 * sind die Arbeitskopie der fokussierten Quest. Das Modell trägt MEHRERE gleichzeitig offene
 * Quests + datengesteuerte Voraussetzungen (requires) – das Fundament für optionale Stränge,
 * ohne dass der spätere Ausbau eine Save-Migration über alle Nutzerstände braucht. */

test("#410 defaultState: genau die erste Quest ist offen", () => {
  Game.reset();
  expect(Game.state.activeQuests).toEqual({ [KQContent.QUESTS[0].id]: { step: 0, task: 0 } });
  expect(Game.activeQuestIds()).toEqual([KQContent.QUESTS[0].id]);
  expect(Game.isQuestActive(KQContent.QUESTS[0].id)).toBe(true);
  expect(Game.isQuestActive(KQContent.QUESTS[1].id)).toBe(false);
});

test("#410 Migration: Alt-Stand (v3, kein activeQuests) -> fokussierte Einzel-Quest wird offen", () => {
  Game.importData(JSON.stringify({ v: 3, data: { questIdx: 5, questStep: 2, taskIdx: 1, currentQuestId: KQContent.QUESTS[5].id } }));
  Game.load();
  // Genau ein offener Eintrag, mit dem migrierten Schritt-Stand – verlustfrei.
  expect(Game.state.activeQuests).toEqual({ [KQContent.QUESTS[5].id]: { step: 2, task: 1 } });
  expect(Game.state.questStep).toBe(2);
  expect(Game.state.taskIdx).toBe(1);
});

test("#410 Migration: Endzustand (alle durch) -> leere offene Menge", () => {
  setWorldScene(null);
  Game.jumpToQuest(KQContent.QUESTS.length);
  expect(Game.state.activeQuests).toEqual({});
  expect(Game.activeQuestIds()).toEqual([]);
  Game.load();
  expect(Game.state.activeQuests).toEqual({}); // round-trippt
});

test("#410 advanceStep: schließt die fokussierte Quest, entfernt sie aus der offenen Menge, öffnet die nächste", () => {
  setWorldScene(null);
  Game.jumpToQuest(0);
  const q0 = KQContent.QUESTS[0], q1 = KQContent.QUESTS[1];
  expect(Game.state.activeQuests).toEqual({ [q0.id]: { step: 0, task: 0 } });
  for (let i = 0; i < q0.steps.length; i++) Game.advanceStep();
  // q0 ist erledigt und NICHT mehr offen; q1 ist jetzt die einzige offene Quest.
  expect(Game.isQuestCompleted(q0.id)).toBe(true);
  expect(Game.isQuestActive(q0.id)).toBe(false);
  expect(Game.state.activeQuests).toEqual({ [q1.id]: { step: 0, task: 0 } });
});

test("#410 startQuest: öffnet eine zweite Quest parallel, ohne den Fokus zu verschieben", () => {
  setWorldScene(null);
  Game.reset();
  const fokus = Game.state.currentQuestId;
  // Eine spätere, voraussetzungsfreie Quest parallel öffnen (k8s-inspect-pods hat keine requires).
  expect(Game.startQuest("k8s-inspect-pods")).toBe(true);
  expect(Game.isQuestActive("k8s-inspect-pods")).toBe(true);
  expect(Game.isQuestActive(fokus)).toBe(true);            // Fokus bleibt offen
  expect(Game.state.currentQuestId).toBe(fokus);           // Fokus unverschoben
  expect(Game.activeQuestIds().length).toBe(2);            // ZWEI gleichzeitig offen
  // persistiert: neu laden liefert beide offenen Quests verlustfrei zurück
  Game.load();
  expect(Game.isQuestActive("k8s-inspect-pods")).toBe(true);
  expect(Game.isQuestActive(fokus)).toBe(true);
});

test("#410 startQuest: keine Dublette, kein erneutes Öffnen einer erledigten Quest", () => {
  Game.reset();
  expect(Game.startQuest("k8s-inspect-pods")).toBe(true);
  expect(Game.startQuest("k8s-inspect-pods")).toBe(false); // schon offen -> kein zweites Mal
  Game.state.completedQuests.push("k8s-service");
  expect(Game.startQuest("k8s-service")).toBe(false);      // erledigt + nicht repeatable -> gesperrt
  expect(Game.startQuest("gibt-es-nicht")).toBe(false);    // unbekannte Quest
});

test("#410 requires (datengesteuert): optionale Quest bleibt gesperrt, bis die Voraussetzung erledigt ist", () => {
  Game.reset();
  // helm-umbrella-chart deklariert in den Quest-DATEN requires:[helm-intro].
  expect(Game.questPrereqsMet("helm-umbrella-chart")).toBe(false);
  expect(Game.canStartQuest("helm-umbrella-chart")).toBe(false);
  expect(Game.startQuest("helm-umbrella-chart")).toBe(false);
  // Voraussetzung erfüllen -> Gate öffnet.
  Game.state.completedQuests.push("helm-intro");
  expect(Game.questPrereqsMet("helm-umbrella-chart")).toBe(true);
  expect(Game.canStartQuest("helm-umbrella-chart")).toBe(true);
  // Quest ohne requires hat keine Voraussetzung -> immer erfüllt.
  expect(Game.questPrereqsMet("k8s-inspect-pods")).toBe(true);
});

/* ---------- #413: persistente Spiel-Zeit-Achse / Kalender ----------
 * gameDays (fraktionale Tageszahl) ist die persistente Achse; advanceClock rückt sie um
 * reale Frame-Zeit vor, calendar() leitet Tag/Saison/Uhrzeit daraus ab. Vorher lief
 * Tag/Nacht nur aus flüchtiger Frame-Zeit (Reload = wieder Tag 1). Bewusst in TAGEN
 * gespeichert (vom Tempo DAY_CYCLE_MS entkoppelt), damit ein Tempo-Tuning keinen Stand
 * auf ein anderes Kalenderdatum umschreibt. */

test("#413 defaultState: frischer Stand startet bei Tag 1, Mittag (gameDays 0)", () => {
  Game.reset();
  expect(Game.state.gameDays).toBe(0);
  const cal = Game.calendar();
  expect(cal.day).toBe(1);
  expect(cal.hhmm).toBe("12:00");
  expect(cal.seasonName).toBe("Frühling");
});

test("#413 advanceClock: typische Per-Frame-Deltas akkumulieren (über den Tempo-Faktor)", () => {
  Game.reset();
  Game.advanceClock(16);                       // ein 60fps-Frame
  expect(Game.state.gameDays).toBeCloseTo(16 / DAY_CYCLE_MS, 12);
  Game.advanceClock(16);
  expect(Game.state.gameDays).toBeCloseTo(32 / DAY_CYCLE_MS, 12); // summiert sich auf
});

test("#413 calendar(): leitet Tag/Uhrzeit/Saison aus der gesetzten Achse ab", () => {
  Game.reset();
  Game.state.gameDays = 1;                     // exakt ein Tag vergangen
  // gameDays 1.0 = wieder Mittag (phase 0), aber Mitternacht dazwischen -> Tag 2.
  expect(Game.calendar().day).toBe(2);
  expect(Game.calendar().hhmm).toBe("12:00");
  Game.state.gameDays = 28.25;                 // Tag 29, 18:00 -> Saisonwechsel nach 28 Tagen
  expect(Game.calendar().day).toBe(29);
  expect(Game.calendar().hhmm).toBe("18:00");
  expect(Game.calendar().seasonName).toBe("Sommer");
});

test("#413 advanceClock: ignoriert Unsinn (NaN/≤0) und deckelt einen Riesen-Frame", () => {
  Game.reset();
  Game.advanceClock(NaN);
  Game.advanceClock(0);
  Game.advanceClock(-5000);
  expect(Game.state.gameDays).toBe(0);        // nichts davon hat die Achse bewegt
  // Ein riesiges delta (Tab war im Hintergrund) darf nicht Stunden überspringen:
  // gedeckelt auf 1 reale Sekunde Zuwachs (MAX_FRAME_MS), nicht 10 Tage.
  Game.advanceClock(10 * DAY_CYCLE_MS);
  expect(Game.state.gameDays).toBeCloseTo(1000 / DAY_CYCLE_MS, 12);
  expect(Game.calendar().day).toBe(1);        // weiterhin Tag 1
});

test("#413 gameDays persistiert über load() (überlebt einen Reload)", () => {
  setWorldScene(null);
  Game.reset();
  Game.state.gameDays = 5.25;                 // Tag 6, ~18:00
  Game.save();
  Game.load();
  expect(Game.state.gameDays).toBe(5.25);     // verlustfrei zurückgelesen
  expect(Game.calendar().day).toBe(6);
});

test("#413 Migration: Alt-Stand ohne gameDays bekommt Default 0 (verlustfrei)", () => {
  // Stand wie vor #413: kein gameDays-Feld -> startet sauber am Tag-1-Anfang.
  Game.importData(JSON.stringify({ v: 4, data: { xp: 50, questIdx: 3 } }));
  Game.load();
  expect(Game.state.gameDays).toBe(0);
  expect(Game.state.xp).toBe(50);             // übriger Fortschritt unberührt
});

test("#413 Sanitize: gültiger Float überlebt, kaputter/negativer Wert fällt auf 0 (Red-Green)", () => {
  // Gültiger fraktionaler Wert bleibt EXAKT (nicht auf Ganzzahl gerundet wie ein Index).
  Game.importData(JSON.stringify({ v: 5, data: { gameDays: 12.5 } }));
  Game.load();
  expect(Game.state.gameDays).toBe(12.5);

  // Falscher Typ -> Default 0 (würde der Sanitize-Guard fehlen, bliebe hier "bald" stehen).
  Game.importData(JSON.stringify({ v: 5, data: { gameDays: "bald" } }));
  Game.load();
  expect(Game.state.gameDays).toBe(0);

  // Negativ ist unplausibel (Zeit läuft nicht rückwärts) -> Default 0.
  Game.importData(JSON.stringify({ v: 5, data: { gameDays: -3 } }));
  Game.load();
  expect(Game.state.gameDays).toBe(0);
});
