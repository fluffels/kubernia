/* Geteilte Bausteine des game.ts-Splits (#392). Anwendungsschicht, Phaser-frei.
 * Hier liegt, was MEHRERE game/*-Bündel brauchen:
 *  - der permissiv typisierte this-Helfer (part/GameSelf, exakt wie ui/shared.ts #356),
 *  - die ID<->Index-Brücke des Quest-Fortschritts (#353) – von save (sanitize) UND
 *    progression (advanceStep/jumpToQuest) genutzt,
 *  - makeDefaultState als kanonischer Default-Stand (save + progression),
 *  - der EventMode-Guard (save-Sanitize + economy-Setter),
 *  - die zentral tunebaren Freischalt-Schwellen (save-Grandfathering + unlocks; vom
 *    Barrel public re-exportiert, weil ui/radio.ts + Tests sie importieren).
 * Bewusst KEIN Import aus anderen game/*-Modulen – shared bleibt das zyklenfreie Blatt. */
import { KQContent } from "../content";
import { coins } from "../core/coins";
import type { Coins } from "../core/coins";
import type { Sim } from "../sim";
import type { GameState, EventMode, QuestProgress, Quest, QuestStep, FunkStep, QuestTask } from "../types";
import type { GameClock } from "../core/clock";
import type { CmdCard, QuizCard } from "../content/loader";

/* ---------- Rückgabe-Typen der Bündel-Oberfläche ---------- */

/** Ein Rang-Eintrag (XP-Schwelle + Anzeige) – der Element-Typ von `KQContent.RANKS`.
 *  Als benannter Typ, damit `rank()`/`nextRank()` in `GameApi` ihn tragen können. */
export type Rank = { xp: number; name: string; icon: string };

/** Konkrete Stellschrauben pro Spiel-Feel-Stufe (#71). Bewusst eine reine Daten-Form,
 *  die Wirtschaft (game/economy.ts) und Events (scenes.ts via Game.eventProfile())
 *  gemeinsam nutzen. Liegt hier im zyklenfreien Blatt, weil `GameApi` sie als
 *  Rückgabetyp von `eventProfile()` braucht (shared darf kein game/*-Modul importieren). */
export interface EventProfile {
  /** Faktor auf die Wartezeit bis zum nächsten Event (größer = seltener; Infinity = nie). */
  spawnScale: number;
  /** Faktor auf die Reparatur-Deadline (größer = mehr Zeit = sanfter). */
  deadlineScale: number;
  /** Anteil der Einnahmen, den ein kaputter Dienst trotzdem abwirft (0 = voller Malus, 1 = kein Malus). */
  malusFactor: number;
  /** Schaltet Zufalls-Events ganz an/aus. */
  enabled: boolean;
}

/** Anzeigefertige Slot-Beschreibung für den Spielstand-Wähler (#306). Die Anwendungsschicht
 *  leitet Rang/Quest-Titel aus den Roh-Zahlen ab, damit die UI dumm bleibt. Liegt hier (statt
 *  in save.ts), weil `GameApi.slots()` sie als Rückgabetyp trägt. */
export interface SlotView {
  id: string;
  name: string;
  /** Ist das der gerade gespielte Slot? */
  active: boolean;
  /** Frischer, noch nicht bespielter Slot (keine Vorschau/kein Charakter)? */
  isNew: boolean;
  xp: number;
  rankIcon: string;
  rankName: string;
  /** Index der fokussierten Quest (0-basiert) bzw. = questTotal im Endzustand. */
  questIdx: number;
  questTotal: number;
  questTitle: string;
  /** Zeitstempel des letzten Speicherns (ms), 0 = noch nie. */
  lastSeen: number;
}

/** Die veränderlichen Zustandsfelder der Game-Fassade (in game.ts initialisiert, von load()
 *  ersetzt). Behalten ihren echten Typ, damit der save-kritische Zugriff `this.state.*` voll
 *  typgeprüft bleibt. */
export interface GameData {
  state: GameState;
  sim: Sim;
  incomeAcc: number;
  offlineEarnings: number;
  /** #279: Zahl der beim letzten Laden NACHGESCHOBENEN Lernkarten (Backfill). Flüchtig
   *  (RAM), NICHT Teil von GameState/Save – nur damit die Präsentation einmalig einen
   *  sanften „Es gibt Neues zu lernen"-Hinweis zeigen kann. */
  newLearnCards: number;
  /** Wiederspiel-Sandbox (#332): geklonter Live-Stand während eines Replays, sonst
   *  null. Flüchtig (RAM), NICHT Teil von GameState/Save. */
  replayBookmark: GameState | null;
}

