#!/usr/bin/env node
/**
 * Design-Schritt eines Tickets (factory#172, factory#162 L47): `node scripts/design-schritt.mjs --issue <nr>`.
 * Liest den Block `design` der Projekt-Config und die Labels des Tickets und gibt genau eine Zeile `design: aus|entwurf-fehlt|freigegeben` aus.
 * Exit 0 bei `aus` und `freigegeben`, Exit 3 bei `entwurf-fehlt` (der Planer plant dann nicht, sondern meldet `DESIGN-ENTWURF FEHLT`), Exit 2 bei einem
 * Aufruf-Fehler, ungültigem Block oder nicht lesbaren Labels. Die Entscheidung steht pur in `designZustand` (design-lib.mjs); ersetzt die Handarbeit
 * mit drei `projekt-config.mjs`-Aufrufen und einem Label-Vergleich im Planer.
 * Reines Node-Skript; die Labels kommen aus `gh issue view` (nur lesend), die Config aus `ladeProjektConfig`, beides injizierbar (`lauf`).
 */
import { designZustand } from "./design-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { direktaufruf, flagsLesen } from "./flag-lib.mjs";
import { ghText } from "./gh-cli.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";

const OPTIONEN = { issue: { type: "string" } };

/** Pur: die Ticketnummer aus den Argumenten oder der Fehlertext. */
function aufruf(argv) {
  const { werte, fehler } = flagsLesen(argv, OPTIONEN, { pflicht: ["issue"] });
  if (fehler) return { fehler: fehler.text };
  if (!/^[1-9]\d*$/.test(werte.issue ?? "")) return { fehler: "--issue braucht eine Ticketnummer (ganze Zahl ≥ 1)" };
  return { nr: werte.issue };
}

/** Pur bis auf die injizierten Quellen: `design` ist `config.design`, `labels(nr)` die Label-Namen des Tickets. */
export function lauf(argv, { design, labels }) {
  const a = aufruf(argv);
  if (a.fehler) return { code: 2, out: "", err: `✖ design-schritt: ${a.fehler}\n` };
  try {
    const zustand = designZustand(design, labels(a.nr));
    return { code: zustand === "entwurf-fehlt" ? 3 : 0, out: `design: ${zustand}\n`, err: "" };
  } catch (e) {
    return { code: 2, out: "", err: `✖ design-schritt: ${e instanceof Error ? e.message : String(e)}\n` };
  }
}

/** Die echten Quellen; scheitert das Laden der Config, wirft `labels` den Fehler (Exit 2 statt stilles `aus`). */
export const echteQuellen = (lade = ladeProjektConfig) => {
  try {
    return {
      design: lade({ pruefen: false }).design,
      labels: (nr) => ghText(["issue", "view", nr, "--json", "labels", "-q", ".labels[].name"]).split(/\r?\n/).filter(Boolean),
    };
  } catch (e) {
    return {
      design: undefined,
      labels: () => {
        throw e;
      },
    };
  }
};

if (istDirektaufruf(import.meta.url)) {
  direktaufruf(process.argv.slice(2), {
    pruefe: (argv) => {
      const a = aufruf(argv);
      return a.fehler ? { fehler: a.fehler } : {};
    },
    fehlerErgebnis: (_argv, vorab) => ({ code: 2, out: "", err: `✖ design-schritt: ${vorab.fehler}\n` }),
    io: echteQuellen,
    fuehreAus: lauf,
  });
}
