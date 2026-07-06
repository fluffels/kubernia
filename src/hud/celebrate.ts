/* Erfolgs-Feier-System (#314) — der DOM-freie Kern.
 *
 * Verallgemeinert die Rang-Aufstieg-Feier (#223) zu EINEM System für ALLE Erfolge
 * (Level-Up, Sammelalbum-Eintrag, verdiente Abkürzung, Befehlshistorie …). Die
 * Präsentation (das mittige Feier-Overlay + Signalflaggen-Konfetti) sitzt weiter in
 * `ui/hud.ts`; hier lebt die pure, unit-testbare Entscheidung:
 *
 *  1. WAS in der Warteschlange landet, wenn mehrere Erfolge auflaufen, während der
 *     Spieler noch beschäftigt ist (Terminal/Quiz/Dialog/Minispiel offen) – dann darf
 *     NICHT ein Popup je Erfolg aufpoppen (Akzeptanz „bündeln statt spammen").
 *  2. WELCHER DevOps-Spruch die Sammlung feiert (passend zur Erfolgs-Art bzw. ein
 *     Sammel-Spruch, wenn mehrere Arten gemischt sind).
 *
 * Bewusst Phaser-/DOM-frei und deterministisch (Spruch-Auswahl per `hashStr` statt
 * `Math.random`, das in `src/hud/**` ohnehin verboten ist, #492) – so unit-testbar.
 * Neue Erfolgs-Art = ein Eintrag in `AchievementKind` + ein Spruch-Pool.
 */
import { hashStr } from "../core/rng";

/** Die feiernswerten Erfolgs-Arten. Erweiterbar: neue Art hier + Spruch-Pool unten. */
export type AchievementKind = "rank" | "album" | "abbrev" | "cmdhistory";

/** Ein einzelner Erfolg, wie er in der Feier als „Sticker" erscheint. */
export interface Achievement {
  readonly kind: AchievementKind;
  /** Icon/Emoji des Erfolgs (z.B. der neue Rang-Icon, 📖 fürs Album). */
  readonly icon: string;
  /** Kurztitel (neuer Rang-Name, „kubectl", „3 neue Album-Einträge" …). */
  readonly title: string;
  /** Optionale Unterzeile (z.B. „zuvor: ⚓ Matrose" beim Rang-Aufstieg). */
  readonly detail?: string;
}

/** Die gebündelte Anzeige-Sicht einer Feier (was das Overlay rendert). */
export interface CelebrationView {
  /** Kopfzeile des Popups. */
  readonly title: string;
  /** Der gefeierte DevOps-Spruch. */
  readonly quip: string;
  /** Die einzelnen Erfolge (Rang zuerst, sonst in Auflauf-Reihenfolge). */
  readonly items: readonly Achievement[];
}

/** Legt einen frischen Erfolg in die Warteschlange (gibt eine NEUE Liste zurück).
 *
 *  Zwei Bündelungs-Regeln gegen Popup-Spam:
 *  - **Rang faltet** (wie #223): läuft mehr als ein Aufstieg auf, bevor der Spieler
 *    frei ist, zeigen wir am Ende EINEN Rang-Sticker vom URSPRÜNGLICHEN Rang (die
 *    `detail`-„zuvor"-Zeile des ersten bleibt) zum ZULETZT erreichten (Icon/Titel des
 *    neuen). Also nie zwei Rang-Sticker.
 *  - **Andere deduplizieren** nach `kind`+`title`: derselbe Erfolg (z.B. dieselbe
 *    Abkürzung) landet nicht doppelt in einer Feier. */
export function enqueueAchievement(queue: readonly Achievement[], a: Achievement): Achievement[] {
  if (a.kind === "rank") {
    const existing = queue.find(x => x.kind === "rank");
    if (existing) {
      // ältestes „zuvor" (detail) behalten, neuestes Icon/Titel übernehmen
      const merged: Achievement = { kind: "rank", icon: a.icon, title: a.title, detail: existing.detail };
      return queue.map(x => (x === existing ? merged : x));
    }
    return [...queue, a];
  }
  if (queue.some(x => x.kind === a.kind && x.title === a.title)) return [...queue];
  return [...queue, a];
}

