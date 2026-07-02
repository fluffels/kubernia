/* Save-Migrations-INTEGRATIONSTEST mit realistischen, VOLLEN Alt-Stand-Fixtures (#414).
 *
 * Warum dieser Test neben store.test.ts / game.test.ts existiert:
 *  - store.test.ts prüft die Versions-Hülle (write/read, Fallback, Quota, Backup) mit
 *    MINIMALEN Payloads ({xp:42}).
 *  - game.test.ts prüft sanitizeState mit künstlich kaputten EINZELwerten.
 *  - HIER liegt der Lücken-Schluss: echte, über mehrere Major-Versionen gewanderte
 *    VOLLSTÄNDIGE Stände (alle Quests, großes Spaced-Repetition-Deck, Abkürzungen,
 *    Stats, Inventar, Cluster-Snapshot) werden als Datei-Fixtures geladen und der
 *    GANZE Ladeweg (SaveStore.readState → Migration → sanitizeState → Sim-Aufbau)
 *    wird gegen die exakt erwarteten Endwerte geprüft.
 *
 * Das ist das Netz, das die Regel „Spielstände nie brechen" für die anstehenden
 * Save-Format-Änderungen (#410 Quest-Modell, #413 Kalender) absichert: jede Datei in
 * test/fixtures/savegame-*.json ist ein echter Alt-Stand, der verlustfrei laden muss.
 *
 * Determinismus: load() zieht lastSeen/streak bewusst „auf jetzt" (Offline-Einnahmen,
 * Streak-Tick). Wir pinnen die Uhr pro Fixture auf dessen gespeicherten lastSeen →
 * Date.now()-lastSeen == 0 → keine Offline-Einnahmen, Münzstand exakt prüfbar. Der
 * Streak wird beim Laden absichtlich getoucht; sein Endwert ist „jetzt"-abhängig und
 * wird daher NICHT byteweise geprüft (der Roundtrip-Fixpunkt deckt die Stabilität ab).
 *
 * Neue Format-Version später? Ein neues test/fixtures/savegame-v<N>-*.json mit vollem
 * Fortschritt ergänzen und hier einen Lade-Block dafür schreiben (siehe unten).
 * Das ist seit #510 nicht mehr nur Bitte, sondern MASCHINELL ERZWUNGEN: der
 * Fitness-Test „#510 …" ganz unten geht rot, sobald es zu einer Format-Version
 * 1..CURRENT_SAVE_VERSION keine hier geladene Fixture gibt. Damit kann ein
 * CURRENT_SAVE_VERSION-Bump ohne echten Alt-Stand-Nachweis nicht durchrutschen.
 */
import { test, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { KQContent } from "../src/content";
import { setWorldScene } from "../src/runtime";

const SAVE_KEY = "kubernia-save-v3";        // muss zum Key in store.ts passen
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

let Game: typeof import("../src/game").Game;
let SaveStore: typeof import("../src/store").SaveStore;
let CURRENT_SAVE_VERSION: number;
let lsMap: Map<string, string>;

beforeAll(async () => {
  // window.localStorage stubben (kein jsdom): store.ts bleibt im synchronen
  // localStorage-Modus, weil wir SaveStore.init() (IndexedDB) nie aufrufen.
  lsMap = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => (lsMap.has(k) ? lsMap.get(k)! : null),
      setItem: (k: string, v: string) => { lsMap.set(k, String(v)); },
      removeItem: (k: string) => { lsMap.delete(k); },
    },
  });
  ({ Game } = await import("../src/game"));
  const store = await import("../src/store");
  SaveStore = store.SaveStore;
  CURRENT_SAVE_VERSION = store.CURRENT_SAVE_VERSION;
});

beforeEach(() => {
  vi.useFakeTimers();
  lsMap.clear();
  setWorldScene(null); // sonst überschreibt save() die geladene Spielerposition mit der Live-Szene
});

afterEach(() => {
  vi.useRealTimers();
});

