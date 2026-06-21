/* Persistenz & defensive Spielstand-Sanitisierung (#392, game.ts-Split).
 * Laden/Speichern/Reset/Export/Import + sanitizeState (härtet jeden bekannten Feldwert
 * gegen die Defaults ab) + die eingefrorene Quest-ID-Migrations-Map (#354).
 * ⚠️ Save-kritisch: bestehende Stände müssen exakt gleich laden – Logik unverändert
 * aus game.ts übernommen (#392 ist reines Refactoring, keine Format-Migration). */
import { KQContent } from "../content";
import { Sim as KQSim } from "../sim";
import { SaveStore } from "../store";
import { worldScene, applyAudioConfig } from "../runtime";
import type { GameState, QuestProgress } from "../types";
import { part, makeDefaultState, questIdForIndex, questIndexForId, canonicalActiveQuests, isEventMode, ALL_ABBREV_UNLOCKED } from "./shared";

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
/** Endliche, nicht-negative Ganzzahl (XP, Münzen, Indizes, Zähler) – sonst Default. */
function safeCount(v: unknown, def: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : def;
}
/** Endliche Zahl (Weltkoordinaten dürfen auch negativ sein) – sonst Default. */
function safeNum(v: unknown, def: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : def;
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

export function sanitizeState(raw: unknown): GameState {
  const def = makeDefaultState();
  if (!isPlainObject(raw)) return def; // primitiver/kaputter Stand -> komplett frisch

  // Inventar: nur Einträge mit endlicher, nicht-negativer Stückzahl behalten.
  const inventory: Record<string, number> = {};
  if (isPlainObject(raw.inventory)) {
    for (const [id, n] of Object.entries(raw.inventory)) {
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) inventory[id] = Math.floor(n);
    }
  }

  // Spaced-Repetition: nur valide { box (1..5), due } übernehmen.
  const review: GameState["review"] = {};
  if (isPlainObject(raw.review)) {
    for (const [id, info] of Object.entries(raw.review)) {
      if (!isPlainObject(info)) continue;
      const box = Math.min(5, Math.max(1, safeCount(info.box, 1)));
      review[id] = { box, due: safeCount(info.due, 0) };
    }
  }

  // Stats: auf den Default-Stats aufsetzen und nur endliche Zahlen überschreiben;
  // dynamische Zusatz-Stats (z.B. stormsFixed) bleiben erhalten, solange Zahl.
  const stats = def.stats;
  if (isPlainObject(raw.stats)) {
    for (const [k, n] of Object.entries(raw.stats)) {
      if (typeof n === "number" && Number.isFinite(n)) stats[k] = n;
    }
  }

  const player = isPlainObject(raw.player) ? raw.player : {};
  const streak = isPlainObject(raw.streak) ? raw.streak : {};

  // „Verdiente Abkürzungen" (#297): vorhandenes Feld einfach übernehmen. Fehlt es ganz,
  // stammt der Stand von VOR dieser Mechanik – wer schon Fortschritt hat, wird per
  // Sentinel "*" grandfathered (alles frei), damit das spätere Gating (#299) kein bereits
  // gelerntes Kürzel rückwirkend sperrt. Ein frischer Stand ohne Fortschritt startet leer
  // und verdient die Kürzel regulär.
  let unlockedAbbrev: string[];
  if (raw.unlockedAbbrev !== undefined) {
    unlockedAbbrev = safeStrArray(raw.unlockedAbbrev);
  } else {
    const hatFortschritt = safeCount(raw.xp, 0) > 0 || safeCount(raw.questIdx, 0) > 0 ||
      (Array.isArray(raw.completedQuests) && raw.completedQuests.length > 0);
    unlockedAbbrev = hatFortschritt ? [ALL_ABBREV_UNLOCKED] : [];
  }

  // Nutzungszähler je Baustein (#313): nur endliche, nicht-negative Zahlen übernehmen.
  // Fehlt das Feld (Alt-Stand), bleibt es leer – kein Bruch, kein Rückschritt.
  const abbrevUsage: Record<string, number> = {};
  if (isPlainObject(raw.abbrevUsage)) {
    for (const [id, n] of Object.entries(raw.abbrevUsage)) {
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) abbrevUsage[id] = Math.floor(n);
    }
  }

  // Quest-Fortschritt auflösen (#353): die Quest-ID ist die Autorität, der numerische
  // questIdx nur abgeleitet. So bricht das Einfügen/Umsortieren von Quests keinen Stand.
  //   - currentQuestId vorhanden (Stand ab #353): ID gewinnt -> Index daraus auflösen.
  //       Unbekannte ID (Quest entfernt) -> Fallback auf den (geklemmten) Zahl-Index,
  //       damit Fortschritt nicht still auf Quest 0 zurückfällt.
  //   - currentQuestId fehlt (Alt-Stand VOR #353): aus dem numerischen questIdx ableiten.
  // Danach wird die ID kanonisch aus dem aufgelösten Index neu gesetzt (Endzustand -> "").
  // Save-Migration #354: eine evtl. alte Quest-ID (q5, …) zuerst auf den neuen Slug heben.
  let questIdx: number;
  if (typeof raw.currentQuestId === "string") {
    const resolved = questIndexForId(migrateQuestId(raw.currentQuestId));
    questIdx = resolved >= 0 ? resolved : safeCount(raw.questIdx, def.questIdx);
  } else {
    questIdx = safeCount(raw.questIdx, def.questIdx);
  }
  if (questIdx > KQContent.QUESTS.length) questIdx = KQContent.QUESTS.length; // nie über den Endzustand
  const currentQuestId = questIdForIndex(questIdx);

  // Schritt-/Aufgaben-Stand der fokussierten Quest defensiv lesen (Arbeitskopie der linearen Felder).
  let questStep = safeCount(raw.questStep, def.questStep);
  let taskIdx = safeCount(raw.taskIdx, def.taskIdx);

  // Offene Quests als Menge auflösen (#410). Die Persistenz-Autorität ist `activeQuests`;
  // die linearen Felder oben sind nur die Arbeitskopie der FOKUSSIERTEN (linearen) Quest.
  //   - Stand ab v4: `raw.activeQuests` sanitisiert übernehmen – nur echte Quest-IDs (alte
  //     numerische via #354-Map gehoben); bereits erledigte Quests fallen raus, weil „offen"
  //     und „erledigt" sich ausschließen.
  //   - Alt-Stand (≤ v3, kein `activeQuests`): aus der fokussierten Einzel-Quest bauen – genau
  //     ein offener Eintrag (oder keiner im Endzustand). Das ist die verlustfreie Migration
  //     „bestehender Einzel-Stand → Set mit einem Eintrag".
  const completedSet = new Set(safeStrArray(raw.completedQuests).map(migrateQuestId));
  const active: Record<string, QuestProgress> = {};
  if (isPlainObject(raw.activeQuests)) {
    for (const [rawId, prog] of Object.entries(raw.activeQuests)) {
      const id = migrateQuestId(rawId);
      if (questIndexForId(id) < 0) continue;   // unbekannte/entfernte Quest -> raus
      if (completedSet.has(id)) continue;      // erledigt gewinnt -> nicht zugleich offen
      if (!isPlainObject(prog)) continue;
      active[id] = { step: safeCount(prog.step, 0), task: safeCount(prog.task, 0) };
    }
  } else if (currentQuestId !== "") {
    active[currentQuestId] = { step: questStep, task: taskIdx };
  }
  // Invariante: die fokussierte Quest ist (außer im Endzustand) immer offen – fehlt sie in
  // einem v4-Stand (kaputt/manipuliert), aus den linearen Feldern ergänzen.
  if (currentQuestId !== "" && !active[currentQuestId]) active[currentQuestId] = { step: questStep, task: taskIdx };
  const activeQuests = canonicalActiveQuests(active);
  // Arbeitskopie aus der Autorität nachziehen: bei v4-Ständen kann der fokussierte Eintrag
  // aktueller sein als die top-level questStep/taskIdx (Autorität gewinnt).
  const focus = currentQuestId !== "" ? activeQuests[currentQuestId] : undefined;
  if (focus) { questStep = focus.step; taskIdx = focus.task; }

  return {
    xp: safeCount(raw.xp, def.xp),
    coins: safeCount(raw.coins, def.coins),
    character: typeof raw.character === "number" && Number.isFinite(raw.character) ? raw.character : null,
    player: { x: safeNum(player.x, def.player.x), y: safeNum(player.y, def.player.y) },
    activeQuests,
    currentQuestId,
    questIdx,
    questStep,
    taskIdx,
    completedQuests: safeStrArray(raw.completedQuests).map(migrateQuestId), // alte Quest-IDs -> neue Slugs (#354)
    inventory,
    owned: safeStrArray(raw.owned),
    activePet: safeStrOrNull(raw.activePet),
    activeFlag: safeStrOrNull(raw.activeFlag),
    review,
    streak: { count: safeCount(streak.count, 0), lastDay: safeCount(streak.lastDay, 0) },
    streakHintShown: typeof raw.streakHintShown === "boolean" ? raw.streakHintShown : def.streakHintShown,
    introSeen: typeof raw.introSeen === "boolean" ? raw.introSeen : def.introSeen,
    questLogIntroShown: typeof raw.questLogIntroShown === "boolean" ? raw.questLogIntroShown : def.questLogIntroShown,
    unlockedAbbrev,
    abbrevUsage,
    // #316: additives Bool-Flag wie die Abkürzungs-Freischaltung – fehlt es (Alt-Stand),
    // gilt der Default (gesperrt); ein bestehender Vielspieler schaltet es beim nächsten
    // getippten Befehl regulär frei (kein Bruch, kein Versions-Bump nötig).
    cmdHistoryUnlocked: typeof raw.cmdHistoryUnlocked === "boolean" ? raw.cmdHistoryUnlocked : def.cmdHistoryUnlocked,
    stats,
    lastSeen: safeCount(raw.lastSeen, def.lastSeen),
    // Snapshot ist ein freies Sim-Objekt; nur ein echtes Objekt akzeptieren, sonst null.
    clusterSnapshot: isPlainObject(raw.clusterSnapshot) ? raw.clusterSnapshot : null,
    audio: safeAudio(raw.audio),
    settings: safeSettings(raw.settings),
    questsSinceGate: safeCount(raw.questsSinceGate, 0),
  };
}

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
    // Szenarien bereits erreichter Funk-Schritte wieder einmischen
    for (let qi = 0; qi <= Math.min(this.state.questIdx, KQContent.QUESTS.length - 1); qi++) {
      const quest = KQContent.QUESTS[qi];
      quest.steps.forEach((step, si) => {
        if (step.scenario && (qi < this.state.questIdx || si <= this.state.questStep)) {
          const sc = Object.assign({}, step.scenario);
          if (this.state.clusterSnapshot) delete sc.deployments;
          this.sim.mergeScenario(sc);
        }
      });
    }
    this.touchStreak();
    // Offline-Einnahmen: dein Hafen hat weitergearbeitet (max. 4 Stunden, halber Satz)
    this.offlineEarnings = 0;
    if (this.state.lastSeen) {
      const minutes = Math.min(240, (Date.now() - this.state.lastSeen) / 60000);
      this.offlineEarnings = Math.floor(minutes * this.incomeRate() * 0.5);
      if (this.offlineEarnings > 0) this.state.coins += this.offlineEarnings;
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
    if (this.sim) this.state.clusterSnapshot = this.sim.snapshot();
    const ws = worldScene();
    if (syncFromScene && ws && ws.player) {
      this.state.player = { x: ws.player.x, y: ws.player.y };
    }
    // Fokussierte Quest in die Autorität (activeQuests) einfalten + kanonisieren (#410):
    // so spiegelt der persistierte Stand die lineare Arbeitskopie (questStep/taskIdx) wider
    // und die Schlüssel-Reihenfolge bleibt byte-stabil (Roundtrip-Fixpunkt).
    if (this.state.currentQuestId) {
      this.state.activeQuests[this.state.currentQuestId] = { step: this.state.questStep, task: this.state.taskIdx };
    }
    this.state.activeQuests = canonicalActiveQuests(this.state.activeQuests);
    this.state.lastSeen = Date.now();
    SaveStore.writeState(this.state); // legt den Stand in der aktuellen Versions-Hülle ab
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
    JSON.parse(json); // wirft bei ungültiger Datei
    SaveStore.write(json);
  },
});
