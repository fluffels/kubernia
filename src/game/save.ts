/* Persistenz & defensive Spielstand-Sanitisierung (#392, game.ts-Split).
 * Laden/Speichern/Reset/Export/Import + sanitizeState (härtet jeden bekannten Feldwert
 * gegen die Defaults ab) + die eingefrorene Quest-ID-Migrations-Map (#354).
 * ⚠️ Save-kritisch: bestehende Stände müssen exakt gleich laden – Logik unverändert
 * aus game.ts übernommen (#392 ist reines Refactoring, keine Format-Migration). */
import { KQContent } from "../content";
import { Sim as KQSim } from "../sim";
import { SaveStore } from "../store";
import { worldScene, applyAudioConfig, notifySaveFailed } from "../runtime";
import { add, toCoins } from "../core/coins";
import type { GameState, QuestProgress, QuestStep, LeitnerEntry } from "../types";
import { part, makeDefaultState, questIdForIndex, questIndexForId, canonicalActiveQuests, isEventMode, ALL_ABBREV_UNLOCKED, type SlotView } from "./shared";

/** Save-Migration #354: alte numerische Quest-IDs (q0, q2b, …) → neue sprechende Slugs.
 *  Quest-IDs sind in Spielständen persistiert (completedQuests + currentQuestId aus #353),
 *  also dürfen sie beim Umbenennen NICHT brechen – bestehende Spieler behalten ihren
 *  exakten Fortschritt. Diese Tabelle ist die EINMALIGE, eingefrorene Übersetzung
 *  (historische Migration, nicht mehr ändern). Unbekannte/neue IDs bleiben unverändert. */
const LEGACY_QUEST_ID_MAP: Record<string, string> = {
  q0: "onboarding-sign-on", q1: "docker-first-container", q2: "docker-list-containers",
  q2b: "docker-stack-minigame", q3: "docker-run-options", q3b: "docker-build-image",
  q4: "k8s-first-deployment", q5: "k8s-inspect-pods", q6: "k8s-service",
  q7: "k8s-self-healing", q8: "k8s-apply-manifests", q9: "helm-intro",
  q10: "helm-release-install", q11: "helm-upgrade-rollback", q12: "terraform-intro",
  q13: "terraform-state-destroy", q14: "kraken-boss", q15: "k8s-debug-imagepull",
  q16: "k8s-debug-crashloop", q17: "k8s-node-capacity", q18: "git-version-control",
  q19: "git-feature-branch", q20: "git-pipeline", q21: "helm-umbrella-chart",
  q22: "network-policy", q23: "secrets-encrypted", q24: "k8s-service-endpoints",
  q25: "git-merge-branches", q26: "k8s-configmap-secret", q27: "k8s-resource-limits",
  q28: "gitops-argocd-intro", q29: "gitops-self-sync", q30: "gitops-drift-detection",
  q31: "gitops-app-of-apps", q32: "observability-metrics", q33: "observability-grafana",
  q34: "observability-logs", q35: "observability-alerts", q36: "storage-statefulset",
  q37: "storage-pvc",
};
/** Hebt eine evtl. alte Quest-ID auf den aktuellen Slug (No-op für bereits neue/fremde IDs). */
function migrateQuestId(id: string): string {
  return LEGACY_QUEST_ID_MAP[id] ?? id;
}

/* ---------- Defensive Validierung beim Laden ----------
 * readState() (store.ts) hebt einen Alt-Stand aufs aktuelle FORMAT, prüft aber
 * nicht den INHALT der Felder. Ein manipulierter Import (importData) oder ein
 * über viele Versionen gewanderter Stand kann kaputte/fremde Werte tragen:
 * falscher Typ, NaN/Infinity, negativ, Array statt Objekt. Früher übernahm
 * Object.assign(makeDefaultState(), data) solche Werte ungeprüft – NaN-Münzen
 * & Co. landeten direkt im Spiel.
 *
 * sanitizeState härtet jeden BEKANNTEN Feldwert gegen die Defaults ab:
 * unplausible Werte fallen auf den Default zurück, fehlende werden ergänzt,
 * unbekannte Zusatzfelder fallen weg. Ergebnis ist immer ein konsistenter
 * GameState – kein Crash, kein NaN. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Die opake Slot-Vorschau (summary) defensiv lesen: eine endliche Zahl unter `key`, sonst Default. */
