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
import { questlogUI } from "./ui/questlog";
import { shopUI } from "./ui/shop";
import { quizUI } from "./ui/quiz";
import { saveUI } from "./ui/save";
import type { ChoiceStep } from "./types";
import type { DrillTask } from "./content/drills";

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
}
/** Laufende Wissensrunde/Quiz (ui/quiz.ts). */
interface ActiveReview {
  ids: string[];
  idx: number;
  right: number;
  free: boolean;
  assisted?: number;
  gate?: { npcId: string; questIdx: number };
}
/** Freies Üben am Funkgerät (ui/radio.ts). */
interface ActivePractice {
  npcId: string;
  drills: string[];
  idx: number;
  task: DrillTask | null;
}
/** Stapel-Minispiel-Zustand (ui/minigame.ts). */
interface ActiveStack { round: number; score: number; }

export const UI = {
  dialogue: null as ActiveDialogue | null,
  termLog: [] as string[],
  termHistory: [] as string[], // #316: zuletzt getippte Funk-Befehle (Sitzung, ↑/↓-Historie)
  termHistIdx: 0,              // Cursor in termHistory; == length bedeutet „neuer Entwurf"
  review: null as ActiveReview | null,
  practice: null as ActivePractice | null,   // { npcId, drills, idx, task }
  _drillTask: null as DrillTask | null, // aktuelle generierte Drill-Aufgabe des Quest-Schritts
  stack: null as ActiveStack | null,      // Stapel-Minispiel
  failCount: 0,
  _gateClearedIdx: -1,     // questIdx, für den das Wiederholungs-Gate schon erledigt ist (#222)
  _lastClock: "",          // zuletzt gesetzte HUD-Uhr-Signatur – die Uhr tickt jede reale Sekunde, aber updateDayNight feuert jeden Frame; nur bei echter Änderung in den DOM schreiben (#121)
  choiceBtns: null as HTMLButtonElement[] | null, // Dialog-Antwort-Buttons (für Tastatur-Navigation)
  choiceSel: 0,
  questLogViewIdx: null as number | null, // welche Quest im Logbuch gerade „nachgelesen" wird (null = Übersicht, #326)
  reviewSel: -1,           // markierte Quiz-Option in der Wissensrunde (Pfeiltasten, #258)
  ...overlayUI,
  ...hudUI,
  ...questUI,
  ...dialogUI,
  ...radioUI,
  ...minigameUI,
  ...questlogUI,
  ...shopUI,
  ...quizUI,
  ...saveUI,
};
