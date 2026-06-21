/* Zentrale Typen für KubeQuest.
 * Die Content-Ränder sind inzwischen scharf typisiert: `QuestStep` ist eine
 * diskriminierte Union pro Schritt-Typ, `clusterSnapshot` trägt die Sim-Form.
 * Kein `any` mehr an diesen Rändern – der Compiler fängt falsch gebaute Inhalte.
 */

// Reiner Typ-Import (zur Laufzeit gelöscht). Seit #390 zeigt sim.ts NICHT mehr auf types.ts
// zurück (ExecResult liegt jetzt in sim/state.ts) – die Kante types → sim ist einseitig, kein Zyklus.
import type { Sim, Scenario } from "./sim";

/** Fortschritt EINER offenen Quest: aktueller Schritt + Aufgabe innerhalb des Schritts.
 *  Wert-Typ von `GameState.activeQuests` (#410). Pro offener Quest genau ein solcher Stand;
 *  so trägt das Save-Format mehrere parallel offene Quests, ohne dass ein Umbau auf
 *  parallele/optionale Quests später eine Migration über alle Nutzerstände braucht. */
export interface QuestProgress {
  step: number;
  task: number;
}

/** Vollständiger, serialisierbarer Spielstand (genau die Form aus Game.defaultState). */
export interface GameState {
  xp: number;
  coins: number;
  character: number | null;
  player: { x: number; y: number };
  /** Offene Quests als **Menge** (Quest-ID → Fortschritt). Die Persistenz-Autorität für
   *  den Quest-Fortschritt seit #410 – erweitert #353 von EINER auf MEHRERE gleichzeitig
   *  offene Quests, ohne dass das einen Spielstand bricht. Auf dem linearen Lernpfad ist
   *  hier genau **ein** Eintrag (= die aktuelle Quest); das Modell trägt aber beliebig viele
   *  parallel/optional offene Quests (Stardew-Scope: Nebenstränge, Voraussetzungen). Eine
   *  Quest ist „offen" ⇔ sie steht hier; „erledigt" ⇔ sie steht in `completedQuests`
   *  (beides gleichzeitig schließt sich aus). Leeres Objekt = keine offene Quest (Endzustand).
   *  Die linearen Felder `currentQuestId`/`questIdx`/`questStep`/`taskIdx` sind die abgeleitete
   *  **Arbeitskopie der fokussierten Quest** (= des linearen Lernpfads); sie werden beim Laden
   *  aus `activeQuests` abgeleitet und beim Speichern dort eingefaltet. Alt-Stände ohne dieses
   *  Feld werden aus der fokussierten Einzel-Quest migriert (game.ts › sanitizeState). */
  activeQuests: Record<string, QuestProgress>;
  /** Fokussierte Quest als **ID** (die lineare Lernpfad-Quest, deren Schritt die UI spielt).
   *  Abgeleitete Arbeitskopie der entsprechenden `activeQuests`-Auswahl. Leerer String =
   *  alle Quests durch (Endzustand). `questIdx` ist der daraus abgeleitete Laufzeit-Index;
   *  bei Konflikt gewinnt diese ID. Seit #353 ID-basiert (Quests einschieben/umsortieren
   *  verschiebt keinen Stand), seit #410 Spiegel des `activeQuests`-Eintrags. */
  currentQuestId: string;
  /** Abgeleiteter Laufzeit-Index der fokussierten Quest in `QUESTS` (= Index in quest-order.json).
   *  Wird beim Laden aus `currentQuestId` aufgelöst – NICHT die Persistenz-Autorität (#353). */
  questIdx: number;
  /** Schritt-Stand der fokussierten Quest. Arbeitskopie von `activeQuests[currentQuestId].step`. */
  questStep: number;
  /** Aufgaben-Stand innerhalb des fokussierten Schritts. Arbeitskopie von `activeQuests[currentQuestId].task`. */
  taskIdx: number;
  completedQuests: string[];
  inventory: Record<string, number>;
  owned: string[];
  activePet: string | null;
  activeFlag: string | null;
  review: Record<string, { box: number; due: number }>;
  streak: { count: number; lastDay: number };
  /** Wurde der einmalige Erklär-Toast zum 🔥 Streak bereits gezeigt? */
  streakHintShown: boolean;
  /** Wurde die einmalige Begrüßung/das Intro beim ersten Spielstart schon gezeigt? (#288) */
  introSeen: boolean;
  /** Wurde das einmalige Bo-Onboarding zum Logbuch (Freischaltung nach Quest 1) schon gezeigt? (#326) */
  questLogIntroShown: boolean;
  /** Freigeschaltete „verdiente Abkürzungen" (Kürzel-IDs, #287/#297). Leer = noch keine
   *  freigeschaltet. Der Sentinel `"*"` bedeutet „alle freigeschaltet" – damit werden
   *  Alt-Spielstände (von vor der Mechanik, mit Fortschritt) grandfathered, sodass kein
   *  bereits gelerntes Kürzel rückwirkend gesperrt wird. Das Gating kommt in #299, der
   *  Katalog der IDs in #298. */
  unlockedAbbrev: string[];
  /** Nutzungszähler je Abkürzungs-Baustein (#313): wie oft die Langform schon
   *  korrekt getippt wurde. Erreicht der Zähler `ABBREV_EARN_THRESHOLD`, wird die
   *  Kurzform verdient (landet in `unlockedAbbrev`). Fehlt/`{}` = noch nichts gezählt;
   *  bereits freigeschaltete Bausteine werden nicht weitergezählt. */
  abbrevUsage: Record<string, number>;
  /** #316: Ist die Befehlshistorie im Funkgerät-Terminal (↑/↓) freigeschaltet? Startet
   *  `false` und wird „durch Nutzung" freigeschaltet, sobald genug Befehle getippt wurden
   *  (`CMD_HISTORY_UNLOCK_AT`) – eine kleine Komfort-Funktion als Upgrade, nicht von Anfang
   *  an da. Persistiert, damit die Freischaltung über Reloads erhalten bleibt. */
  cmdHistoryUnlocked: boolean;
  stats: {
    commands: number;
    reviews: number;
    quizRight: number;
    quizWrong: number;
    piratesBeaten: number;
    krakenBeaten: number;
    stackBest: number;
    [k: string]: number; // dynamische Zusatz-Stats (z.B. stormsFixed)
  };
  lastSeen: number;
  /** Serialisierter Cluster-Zustand (genau die Form von Sim.snapshot()). */
  clusterSnapshot: Scenario | null;
  /** Audio-Einstellungen (Musik & Sounds getrennt schaltbar, je mit Lautstärke; track = gewähltes Musikstück). */
  audio: AudioConfig;
  /** Spiel-Feel: Frequenz/Härte der Zufalls-Events (Anti-Frust, #71). */
  settings: { events: EventMode };
  /** Abgeschlossene Quests seit dem letzten Review-Gate-Feuern (#323).
   *  Zähler für das Quest-Count-Gate: ab 3 wird Kralle auch ohne fällige Karten vorgeschlagen. */
  questsSinceGate: number;
  /** Persistente Spiel-Zeit-Achse (#413): vergangene In-Game-Tage als **fraktionale Zahl**.
   *  Der Ganzzahl-Anteil + 1 ist der Anzeige-Tag (`gameDays` 0 = Tag 1), der Nachkomma-Anteil
   *  die Tageszeit (Phase ab Mittag, wie der Tag-Nacht-Schleier). Daraus leiten `clock.ts`
   *  (Uhr/Datum) und `updateDayNight` (Schleier) Tag/Saison/Uhrzeit ab – seit #413 überleben
   *  die also einen Reload (vorher lief Tag/Nacht nur aus der flüchtigen Frame-Zeit, Reload =
   *  wieder „Tag 1"). Bewusst in TAGEN statt ms gespeichert: so ist der Kalender vom Tempo
   *  (`DAY_CYCLE_MS`) ENTKOPPELT – ein Tempo-Tuning ändert nur die künftige Laufgeschwindigkeit,
   *  NICHT das Kalenderdatum bestehender Stände (Saves nie brechen). Fundament für saisonalen
   *  Content/Festivals/Routinen; konkrete Inhalte sind Folge-Content. `game/clock.ts` ist die
   *  Anwendungs-API darüber (advanceClock = vorrücken, calendar = abgeleiteter Kalender). */
  gameDays: number;
}

