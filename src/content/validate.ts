/* ===== Inhalte: Schema-Validierung =====
 * Behandelt die Spielinhalte (Quests, Drills, Quiz, Karten, Pools) als ein
 * *validiertes Datenschema* statt als bloße TS-Konstanten. `validateContent`
 * prüft die **strukturelle Konsistenz** des gesamten Inhalts-Bündels und gibt
 * eine Liste menschenlesbarer Probleme zurück (leer = alles in Ordnung).
 *
 * Warum eigene Validator-Funktionen statt einer Library wie Zod?
 *  - Das Repo hält bewusst **null Laufzeit-Abhängigkeiten** außer Phaser
 *    (siehe package.json). Eine Schema-Library nur für den Test-/Dev-Pfad
 *    wäre unnötiger Ballast im Bundle.
 *  - Die spannenden Fehler sind hier nicht „falscher Feldtyp" (das fängt der
 *    Compiler über die diskriminierte `QuestStep`-Union in types.ts schon),
 *    sondern **Querverweise**: zeigt ein `giver`/`npc`/`drill`/`after`/
 *    `chapter`/`reviewId` auf etwas, das es wirklich gibt? Genau das prüfen
 *    diese Funktionen – ein reiner Schema-Validator ohne Welt-Wissen könnte
 *    das gar nicht.
 *
 * Entscheidung „Inhalte als externes JSON?" (vom Ticket #81 gefordert):
 *  Bewusst **bei TS-Modulen geblieben**, nicht auf externe JSON-Dateien
 *  umgestellt. Trade-off:
 *   + JSON senkt die Einstiegshürde minimal (kein TS nötig) …
 *   – … aber genau die Stärke geht verloren: Die Drills sind **Funktionen**
 *     (`(sim) => DrillTask`), die `accept`-Regeln sind **RegExp**, und die
 *     `scenario`/`check`-Felder enthalten Logik – das ist in JSON gar nicht
 *     ausdrückbar. Außerdem prüft der Compiler heute jeden Quest-Schritt
 *     strukturell (Union in types.ts); bei JSON fiele diese Sicherung weg und
 *     müsste komplett über einen Laufzeit-Validator nachgebaut werden.
 *  Ergebnis: TS bleibt die Quelle (Typsicherheit + Logik-Felder), und dieser
 *  Validator liefert die *zusätzliche* referenzielle Prüfung, die der reine
 *  Typ-Check nicht abdecken kann. Damit skaliert der Inhalt auf viele Inseln,
 *  ohne die niedrige Einstiegshürde („neue Quest als Objekt-Literal anhängen")
 *  aufzugeben.
 */
import type { Quest } from "../types";

/** Karteikarte der Quiz-Krabbe (Multiple Choice). */
export interface QuizCard {
  id: string;
  /** Quest-ID, nach deren Abschluss diese Karte in den SR-Pool kommt (analog zu CmdCard.chapter). */
  chapter?: string;
  /** Quest-ID, in der das Konzept eingeführt wird (#412); fehlt es, gilt `chapter`. */
  introducedIn?: string;
  q: string;
  options: string[];
  correct: number;
  explain: string;
}

/** Befehls-Karte (Spaced Repetition): Aufgabe + akzeptierte Eingaben. */
export interface CmdCard {
  id: string;
  chapter: string;
  /** Quest-ID, in der das Konzept eingeführt wird (#412); fehlt es, gilt `chapter`. */
  introducedIn?: string;
  q: string;
  accept: RegExp[];
  solution: string;
}

/** Genau die Felder des `KQContent`-Bündels, die der Validator inspiziert.
 *  Strukturelle Teilmenge – `KQContent` (mit SMALLTALK, corruptImage …) ist
 *  zuweisbar, aber auch ein bewusst kaputtes Test-Objekt lässt sich übergeben. */
