/* ===== KubeQuest – Sammelalbum / Glossar (#278) =====
 * Pure, Phaser-/DOM-freie Logik fürs spielerseitige Sammelalbum: ein Nachschlage-
 * und Sammel-Bereich (wie ein Sticker-Album), in dem alles Gelernte auftaucht –
 * jeder eingeführte Befehl und jedes Wissens-Stück (Quiz-Karte). Einträge starten
 * „verdeckt" und werden freigeschaltet, sobald man sie im Spiel kennengelernt hat.
 *
 * Eine Quelle, kein doppelter Pflegeaufwand (Akzeptanz #278): das Album speist sich
 * AUTOMATISCH aus den vorhandenen Content-Daten – Befehle aus den `teach`-Schritten
 * der Quests (Intro-Marker „🆕 Neuer Befehl:"), Wissen aus den Quiz-Karten (CRAB_QUIZ).
 * Gruppiert nach Thema (`quest-topics.json`) wie Album-Seiten.
 *
 * Freischalt-Status wird OHNE neues Save-Feld abgeleitet (Stardew-Scope: keine
 * Migration für ein reines Anzeige-Feature):
 *  - Befehl  → freigeschaltet, sobald seine Heimat-Quest ABGESCHLOSSEN ist
 *    (`completedQuests`), analog zur SR-Karten-Freischaltung beim Quest-Abschluss.
 *  - Wissen  → freigeschaltet, sobald die Karte im Spaced-Repetition-Pool ist
 *    (`review` ist selbst der „gesehen?"-Tracker, #279) – das passiert beim
 *    Quest-Abschluss (chapter-Karten) bzw. beim Beantworten einer Choice (reviewId).
 *
 * Bewusst wie questlog.ts geschnitten: die Entscheidung lebt hier (unit-getestet),
 * die DOM-Anbindung (Rendern/Klicks) liegt dünn in ui/album.ts.
 */
import type { Quest } from "../types";
import type { QuizCard, QuestTopic } from "../content/loader";

/** Ein Sammel-Eintrag im Album – ein Befehl oder ein Wissens-Stück. */
export interface AlbumEntry {
  kind: "command" | "knowledge";
  /** Eindeutige Eintrags-ID (Befehl: `cmd:<befehl>`, Wissen: die Karten-ID). */
  id: string;
  /** Überschrift des Stickers (Befehl: der Befehl selbst; Wissen: die Frage). */
  title: string;
  /** Erklärung/Detail (kann Spiel-Markup wie <code>/<b>/<i> enthalten). */
  detail: string;
  /** Beispiel-Eingabe bei Befehlen (die Musterlösung des Teach-Schritts). */
  example?: string;
  /** „Wo gelernt": ID + Titel der Heimat-Quest. */
  questId: string;
  questTitle: string;
  /** Schon gesammelt (im Spiel kennengelernt)? */
  unlocked: boolean;
}

/** Eine Album-Seite = ein Thema mit seinen Einträgen + Sammel-Fortschritt. */
export interface AlbumPage {
  id: string;
  label: string;
  entries: AlbumEntry[];
  /** Wie viele der Einträge schon gesammelt sind … */
  collected: number;
  /** … von wie vielen insgesamt. */
  total: number;
}

/** Das ganze Album: Seiten (nur nicht-leere) + Gesamt-Sammelstand. */
export interface Album {
  pages: AlbumPage[];
  collected: number;
  total: number;
}

/** Freischalt-Zustand, aus dem das Album seine „gesammelt?"-Flags ableitet –
 *  beides aus bestehenden Save-Feldern (kein neues Feld). */
export interface AlbumUnlockState {
  /** IDs abgeschlossener Quests (`GameState.completedQuests`). */
  completedQuests: Set<string>;
  /** IDs der Karten im Spaced-Repetition-Pool (`Object.keys(GameState.review)`). */
  reviewIds: Set<string>;
}

/** Marker eines Teach-Intros, das wirklich einen NEUEN Befehl einführt. Bewusst
 *  „Neuer Befehl:" (mit Doppelpunkt) – Schritte wie „🆕 Kein neuer Befehl …" oder
 *  „🆕 Wieder nur ein neues Image …" stellen KEINEN neuen Befehl vor und matchen
 *  hier nicht (sie kommen also nicht ins Befehls-Album). */
const NEW_CMD_RE = /🆕\s*Neuer Befehl:\s*<code>([^<]+)<\/code>\s*[–—-]?\s*(.*)$/s;

/**
 * Zieht aus dem Intro eines Teach-Schritts den eingeführten Befehl + seine
 * Kurzerklärung – oder `null`, wenn das Intro keinen neuen Befehl vorstellt.
 */
export function extractTaughtCommand(intro: string): { command: string; explanation: string } | null {
  const m = NEW_CMD_RE.exec(intro);
  if (!m) return null;
  const command = m[1].trim();
  if (!command) return null;
  return { command, explanation: m[2].trim() };
}