/** DevOps-Sprüche je Erfolgs-Art (mit Augenzwinkern, maritim-technisch). */
const QUIPS: Record<AchievementKind, readonly string[]> = {
  rank: [
    "Neuer Rang, neue Rechte – aber denk dran: mit großer kubectl-Macht kommt große Verantwortung.",
    "Befördert! Kein rolling update nötig – du bist schon live.",
    "Rang hoch! Das nenn ich mal saubere vertikale Skalierung.",
    "Aufgestiegen – dein Ansehen im Hafen läuft jetzt mit höherer Replica-Zahl.",
  ],
  album: [
    "Frisch ins Sammelalbum geklebt – dein Wissen wächst schneller als ein Pod unter Last.",
    "Neuer Eintrag gesammelt! Bald bist du wandelnde Doku – nur ohne die veralteten Stellen.",
    "Sticker verdient! Gesammeltes Wissen ist das beste Persistent Volume: übersteht jeden Neustart.",
    "Ab ins Album damit – Erlerntes gehört gesichert, nicht ins /tmp.",
  ],
  abbrev: [
    "Abkürzung verdient – jeder gesparte Tastendruck ist gelebte Effizienz. DevOps in Reinform.",
    "Kurzform freigeschaltet! Faule Finger, kluger Kopf – so tickt jede gute Ops-Crew.",
    "Weniger tippen, mehr schaffen – die Profi-Kurzform gehört jetzt dir.",
  ],
  cmdhistory: [
    "Befehlshistorie an Bord! ↑ holt Vergangenes zurück – Zeitreise, aber nur fürs Terminal.",
    "Pfeil hoch, Zeit gespart – deine Shell merkt sich jetzt, was du schon konntest.",
  ],
};

/** Sammel-Sprüche, wenn mehrere Erfolgs-ARTEN gleichzeitig gefeiert werden. */
const MIXED_QUIPS: readonly string[] = [
  "Gleich mehrfach abgeräumt – das war ja ein regelrechter Deployment-Sturm! Alles grün.",
  "Volle Ladung Erfolge auf einmal – dein Hafen brummt wie ein Cluster unter Autoscaling.",
  "Mehrere Erfolge im Doppelpack – so sieht ein sauberer Rollout aus, Käpt'n!",
  "Alles auf einmal geschafft – dein Kanban-Board ist grün bis zum Horizont.",
];

/** Wählt DETERMINISTISCH einen Spruch für die Sammlung: bei genau einer Erfolgs-Art
 *  aus deren Pool, bei gemischten Arten aus dem Sammel-Pool. Die Auswahl hängt am
 *  Inhalt (Art+Titel), damit sie stabil/testbar ist – kein `Math.random`. */
export function celebrationQuip(items: readonly Achievement[]): string {
  if (items.length === 0) return "";
  const kinds = new Set(items.map(i => i.kind));
  const pool = kinds.size > 1 ? MIXED_QUIPS : QUIPS[items[0].kind];
  const seed = items.map(i => i.kind + ":" + i.title).join("|");
  return pool[hashStr(seed) % pool.length];
}

/** Kopfzeile: der klassische Aufstiegs-Titel, wenn NUR Rang gefeiert wird, sonst
 *  ein allgemeiner Erfolgs-Titel (deckt Album/Abkürzung/Historie + gemischt ab). */
export function celebrationTitle(items: readonly Achievement[]): string {
  const onlyRank = items.length > 0 && items.every(i => i.kind === "rank");
  return onlyRank ? "🎉 Aufgestiegen! 🎉" : "🎉 Geschafft! 🎉";
}

/** Faltet die Warteschlange in EINE Anzeige-Sicht – oder `null`, wenn nichts ansteht.
 *  Reihenfolge: Rang-Sticker zuerst (der „große" Erfolg), danach die übrigen in
 *  Auflauf-Reihenfolge (stabiler Sort). */
export function bundleCelebration(queue: readonly Achievement[]): CelebrationView | null {
  if (queue.length === 0) return null;
  const items = [...queue].sort((a, b) => (a.kind === "rank" ? 0 : 1) - (b.kind === "rank" ? 0 : 1));
  return { title: celebrationTitle(items), quip: celebrationQuip(items), items };
}
