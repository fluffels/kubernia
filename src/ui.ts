/* ===== KubeQuest 3.0 – UI & Quest-Steuerung (Orchestrator/Barrel, #356) =====
 * Das öffentliche UI-Objekt entsteht aus den Domänen-Bündeln unter src/ui/
 * (Dialog/Funkgerät/Quiz/Minispiel/Shop/Logbuch/HUD …); der veränderliche
 * UI-Zustand (this.*) ist hier zentral deklariert, gemeinsame Helfer liegen in
 * src/ui/shared.ts. Schwester-Refactor zu #345 (scenes.ts) und #346 (sim.ts). */
import { overlayUI } from "./ui/overlay";
import { hudUI } from "./ui/hud";
import { questUI } from "./ui/quest";
import { dialogUI } from "./ui/dialog";
import { radioUI } from "./ui/radio";
import { minigameUI } from "./ui/minigame";
import { podpackingUI } from "./ui/podpacking";
import { yamlstructUI } from "./ui/yamlstruct";
import { routingUI } from "./ui/routing";
import { drifthealUI } from "./ui/driftheal";
import { rbaskeyringUI } from "./ui/rbaskeyring";
import { questlogUI } from "./ui/questlog";
import { albumUI } from "./ui/album";
import { shopUI } from "./ui/shop";
import { quizUI } from "./ui/quiz";
import { saveUI } from "./ui/save";
import { setSaveFailedSink, setPayoutSink, setClockSink, setUiBusyProbe, worldScene } from "./runtime";
import type { ChoiceStep } from "./types";
import type { DrillTask } from "./content/drills";
import type { CmdCard, QuizCard } from "./content/loader";
import type { PackingPlacement } from "./content/podpacking";
import type { YamlLine } from "./content/yamlstruct";
import type { DriftHealState } from "./content/driftheal";
import type { Achievement } from "./hud/celebrate";

/* ── Typen des veränderlichen UI-Zustands (#423): ersetzen die früheren `as any`.
 *    Geschrieben/gelesen werden die Felder quer aus den ui/*-Bündeln über die
 *    permissive UISelf-Sicht; hier stehen die echten Formen als Doku + Typ-Anker. ── */
/** Aktiver NPC-/Bo-Dialog (Quellen: ui/dialog.ts + Menü in ui/hud.ts). */
interface ActiveDialogue {
  npcId: string;
  lines: string[];
  idx: number;
  onDone: (() => void) | null;
  choice: ChoiceStep | { menu: true } | null;
  /** Nur Choice-Dialoge: schon eine Antwort gewählt? (ui/dialog.ts answerChoice → verhindert
   *  Doppelklick). Fehlt bei normalen Lese-Dialogen, darum optional. */
  answered?: boolean;
}
/** Inhalt EINER Review-Karte, wie ihn `Game.findReviewContent` liefert: entweder eine
 *  Quiz-Frage (`q`) oder eine Befehls-Karte (`card`), unterschieden über `kind`. */
type ReviewContent = { kind: string; card?: CmdCard; q?: QuizCard };
/** Die aktuell gezeigte Karte einer Wissensrunde (ui/quiz.ts setzt sie je Karte in
 *  renderReviewItem). `order` mischt nur bei Quiz-Karten die Options-Reihenfolge (#258). */
interface ReviewCard {
  itemId: string;
  content: ReviewContent;
  answered: boolean;
  attempts: number;
  order?: number[];
}
/** Laufende Wissensrunde/Quiz (ui/quiz.ts). `current` ist erst nach renderReviewItem gesetzt
 *  (zwischen den Karten bzw. vor dem Start nicht vorhanden). */
interface ActiveReview {
  ids: string[];
  idx: number;
  right: number;
  free: boolean;
  assisted?: number;
  gate?: { npcId: string; questIdx: number };
  current?: ReviewCard;
}
/** Freies Üben am Funkgerät (ui/radio.ts). */
interface ActivePractice {
  npcId: string;
  drills: string[];
  idx: number;
  task: DrillTask | null;
}
/** Stapel-Minispiel-Zustand (ui/minigame.ts). target/placed werden je Runde gesetzt;
 *  roundClean (#219) merkt, ob die aktuelle Runde bisher fehlerfrei gestapelt wurde. */
