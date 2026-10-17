// Kein Shebang, kein Direktaufruf: Lib für `budget-pacing.mjs` und `statusline.mjs` (#1358, Konvention #1398:
// Einstiegsskripte importieren nicht voneinander, gemeinsamer Code steht in einer Lib).
/**
 * Budget-Pacing: Entscheidung ok / knapp / stopp aus dem Rate-Limit-Snapshot des Kontos (7-Tage- und 5-Stunden-Fenster).
 * Pur: `pacing`, `ausStatusline`, `ausProbe`, `zielquoteAusEnv`. I/O: `snapshotPfad`, `liesSnapshot`, `schreibeSnapshot`.
 * Fail-open: ein unbekannter oder unlesbarer Stand ergibt `ok` mit Warnung (Pacing ist kein Sicherheits-Gate).
 * Ein Snapshot hat die Form `{ stand, quelle, sevenDay?, fiveHour? }` mit `stand` in ms und je Fenster
 * `{ pct (0-100), resetsAt (Unix-Sekunden) }`. Regeln und Defaults: docs/model-routing.md §6.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { ticketNamen } from "./ticket-namen.mjs";

export const ZIELQUOTE_DEFAULT = 65;
export const TOLERANZ_PP = 5;
export const FUENF_STUNDEN_GRENZE = 90;
export const MAX_ALTER_MS = 15 * 60_000;
const WOCHE_MS = 7 * 24 * 3_600_000;

const zahl = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Normalisiert ein Fenster auf `{ pct, resetsAt }`; `null` bei Nicht-Zahl, negativem Wert oder fehlendem Reset. Über 100 wird auf 100 begrenzt. */
function fenster(pct, resetsAt) {
  const p = zahl(pct);
  const r = zahl(resetsAt);
  return p !== null && p >= 0 && r !== null ? { pct: Math.min(100, p), resetsAt: r } : null;
}

/** Liest `rate_limits` aus dem Statusline-Payload; `null`, wenn kein Fenster brauchbar ist. Pur. */
export function ausStatusline(input, jetzt = Date.now()) {
  const rl = input?.rate_limits;
  if (!rl || typeof rl !== "object") return null;
  const sevenDay = fenster(rl.seven_day?.used_percentage, rl.seven_day?.resets_at);
  const fiveHour = fenster(rl.five_hour?.used_percentage, rl.five_hour?.resets_at);
  return sevenDay || fiveHour ? { stand: jetzt, quelle: "statusline", ...(sevenDay && { sevenDay }), ...(fiveHour && { fiveHour }) } : null;
}

/** Liest das letzte `rate_limit_event` aus den stream-json-Zeilen der Headless-Probe (`utilization` ist ein Bruchteil 0-1); `null` ohne Event. Pur. */
export function ausProbe(zeilen, jetzt = Date.now()) {
  let event = null;
  for (const z of zeilen) {
    try {
      const j = JSON.parse(z);
      if (j?.type === "rate_limit_event") event = j.rate_limit_info ?? j;
    } catch {
      /* unlesbare Zeile überspringen */
    }
  }
  if (!event) return null;
  const aus = (w) => (zahl(w?.utilization) === null ? null : fenster(w.utilization * 100, w.resetsAt));
  let sevenDay = aus(event.unifiedWindows?.seven_day);
  let fiveHour = aus(event.unifiedWindows?.five_hour);
  if (!sevenDay && !fiveHour) {
    // ältere Form: ein einzelnes Fenster am Event selbst
    if (event.rateLimitType === "seven_day") sevenDay = aus(event);
    if (event.rateLimitType === "five_hour") fiveHour = aus(event);
  }
  return sevenDay || fiveHour ? { stand: jetzt, quelle: "probe", ...(sevenDay && { sevenDay }), ...(fiveHour && { fiveHour }) } : null;
}

/** Zielquote aus `KQ_PACING_ZIELQUOTE` (1-100); ungültig ergibt den Default samt Warnung. Pur. */
export function zielquoteAusEnv(env) {
  const roh = env?.KQ_PACING_ZIELQUOTE;
  if (roh === undefined) return { zielquote: ZIELQUOTE_DEFAULT };
  const n = Number(roh);
  if (String(roh).trim() !== "" && Number.isFinite(n) && n >= 1 && n <= 100) return { zielquote: n };
  return { zielquote: ZIELQUOTE_DEFAULT, warnung: `KQ_PACING_ZIELQUOTE="${roh}" ungültig (erlaubt 1-100), Default ${ZIELQUOTE_DEFAULT} gilt.` };
}

/** Braucht die CLI eine Probe? Ja, wenn der Snapshot fehlt, veraltet ist oder kein 7-Tage-Fenster trägt. Pur. */
export function brauchtProbe(snapshot, jetzt = Date.now()) {
  const stand = zahl(snapshot?.stand);
  return stand === null || jetzt - stand > MAX_ALTER_MS || !fenster(snapshot?.sevenDay?.pct, snapshot?.sevenDay?.resetsAt);
}

const RANG = { ok: 0, knapp: 1, stopp: 2 };

