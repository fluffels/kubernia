/**
 * Die EINE exhaustive Feldliste für Quest-Anzeigetexte (#1526).
 *
 * Vorher gab es zwei handgepflegte Sammler (`questAnzeigeFelder` in content.test.ts, `stepTexts` in abbrev.test.ts), die
 * auseinanderliefen (`brief`/`why` fehlten in einem). Hier ist jedes Feld jedes Quest-Typs klassifiziert, und die Tabellen
 * sind `satisfies Record<keyof T, Anzeige>`: ein neues Feld in `src/types.ts` bricht den Typecheck, bis es klassifiziert ist.
 * Der Sammler liest aus den Tabellen, nicht aus einer eigenen Feldliste.
 *
 * Klassen:
 *   - `markup`:  wird per `fmtCmd`/`innerHTML` gerendert (Platzhalter-Badges, `<code>`, `<b>`): Wächter für Platzhalter,
 *                Tags und Wording lesen diese Felder.
 *   - `escaped`: wird als Text ausgegeben (`esc()`), Markup darin wäre sichtbar kaputt, wird aber nicht als Markup geprüft
 *                (`solution` in radio.ts ~383).
 *   - `daten`:   kein Anzeigetext (IDs, Zahlen, Regexe, Referenzen, Szenarien).
 *   - `kinder`:  Container mit eigener Tabelle (`steps`, `options`, `cmd`, `tasks`); der Sammler steigt dort hinab.
 */
import type { ChoiceOption, ChoiceStep, DialogStep, DrillStep, MinigameStep, Quest, QuestTask, TeachCommand, TeachStep, TerminalStep } from "../../src/types";

export type Anzeige = "markup" | "escaped" | "daten" | "kinder";

const BASIS = { scenario: "daten", unlockAbbrev: "daten" } as const;

const AUFGABE = {
  id: "daten",
  text: "markup",
  accept: "daten",
  solution: "escaped",
  hint: "markup",
  why: "markup",
  check: "daten",
  solvedBy: "daten",
  altSolutions: "daten",
} as const satisfies Record<keyof QuestTask, Anzeige>;

/** Feldklassifikation je Typ. Ein neues Feld in `src/types.ts` ist hier ein Typfehler, bis es klassifiziert ist. */
export const ANZEIGE_FELDER = {
  quest: {
    id: "daten",
    title: "markup",
    giver: "daten",
    topic: "daten",
    requires: "daten",
    repeatable: "daten",
    rewardXp: "daten",
    rewardCoins: "daten",
    steps: "kinder",
  } as const satisfies Record<keyof Quest, Anzeige>,
  dialog: { ...BASIS, type: "daten", npc: "daten", lines: "markup" } as const satisfies Record<keyof DialogStep, Anzeige>,
  choice: { ...BASIS, type: "daten", npc: "daten", q: "markup", options: "kinder", reviewId: "daten" } as const satisfies Record<keyof ChoiceStep, Anzeige>,
  teach: { ...BASIS, type: "daten", brief: "markup", cmd: "kinder" } as const satisfies Record<keyof TeachStep, Anzeige>,
  drill: { ...BASIS, type: "daten", brief: "markup", pool: "daten", count: "daten", intro: "markup" } as const satisfies Record<keyof DrillStep, Anzeige>,
  terminal: { ...BASIS, type: "daten", brief: "markup", tasks: "kinder" } as const satisfies Record<keyof TerminalStep, Anzeige>,
  minigame: { ...BASIS, type: "daten", npc: "daten", game: "daten", brief: "markup" } as const satisfies Record<keyof MinigameStep, Anzeige>,
  option: { t: "markup", ok: "daten", reply: "markup" } as const satisfies Record<keyof ChoiceOption, Anzeige>,
  aufgabe: AUFGABE,
  teachCmd: { ...AUFGABE, intro: "markup" } as const satisfies Record<keyof TeachCommand, Anzeige>,
};

/** Die Container-Felder, in die der Sammler hinabsteigt; der Test gleicht sie gegen die `kinder`-Einträge der Tabellen ab. */
export const ANZEIGE_KINDER = ["steps", "options", "cmd", "tasks"] as const;

type Feldtabelle = Readonly<Record<string, Anzeige>>;
export type Anzeigefeld = [label: string, text: string];

/** Hängt alle `markup`-Felder von `objekt` (Text oder Textliste) an; ein `markup`-Feld mit anderem Typ ist ein Klassifikationsfehler. */
function sammleMarkup(objekt: object, tabelle: Feldtabelle, label: string, out: Anzeigefeld[]): void {
  for (const [feld, art] of Object.entries(tabelle)) {
    if (art !== "markup") continue;
    const wert = (objekt as Record<string, unknown>)[feld];
    if (wert === undefined) continue; // optionale Felder (why)
    if (typeof wert === "string") out.push([`${label}.${feld}`, wert]);
    else if (Array.isArray(wert) && wert.every((w): w is string => typeof w === "string")) wert.forEach((w, k) => out.push([`${label}.${feld}[${k}]`, w]));
    else throw new Error(`${label}.${feld} ist als markup klassifiziert, ist aber weder Text noch Textliste`);
  }
}

/** Alle als `markup` klassifizierten Anzeige-Textfelder einer Quest-Liste mit Label `<quest>#<schritt>.<feld>`. */
export function questAnzeigeFelder(quests: readonly Quest[]): Anzeigefeld[] {
  const out: Anzeigefeld[] = [];
  for (const quest of quests) {
    sammleMarkup(quest, ANZEIGE_FELDER.quest, quest.id, out);
    quest.steps.forEach((step, i) => {
      const l = `${quest.id}#${i}`;
      sammleMarkup(step, ANZEIGE_FELDER[step.type], l, out);
      switch (step.type) {
        case "choice":
          step.options.forEach((o, k) => sammleMarkup(o, ANZEIGE_FELDER.option, `${l}.options[${k}]`, out));
          break;
        case "teach":
          sammleMarkup(step.cmd, ANZEIGE_FELDER.teachCmd, l, out);
          break;
        case "terminal":
          step.tasks.forEach((t) => sammleMarkup(t, ANZEIGE_FELDER.aufgabe, `${l}/${t.id}`, out));
          break;
        case "dialog":
        case "drill":
        case "minigame":
          break;
        default:
          step satisfies never; // neuer Schritt-Typ: hier hinabsteigen oder bewusst aufführen
      }
    });
  }
  return out;
}