/** Die vollständige Oberfläche der komponierten Game-Fassade: Zustandsfelder (GameData) +
 *  alle Methoden der game/*-Bündel. DIES ist der `this`-Typ der Bündel (ThisType unten) UND
 *  der Typ, gegen den game.ts die Komposition (`Game`) prüft. Damit ist die Cross-Bündel-
 *  Oberfläche voll typgeprüft (#513): ein Tippfehler `this.iComeRate()` fällt jetzt auf,
 *  früher schluckte ihn eine `[key:string]: any`-Index-Signatur. Der Compiler hält die Liste
 *  ehrlich – eine neue Bündel-Methode MUSS hier stehen, sonst schlägt der Typecheck von
 *  `Game` bzw. jeder Aufrufer fehl. Die reinen Rechenkerne liegen als freie Funktionen
 *  (pickWeighted/canonicalActiveQuests) unten und sind isoliert testbar. */
export interface GameApi extends GameData {
  // ---- economy.ts: Hafen-Wirtschaft, Streak, XP/Rang, Dublonen, Shop ----
  eventProfile(): EventProfile;
  setEventMode(mode: EventMode): void;
  incomeRate(): number;
  economyTick(dt: number): number;
  touchStreak(): void;
  coinMultiplier(): number;
  rankIndex(xp?: number): number;
  rank(): Rank;
  nextRank(): Rank | null;
  addXp(amount: number): boolean;
  addCoins(amount: number): Coins;
  spendCoins(amount: number): boolean;
  buy(itemId: string): { ok: boolean; msg: string };
  useConsumable(itemId: string): boolean;
  hasUpgrade(id: string): boolean;

  // ---- save.ts: Laden/Speichern/Reset/Export/Import + Save-Slots (#306) ----
  load(): void;
  save(syncFromScene?: boolean): void;
  reset(): void;
  exportData(): string | null;
  importData(json: string): void;
  slotSummary(): { xp: number; coins: Coins; questIdx: number; lastSeen: number; character: number | null };
  slots(): SlotView[];
  newSlot(name?: string): string;
  switchSlot(id: string): boolean;
  renameSlot(id: string, name: string): boolean;
  deleteSlot(id: string): { ok: boolean; reload: boolean };

  // ---- progression.ts: Quest-Fortschritt, Dev-Sprung, offene Quests, Üben ----
  // currentQuest ist (wie in der Sim, noUncheckedIndexedAccess aus) non-null typisiert:
  // KQContent.QUESTS[idx] gilt dem Compiler als Quest, `|| null` bleibt darum Quest.
  currentQuest(): Quest;
  currentStep(): QuestStep | null;
  isFunkStep(step: QuestStep | null): step is FunkStep;
  stepTasks(step: QuestStep): QuestTask[] | null;
  unlockedCommandFamilies(): Set<string>;
  advanceStep(): { questDone?: Quest };
  allQuestsDone(): boolean;
  pointsToKralleAfterFirstQuest(): boolean;
  getQuestRoadmap(): { idx: number; id: string; title: string; giver: string; giverName: string; steps: number; completed: boolean }[];
  spawnAtQuestGiver(questIdx: number): void;
  jumpToQuest(questIdx: number): boolean;
  activeQuestIds(): string[];
  isQuestActive(id: string): boolean;
  isQuestCompleted(id: string): boolean;
  questProgress(id: string): QuestProgress | null;
  questPrereqsMet(id: string): boolean;
  canStartQuest(id: string): boolean;
  startQuest(id: string): boolean;
  practiceDrillsFor(npcId: string): string[];

  // ---- unlocks.ts: verdiente Abkürzungen (#313) + Befehlshistorie (#316) ----
  isAbbrevUnlocked(id: string): boolean;
  unlockAbbrev(id: string): void;
  recordAbbrevLongFormUse(id: string): boolean;
  isCmdHistoryUnlocked(): boolean;
  maybeUnlockCmdHistory(): boolean;