/** Spiel-Feel-Stufe: regelt Häufigkeit & Härte der Zufalls-Events (Stürme,
 *  Piraten, Krake) und den Verdienst-Malus kaputter Dienste.
 *  `normal` = volle Härte, `cozy` = seltener/sanfter + gemilderter Malus,
 *  `off` = keine Zufalls-Events und kein Malus. */
export type EventMode = "normal" | "cozy" | "off";

/** Audio-Einstellungen (Teil von GameState.audio). Liegt bewusst in der
 *  Typ-/Domänen-Schicht, NICHT in `sfx.ts` (Präsentation): so können Anwendung
 *  (game.ts) und das Laufzeit-Wiring (runtime.ts) den Typ nutzen, ohne auf die
 *  Präsentations-Schicht zu zeigen. `sfx.ts` re-exportiert ihn nur. */
export interface AudioConfig {
  music: boolean;
  sfx: boolean;
  /** Lautstärke 0..1 */
  musicVol: number;
  /** Lautstärke 0..1 */
  sfxVol: number;
  /** ID des aktuell gewählten Musikstücks (siehe MUSIC_THEMES in sfx.ts). */
  track: string;
}

/* ---------- Inhalts-Strukturen ----------
 * `QuestStep` ist eine echte diskriminierte Union über `type`: jeder Schritt-Typ
 * führt genau seine Pflichtfelder, der Compiler meckert bei falsch aufgebauten
 * Schritten (Tippfehler im Feldnamen, fehlendes Pflichtfeld). Die zusätzlichen
 * Cross-Referenz-Prüfungen (verweist reviewId auf eine existierende Karte? matcht
 * die Lösung ihre accept-Regex?) bleiben als zweite Sicherung in content.test.ts. */