/** Roh-Bytes einer Fixture-Datei – genau das, was bei einem echten Nutzer in der Persistenz läge. */
function fixtureRaw(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

/** Quest-IDs der ersten n Quests (in Reihenfolge) – aus dem Content abgeleitet, nicht handgepflegt.
 *  Die Alt-Stand-Fixtures hier stammen aus der Zeit VOR der eingeschobenen Warenkunde-Quest
 *  `docker-common-images` (#448, an Index 2). Solche Stände haben diese Quest nie gespielt –
 *  ihr migrierter Fortschritt überspringt sie (genau das #353-Verhalten: passierte Einschübe
 *  schicken niemanden zurück). „Die ersten n erledigten Quests" ist daher die Reihenfolge OHNE
 *  den Einschub. */
function slugs(n: number): string[] {
  return KQContent.QUESTS.map(q => q.id).filter(id => id !== "docker-common-images").slice(0, n);
}

/** Die im Fixture gespeicherte completedQuests-Liste (bereits aktuelle Slugs). Wird beim
 *  Laden verlustfrei übernommen – mit ihr prüfen wir Stände, die VOR einer mitten in der
 *  Reihenfolge eingefügten Quest (z.B. #273 helm-templates) gespeichert wurden: ihr
 *  Completed-Set bleibt exakt, auch wenn sich der abgeleitete questIdx verschiebt (#353). */
function fixtureCompleted(name: string): string[] {
  const env = JSON.parse(fixtureRaw(name)) as { data?: { completedQuests?: string[] } };
  return env.data?.completedQuests ?? [];
}

/** Wie `slugs`, aber zusätzlich OHNE die später eingeschobenen `docker-registry` (#449, Index 7)
 *  und `docker-rabbitmq` (#450, Index 8).
 *  Die ganz alten v1/v2-Fixtures stammen aus der Zeit vor ALLEN drei Docker-Einschüben
 *  (docker-common-images #448, docker-registry #449 und docker-rabbitmq #450); ihr migrierter
 *  Fortschritt überspringt alle (passierte Einschübe schicken niemanden zurück, #353). „Die ersten
 *  n erledigten Quests" ist daher die Reihenfolge ohne diese Einschübe. */
function slugsSansRegistry(n: number): string[] {
  return KQContent.QUESTS.map(q => q.id)
    .filter(id => id !== "docker-common-images" && id !== "docker-registry" && id !== "docker-rabbitmq")
    .slice(0, n);
}

/** #410: Ein linearer (Single-Active) Stand muss nach dem Laden genau die fokussierte
 *  Quest als offene Menge tragen (oder die leere Menge im Endzustand). So beweist jeder
 *  Alt-Stand-Lauf, dass die Migration „Einzel-Quest → activeQuests-Set mit einem Eintrag"
 *  verlustfrei greift. */
function expectFocusedActiveQuests(): void {
  const cur = Game.state.currentQuestId;
  if (cur === "") { expect(Game.state.activeQuests).toEqual({}); return; }
  expect(Game.state.activeQuests).toEqual({ [cur]: { step: Game.questStep(), task: Game.taskIdx() } });
}

/**
 * Spielt einen Fixture-Stand roh in die Persistenz ein und lädt ihn. Pinnt die Uhr auf
 * den gespeicherten lastSeen, damit KEINE Offline-Einnahmen anfallen (Differenz 0) und
 * der Münzstand exakt prüfbar bleibt.
 */
function loadFixture(name: string): void {
  const raw = fixtureRaw(name);
  const env = JSON.parse(raw) as { data?: { lastSeen?: unknown } };
  const lastSeen = typeof env?.data?.lastSeen === "number" ? env.data.lastSeen : 0;
  vi.setSystemTime(lastSeen);
  lsMap.set(SAVE_KEY, raw);
  Game.load();
}

/**
 * Ein Lade→Speichern→Laden-Roundtrip muss ein FIXPUNKT sein: load() schreibt den
 * kanonisierten Stand zurück (trailing save()); ein erneutes Laden darf die persistierten
 * Bytes NICHT mehr verändern. Sonst würde der Save bei jedem Reload driften/wachsen –
 * genau die Art stiller Save-Korruption, die dieser Test verhindern soll.
 */
function expectRoundTripFixedPoint(): void {
  const raw1 = SaveStore.read();        // kanonischer Stand nach dem ersten load()
  expect(raw1).not.toBeNull();
  Game.load();                          // erneut laden (+ trailing save())
  expect(SaveStore.read()).toBe(raw1);  // Bytes unverändert → verlustfreier Roundtrip
}

/* ============================================================================
 * v1 (vor #353): Fortschritt nur als Zahl-Index + alte numerische Quest-IDs.
 * ========================================================================== */

test("v1 (Docker-Bogen): currentQuestId aus questIdx abgeleitet, alte IDs gemappt, grandfathered", () => {
  loadFixture("savegame-v1-docker-arc.json");

  // #353: currentQuestId fehlt im v1-Stand → wird aus questIdx abgeleitet.
  expect(Game.questIdx()).toBe(6);
  // QUESTS[6] = "docker-build-image": die Einschübe docker-common-images (#448, Index 2) und
  // docker-registry (#449, Index 7) verschieben, was der gespeicherte Zahl-Index 6 auflöst.
  expect(Game.state.currentQuestId).toBe(KQContent.QUESTS[6].id);
  // #354: alte numerische IDs (q0..q3b) → sprechende Slugs, vollständig & in Reihenfolge.
  expect(Game.state.completedQuests).toEqual(slugs(6));

  // Stand hat Fortschritt, aber kein unlockedAbbrev-Feld → grandfathered ("*"): kein
  // bereits gelerntes Kürzel wird rückwirkend gesperrt.
  expect(Game.state.unlockedAbbrev).toEqual(["*"]);
  expect(Game.isAbbrevUnlocked("-a")).toBe(true);

  // Fehlende Felder bekommen die Defaults, vorhandene Daten bleiben unverändert.
  expect(Game.state.xp).toBe(95);
  expect(Game.state.coins).toBe(120); // keine Offline-Einnahmen (Uhr gepinnt)
  expect(Game.state.inventory).toEqual({ fernrohr: 1 });
  expect(Game.state.owned).toEqual(["pet-ratte"]);
  expect(Game.state.audio).toEqual({ music: true, sfx: true, musicVol: 0.5, sfxVol: 0.8, track: "hafen" });
  expect(Game.state.settings).toEqual({ events: "normal" });
  expect(Game.state.cmdHistoryUnlocked).toBe(false);

  // #410: lineare Single-Active-Migration – genau die fokussierte Quest ist offen.
  expectFocusedActiveQuests();
  expect(Game.state.activeQuests).toEqual({ "docker-build-image": { step: Game.questStep(), task: 0 } });

  // Migrierter Stand wurde VOR dem Überschreiben in den Backup-Slot gesichert.
  expect(SaveStore.readBackup()).toBe(fixtureRaw("savegame-v1-docker-arc.json"));

  expectRoundTripFixedPoint();
});

test("v1 (voller Stand): reiches Deck/Abkürzungen/Stats/Cluster-Snapshot laden verlustfrei", () => {
  loadFixture("savegame-v1-rich.json");

  expect(Game.questIdx()).toBe(16);
  // QUESTS[16] = "terraform-intro": der gespeicherte Zahl-Index 16 bleibt, löst aber durch die
  // beiden Docker-Einschübe (#448/#449) eine andere Quest auf. Die 16 abgeschlossenen Alt-IDs
  // sind unverändert – „alles bis dahin", nur ohne die nie gespielten Einschübe.
  expect(Game.state.currentQuestId).toBe(KQContent.QUESTS[16].id);
  expect(Game.state.completedQuests).toEqual(slugsSansRegistry(16));

  // Explizite unlockedAbbrev-Liste vorhanden → wird übernommen, NICHT pauschal grandfathered.
  expect(Game.state.unlockedAbbrev).toEqual(["-a", "-n", "-d", "--name"]);
  expect(Game.isAbbrevUnlocked("-a")).toBe(true);
  expect(Game.isAbbrevUnlocked("--noch-nie")).toBe(false);
  expect(Game.state.abbrevUsage).toEqual({ "docker-ps-all": 19, "kubectl-get-pods": 7 });
  expect(Game.state.cmdHistoryUnlocked).toBe(true);

  // Volle Sammlungen exakt erhalten.
  expect(Game.state.inventory).toEqual({ fernrohr: 3, kompass: 1 });
  expect(Game.state.owned).toEqual(["pet-ratte", "pet-moewe", "flag-blau", "fernrohr-upgrade"]);
  expect(Game.state.activePet).toBe("pet-moewe");
  expect(Game.state.activeFlag).toBe("flag-blau");
  // Die 6 gespeicherten Review-Einträge werden verlustfrei übernommen (jeder bleibt erhalten,
  // mit seinem Leitner-Stand) …
  for (const id of ["q-ch1-1", "q-flag-ps-a", "q-tools-stack", "q-tools-monitoring", "q-flag-run-d", "q-flag-kubectl-n"]) {
    expect(Game.state.review[id], `gespeicherte Review-Karte ${id} muss verlustfrei geladen werden`).toBeTruthy();
  }
  expect(Game.state.review["q-ch1-1"]).toEqual({ box: 5, due: 19999 });
  // … zusätzlich schiebt der #279-Backfill beim Laden die Karten der 16 abgeschlossenen Quests
  // rein additiv nach (Nachzügler erreichen Fortgeschrittene), daher ist der Pool danach größer.
  expect(Object.keys(Game.state.review).length).toBeGreaterThan(6);

  // Dynamische Zusatz-Stat (stormsFixed) bleibt erhalten.
  expect(Game.state.stats.stormsFixed).toBe(4);
  expect(Game.state.stats.commands).toBe(310);

  // Cozy-Modus + individuelle Audio-Einstellungen überleben.
  expect(Game.state.settings).toEqual({ events: "cozy" });
  expect(Game.state.audio).toEqual({ music: false, sfx: true, musicVol: 0.3, sfxVol: 0.9, track: "leuchtturm" });

  expect(Game.state.coins).toBe(860); // Snapshot wirft Einkommen ab, aber Uhr gepinnt → 0 Offline-Einnahmen
  expectFocusedActiveQuests(); // #410: die fokussierte Quest (terraform-state-destroy) ist die einzige offene
  expectRoundTripFixedPoint();
});

/* ============================================================================
 * v2 (#353/#354): Fortschritt als Quest-ID, IDs teils noch numerisch.
 * ========================================================================== */

test("v2 (veralteter Zahl-Index): currentQuestId gewinnt über stale questIdx, IDs gemappt", () => {
  loadFixture("savegame-v2-stale-index.json");

  // Kernschutz #353: gespeicherter questIdx (0) ist veraltet; currentQuestId "q5" → "k8s-inspect-pods"
  // (durch die Einschübe #448/#449/#450 jetzt Index 10) gewinnt. So bricht ein vorheriges Quest-Einschieben
  // den Stand nicht – der Index folgt der ID, nicht umgekehrt.
  expect(Game.questIdx()).toBe(10);
  expect(Game.state.currentQuestId).toBe("k8s-inspect-pods");
  expect(Game.state.completedQuests).toEqual(slugsSansRegistry(7));

  // Explizit leeres unlockedAbbrev wird respektiert (kein Grandfather trotz Fortschritt).
  expect(Game.state.unlockedAbbrev).toEqual([]);
  expect(Game.isAbbrevUnlocked("-a")).toBe(false);

  expect(Game.state.coins).toBe(410);
  expectFocusedActiveQuests(); // #410: k8s-inspect-pods ist die einzige offene Quest
  expectRoundTripFixedPoint();
});

test("v2 (alle Quests durch): Endzustand + vollständige completedQuests-Migration", () => {
  loadFixture("savegame-v2-allquests.json");

  expect(Game.questIdx()).toBe(KQContent.QUESTS.length); // alle durch
  expect(Game.state.currentQuestId).toBe("");                // Endzustand
  expect(Game.allQuestsDone()).toBe(true);

  // Alle alten numerischen IDs (+ später als Slug ergänzte Quests) → die neuen Slugs.
  // #449/#450/#461: docker-registry, docker-rabbitmq UND aufbau-sturm wurden NACH diesem
  // „alles durch"-Stand eingeschoben/angehängt; ein solcher Alt-Stand kennt sie folgerichtig
  // nicht (sie bleiben ungespielt, niemand wird zurückgeschickt). Der Endzustand
  // (questIdx == length, currentQuestId "") bleibt trotzdem erhalten.
  const addedAfterFixture = ["docker-registry", "docker-rabbitmq", "aufbau-sturm", "aufbau-control-plane", "aufbau-worker-join", "aufbau-dienste", "aufbau-cluster-als-code"];
  expect(Game.state.completedQuests.length).toBe(KQContent.QUESTS.length - addedAfterFixture.length);
  expect(new Set(Game.state.completedQuests)).toEqual(
    new Set(KQContent.QUESTS.filter(q => !addedAfterFixture.includes(q.id)).map(q => q.id)),
  );

  expect(Game.state.settings).toEqual({ events: "off" });
  expect(Game.state.coins).toBe(5000);
  expect(Game.state.stats.stormsFixed).toBe(19);
  expectFocusedActiveQuests(); // #410: Endzustand -> keine offene Quest
  expect(Game.state.activeQuests).toEqual({});
  expectRoundTripFixedPoint();
});

/* ============================================================================
 * v3 (vor #410): Fortschritt nur als fokussierte Einzel-Quest, KEIN activeQuests-Feld.
 * Lädt jetzt als Alt-Stand -> wird auf v4 migriert (activeQuests aus der Einzel-Quest
 * gebaut) und vorher gesichert.
 * ========================================================================== */

test("v3 (voller Stand, vor #410): Einzel-Quest -> activeQuests-Set, verlustfrei migriert + gesichert", () => {
  loadFixture("savegame-v3-current.json");

  // Vier mitten eingeschobene Quests vor gitops-argocd-intro: #448 docker-common-images,
  // #449 docker-registry, #450 docker-rabbitmq, #273 helm-templates → Index 31 + 4 = 35; das
  // Completed-Set des Alt-Stands bleibt verlustfrei unverändert.
  expect(Game.questIdx()).toBe(35);
  expect(Game.state.currentQuestId).toBe("gitops-argocd-intro");
  expect(Game.questStep()).toBe(1);
  expect(Game.state.completedQuests).toEqual(fixtureCompleted("savegame-v3-current.json"));
  expect(Game.state.xp).toBe(1500);
  expect(Game.state.coins).toBe(2000);
  expect(Game.state.character).toBe(1);
  expect(Game.state.player).toEqual({ x: 640, y: 480 });
  expect(Game.state.unlockedAbbrev).toEqual(["-a", "-n"]);
  expect(Game.state.abbrevUsage).toEqual({ "docker-ps-all": 5 });
  expect(Game.state.cmdHistoryUnlocked).toBe(true);
  expect(Game.state.audio).toEqual({ music: true, sfx: false, musicVol: 0.6, sfxVol: 0.4, track: "archipel" });
  expect(Game.state.settings).toEqual({ events: "cozy" });
  expect(Game.state.stats.stormsFixed).toBe(9);

  // #410: aus der fokussierten Einzel-Quest wird genau ein offener Eintrag.
  expect(Game.state.activeQuests).toEqual({ "gitops-argocd-intro": { step: 1, task: 0 } });
  expectFocusedActiveQuests();

  // v3 < aktuelle Version (4) → Herauf-Migrieren → Original VORHER gesichert.
  expect(SaveStore.readBackup()).toBe(fixtureRaw("savegame-v3-current.json"));

  expectRoundTripFixedPoint();
});

/* ============================================================================
 * v4 (vor #413): trägt schon MEHRERE offene Quests (#410), aber KEINE persistente
 * Zeit-Achse. Lädt jetzt als Alt-Stand -> wird auf v5 migriert (gameDays default 0)
 * und vorher gesichert. Die mehreren offenen Quests müssen dabei verlustfrei bleiben.
 * ========================================================================== */

test("v4 (vor #413): mehrere offene Quests bleiben, gameDays default 0, migriert + gesichert", () => {
  loadFixture("savegame-v4-current.json");

  // #448 docker-common-images + #449 docker-registry + #450 docker-rabbitmq + #273 helm-templates:
  // vier Einschübe vor gitops-argocd-intro → 31 + 4 = 35.
  expect(Game.questIdx()).toBe(35);
  expect(Game.state.currentQuestId).toBe("gitops-argocd-intro");
  expect(Game.questStep()).toBe(1);
  expect(Game.state.completedQuests).toEqual(fixtureCompleted("savegame-v4-current.json"));

  // #410 bleibt unangetastet: ZWEI parallel offene Quests überleben verlustfrei.
  expect(Game.state.activeQuests).toEqual({
    "gitops-argocd-intro": { step: 1, task: 0 },
    "gitops-self-sync": { step: 0, task: 0 },
  });
  expect(Game.activeQuestIds()).toEqual(["gitops-argocd-intro", "gitops-self-sync"]);
  expect(Game.isQuestActive("gitops-self-sync")).toBe(true);

  // #413: kein gameDays im v4-Stand -> Default 0 (Tag 1, Mittag), verlustfrei.
  expect(Game.state.gameDays).toBe(0);

  // v4 < aktuelle Version (5) → Herauf-Migrieren → Original VORHER gesichert.
  expect(SaveStore.readBackup()).toBe(fixtureRaw("savegame-v4-current.json"));

  expectRoundTripFixedPoint();
});

/* ============================================================================
 * v5 (vor #559): trägt noch die redundante Quest-Arbeitskopie (questIdx/questStep/taskIdx)
 * im Save. Lädt jetzt als Alt-Stand -> wird auf v6 migriert (die drei Felder fallen weg,
 * Schritt/Aufgabe werden zur Laufzeit aus activeQuests abgeleitet) und vorher gesichert.
 * Die persistente Zeit-Achse gameDays muss dabei EXAKT (fraktional) round-trippen.
 * ========================================================================== */

test("v5 (vor #559): gameDays exakt, Arbeitskopie-Felder fallen weg, migriert + gesichert", () => {
  loadFixture("savegame-v5-current.json");

  // #448 docker-common-images + #449 docker-registry + #450 docker-rabbitmq + #273 helm-templates
  // → 31 + 4 = 35.
  expect(Game.questIdx()).toBe(35);
  expect(Game.state.currentQuestId).toBe("gitops-argocd-intro");
  expect(Game.state.activeQuests).toEqual({
    "gitops-argocd-intro": { step: 1, task: 0 },
    "gitops-self-sync": { step: 0, task: 0 },
  });

  // Kern von #413: die persistente Zeit-Achse lädt EXAKT (fraktional, nicht gerundet)
  // und ergibt den richtigen Kalendertag. gameDays persistiert verlustfrei; der daraus
  // abgeleitete (rein kosmetische) Kalendertag hängt seit #336 am 06:00-Spielstart:
  // day = floor(gameDays + START_PHASE - 0.5) + 1 = floor(47.625 + 0.25) + 1 = 48,
  // Saison Sommer (Tag 48). (Der Stand selbst bricht nicht – nur die Anzeige folgt dem
  // verschobenen Mitternachts-Anker.)
  expect(Game.state.gameDays).toBe(47.625);
  expect(Game.calendar().day).toBe(48);
  expect(Game.calendar().seasonName).toBe("Sommer");

  // v5 < aktuelle Version (6) → Herauf-Migrieren → Original VORHER gesichert.
  expect(SaveStore.readBackup()).toBe(fixtureRaw("savegame-v5-current.json"));

  expectRoundTripFixedPoint();
});

/* ============================================================================
 * v6 (aktuelles Format, #559): die Quest-Arbeitskopie (questIdx/questStep/taskIdx) wird NICHT
 * mehr persistiert – der Save trägt nur noch activeQuests + currentQuestId, der Rest wird zur
 * Laufzeit abgeleitet. Muss UNVERÄNDERT laden (kein Backup) und byte-stabil round-trippen.
 * ========================================================================== */

test("v6 (aktueller Stand): abgeleiteter Cursor, kein persistiertes questStep, kein Backup", () => {
  loadFixture("savegame-v6-current.json");

  // currentQuestId ist die Autorität; questIdx()/questStep()/taskIdx() leiten daraus ab.
  expect(Game.questIdx()).toBe(35);
  expect(Game.state.currentQuestId).toBe("gitops-argocd-intro");
  expect(Game.questStep()).toBe(1);
  expect(Game.taskIdx()).toBe(0);
  expect(Game.state.activeQuests).toEqual({
    "gitops-argocd-intro": { step: 1, task: 0 },
    "gitops-self-sync": { step: 0, task: 0 },
  });

  // Die persistente Zeit-Achse lädt weiterhin exakt.
  expect(Game.state.gameDays).toBe(47.625);

  // Der persistierte Stand trägt die Arbeitskopie-Felder NICHT mehr (#559).
  const env = JSON.parse(SaveStore.read()!) as { data?: Record<string, unknown> };
  expect(env.data).toBeTruthy();
  expect("questIdx" in env.data!).toBe(false);
  expect("questStep" in env.data!).toBe(false);
  expect("taskIdx" in env.data!).toBe(false);

  // Aktuelle Version → kein Herauf-Migrieren → kein Sichern ins Backup.
  expect(SaveStore.readBackup()).toBeNull();

  expectRoundTripFixedPoint();
});

/* ============================================================================
 * Echter Spielzug-Roundtrip: laden → spielen → speichern → laden bleibt identisch.
 * ========================================================================== */

test("Roundtrip mit Spielzug: laden → XP/Abkürzung/Karte ändern → speichern → laden verlustfrei", () => {
  loadFixture("savegame-v1-rich.json");
  expectRoundTripFixedPoint();

  const xpBefore = Game.state.xp;
  Game.addXp(30);                          // echter Spielzug (persistiert via save())
  Game.unlockAbbrev("--roundtrip-test");   // Freischaltung
  Game.ensureReviewItem("rt-neue-karte");  // neue Spaced-Repetition-Karte
  Game.save();
  const rawAfterPlay = SaveStore.read();

  Game.load();                             // neu laden
  expect(Game.state.xp).toBe(xpBefore + 30);
  expect(Game.isAbbrevUnlocked("--roundtrip-test")).toBe(true);
  expect(Game.state.review["rt-neue-karte"]).toBeTruthy();
  expect(SaveStore.read()).toBe(rawAfterPlay); // erneuter Roundtrip ändert die Bytes nicht
});

/* ============================================================================
 * RED-GREEN: ein absichtlich KAPUTTES Fixture muss hart abgehärtet werden, nicht
 * stillschweigend übernommen. Würde sanitizeState umgangen, gingen diese Assertions
 * sofort rot – der Test hat also „Zähne".
 * ========================================================================== */

test("Red-Green: kaputtes v2-Fixture lädt sanitisiert (kein Crash, Defaults statt Müll)", () => {
  expect(() => loadFixture("savegame-v2-corrupt.json")).not.toThrow();

  // Zahlenfelder: Müll → Defaults, NICHT String-/negativ-Werte.
  expect(Game.state.coins).toBe(40);   // "viel" verworfen
  expect(Game.state.xp).toBe(0);       // -50 verworfen
  expect(Game.state.character).toBeNull(); // "Hans" verworfen
  expect(Game.state.player).toEqual({ x: 400, y: 200 }); // "nope" → Default-x, gültiges y bleibt

  // Quest-Fortschritt: currentQuestId 999 (kein String) + questIdx -3 → sauber auf Quest 0.
  expect(Game.questIdx()).toBe(0);
  expect(Game.state.currentQuestId).toBe(KQContent.QUESTS[0].id);
  expect(Game.state.completedQuests).toEqual([]); // String statt Array → leer

  // Sammlungen gefiltert.
  expect(Game.state.owned).toEqual(["pet-1", "flag"]);
  expect(Game.state.inventory).toEqual({ potion: 3 });
  expect(Game.state.activePet).toBeNull();
  expect(Game.state.activeFlag).toBeNull();
  expect(Game.state.review.good).toEqual({ box: 2, due: 5 });
  expect(Game.state.review.bad).toBeUndefined();   // kaputter Eintrag verworfen
  expect(Game.state.review.over.box).toBe(5);      // box auf 1..5 geklemmt
  expect(Game.state.abbrevUsage).toEqual({ z: 4 }); // neg/falscher Typ raus

  // Booleans & Enums.
  expect(Game.state.cmdHistoryUnlocked).toBe(false);
  expect(Game.state.introSeen).toBe(false);
  expect(Game.state.settings).toEqual({ events: "normal" }); // "ultrahart" verworfen
  expect(Game.state.audio).toEqual({ music: false, sfx: true, musicVol: 1, sfxVol: 0, track: "hafen" });

  // #413: kaputte Zeit-Achse ("bald", kein number) → Default 0, nicht der Müll-String.
  expect(Game.state.gameDays).toBe(0);

  // Array-Cluster-Snapshot [1,2,3] ist kein gültiger Sim-Zustand → in sanitizeState verworfen;
  // der Sim baut beim Laden einen frischen Default-Snapshot. Der Müll-Array darf NICHT
  // in den Cluster durchschlagen (kein Crash bei new Sim([1,2,3])).
  expect(Array.isArray(Game.state.clusterSnapshot)).toBe(false);
  expect(Game.state.clusterSnapshot).not.toBeNull();
  expect(Array.isArray(Game.state.clusterSnapshot?.deployments)).toBe(true);

  // Trotz Müll-Eingabe ein konsistenter, stabiler Stand.
  expectRoundTripFixedPoint();
});

/* ============================================================================
 * #436: load() mit vollständigem Snapshot – kein Szenario-Replay, Snapshot ist SSOT.
 * RED: schlägt fehl, solange load() das Szenario re-merged (Object.assign überschreibt).
 * GREEN: ab dem Moment, wo load() beim vollständigen Snapshot den Replay-Loop überspringt.
 * ========================================================================== */

test("#436: load() mit vollständigem Snapshot überschreibt Snapshot-Dateien NICHT durch Szenario-Replay", () => {
  // „docker-build-image" (Reihenfolge-Index 5) trägt ein Szenario mit
  //   files: { "Dockerfile": "FROM nginx:1.27..." }.
  // Ein Stand bei questIdx 6 (eine Quest weiter) mit einem vollständigen Snapshot,
  // der denselben Schlüssel mit einem ANDEREN Wert enthält, muss nach load() den
  // Snapshot-Wert behalten. Der alte Code würde das Szenario re-mergen (Object.assign
  // in mergeScenario ist für „files" nicht idempotent) und den Snapshot-Wert überschreiben.
  const nextIdx = 6; // docker-build-image liegt bei Index 5; wir stehen eine Quest später
  vi.setSystemTime(0);
  lsMap.set(SAVE_KEY, JSON.stringify({
    v: 5,
    data: {
      xp: 50, coins: 100, character: null,
      player: { x: 400, y: 300 },
      questIdx: nextIdx,
      currentQuestId: KQContent.QUESTS[nextIdx].id,
      questStep: 0, taskIdx: 0,
      completedQuests: KQContent.QUESTS.slice(0, nextIdx).map((q: { id: string }) => q.id),
      activeQuests: { [KQContent.QUESTS[nextIdx].id]: { step: 0, task: 0 } },
      inventory: {}, owned: [], activePet: null, activeFlag: null,
      review: {}, unlockedAbbrev: [], abbrevUsage: {}, cmdHistoryUnlocked: false,
      streak: { count: 0, lastDay: 0 }, streakHintShown: false, introSeen: false,
      questLogIntroShown: false, stats: {}, lastSeen: 0, gameDays: 0, questsSinceGate: 0,
      audio: { music: true, sfx: true, musicVol: 0.5, sfxVol: 0.8, track: "hafen" },
      settings: { events: "normal" },
      // Vollständiger Snapshot (hat „files"-Schlüssel): trägt eine MODIFIZIERTE Dockerfile-Version.
      // Kein Replay-Szenario darf diesen Wert überschreiben.
      clusterSnapshot: { files: { "Dockerfile": "SNAPSHOT-VERSION-NIE-UEBERSCHREIBEN" } },
    },
  }));
  Game.load();
  // Snapshot-Version muss nach dem Laden unverändert erhalten bleiben.
  expect(Game.sim.files["Dockerfile"]).toBe("SNAPSHOT-VERSION-NIE-UEBERSCHREIBEN");
});

/* ============================================================================
 * #510: Fitness-Function — ein CURRENT_SAVE_VERSION-Bump erzwingt Alt-Stand-Beweis.
 *
 * Das Save-Versioning hat zwei Mechanismen mit getrennter Zuständigkeit (SSOT in
 * store.ts dokumentiert): versionsgetriebene migrations[n] für STRUKTURELLE Sprünge,
 * feldbasiertes sanitizeState fürs Defaulting/Härten. Die Regel „was auf main geht,
 * darf keinen Stand brechen" hing bislang nur an einem Kommentar („neue Version? bitte
 * eine Fixture + Lade-Block ergänzen") – ein Bump OHNE echten Alt-Stand-Nachweis wäre
 * unbemerkt durchgerutscht. Dieser Test gibt der Regel Zähne:
 *
 *   1. Zu JEDER Format-Version 1..CURRENT_SAVE_VERSION muss mindestens eine volle
 *      Alt-Stand-Fixture test/fixtures/savegame-v<N>-*.json auf der Platte liegen.
 *   2. Jede solche Fixture muss von dieser Test-Datei auch WIRKLICH GELADEN werden
 *      (ihr Dateiname taucht im Quelltext auf) – eine tote Fixture, die kein Lade-Block
 *      anfasst, zählt nicht als Nachweis.
 *
 * RED-GREEN: CURRENT_SAVE_VERSION testweise +1 → es fehlt die Fixture der neuen Version
 * → rot. Bzw. eine geladene savegame-v3-*.json-Zeile entfernen → rot. Beides verifiziert.
 * ========================================================================== */

test("#510 Fitness: jede Format-Version 1..CURRENT_SAVE_VERSION hat eine GELADENE Alt-Stand-Fixture", () => {
  const files = readdirSync(FIXTURES).filter(f => /^savegame-v\d+-.*\.json$/.test(f));
  // Der eigene Quelltext ist die Wahrheit dafür, WELCHE Fixtures ein Lade-/Import-Block
  // tatsächlich anfasst (loadFixture(...)/fixtureRaw(...)/ALL_FIXTURES). Eine bloß auf der
  // Platte liegende Datei, die nirgends referenziert wird, ist kein Migrations-Nachweis.
  const src = readFileSync(fileURLToPath(import.meta.url), "utf8");

  for (let v = 1; v <= CURRENT_SAVE_VERSION; v++) {
    const forVersion = files.filter(f => new RegExp(`^savegame-v${v}-`).test(f));
    expect(
      forVersion.length,
      `Format-Version ${v} braucht mindestens eine volle Alt-Stand-Fixture ` +
      `test/fixtures/savegame-v${v}-*.json (Regel #510: CURRENT_SAVE_VERSION-Bump ` +
      `erzwingt einen echten Alt-Stand-Nachweis).`,
    ).toBeGreaterThan(0);

    const loaded = forVersion.filter(f => src.includes(f));
    expect(
      loaded.length,
      `Für Format-Version ${v} existiert eine Fixture (${forVersion.join(", ")}), aber KEINE ` +
      `wird in savemigration.test.ts geladen/importiert. Einen Lade-Block dafür schreiben ` +
      `(loadFixture / ALL_FIXTURES), sonst ist die Migration nicht abgesichert.`,
    ).toBeGreaterThan(0);
  }
});

/* ============================================================================
 * #493: JSON-Import (Game.importData) muss durch dieselbe Kette wie ein Ladevorgang.
 * Früher legte importData den Roh-String via SaveStore.write HÜLLENLOS ab und umging
 * Migration + sanitizeState → ein hüllenloser/fremdversionierter Stand wurde beim
 * nächsten readState als Version 0 fehlinterpretiert. Jetzt: migrateParsed +
 * sanitizeState + writeState in der aktuellen Versions-Hülle.
 *
 * RED-GREEN: alle Assertions prüfen den Zustand DIREKT NACH importData (ohne load()) –
 * genau dort, wo der alte Code hüllenlos/ungehärtet schrieb. Mit dem alten importData
 * gehen sie sofort rot.
 * ========================================================================== */

const ALL_FIXTURES = [
  "savegame-v1-docker-arc.json", "savegame-v1-rich.json",
  "savegame-v2-stale-index.json", "savegame-v2-allquests.json",
  "savegame-v3-current.json", "savegame-v4-current.json", "savegame-v5-current.json",
  "savegame-v6-current.json",
];

test("#493 Import-Pfad: jeder Fixture-Stand (v1..v6) wird in der AKTUELLEN Versions-Hülle abgelegt (nicht hüllenlos/alt)", () => {
  for (const f of ALL_FIXTURES) {
    lsMap.clear();
    Game.importData(fixtureRaw(f));
    const raw = SaveStore.read();
    expect(raw, `${f}: nach dem Import muss ein Stand gespeichert sein`).not.toBeNull();
    const env = JSON.parse(raw!) as { v?: unknown; data?: unknown };
    // Kern des Bugs: der importierte Stand liegt jetzt IN der aktuellen Hülle, nicht mehr
    // roh in seiner Alt-Version (v1..v4) oder ganz ohne Hülle.
    expect(env.v, `${f}: gespeicherte Version muss die aktuelle sein`).toBe(CURRENT_SAVE_VERSION);
    expect(typeof env.data, `${f}: Nutzlast muss ein Objekt sein`).toBe("object");
  }
});

test("#493 Import-Pfad: ein HÜLLENLOSER Alt-Stand (Format-Version 0) wird beim Import migriert + gehüllt", () => {
  // Ein blanker GameState ohne { v, data }-Hülle – so lagen Stände VOR der Versionierung
  // (bzw. so sieht eine handgeschriebene/fremde Backup-Datei aus). Der alte importData legte
  // genau das roh ab → readState hätte es korrekt als v0 lesen müssen, aber es lief nie durch
  // sanitizeState. Jetzt: als v0 migriert, gehärtet, in aktueller Hülle gespeichert.
  Game.importData(JSON.stringify({ xp: 7, coins: 50, questIdx: 2 }));
  const env = JSON.parse(SaveStore.read()!) as { v?: unknown; data?: { xp?: unknown; coins?: unknown } };
  expect(env.v).toBe(CURRENT_SAVE_VERSION);
  expect(env.data?.xp).toBe(7);
  expect(env.data?.coins).toBe(50);
});

test("#493 Import-Pfad RED-GREEN: kaputter Stand wird schon BEIM IMPORT gehärtet (nicht erst beim Laden)", () => {
  // savegame-v2-corrupt.json trägt Müllwerte (coins:"viel", xp:-50, clusterSnapshot:[1,2,3] …).
  // Der alte importData schrieb genau diesen Müll roh weg; sanitizeState lief erst beim späteren
  // load(). Jetzt härtet der Import selbst – der PERSISTIERTE Stand ist bereits sauber.
  Game.importData(fixtureRaw("savegame-v2-corrupt.json"));
  const env = JSON.parse(SaveStore.read()!) as { v?: unknown; data?: Record<string, unknown> };
  expect(env.v).toBe(CURRENT_SAVE_VERSION);
  const data = env.data!;
  expect(data.coins).toBe(40);   // "viel" → Default
  expect(data.xp).toBe(0);       // -50 → Default
  expect(data.character).toBeNull(); // "Hans" → null
  expect(Array.isArray(data.clusterSnapshot)).toBe(false); // [1,2,3] verworfen
  // completedQuests war ein String → sauberes Array.
  expect(Array.isArray(data.completedQuests)).toBe(true);
});

test("#493 Import-Pfad ≙ Ladepfad: importieren+laden ergibt exakt denselben kanonischen Stand wie direktes Laden", () => {
  // Beide Wege müssen zu byte-identischer Persistenz führen – der Import ist nur ein weiterer
  // Eingang in dieselbe Normalisierung. Uhr auf den gespeicherten lastSeen pinnen (keine
  // Offline-Einnahmen), damit der Vergleich deterministisch ist.
  const raw = fixtureRaw("savegame-v1-rich.json");
  const env = JSON.parse(raw) as { data?: { lastSeen?: unknown } };
  const lastSeen = typeof env?.data?.lastSeen === "number" ? env.data.lastSeen : 0;

  // Pfad 1: direkt in die Persistenz einspielen + laden.
  vi.setSystemTime(lastSeen);
  lsMap.clear();
  lsMap.set(SAVE_KEY, raw);
  Game.load();
  const viaLoad = SaveStore.read();

  // Pfad 2: über den JSON-Import + laden.
  vi.setSystemTime(lastSeen);
  lsMap.clear();
  Game.importData(raw);
  Game.load();
  const viaImport = SaveStore.read();

  expect(viaImport).toBe(viaLoad);
});