function summaryNum(sum: unknown, key: string, def: number): number {
  if (isPlainObject(sum)) {
    const v = sum[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return def;
}
/** Endliche, nicht-negative Ganzzahl (XP, Münzen, Indizes, Zähler) – sonst Default. */
function safeCount(v: unknown, def: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : def;
}
/** Endliche Zahl (Weltkoordinaten dürfen auch negativ sein) – sonst Default. */
function safeNum(v: unknown, def: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : def;
}
/** Endliche, nicht-negative Zahl – anders als safeCount NICHT auf Ganzzahl gerundet
 *  (für fraktionale Werte wie die Spiel-Zeit-Achse `gameDays`, #413). Sonst Default. */
function safeNonNegNum(v: unknown, def: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : def;
}
/** String oder null – jeder andere Typ wird zu null. */
function safeStrOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
/** Array, gefiltert auf reine Strings (verwirft fremde Einträge). */
function safeStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
/** Lautstärke: endliche Zahl auf [0,1] geklemmt – sonst Default. */
function safeVol(v: unknown, def: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : def;
}
/** Spiel-Feel-Einstellungen absichern: nur eine bekannte EventMode übernehmen, sonst Default. */
function safeSettings(v: unknown): GameState["settings"] {
  const d = makeDefaultState().settings;
  const s = isPlainObject(v) ? v : {};
  return { events: isEventMode(s.events) ? s.events : d.events };
}
/** Audio-Einstellungen gegen die Defaults absichern (Booleans + geklemmte Lautstärken). */
function safeAudio(v: unknown): GameState["audio"] {
  const d = makeDefaultState().audio;
  const a = isPlainObject(v) ? v : {};
  return {
    music: typeof a.music === "boolean" ? a.music : d.music,
    sfx: typeof a.sfx === "boolean" ? a.sfx : d.sfx,
    musicVol: safeVol(a.musicVol, d.musicVol),
    sfxVol: safeVol(a.sfxVol, d.sfxVol),
    // Track als String übernehmen; die Audio-Schicht prüft ihn zur Laufzeit gegen
    // die bekannten Themes und fällt sonst auf den Default zurück.
    track: typeof a.track === "string" ? a.track : d.track,
  };
}

/** Boolean oder Default – additive Bool-Flags fehlen in Alt-Ständen (kein Bruch). */
function safeBool(v: unknown, def: boolean): boolean {
  return typeof v === "boolean" ? v : def;
}
/** Endliche Zahl oder null (z.B. die Charakter-Auswahl). */
function safeNumOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
/** Map endlicher, nicht-negativer Ganzzahlen (Inventar #313, Nutzungszähler abbrevUsage):
 *  nur plausible Einträge behalten, fremde/kaputte Werte verwerfen. Fehlt das Feld → leer. */
function sanitizeCountMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isPlainObject(v)) {
    for (const [id, n] of Object.entries(v)) {
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[id] = Math.floor(n);
    }
  }
  return out;
}
/** Leitner-Einträge { box (1..5), due } defensiv übernehmen. EINE Quelle für die
 *  gleich geformten Maps `review` (Quiz) und `mastery` (Übungen #219) – fehlt das Feld
 *  (Alt-Stand) → leer, die verlustfreie Migration. */
function sanitizeLeitnerMap(v: unknown): Record<string, LeitnerEntry> {
  const out: Record<string, LeitnerEntry> = {};
  if (isPlainObject(v)) {
    for (const [id, info] of Object.entries(v)) {
      if (!isPlainObject(info)) continue;
      const box = Math.min(5, Math.max(1, safeCount(info.box, 1)));
      out[id] = { box, due: safeCount(info.due, 0) };
    }
  }
  return out;
}
/** Auf die Default-Stats aufsetzen und nur endliche, NICHT-NEGATIVE Ganzzahlen aus dem
 *  Alt-Stand überschreiben (#511). Negative/gebrochene Werte fallen für bekannte Keys auf
 *  den Default; dynamische Zusatz-Stats (z.B. stormsFixed) werden nur bei validem Wert
 *  übernommen. Mutiert und liefert `base` (das Default-Stats-Objekt). */
