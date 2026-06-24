/* ===== KubeQuest 3.0 – Inhalte (Fassade) =====
 * Kleinschrittiges Lernen: jeder Befehl wird einzeln eingeführt (teach),
 * dann in Zufalls-Varianten geübt (drill), erst dann kommt der nächste.
 *
 * Die Inhalte sind nach Domänen in `./content/` aufgeteilt; diese Datei
 * bündelt sie nur noch zum gewohnten `KQContent`-Objekt (öffentliche API).
 */
import { RANKS, SHOP } from "./content/progression";
// NPCs, Smalltalk, Quests, Befehls-Karten und Quiz-Karten sind Content-as-Data
// (#348/#352/#368): als JSON in content/data/, geladen & gegen ein Schema validiert vom
// Loader (accept→RegExp, check→Mechanik-Registry). Siehe content/loader.ts + content/checks.ts.
import { NPCS, SMALLTALK, getQuests, getCmdCards, getQuizCards, getQuestTopics, groupQuestsByTopic, getTfConfigs } from "./content/loader";
import { DRILLS, PRACTICE } from "./content/drills";
import { STACK_ROUNDS, corruptImage } from "./content/minigame";

// Quests, Themen, Quiz- und Befehls-Karten sind seit #435 LAZY: die Fassade exponiert sie
// als Getter, die das (bei Stardew-Scope teure) Parsen+Validieren erst beim ersten Zugriff
// auslösen (memoisiert im Loader). Die öffentliche API `KQContent.QUESTS` etc. bleibt
// unverändert synchron. NPCS/SMALLTALK bleiben eager (winzig, schon beim Boot gebraucht).
export const KQContent = {
  RANKS, SHOP, NPCS, SMALLTALK, DRILLS, PRACTICE, STACK_ROUNDS, corruptImage, groupQuestsByTopic,
  get QUESTS() { return getQuests(); },
  get QUEST_TOPICS() { return getQuestTopics(); },
  get CRAB_QUIZ() { return getQuizCards(); },
  get CMD_CARDS() { return getCmdCards(); },
  // Terraform-Konfig-Bibliothek (#147): benannte Beispiel-Szenarien der Expeditions-Flotte,
  // auf die Quests per `scenarioRef` verweisen. Lazy wie die übrigen Sammlungen.
  get TF_CONFIGS() { return getTfConfigs(); },
};