/**
 * Ist das Sammelalbum freigeschaltet? Wie das Logbuch (#326) erst, NACHDEM die
 * erste Quest abgeschlossen ist – vorher gibt es nichts zu sammeln.
 */
export function albumUnlocked(completedCount: number): boolean {
  return completedCount >= 1;
}

/** Ein noch einem Thema zugeordneter Eintrag (intern; `topicId` fällt beim
 *  Seiten-Bau wieder weg, da die Seite ihr Thema selbst trägt). */
type PlacedEntry = AlbumEntry & { topicId: string };

/** Befehls-Einträge: pro Quest (in Spielreihenfolge) die `teach`-Schritte mit
 *  „🆕 Neuer Befehl:"-Intro. Über alle Quests nach Befehl dedupliziert (der erste
 *  Auftritt gewinnt – dort wird er eingeführt). */
function buildCommandEntries(quests: Quest[], unlocked: Set<string>): PlacedEntry[] {
  const seen = new Set<string>();
  const out: PlacedEntry[] = [];
  for (const quest of quests) {
    for (const step of quest.steps) {
      if (step.type !== "teach") continue;
      const t = extractTaughtCommand(step.cmd.intro);
      if (!t || seen.has(t.command)) continue;
      seen.add(t.command);
      out.push({
        kind: "command",
        id: "cmd:" + t.command,
        title: t.command,
        detail: t.explanation,
        example: step.cmd.solution,
        questId: quest.id,
        questTitle: quest.title,
        topicId: quest.topic,
        unlocked: unlocked.has(quest.id),
      });
    }
  }
  return out;
}

/** Wissens-Einträge: jede Quiz-Karte bekommt genau EINE Heimat-Quest (die erste,
 *  die sie beansprucht), woraus sich Thema + „wo gelernt" ergeben. Beansprucht wird
 *  eine Karte über die Choice-`reviewId` im Quest-Ablauf ODER ihr `chapter`-Feld –
 *  exakt die zwei Quellen, aus denen die Karte in den SR-Pool kommt (#412). */
function buildKnowledgeEntries(quests: Quest[], cards: QuizCard[], reviewIds: Set<string>): PlacedEntry[] {
  const byId = new Map(cards.map(c => [c.id, c]));
  const claimed = new Set<string>();
  const out: PlacedEntry[] = [];
  const claim = (id: string, quest: Quest): void => {
    if (claimed.has(id)) return;
    const card = byId.get(id);
    if (!card) return;
    claimed.add(id);
    const answer = card.options[card.correct] ?? "";
    out.push({
      kind: "knowledge",
      id: card.id,
      title: card.q,
      detail: `✅ ${answer}<br>${card.explain}`,
      questId: quest.id,
      questTitle: quest.title,
      topicId: quest.topic,
      unlocked: reviewIds.has(card.id),
    });
  };
  for (const quest of quests) {
    // Zuerst die im Ablauf verknüpften Choice-Karten (Schritt-Reihenfolge), …
    for (const step of quest.steps) {
      if (step.type === "choice" && step.reviewId) claim(step.reviewId, quest);
    }
    // … dann die per chapter dieser Quest zugeordneten Karten.
    for (const card of cards) {
      if (card.chapter === quest.id) claim(card.id, quest);
    }
  }
  return out;
}

/**
 * Baut das ganze Album aus den Content-Daten + Freischalt-Zustand. Pure Funktion
 * (kein Spielzustand außer den übergebenen Mengen), Grundlage für ui/album.ts.
 *
 * Reihenfolge: Themen in Taxonomie-Reihenfolge (`topics`); innerhalb einer Seite
 * erst die Befehle, dann das Wissen (jeweils in Lernpfad-Reihenfolge). Leere Themen
 * (kein Befehl, keine Karte) fallen als Seiten weg.
 */
export function buildAlbum(
  quests: Quest[],
  topics: QuestTopic[],
  cards: QuizCard[],
  unlock: AlbumUnlockState,
): Album {
  const commands = buildCommandEntries(quests, unlock.completedQuests);
  const knowledge = buildKnowledgeEntries(quests, cards, unlock.reviewIds);
  const all = [...commands, ...knowledge];

  const pages: AlbumPage[] = [];
  for (const t of topics) {
    const cmds = commands.filter(e => e.topicId === t.id);
    const know = knowledge.filter(e => e.topicId === t.id);
    const entries: AlbumEntry[] = [...cmds, ...know].map(({ topicId: _topicId, ...e }) => e);
    if (entries.length === 0) continue;
    pages.push({
      id: t.id,
      label: t.label,
      entries,
      collected: entries.filter(e => e.unlocked).length,
      total: entries.length,
    });
  }

  return {
    pages,
    collected: all.filter(e => e.unlocked).length,
    total: all.length,
  };
}