  // ---- spaced-repetition.ts: Leitner-Plan, Review-Gate, Übungs-Lernstand (#219) ----
  ensureReviewItem(itemId: string): boolean;
  seedQuestCards(questId: string): number;
  registerQuestCards(questId: string): void;
  backfillReviewItems(): number;
  reviewResult(itemId: string, correct: boolean): void;
  choiceResult(itemId: string, correct: boolean): void;
  dueReviewItems(limit?: number): string[];
  shouldReviewGate(): boolean;
  freeReviewItems(limit?: number): string[];
  recordKrallePractice(): { milestone: string | null; aside: string | null };
  // Genau eine der beiden Karten ist je Treffer gesetzt (kind "cmd" → card, "quiz" → q); der
  // Aufrufer diskriminiert über `kind` und greift per `!` zu (ui/quiz.ts) – Form gespiegelt zum
  // inferierten Rückgabetyp der Methode.
  findReviewContent(itemId: string): { kind: string; card?: CmdCard; q?: QuizCard } | null;
  masteryBox(itemId: string): number;
  recordPractice(itemId: string, correct: boolean): void;
  masteryWeight(itemId: string): number;
  pickWeightedPractice(pool: string[], rand?: () => number): string;
  pickWeightedDrills(pool: string[], count: number, rand?: () => number): string[];

  // ---- clock.ts: persistente Spiel-Zeit / Kalender (#413) ----
  advanceClock(deltaMs: number): void;
  calendar(): GameClock;

  // ---- tick.ts: szenen-neutraler Frame-Takt (#501) ----
  tick(deltaMs: number): void;

  // ---- sandbox.ts: Wiederspiel-Sandbox (#332) ----
  isReplaying(): boolean;
  startReplay(questIdx: number): boolean;
  endReplay(): boolean;
}

/** Typisiert ein Methodenbündel so, dass this = GameApi ist, ohne die Methoden-Signaturen
 *  zu verlieren (ThisType-Muster). Damit sind die quer über die Bündel aufgerufenen Methoden
 *  (this.save(), this.incomeRate() …) voll typgeprüft (#513). */
export function part<T>(b: T & ThisType<GameApi>): T { return b; }

/** Sentinel in `unlockedAbbrev`: „alle Abkürzungen freigeschaltet". Für Alt-Spielstände
 *  von vor der Freischalt-Mechanik (#287/#297) – so erlebt niemand einen Rückschritt,
 *  wenn das Gating (#299) aktiv wird. Neue Spiele starten mit leerem Array. */
export const ALL_ABBREV_UNLOCKED = "*";

/** Schwelle (#313): so oft muss die Langform korrekt getippt werden, bis sich die
 *  zugehörige Kurzform „verdient" und freischaltet. Zentral & bewusst tunebar. */
export const ABBREV_EARN_THRESHOLD = 20;

/** Schwelle (#316): so viele Befehle müssen im Funkgerät-Terminal getippt sein, bis die
 *  ↑/↓-Befehlshistorie „durch Nutzung" freigeschaltet wird. Bewusst früh – es soll ein
 *  spürbares kleines Upgrade sein, sobald man das Terminal ein paar Mal benutzt hat. */
export const CMD_HISTORY_UNLOCK_AT = 10;

export function today() {
  const now = new Date();
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);
}

/** Spiel-Feel-Stufe erkennen (Typ-Guard fürs Narrowing). */
export function isEventMode(v: unknown): v is EventMode {
  return v === "normal" || v === "cozy" || v === "off";
}

/* ---------- Quest-Fortschritt: ID <-> Laufzeit-Index (#353) ----------
 * Persistiert wird die Quest-ID (currentQuestId), gespielt wird mit dem Index. Diese
 * beiden Helfer sind die einzige Brücke dazwischen – so bleibt der Index ein rein
 * abgeleiteter Laufzeitwert und Quests einschieben/umsortieren bricht keinen Stand. */

/** Sentinel für „alle Quests durch" (Index === QUESTS.length): kein aktiver Quest,
 *  daher leere ID. Ein FEHLENDES Feld heißt dagegen „Alt-Stand vor #353" (→ aus questIdx
 *  migrieren) – bewusst unterscheidbar von "" (= bewusst am Ende). */
const QUEST_DONE_ID = "";

/** Quest-ID für einen Laufzeit-Index. Endzustand (QUESTS.length) → "" (= durch). */
export function questIdForIndex(idx: number): string {
  return KQContent.QUESTS[idx]?.id ?? QUEST_DONE_ID;
}

/** Laufzeit-Index für eine gespeicherte Quest-ID. "" → Endzustand (QUESTS.length).
 *  Unbekannte ID (z.B. Quest später entfernt) → -1; der Aufrufer entscheidet den Fallback,
 *  damit ein Stand nie kommentarlos auf Quest 0 zurückfällt. */
export function questIndexForId(id: string): number {
  if (id === QUEST_DONE_ID) return KQContent.QUESTS.length;
  return KQContent.QUESTS.findIndex(q => q.id === id);
}