function sanitizeStats(base: GameState["stats"], raw: unknown): GameState["stats"] {
  if (isPlainObject(raw)) {
    for (const [k, n] of Object.entries(raw)) {
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) base[k] = Math.floor(n);
    }
  }
  return base;
}

/** „Verdiente Abkürzungen" (#297) auflösen: vorhandenes Feld übernehmen. Fehlt es ganz,
 *  stammt der Stand von VOR der Mechanik – wer schon Fortschritt hat, wird per Sentinel "*"
 *  grandfathered (alles frei), damit das spätere Gating (#299) kein gelerntes Kürzel
 *  rückwirkend sperrt. Frischer Stand ohne Fortschritt startet leer. */
function resolveUnlockedAbbrev(raw: Record<string, unknown>): string[] {
  if (raw.unlockedAbbrev !== undefined) return safeStrArray(raw.unlockedAbbrev);
  const hatFortschritt = safeCount(raw.xp, 0) > 0 || safeCount(raw.questIdx, 0) > 0 ||
    (Array.isArray(raw.completedQuests) && raw.completedQuests.length > 0);
  return hatFortschritt ? [ALL_ABBREV_UNLOCKED] : [];
}

/** Quest-Fortschritts-Index auflösen (#353): die Quest-ID ist die Autorität, der numerische
 *  questIdx nur abgeleitet. So bricht das Einfügen/Umsortieren von Quests keinen Stand.
 *   - currentQuestId vorhanden (Stand ab #353): ID gewinnt → Index daraus. Unbekannte ID
 *     (Quest entfernt) → Fallback auf den geklemmten Zahl-Index (kein stiller Rückfall auf 0).
 *   - currentQuestId fehlt (Alt-Stand VOR #353): aus dem numerischen questIdx ableiten.
 *  Die alte Quest-ID (q5, …) wird zuerst per #354-Map auf den neuen Slug gehoben. */
function resolveQuestIdx(raw: Record<string, unknown>): number {
  let questIdx: number;
  if (typeof raw.currentQuestId === "string") {
    const resolved = questIndexForId(migrateQuestId(raw.currentQuestId));
    questIdx = resolved >= 0 ? resolved : safeCount(raw.questIdx, 0);
  } else {
    questIdx = safeCount(raw.questIdx, 0);
  }
  return Math.min(questIdx, KQContent.QUESTS.length); // nie über den Endzustand
}

/** Offene Quests als Menge auflösen (#410). Autorität ist `raw.activeQuests`; `questStep`/
 *  `taskIdx` sind nur der Migrationspfad für Alt-Stände ≤ v3 (Einzel-Quest → Menge).
 *   - Stand ab v4: `raw.activeQuests` sanitisieren – nur echte Quest-IDs (alte via #354-Map),
 *     erledigte fallen raus (AUSNAHME: die fokussierte Quest ist per Invariante immer offen,
 *     sonst ginge ihr Schritt-Stand seit #559 verloren), jeder Eintrag gegen den Content
 *     geklemmt (#511 – kein 999-Zustand persistieren).
 *   - Alt-Stand (≤ v3, kein `activeQuests`): aus der fokussierten Einzel-Quest bauen.
 *  Die Invariante „fokussierte Quest immer offen" wird abschließend erzwungen. */