/** Eine zu tippende Terminal-Aufgabe bzw. – um `intro` erweitert – ein Teach-Befehl. */
export interface QuestTask {
  id: string;
  text: string;
  /** Erlaubte Eingaben; mindestens eine Regex muss matchen. */
  accept: RegExp[];
  /** Musterlösung (Anzeige + Selbsttest in content.test.ts). */
  solution: string;
  hint: string;
  /** Optionale Zusatzbedingung gegen den Sim-Zustand – es zählt nur die Truthiness. */
  check?: (sim: Sim) => unknown;
}

/** Der „neue Befehl" eines Teach-Schritts: eine Aufgabe mit erklärendem Intro. */
export interface TeachCommand extends QuestTask {
  intro: string;
}

/** Eine Antwortoption eines Choice-Schritts. */
export interface ChoiceOption {
  t: string;
  ok: boolean;
  reply: string;
}

/** Gemeinsame, an jedem Schritt-Typ erlaubte Felder. */
export interface StepBase {
  /** Bereitet die Welt vor (Dateien, kaputte Deployments, Pipelines …), bevor
   *  der Schritt läuft – kann an Dialog-, Teach- oder Terminal-Schritten hängen. */
  scenario?: Scenario;
  /** Freischalt-ID einer verdienten Abkürzung (#300): Wenn dieser Schritt abgeschlossen
   *  wird und die ID noch gesperrt ist, schaltet das UI die Abkürzung frei (Toast +
   *  Game.unlockAbbrev). ID muss in ABBREVS.id existieren. */
  unlockAbbrev?: string;
}

/** Gespräch: der NPC sagt mehrere Zeilen. */
export interface DialogStep extends StepBase {
  type: "dialog";
  npc: string;
  lines: string[];
}

