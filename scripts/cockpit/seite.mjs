// Kein Shebang: Lib. Rendert die Cockpit-Seite serverseitig; kein Client-Skript, jeder Wert wird escaped (auch Fremdtext späterer Quellen).
// Escapen ist keine Inhaltsprüfung: der Text bleibt Text, wird aber nie als Markup ausgeführt.

const KLASSE = { ok: "ok", ausfall: "ausfall" };

export function escapeHtml(wert) {
  return String(wert).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const zwei = (n) => String(n).padStart(2, "0");

/** Lokale Zeit `YYYY-MM-DD HH:MM:SS` aus epoch ms. */
export function formatZeit(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())} ${zwei(d.getHours())}:${zwei(d.getMinutes())}:${zwei(d.getSeconds())}`;
}

const wertText = (v) => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));

function renderPanel({ titel, ergebnis, zuletztOk }) {
  const kopf = `<h2>${escapeHtml(titel)}</h2>\n<p class="stand">Stand ${escapeHtml(formatZeit(ergebnis.stand))}</p>`;
  if (ergebnis.status !== "ok") {
    const zuletzt = zuletztOk === null ? "nie" : formatZeit(zuletztOk);
    return `<section class="panel ${KLASSE.ausfall}">\n${kopf}\n<p class="meldung">${escapeHtml(`Ausfall: ${ergebnis.grund}, zuletzt ok ${zuletzt}`)}</p>\n</section>`;
  }
  const zeilen = Object.entries(ergebnis.daten)
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(wertText(v))}</dd>`)
    .join("\n");
  return `<section class="panel ${KLASSE.ok}">\n${kopf}\n<dl>\n${zeilen}\n</dl>\n</section>`;
}

/** Volle HTML-Seite: `panels` aus `sammleAlle()`, `jetzt` epoch ms, `projekt` der Anzeigepfad. */
export function renderSeite({ panels, jetzt, projekt, refreshS = 30 }) {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="${Number(refreshS)}">
<title>Harness-Cockpit</title>
<link rel="stylesheet" href="/cockpit.css">
</head>
<body>
<h1>Harness-Cockpit</h1>
<p class="projekt">Projekt ${escapeHtml(projekt)} · Seite von ${escapeHtml(formatZeit(jetzt))}</p>
${panels.map(renderPanel).join("\n")}
</body>
</html>
`;
}
