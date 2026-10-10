// Kein Shebang, kein Direktaufruf: Lib für `gh-kontingent.mjs`, `board-place.mjs`, `board-takt.mjs`, `naechstes-ticket.mjs` und
// `sammelticket-anlegen.mjs` (#1579, Konvention #1398: Einstiegsskripte importieren nicht voneinander, gemeinsamer Code steht in einer Lib).
/**
 * Kern der GitHub-API-Kontingent-Messung (#1549 Z1, Bezug #1358): `gh api rate_limit` lesen, vorab prüfen (`kontingentPruefen`),
 * Kosten je Skriptlauf protokollieren (`mitKontingent`, `kostenDelta`, `berichtAus`). Das CLI (Stand anzeigen, `--bericht`) steht in
 * gh-kontingent.mjs. Es liest nur über `gh-cli.mjs` (der Wächter `test/harness/gh-cli.test.ts` verbietet einen direkten `gh`-Aufruf).
 */
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ghJson } from "./gh-cli.mjs";

/** Unterhalb dieses Anteils am Limit gilt das Kontingent als knapp. */
export const MIN_ANTEIL = 0.1;
/** Exit-Code für „Kontingent knapp“ (frei neben den 1/2 der Board-Skripte). */
export const EXIT_KNAPP = 3;
export const ARTEN = ["core", "graphql"];

const zahl = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Liest die Ressource `art` aus der `rate_limit`-Antwort; `null` bei fehlenden oder unsinnigen Feldern. */
export function ressource(json, art) {
  const r = json?.resources?.[art];
  const [limit, remaining, reset, used] = [zahl(r?.limit), zahl(r?.remaining), zahl(r?.reset), zahl(r?.used)];
  return limit && limit > 0 && remaining !== null && reset !== null ? { limit, remaining, reset, used: used ?? limit - remaining } : null;
}

/** Prüft beide Kontingente. Fail-open: nicht lesbare Antworten ergeben `ok` mit `warnung`. Pur. */
export function kontingentPruefen(json, { minAnteil = MIN_ANTEIL, jetzt = Date.now(), arten = ARTEN } = {}) {
  const knapp = [];
  let gelesen = 0;
  for (const art of arten) {
    const r = ressource(json, art);
    if (!r) continue;
    gelesen++;
    if (r.remaining / r.limit < minAnteil) {
      knapp.push({ art, remaining: r.remaining, limit: r.limit, resetInMin: Math.max(0, Math.ceil((r.reset * 1000 - jetzt) / 60_000)) });
    }
  }
  if (gelesen === 0) return { ok: true, knapp: [], meldung: "", warnung: "GitHub-API-Kontingent nicht lesbar, Lauf geht ohne Vorab-Prüfung weiter." };
  const meldung = knapp.length
    ? `GitHub-API-Kontingent knapp: ${knapp.map((k) => `${k.art} ${k.remaining}/${k.limit} (${Math.round((k.remaining / k.limit) * 100)} %)`).join(", ")}, Reset in ${Math.max(...knapp.map((k) => k.resetInMin))} min.`
    : "";
  return { ok: knapp.length === 0, knapp, meldung };
}

/** Verbrauch zwischen zwei `rate_limit`-Antworten je Art. Ein anderes `reset` heißt gerolltes Fenster: dann zählt `used` des neuen. Pur. */
export function kostenDelta(vorher, nachher) {
  const aus = {};
  for (const art of ARTEN) {
    const v = ressource(vorher, art);
    const n = ressource(nachher, art);
    if (!v || !n) aus[art] = 0;
    else aus[art] = Math.max(0, v.reset === n.reset ? n.used - v.used : n.used);
  }
  return aus;
}

