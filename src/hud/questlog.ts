/* ===== KubeQuest – Logbuch-Übersicht & Navigation (#326) =====
 * Pure, Phaser-/DOM-freie Logik fürs spielerseitige Logbuch (Quest-Log):
 *  1. Welche Quests die Übersicht zeigt und in welchem Zustand (abgeschlossen /
 *     aktuell / gesperrt) – Grundlage für „zukünftige Quests sichtbar aber
 *     gesperrt, abgeschlossene nur ansehbar" (#326, Stufe 1).
 *  2. Ab wann das Übersichts-/Navigations-Feature freigeschaltet ist
 *     (nach Abschluss von Quest 1 – vorher gibt es nichts zum Wechseln).
 *  3. Wie sich eine abgeschlossene/aktuelle Quest „nachlesen" lässt: die Dialoge
 *     und Hinweise ihrer Schritte als lesbare Zeilen.
 *
 * Bewusst wie devpanel.ts/overlaykbd.ts geschnitten: die Entscheidung lebt hier
 * (unit-getestet), die DOM-Anbindung (Rendern/Klicks) liegt dünn in ui.ts.
 * Anders als das Dev-Panel (#325, springt überallhin) erlaubt diese Schicht
 * KEIN Vorausspringen: gesperrte Quests sind sichtbar, aber nicht ansehbar.
 */
import type { Quest } from "../types";

/** Zustand einer Quest in der Logbuch-Übersicht. */
export type QuestLogState = "done" | "active" | "locked";

/** Minimaler Eingabe-Eintrag (Teilmenge von {@link Game.getQuestRoadmap}) – nur
 *  was die Übersicht braucht, damit die Logik unabhängig vom Spielstand testbar
 *  bleibt. */
export interface QuestLogRoadmapEntry {
  idx: number;
  id: string;
  title: string;
  /** Laut Spielstand abgeschlossen? */
  completed: boolean;
}

/** Eine fertige Zeile der Logbuch-Übersicht. */
export interface QuestLogRow {
  /** Quest-Index (Position in der Roadmap). */
  idx: number;
  id: string;
  title: string;
  state: QuestLogState;
  /** Darf die Quest angesehen werden (Dialoge/Hinweise nachlesen)? Nur
   *  abgeschlossene und die aktuelle – gesperrte (zukünftige) nicht. */
  viewable: boolean;
}

/** Eine lesbare Zeile der Quest-Detailansicht („nachlesen"). */
export interface QuestDetailLine {
  kind: "dialog" | "choice" | "teach" | "drill" | "terminal" | "minigame";
  /** Sprecher-Name (NPC), wo der Schritt bei einem NPC läuft – sonst leer. */
  speaker?: string;
  /** Haupttext (kann Spiel-Markup wie <b>/<code>/<i> enthalten). */
  text: string;
}

/**
 * Baut die Zeilen der Logbuch-Übersicht: jede Quest bekommt ihren Zustand
 * (abgeschlossen / aktuell / gesperrt) und ob sie ansehbar ist.
 *
 * Regel (#326): abgeschlossene Quests sind ansehbar, die aktuelle ist ansehbar,
 * zukünftige (`idx > questIdx`, nicht abgeschlossen) sind SICHTBAR aber GESPERRT
 * – kein Vorausspringen. Abgeschlossen schlägt „aktuell" – so ist beim
 * Endzustand (alles durch, `questIdx === Anzahl`) jede Quest korrekt „done".
 */
export function buildQuestLogRows(
  roadmap: QuestLogRoadmapEntry[],
  questIdx: number,
): QuestLogRow[] {
  return roadmap.map(q => {
    const state: QuestLogState = q.completed ? "done" : q.idx === questIdx ? "active" : "locked";
    return { idx: q.idx, id: q.id, title: q.title, state, viewable: state !== "locked" };
  });
}

/**
 * Ist das Übersichts-/Navigations-Feature freigeschaltet? Für Spieler:innen erst,
 * NACHDEM Quest 1 abgeschlossen ist (`completedCount >= 1`) – vorher gibt es
 * nichts zum Wechseln. Der Dev-/Test-Modus (#325) umgeht das über ein eigenes,
 * passwortgegatetes Panel.
 */
export function questLogUnlocked(completedCount: number): boolean {
  return completedCount >= 1;
}

/**
 * Wandelt eine Quest in lesbare Detailzeilen (Dialoge + Hinweise) zum Nachlesen.
 * Pro Schritt-Typ:
 *  - dialog: jede gesprochene Zeile einzeln (Sprecher = NPC),
 *  - choice: die Frage plus die richtige Antwort (deren `reply`),
 *  - teach/terminal/minigame: der Kurztext (`brief`),
 *  - drill: der Einleitungstext (`intro`, sonst `brief`).
 * `npcName` löst eine NPC-ID in den Anzeigenamen auf (in ui.ts an NPCS gebunden).
 */
export function buildQuestDetail(quest: Quest, npcName: (id: string) => string): QuestDetailLine[] {
  const out: QuestDetailLine[] = [];
  for (const step of quest.steps) {
    switch (step.type) {
      case "dialog":
        for (const line of step.lines) out.push({ kind: "dialog", speaker: npcName(step.npc), text: line });
        break;
      case "choice": {
        const correct = step.options.find(o => o.ok);
        const reply = correct ? ` → ${correct.reply}` : "";
        out.push({ kind: "choice", speaker: npcName(step.npc), text: `${step.q}${reply}` });
        break;
      }
      case "teach":
        out.push({ kind: "teach", text: step.brief });
        break;
      case "drill":
        out.push({ kind: "drill", text: step.intro || step.brief });
        break;
      case "terminal":
        out.push({ kind: "terminal", text: step.brief });
        break;
      case "minigame":
        out.push({ kind: "minigame", speaker: npcName(step.npc), text: step.brief });
        break;
    }
  }
  return out;
}