/**
 * Entscheidet ok / knapp / stopp. `pauseBis` (ms) steht bei knapp und stopp. Pur.
 * Soll = verstrichener Anteil des 7-Tage-Fensters × Zielquote; knapp bei Ist > Soll + Toleranz, stopp ab Ist ≥ Zielquote;
 * 5h-Fenster ab 90 % ist knapp bis zu dessen Reset. Ein veralteter Snapshot (> 15 min) behält stopp und die 5h-Pause
 * (der Verbrauch wächst im Fenster nur), sein knapp verfällt zu ok mit Warnung.
 */
export function pacing(snapshot, { jetzt = Date.now(), zielquote = ZIELQUOTE_DEFAULT } = {}) {
  const warnungen = [];
  const basis = { status: "ok", pauseBis: null, zielquote, ist7: null, soll7: null, ist5: null, quelle: snapshot?.quelle ?? null, alterMs: null, warnungen };
  if (!snapshot || typeof snapshot !== "object") {
    warnungen.push("Kein Rate-Limit-Snapshot, Lauf geht ohne Pacing weiter.");
    return basis;
  }
  const stand = zahl(snapshot.stand);
  const alterMs = stand === null ? null : Math.max(0, jetzt - stand);
  const veraltet = alterMs === null || alterMs > MAX_ALTER_MS;
  if (veraltet) warnungen.push(alterMs === null ? "Snapshot ohne Zeitstempel, gilt als veraltet." : `Snapshot ${Math.round(alterMs / 60_000)} min alt (Grenze ${MAX_ALTER_MS / 60_000} min).`);
  const offen = (f) => (f && f.resetsAt * 1000 > jetzt ? f : null);
  const f7 = offen(fenster(snapshot.sevenDay?.pct, snapshot.sevenDay?.resetsAt));
  const f5 = offen(fenster(snapshot.fiveHour?.pct, snapshot.fiveHour?.resetsAt));
  Object.assign(basis, { alterMs, ist5: f5?.pct ?? null });
  let status = "ok";
  let pauseBis = null;
  const heben = (s, bis) => {
    if (RANG[s] > RANG[status]) status = s;
    pauseBis = Math.max(pauseBis ?? 0, bis);
  };
  if (f7) {
    const start = f7.resetsAt * 1000 - WOCHE_MS;
    const anteil = Math.min(1, Math.max(0, (jetzt - start) / WOCHE_MS));
    const soll = anteil * zielquote;
    Object.assign(basis, { ist7: f7.pct, soll7: soll });
    if (f7.pct >= zielquote) heben("stopp", f7.resetsAt * 1000);
    else if (f7.pct > soll + TOLERANZ_PP) {
      if (veraltet) warnungen.push("knapp-Befund verworfen: Snapshot zu alt.");
      else heben("knapp", start + (WOCHE_MS * (f7.pct - TOLERANZ_PP)) / zielquote);
    }
  } else warnungen.push("7-Tage-Fenster fehlt oder ist abgelaufen, Wochenstand unbekannt.");
  if (f5 && f5.pct >= FUENF_STUNDEN_GRENZE) heben("knapp", f5.resetsAt * 1000);
  return { ...basis, status, pauseBis: status === "ok" ? null : pauseBis };
}

/**
 * Pfad des kontoweiten Snapshots (OS-Temp, für alle Worktrees gleich, Name `<Worktree-Präfix>rate-limits.json` aus der Projekt-Config);
 * `KQ_RATE_LIMITS_SNAPSHOT` überschreibt ihn (dann braucht es keine Config). Ohne vollständige Config (`ticketNamen` prüft `praefixe.*` und `agenten.*`) wirft die Funktion mit Fix-Zeile; die Statusline fängt das und lässt den Snapshot dann weg.
 */
export function snapshotPfad(env = process.env, config) {
  return env.KQ_RATE_LIMITS_SNAPSHOT || join(tmpdir(), `${ticketNamen(config ?? ladeProjektConfig()).praefixe.worktree}rate-limits.json`);
}

/** Liest den Snapshot; fehlende oder kaputte Datei ergibt `{ snapshot: null, warnung }`. */
export function liesSnapshot(pfad = snapshotPfad()) {
  let text;
  try {
    text = readFileSync(pfad, "utf8");
  } catch {
    return { snapshot: null, warnung: `Snapshot ${pfad} fehlt.` };
  }
  try {
    const j = JSON.parse(text);
    if (j && typeof j === "object") return { snapshot: j, warnung: null };
    return { snapshot: null, warnung: `Snapshot ${pfad} ist kein Objekt.` };
  } catch (e) {
    return { snapshot: null, warnung: `Snapshot ${pfad} ist kaputtes JSON (${e instanceof Error ? e.message : String(e)}).` };
  }
}

/** Schreibt den Snapshot atomar (Temp-Datei, dann rename). */
export function schreibeSnapshot(snapshot, pfad = snapshotPfad()) {
  mkdirSync(dirname(pfad), { recursive: true });
  const tmp = `${pfad}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(snapshot));
    renameSync(tmp, pfad);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}