/** Aggregiert JSONL-Zeilen je Skript (Läufe, Summen, Maxima); unlesbare Zeilen werden gezählt, leere ignoriert. Pur. */
export function berichtAus(zeilen) {
  const skripte = {};
  let uebersprungen = 0;
  for (const z of zeilen) {
    if (!z.trim()) continue;
    let e;
    try {
      e = JSON.parse(z);
    } catch {
      uebersprungen++;
      continue;
    }
    if (typeof e?.skript !== "string") {
      uebersprungen++;
      continue;
    }
    const s = (skripte[e.skript] ??= { laeufe: 0, core: 0, graphql: 0, coreMax: 0, graphqlMax: 0 });
    const [c, g] = [zahl(e.core) ?? 0, zahl(e.graphql) ?? 0];
    s.laeufe++;
    s.core += c;
    s.graphql += g;
    s.coreMax = Math.max(s.coreMax, c);
    s.graphqlMax = Math.max(s.graphqlMax, g);
  }
  return { skripte, uebersprungen };
}

/** `gh api rate_limit` lesen; wirft bei Fehler (Aufrufer entscheidet fail-open). */
export function kontingentLesen({ token, exec, timeout = 15_000 } = {}) {
  return ghJson(["api", "rate_limit"], { token, exec, timeout });
}

export const logPfad = (env = process.env) => env.KQ_GH_KOSTEN_LOG || join(tmpdir(), "kubernia-gh-kosten.jsonl");

/**
 * Vorab-Prüfung am Anfang eines Skripts und Kostenmessung beim Beenden. Gibt `{ ok }` zurück.
 * Knapp lokal: Meldung, `beende(3)` (Standard `process.exit`). Unter GitHub Actions nur `::warning::`, damit ein Takt auf `main` nicht rot wird.
 * `arten` begrenzt die Vorab-Prüfung auf die Kontingente, die das Skript verbraucht (`naechstes-ticket` läuft nur über REST: `["core"]`).
 * Alles injizierbar (`exec`, `schreibe`, `schreibeLog`, `registriere`, `beende`, `env`, `jetzt`) für Tests.
 */
export function mitKontingent(name, opts = {}) {
  const {
    token,
    exec,
    arten = ARTEN,
    env = process.env,
    jetzt = Date.now,
    schreibe = (t) => process.stderr.write(t),
    schreibeLog = (z) => appendFileSync(logPfad(env), `${z}\n`),
    registriere = (f) => process.on("exit", f),
    beende = (c) => process.exit(c),
  } = opts;
  const actions = Boolean(env.GITHUB_ACTIONS);
  let vorher;
  try {
    vorher = kontingentLesen({ token, exec });
  } catch (e) {
    schreibe(`Hinweis: GitHub-API-Kontingent nicht lesbar (${String(e instanceof Error ? e.message : e).split("\n")[0].slice(0, 100)}), Lauf geht weiter.\n`);
    return { ok: true };
  }
  const p = kontingentPruefen(vorher, { jetzt: jetzt(), arten });
  if (p.warnung) schreibe(`${p.warnung}\n`);
  if (!p.ok) {
    if (!actions) {
      schreibe(`✖ Abbruch: ${p.meldung} Später erneut fahren.\n`);
      beende(EXIT_KNAPP);
      return { ok: false };
    }
    schreibe(`::warning::${p.meldung} Lauf geht weiter.\n`);
  }
  registriere(() => {
    try {
      const nachher = kontingentLesen({ token, exec, timeout: 5_000 });
      const d = kostenDelta(vorher, nachher);
      const c = ressource(nachher, "core");
      const g = ressource(nachher, "graphql");
      const eintrag = { ts: new Date(jetzt()).toISOString(), skript: name, core: d.core, graphql: d.graphql, coreRest: c?.remaining ?? null, graphqlRest: g?.remaining ?? null, reset: c?.reset ?? null };
      if (actions) schreibe(`::notice title=gh-Kosten::${name}: core ${d.core}, graphql ${d.graphql} (Rest core ${eintrag.coreRest}, graphql ${eintrag.graphqlRest})\n`);
      else schreibeLog(JSON.stringify(eintrag));
    } catch {
      /* Messung ist Beiwerk: nie den Lauf stören */
    }
  });
  return { ok: true };
}