function resolveActiveQuests(
  raw: Record<string, unknown>, currentQuestId: string, questStep: number, taskIdx: number,
): Record<string, QuestProgress> {
  const completedSet = new Set(safeStrArray(raw.completedQuests).map(migrateQuestId));
  const active: Record<string, QuestProgress> = {};
  if (isPlainObject(raw.activeQuests)) {
    for (const [rawId, prog] of Object.entries(raw.activeQuests)) {
      const id = migrateQuestId(rawId);
      if (questIndexForId(id) < 0) continue;                       // unbekannte/entfernte Quest
      if (completedSet.has(id) && id !== currentQuestId) continue; // „erledigt gewinnt"
      if (!isPlainObject(prog)) continue;
      active[id] = clampProgress(id, safeCount(prog.step, 0), safeCount(prog.task, 0));
    }
  } else if (currentQuestId !== "") {
    active[currentQuestId] = clampProgress(currentQuestId, questStep, taskIdx);
  }
  if (currentQuestId !== "" && !active[currentQuestId]) {
    active[currentQuestId] = clampProgress(currentQuestId, questStep, taskIdx);
  }
  return canonicalActiveQuests(active);
}

/** Zahl der über `taskIdx` adressierbaren Aufgaben eines Schritts (#511). Muss zu den
 *  einzigen Stellen passen, die `taskIdx` hochzählen (ui/radio.ts): terminal läuft über
 *  `tasks`, drill über `count`, teach hat genau die eine `cmd`. Bei dialog/choice/minigame
 *  gibt es keine per-Aufgabe-Adressierung – dort ist `taskIdx` bedeutungslos (bleibt 0). */
function stepTaskCount(step: QuestStep): number {
  switch (step.type) {
    case "terminal": return step.tasks.length;
    case "drill": return step.count;
    case "teach": return 1;
    default: return 0; // dialog / choice / minigame: kein per-Aufgabe-Index
  }
}

/** Schritt-/Aufgaben-Index einer Quest gegen ihren echten Content klemmen (#511).
 *  `step`/`task` kommen bereits nicht-negativ + ganzzahlig herein (safeCount), hier wird
 *  nur die OBERE Grenze gezogen: ein manipulierter/über viele Versionen gewanderter Stand
 *  kann questStep/taskIdx weit jenseits der real existierenden Schritte/Aufgaben tragen
 *  (z.B. 999). Ungeklemmt liefert currentStep() dann null → toter Quest-Zustand.
 *   - Kein zugehöriger Quest (unbekannte/leere ID = Endzustand) oder eine Quest ohne
 *     Schritte → {0,0}: es gibt keinen Schritt zu fokussieren, der lineare Stand ist
 *     bedeutungslos.
 *   - Sonst: Schritt auf den letzten realen Schritt klemmen; taskIdx gegen die Aufgabenzahl
 *     des so fokussierten Schritts (`stepTaskCount`) – ein Schritt ohne adressierbare
 *     Aufgaben (dialog/choice/minigame) erzwingt taskIdx 0. */
function clampProgress(questId: string, step: number, task: number): QuestProgress {
  const quest = KQContent.QUESTS[questIndexForId(questId)];
  if (!quest || quest.steps.length === 0) return { step: 0, task: 0 };
  const s = Math.min(step, quest.steps.length - 1);
  const taskCount = stepTaskCount(quest.steps[s]);
  return { step: s, task: taskCount > 0 ? Math.min(task, taskCount - 1) : 0 };
}

