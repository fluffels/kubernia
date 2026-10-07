// Kein Shebang (siehe docs-gen.mjs). Generator `gates` (#1355): Gate-Tabelle aus den
// npm-Ketten (`verify`, `verify:full`, …) plus Beschreibungs-Map und reinen CI-Gates.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expandSteps, renderTable } from "./markdown.mjs";

/**
 * Die eigenen Schritte einer Kette: aufgelöst (verschachtelte Ketten), ohne Kettennamen, je Schritt einmal
 * (erstes Vorkommen). EINE Zählung für die Gate-Tabelle und die Diagramm-Zahlen (Z2a).
 */
export function kettenSchritte(scripts, chains, kette) {
  const aufgeloest = expandSteps(scripts[kette], scripts, chains, [kette]);
  return [...new Set(aufgeloest.filter((s) => !chains.includes(s)))];
}

/** Anzeigebefehl eines Kettenschritts. */
const display = (step, scripts) => (Object.hasOwn(scripts, step) ? (step === "test" ? "npm test" : `npm run ${step}`) : step);

export function gatesGenerator({ rootDir, config }) {
  const cfg = config.gates;
  const pkg = JSON.parse(readFileSync(join(rootDir, cfg.package), "utf8"));
  const scripts = pkg.scripts ?? {};
  const errors = [];
  const rows = [];
  const steps = new Set();
  const seen = new Set();
  for (const chain of cfg.chains) {
    if (typeof scripts[chain] !== "string") {
      errors.push(`Kette "${chain}" fehlt in ${cfg.package}`);
      continue;
    }
    let schritte;
    try {
      schritte = kettenSchritte(scripts, cfg.chains, chain);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      continue;
    }
    for (const step of schritte) {
      if (seen.has(step)) continue;
      seen.add(step);
      steps.add(step);
      rows.push({ step, chain, command: display(step, scripts) });
    }
  }
  const described = cfg.descriptions ?? {};
  const missing = rows.filter((r) => !Object.hasOwn(described, r.step)).map((r) => r.step);
  if (missing.length) errors.push(`Gate ohne Beschreibung in der Config (gates.descriptions): ${missing.join(", ")}`);
  const stale = Object.keys(described).filter((k) => !steps.has(k));
  if (stale.length) errors.push(`Beschreibung ohne Gate in den Ketten (stale): ${stale.join(", ")}`);
  for (const ci of cfg.ci ?? []) {
    let source;
    try {
      source = readFileSync(join(rootDir, ci.source), "utf8");
    } catch {
      errors.push(`CI-Quelle "${ci.source}" für "${ci.command}" nicht lesbar`);
      continue;
    }
    if (!source.includes(ci.command)) errors.push(`CI-Gate "${ci.command}" steht nicht (mehr) in ${ci.source} (stale)`);
  }
  if (errors.length) throw new Error(errors.join("; "));
  const table = rows.map((r) => [`\`${r.command}\``, `\`${r.chain}\``, described[r.step]]);
  for (const ci of cfg.ci ?? []) table.push([`\`${ci.command}\``, "CI", ci.description]);
  return renderTable(["Gate", "Kette", "Was es sichert"], table);
}
