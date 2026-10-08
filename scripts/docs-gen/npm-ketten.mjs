// Kein Shebang (siehe docs-gen.mjs). npm-Ketten (#1428 Z11, vorher in markdown.mjs): `a && b`-Ketten aus package.json zerlegen und auflösen.
// Gehört zum Harness-Stack, nicht zum übertragbaren Kern (markdown.mjs bleibt frei davon); gemeinsam genutzt von Gate-Tabelle, Diagramm-Zahlen,
// Doku-Drift-Wächter und verify-lauf. Reines Node-Modul ohne Importe.

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