export function sanitizeState(raw: unknown): GameState {
  const def = makeDefaultState();
  if (!isPlainObject(raw)) return def; // primitiver/kaputter Stand -> komplett frisch

  const player = isPlainObject(raw.player) ? raw.player : {};
  const streak = isPlainObject(raw.streak) ? raw.streak : {};

  // Quest-Fortschritt auflösen (#353/#410): questIdx aus der ID-Autorität, danach die
  // kanonische ID; activeQuests ist die alleinige Persistenz-Autorität (#559), die linearen
  // questStep/taskIdx sind nur der Migrationspfad für Alt-Stände ≤ v3.
  const questIdx = resolveQuestIdx(raw);
  const currentQuestId = questIdForIndex(questIdx);
  const activeQuests = resolveActiveQuests(raw, currentQuestId, safeCount(raw.questStep, 0), safeCount(raw.taskIdx, 0));

  return {
    xp: safeCount(raw.xp, def.xp),
    coins: toCoins(safeCount(raw.coins, def.coins)),
    character: safeNumOrNull(raw.character),
    player: { x: safeNum(player.x, def.player.x), y: safeNum(player.y, def.player.y) },
    // Quest-Fortschritt: nur die Autorität persistieren (#559). Schritt/Aufgabe/Index werden
    // zur Laufzeit aus activeQuests + currentQuestId abgeleitet (Game.questStep()/taskIdx()/questIdx()).
    activeQuests,
    currentQuestId,
    completedQuests: safeStrArray(raw.completedQuests).map(migrateQuestId), // alte Quest-IDs -> neue Slugs (#354)
    inventory: sanitizeCountMap(raw.inventory),
    owned: safeStrArray(raw.owned),
    activePet: safeStrOrNull(raw.activePet),
    activeFlag: safeStrOrNull(raw.activeFlag),
    review: sanitizeLeitnerMap(raw.review),
    mastery: sanitizeLeitnerMap(raw.mastery), // gleiche Form wie review (#219)
    streak: { count: safeCount(streak.count, 0), lastDay: safeCount(streak.lastDay, 0) },
    streakHintShown: safeBool(raw.streakHintShown, def.streakHintShown),
    introSeen: safeBool(raw.introSeen, def.introSeen),
    questLogIntroShown: safeBool(raw.questLogIntroShown, def.questLogIntroShown),
    unlockedAbbrev: resolveUnlockedAbbrev(raw),
    abbrevUsage: sanitizeCountMap(raw.abbrevUsage), // Nutzungszähler je Baustein (#313)
    // #316: additives Bool-Flag wie die Abkürzungs-Freischaltung – fehlt es (Alt-Stand),
    // gilt der Default (gesperrt); ein Vielspieler schaltet es beim nächsten Befehl regulär frei.
    cmdHistoryUnlocked: safeBool(raw.cmdHistoryUnlocked, def.cmdHistoryUnlocked),
    stats: sanitizeStats(def.stats, raw.stats),
    lastSeen: safeCount(raw.lastSeen, def.lastSeen),
    // Snapshot ist ein freies Sim-Objekt; nur ein echtes Objekt akzeptieren, sonst null.
    clusterSnapshot: isPlainObject(raw.clusterSnapshot) ? raw.clusterSnapshot : null,
    audio: safeAudio(raw.audio),
    settings: safeSettings(raw.settings),
    questsSinceGate: safeCount(raw.questsSinceGate, 0),
    // Spiel-Zeit-Achse (#413): fraktionale, nicht-negative Tageszahl. Fehlt das Feld
    // (jeder Stand ≤ v4) → Default 0 (= Tag 1, Mittag); kaputt/negativ → ebenfalls 0.
    gameDays: safeNonNegNum(raw.gameDays, def.gameDays),
  };
}

/* Nach einem Slot-Wechsel (#306) wird die Seite gleich neu geladen; bis dahin darf KEIN
 * `save()` mehr laufen, sonst trägt der noch im Speicher liegende ALTE Spielstand (oder ein
 * im ~800-ms-Fenster feuernder 5-s-Auto-Save) sich in den jetzt aktiven (neuen) Slot ein – der
 * „neue" Slot würde dann nicht von vorn starten. Das Flag wird beim Reload (frisches Modul)
 * automatisch wieder false. */
let saveSuspended = false;

/* Ein fehlgeschlagener save() (voller localStorage im Fallback-Modus, QuotaExceeded) war
 * bisher für den Spieler unsichtbar (#497) – writeState meldet ihn nur einmalig in die
 * Konsole. Wir heben ihn an die Präsentation, aber nur EINMAL pro Fehler-Episode: der
 * 5-s-Auto-Save darf nicht im Sekundentakt warnen. Nach einem wieder geglückten Save
 * re-armen, damit ein späterer neuer Fehlschlag erneut gemeldet wird. */
let saveFailedNotified = false;

