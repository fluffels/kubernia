// Zentrale Fehler-Diagnostik (#504), Teil 1: die PURE Entscheidung, wie ein
// beliebiger geworfener Wert für den Menschen lesbar aufbereitet wird. Kein DOM/
// Phaser (pure Domäne), damit die Normalisierung im Node-Test prüfbar ist; die
// DOM-Umsetzung (globaler window.onerror/unhandledrejection-Handler + Fallback-
// Overlay) steht in src/main.ts.
//
// Hintergrund (#504): Ein unbehandelter Laufzeitfehler in einer Phaser-Szene riss
// das Spiel bisher STILL weg – schwarzes Canvas, kein Hinweis. Der zentrale
// Handler fängt das jetzt ab, bekommt dabei aber die unterschiedlichsten Werte
// (ein `Error`, einen String, eine `DOMException`, oder einen Promise-`reason`
// beliebigen Typs). Diese Funktion bringt sie auf EIN lesbares Format.

export interface CrashReport {
  /** Freundliche Überschrift für die Spielerin (immer gleich, kein Fachjargon). */
  title: string;
  /** Eine Zeile Klartext: was schiefging (die Fehlermeldung, gekappt). */
  message: string;
  /** Technisches Detail zum Aufklappen (Stacktrace, falls vorhanden; sonst leer). */
  detail: string;
}

/** Feste, nicht-technische Überschrift des Absturz-Overlays. */
export const CRASH_TITLE = "⚓ Kubernia ist auf ein Problem gestoßen";

/** Fallback-Meldung, wenn sich aus dem geworfenen Wert kein Text gewinnen lässt. */
export const CRASH_FALLBACK_MESSAGE = "Ein unerwarteter Fehler ist aufgetreten.";

/** Kappungsgrenzen, damit ein riesiger Wert (langer Stack, großes Objekt) das
 *  Overlay nicht sprengt – die Meldung bleibt eine lesbare Zeile, das Detail ein
 *  überschaubarer Block. */
const MAX_MESSAGE = 300;
const MAX_DETAIL = 4000;

/** Duck-Typing für „fehlerartige" Werte: erfasst `Error` UND Fremd-Fehler wie
 *  `DOMException`, die nicht überall `instanceof Error` sind, aber eine
 *  string-`message` tragen. */
function isErrorLike(v: unknown): v is { name?: unknown; message?: unknown; stack?: unknown } {
  return typeof v === "object" && v !== null && typeof (v as { message?: unknown }).message === "string";
}

/** Bester Klartext aus einem Nicht-Fehler-Wert, ohne je selbst zu werfen
 *  (zirkuläre Objekte lassen `JSON.stringify` werfen → String-Fallback). */
function safeString(v: unknown): string {
  try {
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  } catch {
    return String(v);
  }
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function describe(reason: unknown): { message: string; detail: string } {
  if (isErrorLike(reason)) {
    const name = typeof reason.name === "string" ? reason.name : "Error";
    const msg = typeof reason.message === "string" ? reason.message : "";
    const stack = typeof reason.stack === "string" ? reason.stack : "";
    return {
      // Nur die echte message als Klartext – ist sie leer (z.B. `throw new Error()`),
      // greift die freundliche Fallback-Meldung statt eines nackten „Error".
      message: msg,
      // Der Stack enthält üblicherweise schon „Name: message" in der ersten Zeile;
      // fehlt er, stellen wir „Name: message" als Detail-Kopf, damit nichts verloren geht.
      detail: stack || (msg ? `${name}: ${msg}` : ""),
    };
  }
  if (typeof reason === "string") return { message: reason, detail: "" };
  if (reason == null) return { message: "", detail: "" };
  return { message: safeString(reason), detail: "" };
}

/** Normalisiert einen beliebigen geworfenen Wert in einen anzeigbaren Absturz-
 *  Bericht: feste Überschrift, eine gekappte Klartext-Zeile und ein optionales,
 *  ebenfalls gekapptes technisches Detail (Stacktrace). Wirft nie. */
export function buildCrashReport(reason: unknown): CrashReport {
  const { message, detail } = describe(reason);
  return {
    title: CRASH_TITLE,
    message: clip(message.trim(), MAX_MESSAGE) || CRASH_FALLBACK_MESSAGE,
    detail: clip(detail.trim(), MAX_DETAIL),
  };
}
