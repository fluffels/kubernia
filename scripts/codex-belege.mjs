// Diagnostische Auswertung von Langfuse-Exporten, keine Laufzeitattestierung und keine autonome Freigabe.
import { rollenFuer } from "./codex-rollen.mjs";
import { isDeepStrictEqual } from "node:util";
const liste = v => Array.isArray(v) ? v : [];
const text = v => typeof v === "string" && v !== "";
const usage = o => Number.isFinite(o.usageDetails?.input) && o.usageDetails.input >= 0 && Number.isFinite(o.usageDetails?.output) && o.usageDetails.output > 0;
const ROLLEN_KEY = "agent_source.subagent.thread_spawn.agent_role";
function customRolle(o) {
  const m = o.metadata;
  const flat = m?.[ROLLEN_KEY], nested = m?.agent_source?.subagent?.thread_spawn?.agent_role;
  const konflikt = flat !== undefined && nested !== undefined && flat !== nested;
  return { rolle: flat ?? nested, konflikt };
}
function verbunden(id, main, eltern) {
  const besucht = new Set();
  let current = id;
  while (current !== main) {
    if (!text(current) || besucht.has(current) || !eltern.has(current)) return false;
    besucht.add(current); current = eltern.get(current);
  }
  return text(main);
}
function elternKarte(gens) {
  const eltern = new Map(), rollen = new Map(), arten = new Map(), konflikte = new Set();
  for (const o of gens) {
    const id = o.metadata.agent_id, parent = o.metadata.parent_thread_id;
    const { rolle, konflikt } = customRolle(o);
    if (eltern.has(id) && eltern.get(id) !== parent) konflikte.add(id);
    if (arten.has(id) && arten.get(id) !== o.metadata.agent_role) konflikte.add(id);
    if (konflikt || (rollen.has(id) && rolle !== undefined && rollen.get(id) !== rolle)) konflikte.add(id);
    if (rolle !== undefined) rollen.set(id, rolle);
    arten.set(id, o.metadata.agent_role);
    eltern.set(id, parent);
  }
  for (const id of konflikte) eltern.delete(id);
  return eltern;
}
function eindeutigeObservations(daten, fehler) {
  const nachId = new Map(), konflikte = new Set();
  for (const o of daten) {
    if (nachId.has(o.id) && !isDeepStrictEqual(nachId.get(o.id), o)) konflikte.add(o.id);
    nachId.set(o.id, o);
  }
  if (konflikte.size > 0) fehler.push("Langfuse: widersprüchliche Observation-IDs im Export");
  return [...nachId.values()].filter(o => !konflikte.has(o.id));
}
function traceMaengel(b, rollen, repo) {
  const fehler = [], tag = `project:${repo.split("/").at(-1)}`;
  const imScope = liste(b.observations).filter(o => o && text(o.id) && text(b.sessionId) && o.sessionId === b.sessionId && liste(o.tags).includes(tag));
  const daten = eindeutigeObservations(imScope, fehler);
  const gens = daten.filter(o => o.type === "GENERATION" && text(o.metadata?.agent_id) && usage(o));
  const mains = new Set(gens.filter(o => o.metadata.agent_role === "main" && !o.metadata.parent_thread_id).map(o => o.metadata.agent_id));
  const eltern = elternKarte(gens), [kandidat] = mains;
  const main = mains.size === 1 && eltern.has(kandidat) ? kandidat : undefined;
  if (!main) fehler.push("Langfuse: Hauptagent mit Verbrauch und Repo-Zuordnung fehlt oder ist mehrdeutig");
  for (const r of rollen) {
    const nachweis = gens.some(o => o.metadata.agent_role === "subagent" && o.metadata.agent_id !== main && customRolle(o).rolle === r.name && !customRolle(o).konflikt && verbunden(o.metadata.agent_id, main, eltern));
    if (!nachweis) fehler.push(`Langfuse: Rolle ${r.name} ohne verknüpfte eigene Generation mit Verbrauch`);
  }
  if (daten.some(o => customRolle(o).konflikt)) fehler.push("Langfuse: widersprüchliche Custom-Rollen-Metadaten");
  if (!daten.some(o => o.type === "TOOL")) fehler.push("Langfuse: Werkzeugbeleg mit Repo-Zuordnung fehlt");
  return fehler;
}
export function bewerteBelege(belege, config) {
  const b = belege ?? {}, rollen = rollenFuer(config), fehler = [];
  if (b.version !== "0.164.0") fehler.push("Laufzeit nicht geprüft: erwartet Codex CLI 0.164.0");
  for (const r of rollen) if (!liste(b.rollen).includes(r.name)) fehler.push(`Rolle fehlt im Laufzeitinventar: ${r.name}`);
  for (const t of ["playwright", "langfuse"]) if (!liste(b.tools).includes(t)) fehler.push(`MCP fehlt im Laufzeitinventar: ${t}`);
  return [...fehler, ...traceMaengel(b, rollen, config.repo)];
}
