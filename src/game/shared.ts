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
import type { Sim } from "../sim";
import type { GameState, EventMode, QuestProgress } from "../types";

/** this-Typ der Game-Methodenbündel (this = das komponierte Game-Objekt). Anders als
 *  UISelf in ui/shared.ts behalten die VERÄNDERLICHEN DATEN-Felder hier ihren echten Typ
 *  (state/sim/…), damit der save-kritische Zugriff (this.state.*) voll typgeprüft bleibt;
 *  nur die quer über die Bündel aufgerufenen Methoden sind über die Index-Signatur
 *  permissiv (sonst wäre der Typ zirkulär – die Bündel definieren ja erst die Methoden). */
export type GameSelf = {
  state: GameState;
  sim: Sim;
  incomeAcc: number;
  offlineEarnings: number;
  /** Wiederspiel-Sandbox (#332): geklonter Live-Stand während eines Replays, sonst
   *  null. Flüchtig (RAM), NICHT Teil von GameState/Save. */
  replayBookmark: GameState | null;
  // Bewusster ThisType-Escape-Hatch (#356, analog UISelf): die quer über die Bündel
  // aufgerufenen Methoden lassen sich hier nicht typisieren, ohne den this-Typ zirkulär
  // zu machen (die Bündel definieren die Methoden ja erst). `unknown` würde sie
  // unaufrufbar machen und die Game-API-Typisierung brechen – darum ein begründetes any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};
/** Typisiert ein Methodenbündel so, dass this = GameSelf ist, ohne die Methoden-Signaturen
 *  zu verlieren (ThisType-Muster). Die öffentliche Game-API bleibt damit typisiert. */
export function part<T>(b: T & ThisType<GameSelf>): T { return b; }

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

/** Frischer Spielstand – genau die Form von GameState. */
export function makeDefaultState(): GameState {
  return {
    xp: 0,
    coins: 40,
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
    // Spiel-Zeit-Achse (#413): frischer Stand startet bei Tag 1, Mittag (gameDays 0) –
    // exakt der Zeitpunkt, an dem der Tag-Nacht-Zyklus bisher (ohne Persistenz) begann.
    gameDays: 0,
  };
}