/** Persistenz-Methoden der Game-Fassade (Laden/Speichern/Reset/Export/Import). */
export const saveBundle = part({
  load() {
    try {
      // readState liest die Versions-Hülle und migriert Alt-Stände aufs aktuelle Format.
      const data = SaveStore.readState();
      // Defensive Sanitisierung statt blindem Object.assign: kaputte/fremde
      // Feldwerte fallen auf Defaults zurück, statt ungeprüft ins Spiel zu kommen.
      this.state = sanitizeState(data);
    } catch {
      this.state = makeDefaultState();
    }
    // Audio-Einstellungen aus dem Spielstand an die Präsentation geben – entkoppelt
    // über den Laufzeit-Sink (#344), NICHT mehr per direktem sfx.ts-Import.
    applyAudioConfig(this.state.audio);
    this.sim = new KQSim(this.state.clusterSnapshot || {});
    // Vollständiger Snapshot (erkennbar am `files`-Schlüssel, den snapshot() immer mitschreibt,
    // ältere Teil-Snapshots ihn aber nicht hatten) → Cluster-Zustand komplett eingefroren,
    // kein Szenario-Replay nötig (#436). Ohne Snapshot oder mit altem Teil-Snapshot (kein
    // `files`-Schlüssel): alle bereits erreichten Szenarien einmischen; der anschließende
    // save() schreibt dann erstmals einen vollständigen Snapshot.
    if (!this.state.clusterSnapshot || this.state.clusterSnapshot.files === undefined) {
      const curIdx = this.questIdx();
      const curStep = this.questStep();
      for (let qi = 0; qi <= Math.min(curIdx, KQContent.QUESTS.length - 1); qi++) {
        const quest = KQContent.QUESTS[qi];
        quest.steps.forEach((step, si) => {
          if (step.scenario && (qi < curIdx || si <= curStep)) {
            this.sim.mergeScenario(Object.assign({}, step.scenario));
          }
        });
      }
    }
    this.touchStreak();
    // #279 Backfill: nachträglich eingeführte Lernkarten an fortgeschrittene Spieler nachschieben.
    // Für jede schon abgeschlossene Quest sicherstellen, dass ihre (evtl. neuen) Karten im
    // Spaced-Repetition-Pool sind – idempotent, rein additiv. Die Zahl merkt sich die Präsentation
    // (flüchtig) für einen einmaligen sanften Hinweis. Nicht während eines Wiederspiels nötig
    // (dann ist der echte Stand ohnehin als Lesezeichen geparkt), aber load() läuft nie im Replay.
    this.newLearnCards = this.backfillReviewItems();
    // Offline-Einnahmen: dein Hafen hat weitergearbeitet (max. 4 Stunden, halber Satz)
    this.offlineEarnings = 0;
    if (this.state.lastSeen) {
      const minutes = Math.min(240, (Date.now() - this.state.lastSeen) / 60000);
      this.offlineEarnings = Math.floor(minutes * this.incomeRate() * 0.5);
      if (this.offlineEarnings > 0) this.state.coins = add(this.state.coins, toCoins(this.offlineEarnings));
    }
    this.save();
  },

  /** Sichert den Stand. `syncFromScene` (Default true) übernimmt dabei die
   *  aktuelle Spielerposition aus der laufenden WorldScene – das ist im normalen
   *  Spiel richtig (der 5-s-Auto-Save soll dem Spieler folgen). Wer die Position
   *  aber GERADE BEWUSST gesetzt hat (Sprung/Reset), ruft `save(false)`: sonst
   *  überschreibt die noch lebende Szene die frische Position sofort wieder und
   *  der reload landet am alten Ort (#335 / Reset-Position-Falle #295/#296). */
  save(syncFromScene = true) {
    // Nach einem Slot-Wechsel bis zum Reload nichts mehr schreiben (siehe saveSuspended) –
    // sonst landet der alte Spielstand im frisch gewählten Slot.
    if (saveSuspended) return;
    // Während eines Wiederspiels (#332) schreibt nichts in den Store: der echte
    // Stand liegt als Lesezeichen im RAM und wird erst von endReplay() wieder
    // persistiert – so gibt es keine doppelte XP/Wirtschaft und der Live-Fortschritt
    // (completedQuests/questIdx/Cluster) bleibt unangetastet.
    if (this.replayBookmark) return;
    if (this.sim) this.state.clusterSnapshot = this.sim.snapshot();
    const ws = worldScene();
    if (syncFromScene && ws && ws.player) {
      this.state.player = { x: ws.player.x, y: ws.player.y };
    }
    // Kein Einfalten einer Arbeitskopie mehr (#559): advanceStep/advanceTask/jumpToQuest
    // mutieren activeQuests direkt, es gibt keine getrennten questStep/taskIdx-Felder, die
    // gespiegelt werden müssten. Nur noch kanonisieren, damit die Schlüssel-Reihenfolge
    // byte-stabil bleibt (Roundtrip-Fixpunkt in savemigration.test.ts).
    this.state.activeQuests = canonicalActiveQuests(this.state.activeQuests);
    this.state.lastSeen = Date.now();
    // writeState meldet über den bool-Rückgabewert, ob das Schreiben klappte (#497).
    // Ein Fehlschlag (voller localStorage-Fallback) darf nicht still verpuffen –
    // einmalig pro Fehler-Episode an die Präsentation heben; ein wieder geglückter
    // Save re-armt die Meldung. Legt den Stand in der aktuellen Versions-Hülle ab.
    const written = SaveStore.writeState(this.state);
    if (!written && !saveFailedNotified) {
      saveFailedNotified = true;
      notifySaveFailed();
    } else if (written) {
      saveFailedNotified = false;
    }
    // Vorschau des aktiven Slots für den Spielstand-Wähler aktualisieren (#306). Im
    // Single-Slot-Fall (kein Index) ist das ein No-op – kein Churn beim 5-s-Auto-Save.
    SaveStore.setActiveSlotSummary(this.slotSummary());
  },

  reset() {
    SaveStore.remove();
    this.load();
    // load() endet mit save(); läuft der Reset im laufenden Spiel (Menü → Zurücksetzen),
    // lebt die WorldScene noch und save() schreibt über worldScene() die AKTUELLE
    // Spielerposition in den frisch geladenen Default-Stand zurück (#295) – der Spieler
    // bliebe also stehen, statt am Startpunkt (bei Ole, #288) zu spawnen. Darum die
    // Position explizit auf den Default zwingen und neu sichern; der anschließende
    // location.reload() (ui.resetGame) lädt dann sauber die Startposition.
    this.state.player = { ...makeDefaultState().player };
    SaveStore.writeState(this.state);
  },

  /* ---------- Spielstand als Datei sichern / laden ---------- */
  exportData() {
    this.save();
    return SaveStore.read();
  },

  importData(json: string) {
    const parsed = JSON.parse(json); // wirft bei ungültiger Datei
    // #493: Import ist das letzte Netz (JSON-Backup). Er MUSS durch dieselbe Kette wie ein
    // normaler Ladevorgang: erst aufs aktuelle FORMAT heben (Hülle erkennen/migrieren,
    // migrateParsed), dann den INHALT defensiv härten (sanitizeState) und in der AKTUELLEN
    // Versions-Hülle ablegen (writeState). Früher legte SaveStore.write(json) den String roh
    // und HÜLLENLOS ab und umging Migration + Sanitize – ein hüllenloser oder aus einer
    // anderen Version stammender Stand wurde dann beim nächsten readState als Version 0
    // fehlinterpretiert (Verstoß gegen „Save darf nie brechen").
    SaveStore.writeState(sanitizeState(SaveStore.migrateParsed(parsed)));
  },

  /* ---------- Mehrere Spielstände / Save-Slots (#306) ----------
   * game.ts kennt nur „aktiver Slot": die eigentliche Slot-Mechanik (Index, Keying,
   * Hydration) liegt in SaveStore. Hier wird nur orchestriert + die opake Vorschau gefüllt. */

  /** Kleine, opake Vorschau-Nutzlast des aktiven Slots für den Spielstand-Wähler. */
  slotSummary() {
    return {
      xp: this.state.xp,
      coins: this.state.coins,
      questIdx: this.questIdx(),
      lastSeen: this.state.lastSeen,
      character: this.state.character,
    };
  },

  /** Anzeigefertige Liste aller Slots. Der AKTIVE Slot wird aus dem Live-Zustand beschrieben
   *  (immer aktuell), die übrigen aus ihrer gespeicherten Vorschau. */
  slots(): SlotView[] {
    const activeId = SaveStore.activeSlotId();
    const total = KQContent.QUESTS.length;
    return SaveStore.listSlots().map((s) => {
      const active = s.id === activeId;
      const xp = active ? this.state.xp : summaryNum(s.summary, "xp", 0);
      const rawQuest = active ? this.questIdx() : summaryNum(s.summary, "questIdx", 0);
      const questIdx = Math.max(0, Math.min(total, Math.floor(rawQuest)));
      const lastSeen = active ? this.state.lastSeen : summaryNum(s.summary, "lastSeen", 0);
      // „Neu" = aktiver Slot ohne gesetzten Charakter (Intro noch nicht durch) bzw. ein
      // fremder Slot ganz ohne hinterlegte Vorschau (frisch angelegt, nie gespielt).
      const isNew = active ? this.state.character === null : (s.summary === undefined || s.summary === null);
      const r = KQContent.RANKS[this.rankIndex(xp)];
      return {
        id: s.id,
        name: s.name,
        active,
        isNew,
        xp,
        rankIcon: r.icon,
        rankName: r.name,
        questIdx,
        questTotal: total,
        questTitle: questIdx < total ? KQContent.QUESTS[questIdx].title : "Alles geschafft 🎉",
        lastSeen,
      };
    });
  },

  /** Neuen, leeren Slot anlegen und auf ihn wechseln (frischer Start). Gibt die neue ID
   *  zurück; der Aufrufer (UI) lädt anschließend neu. */
  newSlot(name?: string): string {
    const id = SaveStore.createSlot(name ?? "");
    // Jetzt existiert der Index → der bisher aktive Slot bekommt seine Vorschau gestempelt,
    // dann wechseln wir auf den frischen Slot.
    this.save();
    SaveStore.switchSlot(id);
    // Ab hier nichts mehr in den (jetzt aktiven, leeren) Slot schreiben, bis der Aufrufer
    // neu lädt – sonst trüge ein später feuernder Auto-Save den alten Stand hinein (#306).
    saveSuspended = true;
    return id;
  },

  /** Auf einen bestehenden Slot wechseln. Sichert vorher den aktuellen Stand. false, wenn die
   *  Ziel-ID unbekannt ist. Bei true lädt der Aufrufer neu. */
  switchSlot(id: string): boolean {
    this.save(); // die letzten Sekunden des aktuellen Slots nicht verlieren
    const ok = SaveStore.switchSlot(id);
    // Gewechselt → bis zum Reload keine Saves mehr (sonst überschreibt der alte In-Memory-
    // Stand den Ziel-Slot, #306).
    if (ok) saveSuspended = true;
    return ok;
  },

  /** Einen Slot umbenennen. false, wenn die ID unbekannt ist. */
  renameSlot(id: string, name: string): boolean {
    return SaveStore.renameSlot(id, name);
  },

  /** Einen Slot löschen. `reload` ist true, wenn der AKTIVE Slot getroffen wurde – dann muss
   *  der Aufrufer neu laden, damit der jetzt aktive Slot ins Spiel kommt. */
  deleteSlot(id: string): { ok: boolean; reload: boolean } {
    const wasActive = id === SaveStore.activeSlotId();
    const ok = SaveStore.deleteSlot(id);
    // Wurde der AKTIVE Slot gelöscht, zeigt der Zeiger jetzt woanders hin und der Aufrufer
    // lädt neu – bis dahin keine Saves mehr, sonst landet der gelöschte In-Memory-Stand im
    // neuen aktiven Slot (#306).
    if (ok && wasActive) saveSuspended = true;
    return { ok, reload: ok && wasActive };
  },
});
