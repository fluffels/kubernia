// Kein Shebang: Lib, wird vom Server importiert und von test/cockpit/ geprüft.
/* Quellen-Vertrag des Harness-Cockpits (ADR 0029): eine Quelle ist `{ id, titel, ttlMs, sammeln(ctx) }`.
 * Der Kontext `ctx` trägt `jetzt()`, `signal`, `projekt` (absoluter Projektpfad) und `lauf(id)` (Allowlist-Unterprozess); weitere Felder liefert `ctxFuer`.
 * `sammeln` liefert `ok(daten, ctx)` (daten mit mindestens einem Wert) oder `ausfall(grund, ctx)` mit der Form `{ status: ok|ausfall, stand, daten|null, grund|null }`.
 * Der Abruf läuft parallel mit Frist je Quelle, hält Ergebnisse nur im Speicher (TTL) und merkt von einem früheren Erfolg
 * allein die Zeit (`zuletztOk`), nie Werte. Wirft eine Quelle, läuft in die Frist oder liefert eine ungültige Form, ist das ein Ausfall.
 * Neue Quelle = eine Datei unter quellen/ plus eine Zeile in registry.mjs plus ein Eintrag in .factory/besitz.json (Ring oberflaeche); dieses Modul kennt keine Quelle beim Namen. */

export const STATUS = ["ok", "ausfall"];

/** Wirft bei einer ungültigen Quellenliste (fehlende oder doppelte id, leerer Titel, ttlMs nicht endlich oder ≤ 0, sammeln keine Funktion). */
export function pruefeQuellen(liste) {
  if (!Array.isArray(liste)) throw new Error("Quellen: keine Liste");
  const ids = new Set();
  for (const q of liste) {
    if (!q || typeof q.id !== "string" || q.id === "") throw new Error("Quelle ohne id");
    if (ids.has(q.id)) throw new Error(`Quelle doppelt: ${q.id}`);
    ids.add(q.id);
    if (typeof q.titel !== "string" || q.titel.trim() === "") throw new Error(`Quelle ${q.id}: Titel fehlt`);
    if (!Number.isFinite(q.ttlMs) || q.ttlMs <= 0) throw new Error(`Quelle ${q.id}: ttlMs muss eine endliche Zahl > 0 sein`);
    if (typeof q.sammeln !== "function") throw new Error(`Quelle ${q.id}: sammeln ist keine Funktion`);
  }
}

/** `null` bei gültiger Form, sonst der Grund. */
export function pruefeErgebnis(e) {
  if (!e || typeof e !== "object") return "kein Objekt";
  if (!STATUS.includes(e.status)) return "status weder ok noch ausfall";
  if (!Number.isFinite(e.stand)) return "stand keine Zahl";
  if (e.status === "ok") {
    if (!e.daten || typeof e.daten !== "object") return "ok ohne daten";
    if (Object.keys(e.daten).length === 0) return "ok ohne Werte";
    if (e.grund !== null) return "ok mit grund";
    return null;
  }
  if (e.daten !== null) return "ausfall mit daten";
  if (typeof e.grund !== "string" || e.grund === "") return "ausfall ohne grund";
  return null;
}

export const ok = (daten, ctx) => ({ status: "ok", stand: ctx.jetzt(), daten, grund: null });
export const ausfall = (grund, ctx) => ({ status: "ausfall", stand: ctx.jetzt(), daten: null, grund });

async function hole(q, { jetzt, ctxFuer }, timeoutMs) {
  const abbruch = new AbortController();
  const ctx = { ...ctxFuer(abbruch.signal), jetzt, signal: abbruch.signal };
  let uhr;
  const frist = new Promise((res) => {
    uhr = setTimeout(() => {
      abbruch.abort();
      res(ausfall(`Timeout nach ${timeoutMs} ms`, ctx));
    }, timeoutMs);
  });
  let e;
  try {
    e = await Promise.race([Promise.resolve().then(() => q.sammeln(ctx)), frist]);
  } catch (fehler) {
    e = ausfall(`Fehler: ${fehler?.message ?? String(fehler)}`, ctx);
  } finally {
    clearTimeout(uhr);
  }
  const grund = pruefeErgebnis(e);
  return grund ? ausfall(`Ungültiges Ergebnis: ${grund}`, ctx) : e;
}

/**
 * `sammleAlle()` liefert je Quelle `{ id, titel, ergebnis, zuletztOk }` (`zuletztOk`: Zeit des letzten gültigen Erfolgs oder null).
 * `ctxFuer(signal)` ergänzt den Kontext (z.B. `lauf`); `jetzt` ist die Uhr (epoch ms).
 */
export function erzeugeAbruf({ quellen, timeoutMs = 5000, jetzt = Date.now, ctxFuer = () => ({}) }) {
  pruefeQuellen(quellen);
  const zustand = new Map(quellen.map((q) => [q.id, { ergebnis: null, abgerufen: 0, zuletztOk: null, laufend: null }]));

  function abruf(q) {
    const z = zustand.get(q.id);
    if (z.ergebnis && jetzt() - z.abgerufen < q.ttlMs) return Promise.resolve(z);
    if (!z.laufend) {
      const start = jetzt();
      z.laufend = hole(q, { jetzt, ctxFuer }, timeoutMs)
        .then((e) => {
          z.ergebnis = e;
          z.abgerufen = start;
          if (e.status === "ok") z.zuletztOk = e.stand;
          return z;
        })
        .finally(() => {
          z.laufend = null;
        });
    }
    return z.laufend;
  }

  return async function sammleAlle() {
    const zustaende = await Promise.all(quellen.map(abruf));
    return quellen.map((q, i) => ({ id: q.id, titel: q.titel, ergebnis: zustaende[i].ergebnis, zuletztOk: zustaende[i].zuletztOk }));
  };
}
