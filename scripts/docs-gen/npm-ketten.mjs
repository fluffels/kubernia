// Kein Shebang (siehe docs-gen.mjs). npm-Ketten (#1428 Z11, vorher in markdown.mjs): `a && b`-Ketten aus package.json zerlegen und auflösen.
// Gemeinsam genutzt von Gate-Tabelle, Diagramm-Zahlen, Doku-Drift-Wächter und verify-lauf. Reines Node-Modul (nur das Blatt `regex-lib.mjs`).
import { SCHRITT_NAME } from "../regex-lib.mjs";

/** Zerlegt eine `a && b`-Kette: `npm run X` → X, `npm test` → test, sonst der Rohbefehl. */
export function parseChain(script) {
  return script
    .split("&&")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((step) => {
      // Argumente hinter `--` (`npm run X -- --flag`) gehören nicht zum Schrittnamen (Z5g).
      const run = /^npm run ([^\s]+)(?:\s+--(?:\s.*)?)?$/.exec(step);
      if (run) return run[1];
      return /^npm test(?:\s+--(?:\s.*)?)?$/.test(step) ? "test" : step;
    });
}

/**
 * Schritte einer Kette in Ausführungsreihenfolge. Ein Schritt, dessen Skript selbst eine `&&`-Kette ist und
 * nicht in `chains` steht, wird rekursiv aufgelöst (seine Schritte gehören zur äußeren Kette); ein Zyklus
 * wirft. Einzelbefehl-Aliase (ohne `&&`) bleiben ein Schritt. EINE Auflösung für Gate-Tabelle, Diagramm-Zahlen und
 * den Doku-Drift-Wächter, damit sie nie auseinanderlaufen (#1392).
 */
export function expandSteps(script, scripts, chains, stack) {
  const out = [];
  for (const step of parseChain(script)) {
    const inner = scripts[step];
    if (!chains.includes(step) && typeof inner === "string" && inner.includes("&&")) {
      if (stack.includes(step)) throw new Error(`Zyklus in den Ketten: ${[...stack, step].join(" → ")}`);
      out.push(...expandSteps(inner, scripts, chains, [...stack, step]));
    } else out.push(step);
  }
  return out;
}

/**
 * Die eigenen Schritte einer Kette: aufgelöst (verschachtelte Ketten), ohne Kettennamen, je Schritt einmal
 * (erstes Vorkommen). EINE Zählung für Gate-Tabelle, Diagramm-Zahlen und den Doku-Drift-Wächter.
 */
export function kettenSchritte(scripts, chains, kette) {
  const aufgeloest = expandSteps(scripts[kette], scripts, chains, [kette]);
  return [...new Set(aufgeloest.filter((s) => !chains.includes(s)))];
}

/** Ganzer Schrittname (einfaches npm-Skript, ohne Shell-Zeichen); die Zeichenklasse `SCHRITT_NAME` steht in `regex-lib.mjs` (eine Quelle für verify-lauf, check:docdrift und die Doku-Erkennung, factory#208). */
export const SCHRITT_RE = new RegExp(`^${SCHRITT_NAME}$`);

/**
 * Schritte der Kette `kette` (`ketten`: ihre Kettennamen) aus `package.json`; wirft ohne das Skript dieses Namens oder bei einem
 * Schrittnamen mit Shell-Zeichen (er liefe als `npm run <name>`). Gemeinsam für verify-lauf und gate-fundquote.
 */
export function ketteAusPackage(pkg, ketten, kette) {
  const scripts = pkg?.scripts ?? {};
  if (typeof scripts[kette] !== "string") throw new Error(`package.json hat kein Skript "${kette}"`);
  const schritte = kettenSchritte(scripts, ketten, kette);
  for (const s of schritte) {
    if (!SCHRITT_RE.test(s)) throw new Error(`Schritt "${s}" der ${kette}-Kette ist kein einfaches npm-Skript (Shell-Zeichen?)`);
  }
  return schritte;
}