interface ActiveStack { round: number; score: number; target?: string[]; placed?: number; roundClean?: boolean; }
/** Pod-Packspiel-Zustand (#567, ui/podpacking.ts). `order` ist die gemischte Pod-
 *  Reihenfolge im Pool dieser Runde; `pending` sind korrekt als „passt nirgends"
 *  markierte Pods. roundClean (#219) merkt, ob die Runde bisher fehlerfrei lief. */
interface ActivePacking { round: number; score: number; placements: PackingPlacement[]; pending: string[]; order: string[]; roundClean?: boolean; }
/** YAML-Bausteine-Minispiel-Zustand (#568, ui/yamlstruct.ts). `target`/`placed` werden
 *  je Runde gesetzt; `pendingText` ist die per Reihenfolge schon bestätigte Zeile,
 *  während ihre Tiefe gewählt wird (zwischen den beiden Schritten null). roundClean
 *  (#219) merkt, ob die Runde bisher fehlerfrei lief. */
interface ActiveYamlStruct { round: number; score: number; target?: YamlLine[]; placed?: number; pendingText?: string | null; roundClean?: boolean; }
/** Routing-Lotse-Minispiel-Zustand (#569, ui/routing.ts). `order` sind die noch offenen
 *  Anfrage-Labels dieser Runde; `activeLabel`/`stage` verfolgen die gerade bearbeitete
 *  Anfrage (erst optional „ingress", dann „pod"); `targetService` ist der dabei aufgelöste
 *  Ziel-Service. roundClean (#219) merkt, ob die Runde bisher fehlerfrei lief. */
interface ActiveRouting {
  round: number;
  score: number;
  order: string[];
  activeLabel: string | null;
  stage: "ingress" | "pod" | null;
  targetService: string | null;
  roundClean?: boolean;
}
/** Wunschzustand-Minispiel-Zustand (#570, ui/driftheal.ts). `eventIdx` ist der Index
 *  des laufenden Drift-Ereignisses in der Runde; `state` trägt Ist/Soll + ob der
 *  Reconcile-Loop schon läuft. roundClean (#219) merkt, ob die Runde bisher ohne
 *  imperativen Fehlgriff lief. */
interface ActiveDriftHeal { round: number; score: number; state: DriftHealState; eventIdx: number; roundClean?: boolean; }
/** RBAC-Schlüsselbund-Minispiel-Zustand (#571, ui/rbaskeyring.ts). `order` sind die noch
 *  offenen Task-Indizes dieser Runde; `activeTaskIdx` verfolgt die gerade gewählte Aufgabe
 *  (null = Warteschlange). roundClean (#219) merkt, ob die Runde bisher fehlerfrei lief. */
interface ActiveRbacKeyring { round: number; score: number; order: number[]; activeTaskIdx: number | null; roundClean?: boolean; }

export const UI = {
  dialogue: null as ActiveDialogue | null,
  termLog: [] as string[],
  termHistory: [] as string[], // #316: zuletzt getippte Funk-Befehle (Sitzung, ↑/↓-Historie)
  termHistIdx: 0,              // Cursor in termHistory; == length bedeutet „neuer Entwurf"
  review: null as ActiveReview | null,
  practice: null as ActivePractice | null,   // { npcId, drills, idx, task }
  _drillTask: null as DrillTask | null, // aktuelle generierte Drill-Aufgabe des Quest-Schritts
  _drillId: "",            // #219: ID des aktuell gezogenen Quest-Drills (für recordPractice)
  _practiceDirty: false,   // #219: aktuelle Übung gestolpert/Hilfe genutzt? -> nicht „gekonnt"
  stack: null as ActiveStack | null,      // Stapel-Minispiel
  packing: null as ActivePacking | null,  // Pod-Packspiel (#567)
  yamlstruct: null as ActiveYamlStruct | null, // YAML-Bausteine-Minispiel (#568)
  routing: null as ActiveRouting | null,  // Routing-Lotse-Minispiel (#569)
  driftheal: null as ActiveDriftHeal | null, // Wunschzustand-Minispiel (#570)
  rbaskeyring: null as ActiveRbacKeyring | null, // RBAC-Schlüsselbund-Minispiel (#571)
  failCount: 0,
  _funkExplained: new Set<string>(),      // #362: IDs der „Was ist gerade passiert?"-Erklärungen, die diese Sitzung schon gezeigt wurden (dosiert, kein Save-Feld)
  _gateClearedIdx: -1,     // questIdx, für den das Wiederholungs-Gate schon erledigt ist (#222)
  _lastClock: "",          // zuletzt gesetzte HUD-Uhr-Signatur – die Uhr tickt jede reale Sekunde, aber updateDayNight feuert jeden Frame; nur bei echter Änderung in den DOM schreiben (#121)
  choiceBtns: null as HTMLButtonElement[] | null, // Dialog-Antwort-Buttons (für Tastatur-Navigation)
  choiceSel: 0,
  questLogViewIdx: null as number | null, // welche Quest im Logbuch gerade „nachgelesen" wird (null = Übersicht, #326)
  albumViewTopic: null as string | null, // welche Album-Seite (Thema) gerade offen ist (null = Übersicht, #278)
  reviewSel: -1,           // markierte Quiz-Option in der Wissensrunde (Pfeiltasten, #258)
  pendingCelebrations: [] as Achievement[], // #314: aufgelaufene Erfolge, gebündelt gezeigt sobald der Spieler frei ist
  ...overlayUI,
  ...hudUI,
  ...questUI,
  ...dialogUI,
  ...radioUI,
  ...minigameUI,
  ...podpackingUI,
  ...yamlstructUI,
  ...routingUI,
  ...drifthealUI,
  ...rbaskeyringUI,
  ...questlogUI,
  ...albumUI,
  ...shopUI,
  ...quizUI,
  ...saveUI,
};