export interface ContentBundle {
  RANKS: { xp: number; name: string; icon: string }[];
  SHOP: { id: string }[];
  NPCS: Record<string, { name: string }>;
  QUESTS: Quest[];
  QUEST_TOPICS: { id: string; label: string }[];
  CRAB_QUIZ: QuizCard[];
  CMD_CARDS: CmdCard[];
  DRILLS: Record<string, unknown>;
  PRACTICE: Record<string, { drill: string; after: string }[]>;
  STACK_ROUNDS: { name: string; layers: string[] }[];
}

/** Whitespace normalisieren wie die Eingabe-Auswertung der UI (für den
 *  Selbsttest „matcht die Musterlösung ihre eigene accept-Regex?"). */
const norm = (s: string) => s.trim().replace(/\s+/g, " ");

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * Prüft die strukturelle & referenzielle Konsistenz des Inhalts-Bündels.
 * @returns Liste der gefundenen Probleme (leeres Array = valide).
 */
export function validateContent(c: ContentBundle): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(msg);

  // Nachschlage-Mengen für die Querverweis-Prüfungen.
  const npcIds = new Set(Object.keys(c.NPCS));
  const questIds = new Set(c.QUESTS.map(q => q.id));
  const drillIds = new Set(Object.keys(c.DRILLS));
  const quizIds = new Set(c.CRAB_QUIZ.map(q => q.id));
  const topicIds = new Set(c.QUEST_TOPICS.map(t => t.id));
  // Welche Themen tatsächlich von einer Quest benutzt werden (für den Tot-Themen-Check #327).
  const usedTopics = new Set<string>();

  // ---------- Ränge: aufsteigende XP-Schwellen ----------
  for (let i = 1; i < c.RANKS.length; i++) {
    if (c.RANKS[i].xp <= c.RANKS[i - 1].xp) {
      err(`RANKS: XP-Schwelle nicht aufsteigend bei „${c.RANKS[i].name}" (${c.RANKS[i].xp} <= ${c.RANKS[i - 1].xp})`);
    }
  }

  // ---------- Shop: IDs eindeutig ----------
  const shopSeen = new Set<string>();
  for (const item of c.SHOP) {
    if (shopSeen.has(item.id)) err(`SHOP: doppelte ID „${item.id}"`);
    shopSeen.add(item.id);
  }

  // ---------- Quiz-Karten: IDs eindeutig, correct gültig, Erklärung da ----------
  const quizSeen = new Set<string>();
  for (const q of c.CRAB_QUIZ) {
    if (quizSeen.has(q.id)) err(`CRAB_QUIZ: doppelte ID „${q.id}"`);
    quizSeen.add(q.id);
    if (q.options.length < 2) err(`CRAB_QUIZ ${q.id}: braucht mindestens 2 Optionen`);
    if (!(q.correct >= 0 && q.correct < q.options.length)) err(`CRAB_QUIZ ${q.id}: correct-Index ${q.correct} außerhalb der Optionen`);
    if (!isNonEmptyString(q.explain)) err(`CRAB_QUIZ ${q.id}: Erklärung fehlt`);
    if (q.chapter !== undefined && !questIds.has(q.chapter)) err(`CRAB_QUIZ ${q.id}: unbekannte Quest „${q.chapter}" in chapter`);
    if (q.introducedIn !== undefined && !questIds.has(q.introducedIn)) err(`CRAB_QUIZ ${q.id}: unbekannte Quest „${q.introducedIn}" in introducedIn`);
  }

  // ---------- Befehls-Karten: ID eindeutig, Lösung matcht accept, chapter existiert ----------
  const cardSeen = new Set<string>();
  for (const card of c.CMD_CARDS) {
    if (cardSeen.has(card.id)) err(`CMD_CARDS: doppelte ID „${card.id}"`);
    cardSeen.add(card.id);
    if (card.accept.length === 0) err(`CMD_CARDS ${card.id}: keine accept-Regel`);
    else if (!card.accept.some(re => re.test(norm(card.solution)))) err(`CMD_CARDS ${card.id}: Musterlösung „${card.solution}" matcht keine eigene accept-Regex`);
    if (!questIds.has(card.chapter)) err(`CMD_CARDS ${card.id}: unbekannte Quest „${card.chapter}"`);
    if (card.introducedIn !== undefined && !questIds.has(card.introducedIn)) err(`CMD_CARDS ${card.id}: unbekannte Quest „${card.introducedIn}" in introducedIn`);
  }

  // ---------- Quests: Geber/NPCs/Drills/reviewIds existieren, Choices wohlgeformt ----------
  const questSeen = new Set<string>();
  for (const quest of c.QUESTS) {
    if (questSeen.has(quest.id)) err(`QUESTS: doppelte ID „${quest.id}"`);
    questSeen.add(quest.id);
    if (!npcIds.has(quest.giver)) err(`Quest ${quest.id}: unbekannter Questgeber „${quest.giver}"`);
    // Thema referenziell prüfen (#327): muss in der Taxonomie stehen, sonst rutscht
    // die Quest ungruppiert durchs Logbuch-Accordion. Wie beim Geber bewusst hier
    // (Querverweis) statt im Loader (der prüft topic nur strukturell als Pflicht-String).
    if (!topicIds.has(quest.topic)) err(`Quest ${quest.id}: unbekanntes Thema „${quest.topic}" (nicht in quest-topics.json)`);
    else usedTopics.add(quest.topic);

    // Voraussetzungen (#410) referenziell prüfen: jede ID muss eine echte Quest sein und darf
    // nicht auf sich selbst zeigen (eine Quest kann sich nie selbst freischalten). Zyklen über
    // mehrere Quests fängt der eigene Pass unten ab.
    if (quest.requires) {
      const seenReq = new Set<string>();
      for (const r of quest.requires) {
        if (r === quest.id) err(`Quest ${quest.id}: Voraussetzung verweist auf sich selbst`);
        else if (!questIds.has(r)) err(`Quest ${quest.id}: unbekannte Voraussetzung „${r}"`);
        if (seenReq.has(r)) err(`Quest ${quest.id}: doppelte Voraussetzung „${r}"`);
        seenReq.add(r);
      }
    }

    for (const step of quest.steps) {
      switch (step.type) {
        case "dialog":
          if (!npcIds.has(step.npc)) err(`Quest ${quest.id}: unbekannter NPC „${step.npc}" (dialog)`);
          if (step.lines.length === 0) err(`Quest ${quest.id}: dialog-Schritt ohne Zeilen`);
          break;
        case "choice": {
          if (!npcIds.has(step.npc)) err(`Quest ${quest.id}: unbekannter NPC „${step.npc}" (choice)`);
          const richtige = step.options.filter(o => o.ok).length;
          if (richtige !== 1) err(`Quest ${quest.id}: Choice „${norm(step.q)}" braucht genau eine richtige Antwort (hat ${richtige})`);
          if (step.reviewId !== undefined && !quizIds.has(step.reviewId)) err(`Quest ${quest.id}: unbekannte reviewId „${step.reviewId}"`);
          break;
        }
        case "teach":
          // Hinweis: teach-/terminal-Lösungen werden bewusst NICHT gegen ihre accept-Regex
          // geprüft – viele tragen dynamische Platzhalter (z.B. „docker stop <name aus docker ps>"),
          // weil der echte Name aus dem Sim-Zustand kommt. Der Selbsttest „Lösung matcht accept"
          // greift nur für die statischen CMD_CARDS (siehe oben), wie schon vor #81 etabliert.
          if (!isNonEmptyString(step.cmd.intro) || !isNonEmptyString(step.cmd.hint) || !isNonEmptyString(step.cmd.solution)) {
            err(`Quest ${quest.id}: teach-Schritt „${step.cmd.id}" unvollständig (intro/hint/solution)`);
          }
          if (step.cmd.accept.length === 0) err(`Quest ${quest.id}: teach „${step.cmd.id}" ohne accept-Regel`);
          break;
        case "drill":
          if (step.count <= 0) err(`Quest ${quest.id}: drill-Schritt mit count ${step.count}`);
          if (step.pool.length === 0) err(`Quest ${quest.id}: drill-Schritt mit leerem Pool`);
          for (const d of step.pool) if (!drillIds.has(d)) err(`Quest ${quest.id}: unbekannter Drill „${d}"`);
          break;
        case "terminal":
          if (step.tasks.length === 0) err(`Quest ${quest.id}: terminal-Schritt ohne Aufgaben`);
          for (const t of step.tasks) {
            if (t.accept.length === 0) err(`Quest ${quest.id}: Aufgabe „${t.id}" ohne accept-Regel`);
          }
          break;
        case "minigame":
          if (!npcIds.has(step.npc)) err(`Quest ${quest.id}: unbekannter NPC „${step.npc}" (minigame)`);
          if (step.game !== "stack") err(`Quest ${quest.id}: unbekanntes Minispiel „${step.game}"`);
          break;
      }
    }
  }

  // ---------- Voraussetzungen: keine Zyklen im requires-Graph (#410) ----------
  // Ein Zyklus (A braucht B, B braucht A) würde beide Quests unerreichbar machen –
  // bei Stardew-Scope (viele optionale Stränge) ein leicht einzuschleichender Fehler.
  // Tiefensuche mit Farben: grau = im aktuellen Pfad (Rückkante = Zyklus), schwarz = fertig.
  {
    const questById = new Map(c.QUESTS.map(q => [q.id, q]));
    const color = new Map<string, 0 | 1 | 2>(); // 0 weiß (ungesehen), 1 grau, 2 schwarz
    const cyclesReported = new Set<string>();
    const visit = (id: string): boolean => {
      color.set(id, 1);
      for (const dep of questById.get(id)?.requires ?? []) {
        if (!questById.has(dep)) continue; // unbekannte Referenz hat der Pass oben schon gemeldet
        const cdep = color.get(dep) ?? 0;
        if (cdep === 1) { // Rückkante in den aktuellen Pfad = Zyklus
          const key = [id, dep].sort().join("|");
          if (!cyclesReported.has(key)) { cyclesReported.add(key); err(`QUESTS: Voraussetzungs-Zyklus über „${dep}" (z.B. ${id} → ${dep})`); }
          return true;
        }
        if (cdep === 0 && visit(dep)) return true;
      }
      color.set(id, 2);
      return false;
    };
    for (const q of c.QUESTS) if ((color.get(q.id) ?? 0) === 0) visit(q.id);
  }

  // ---------- Themen-Taxonomie: IDs eindeutig, kein totes Thema (#327) ----------
  const topicSeen = new Set<string>();
  for (const t of c.QUEST_TOPICS) {
    if (topicSeen.has(t.id)) err(`QUEST_TOPICS: doppelte Themen-ID „${t.id}"`);
    topicSeen.add(t.id);
    // Ein Thema ohne jede Quest wäre eine leere Accordion-Sektion: entweder Tippfehler
    // im topic einer Quest oder ein verwaistes Thema. Beides soll auffallen.
    if (!usedTopics.has(t.id)) err(`QUEST_TOPICS: Thema „${t.id}" (${t.label}) hat keine einzige Quest`);
  }

  // ---------- Übungs-Pools: NPC, Drill und Folge-Quest existieren ----------
  for (const [npcId, pool] of Object.entries(c.PRACTICE)) {
    if (!npcIds.has(npcId)) err(`PRACTICE: unbekannter NPC „${npcId}"`);
    for (const p of pool) {
      if (!drillIds.has(p.drill)) err(`PRACTICE ${npcId}: unbekannter Drill „${p.drill}"`);
      if (!questIds.has(p.after)) err(`PRACTICE ${npcId}: unbekannte Quest „${p.after}"`);
    }
  }

  // ---------- Stapel-Spiel: mindestens 2 Runden mit je 3+ Schichten ----------
  if (c.STACK_ROUNDS.length < 2) err(`STACK_ROUNDS: braucht mindestens 2 Runden`);
  for (const r of c.STACK_ROUNDS) {
    if (r.layers.length < 3) err(`STACK_ROUNDS „${r.name}": braucht mindestens 3 Schichten`);
  }

  return errors;
}