/** Verständnisfrage beim NPC; genau eine Option ist richtig (`ok`). */
export interface ChoiceStep extends StepBase {
  type: "choice";
  npc: string;
  q: string;
  options: ChoiceOption[];
  /** Verknüpfte Karteikarte (Spaced Repetition); muss in CRAB_QUIZ existieren. */
  reviewId?: string;
}

/** Ein neuer Befehl: erklärt und selbst getippt (im Funkgerät). */
export interface TeachStep extends StepBase {
  type: "teach";
  brief: string;
  cmd: TeachCommand;
}

/** Zufalls-Übungen aus dem Gelernten (Drills werden von der UI gezogen). */
export interface DrillStep extends StepBase {
  type: "drill";
  brief: string;
  /** Drill-IDs aus DRILLS, aus denen zufällig gezogen wird. */
  pool: string[];
  count: number;
  intro: string;
}

/** Feste Aufgabenkette (Showdowns/Diagnose). */
export interface TerminalStep extends StepBase {
  type: "terminal";
  brief: string;
  tasks: QuestTask[];
}

/** Geführtes Minispiel (#276): der Spieler muss ein Minispiel beim NPC aktiv
 *  einmal durchspielen – der Schritt schließt erst nach dem Spielen ab, nicht
 *  durch bloßes Weiterklicken. Macht neue Interaktionsarten auffindbar, statt
 *  sie nur im Fließtext zu erwähnen. */
export interface MinigameStep extends StepBase {
  type: "minigame";
  /** Bei welchem NPC das Minispiel im Menü liegt (steuert Marker/Wegweiser). */
  npc: string;
  /** Welches Minispiel verpflichtend gespielt werden muss. */
  game: "stack";
  /** Kurzlabel des Schritts (Anzeige/Doku). */
  brief: string;
}

/** Ein Quest-Schritt – diskriminierte Union über `type`. */
export type QuestStep = DialogStep | ChoiceStep | TeachStep | DrillStep | TerminalStep | MinigameStep;

/** Schritte, die im Funkgerät-Terminal laufen (statt im Dialog beim NPC). */
export type FunkStep = TeachStep | DrillStep | TerminalStep;

export interface Quest {
  id: string;
  title: string;
  giver: string;
  /** Themen-/Kapitel-Zuordnung (#327): die ID eines Themas aus
   *  `content/data/quest-topics.json`. Gruppiert Quests fürs Logbuch-Accordion
   *  (#326) entlang des README-Lernpfads. Bewusst ein **explizites Feld** und
   *  nicht aus `giver` abgeleitet: ein Geber kann Quests aus mehreren Themen
   *  geben (z.B. ole → Kubernetes-Grundlagen UND die Security-Krake; juno →
   *  Troubleshooting UND die Security-Hafenmauer). Referenzielle Gültigkeit
   *  (Thema existiert) + „kein totes Thema" prüft `content/validate.ts`. */
  topic: string;
  /** Optionale Voraussetzungen (#410): Quest-IDs, die ALLE erledigt sein müssen, bevor
   *  diese Quest gestartet werden darf (`Game.questPrereqsMet`). Datengesteuert und beim
   *  Laden validiert (content/validate.ts: jede ID existiert, kein Selbst-Verweis, keine
   *  Zyklen). Fehlt das Feld = keine Voraussetzung (der lineare Lernpfad). Der Lernpfad
   *  selbst bleibt über `quest-order.json` geordnet; `requires` ist das Gate für optionale
   *  Nebenstränge, die quer zur Reihenfolge freischalten. */
  requires?: string[];
  /** Optionales Wiederholbar-Flag (#410): darf nach Abschluss erneut gestartet werden
   *  (Grundlage fürs Wiederspielen/Sandbox, #332). Fehlt = einmalig. */
  repeatable?: boolean;
  rewardXp: number;
  rewardCoins: number;
  steps: QuestStep[];
}