/* #497: einen fehlgeschlagenen Save (voller Browser-Speicher im localStorage-Fallback)
 * für den Spieler sichtbar machen. Die Anwendung (game.ts) meldet ihn entkoppelt über
 * den Laufzeit-Sink (runtime.ts, wie beim Audio-Sink #344); hier zeigt die Präsentation
 * einen lesbaren Hinweis mit dem konkreten Ausweg (Stand exportieren). `hint()` bleibt
 * mindestens 15 s stehen (#370). Läuft beim Modul-Laden – main.ts importiert ui.ts vor
 * Game.load() und dem 5-s-Auto-Save, der Sink steht also rechtzeitig. */
setSaveFailedSink(() => {
  UI.hint("⚠️ <b>Speichern fehlgeschlagen</b> – der Browser-Speicher ist voll. Sichere deinen Fortschritt über Menü → Spielstand exportieren.");
});

/* #501: der szenen-neutrale Taktgeber (Game.tick) zahlt den passiven Hafen-Verdienst jetzt in
 * JEDER Szene aus (früher nur in WorldScene.update → stand in den Regionen still). Die
 * Auszahlung meldet die Anwendung entkoppelt über den runtime-Sink; hier reagiert die
 * Präsentation: der HUD-Dublonenstand wird überall aktualisiert (DOM, szenen-unabhängig), der
 * „+N 🪙"-Floater kommt nur von der aktiven Hafen-WorldScene (payoutFloat) – in einer Region
 * wäre die Hafen-Kachel-Koordinate sinnlos, dort tickt der Beutel nur im HUD hoch. */
setPayoutSink((amount) => {
  UI.refreshHud();
  worldScene()?.payoutFloat?.(amount);
});

/* #588: die HUD-Uhr-Anzeige (Datum/Uhrzeit) setzte früher nur die WorldScene (updateDayNight)
 * → in Region-/Interior-Szenen fror sie ein. Jetzt meldet der szenen-neutrale Game.tick die
 * Uhr-Labels entkoppelt über den runtime-Sink (wie Payout-#501); hier schreibt die Präsentation
 * sie ins HUD. setClock dedupliziert per Signatur, schreibt also nur bei echter Änderung. */
setClockSink((dateLabel, timeLabel, title) => {
  UI.setClock(dateLabel, timeLabel, title);
});

/* #540: der szenen-neutrale Gefahren-Takt (game/hazards.ts) darf ui.ts nicht importieren, will
 * aber – wie früher der Szenen-Start – eine Gefahr aufschieben, solange ein Overlay/Dialog/Quiz
 * offen ist (kein Alarm mitten ins Modal). Dafür registriert die Präsentation hier eine Sonde,
 * die die Anwendung vor dem Start abfragt. */
setUiBusyProbe(() => UI.blocking());