/* ---------- Offene Quests als Menge: Kanonisierung (#410) ----------
 * `activeQuests` (Quest-ID → Fortschritt) ist die Persistenz-Autorität für MEHRERE
 * gleichzeitig offene Quests. Damit der Save byte-stabil bleibt (Roundtrip-Fixpunkt
 * in savemigration.test.ts), bringen wir die Schlüssel in eine deterministische
 * Reihenfolge: die der quest-order (QUESTS-Reihenfolge), unabhängig davon, in welcher
 * Reihenfolge Einträge hinzukamen. Unbekannte IDs (entfernte Quests) fallen dabei weg. */

/** Offene Quests kanonisch ordnen (Schlüssel in QUESTS-Reihenfolge, unbekannte raus).
 *  Gibt ein NEUES Objekt zurück und kopiert die Fortschritts-Werte flach (keine Mutation). */
export function canonicalActiveQuests(active: Record<string, QuestProgress>): Record<string, QuestProgress> {
  const out: Record<string, QuestProgress> = {};
  for (const q of KQContent.QUESTS) {
    const p = active[q.id];
    if (p) out[q.id] = { step: p.step, task: p.task };
  }
  return out;
}

/* ---------- Gewichtete Auswahl: reiner Kern (#513) ----------
 * Herausgezogen aus `pickWeightedPractice` (game/spaced-repetition.ts), das nur über das
 * voll komponierte Game erreichbar (und damit schwer isoliert testbar) war. Der eigentliche
 * Auswahl-Algorithmus hängt an KEINEM Spielzustand – nur an einer Gewichts-Funktion – und
 * gehört darum als freie, pur testbare Funktion hierher (analog canonicalActiveQuests). */

/** Zieht EIN Element aus `pool` gewichtet zufällig: `weightOf` gibt je Element sein Gewicht
 *  (höher = häufiger), `rand` eine Zahl in [0,1). Leerer Pool → undefined. Landet der gezogene
 *  Punkt jenseits der Gewichtssumme (Rundung), fällt die Wahl auf das letzte Element. */
export function pickWeighted<T>(pool: T[], weightOf: (item: T) => number, rand: () => number): T | undefined {
  if (pool.length === 0) return undefined;
  const weights = pool.map(weightOf);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/** Frischer Spielstand – genau die Form von GameState. */
export function makeDefaultState(): GameState {
  return {
    xp: 0,
    coins: coins(40),
    character: null,
    // Erststart direkt neben Ole, dem Hafenmeister (#288): kein orientierungsloses
    // Loslaufen mehr – man steht in Redeweite vor der Hafenmeisterei, der Begrüßungs-
    // Dialog holt ab und der "!"-Marker/erste Auftrag ist sofort da. Ole steht auf
    // Kachel (26; 14,6) -> Solid-Kachel (26;15); dieser Punkt liegt eine Kachel
    // links davon (Pixel), begehbar und innerhalb der Redeweite (1,7 Kacheln).
    // Returning-Spieler überschreiben das mit ihrer gespeicherten Position.
    player: { x: 400, y: 248 },
    // Offene Quests (#410): die erste Quest ist der einzige offene Eintrag. Persistenz-
    // Autorität; die linearen Felder darunter sind ihre abgeleitete Arbeitskopie.
    activeQuests: { [questIdForIndex(0)]: { step: 0, task: 0 } },
    currentQuestId: questIdForIndex(0), // fokussierte (lineare) Quest; Spiegel von activeQuests (#353/#410)
    questIdx: 0,
    questStep: 0,
    taskIdx: 0,
    completedQuests: [],
    inventory: {},
    owned: [],
    activePet: null,
    activeFlag: null,
    review: {},
    mastery: {},
    streak: { count: 0, lastDay: 0 },
    streakHintShown: false,
    introSeen: false,
    questLogIntroShown: false,
    unlockedAbbrev: [],
    abbrevUsage: {},
    cmdHistoryUnlocked: false,
    stats: { commands: 0, reviews: 0, quizRight: 0, quizWrong: 0, piratesBeaten: 0, krakenBeaten: 0, stackBest: 0, krallePractice: 0 },
    lastSeen: 0,
    clusterSnapshot: null,
    audio: { music: true, sfx: true, musicVol: 0.5, sfxVol: 0.8, track: "hafen" },
    settings: { events: "normal" },
    questsSinceGate: 0,
    // Spiel-Zeit-Achse (#413): frischer Stand startet bei Tag 1. gameDays 0 zeigt seit
    // #336 den frühen Morgen (06:00) statt Mittag – die Start-Tageszeit liegt als
    // gemeinsamer START_PHASE-Offset in clock.ts, nicht in diesem Achsen-Nullpunkt.
    gameDays: 0,
  };
}
