/* Tests für die zentrale Platzhalter-Darstellung (#311): `fmtCmd` macht aus einem
 * `<token>` im Content-Text ein sichtbares, farbig abgesetztes „ändere-mich"-Badge,
 * lässt echte HTML-Tags aber unangetastet. Rein string→string, ohne DOM/Phaser.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { fmtCmd, CONTENT_HTML_TAGS } from "../src/markup";

test("Platzhalter <token> wird zum sichtbaren .ph-Badge mit erhaltenen spitzen Klammern (#311)", () => {
  assert.equal(fmtCmd("docker pull <image>"), 'docker pull <span class="ph">&lt;image&gt;</span>');
});

test("mehrere Platzhalter in einem Befehl werden alle einzeln ausgezeichnet (#311)", () => {
  assert.equal(
    fmtCmd("docker run -d --name <eigener-name> <image>"),
    'docker run -d --name <span class="ph">&lt;eigener-name&gt;</span> <span class="ph">&lt;image&gt;</span>',
  );
});

test("Bindestrich- und Umlaut-Token werden erkannt (#311)", () => {
  assert.equal(fmtCmd("kubectl describe pod <zwischenlager-pod>"), 'kubectl describe pod <span class="ph">&lt;zwischenlager-pod&gt;</span>');
  assert.equal(fmtCmd("--from-literal=<schlüssel>=<wert>"), '--from-literal=<span class="ph">&lt;schlüssel&gt;</span>=<span class="ph">&lt;wert&gt;</span>');
});

test("echte HTML-Tags bleiben unangetastet – nur Platzhalter werden umgesetzt (#311)", () => {
  // Öffnende Einwort-Tags aus dem Content bleiben stehen …
  assert.equal(fmtCmd("<b>fett</b> und <i>kursiv</i> und <code>docker ps</code>"),
    "<b>fett</b> und <i>kursiv</i> und <code>docker ps</code>");
  assert.equal(fmtCmd("Zeile eins<br>Zeile zwei"), "Zeile eins<br>Zeile zwei");
  // … alle Allowlist-Tags sind No-ops.
  for (const tag of CONTENT_HTML_TAGS) assert.equal(fmtCmd(`<${tag}>`), `<${tag}>`);
});

test("Platzhalter INNERHALB eines <code>-Befehls wird ausgezeichnet, das <code> bleibt (#311)", () => {
  assert.equal(fmtCmd("<code>docker pull <image></code>"),
    '<code>docker pull <span class="ph">&lt;image&gt;</span></code>');
});

test("schließende Tags und Tags mit Attributen werden nicht als Platzhalter verwechselt (#311)", () => {
  assert.equal(fmtCmd("</code>"), "</code>");
  assert.equal(fmtCmd('<a href="https://x">Link</a>'), '<a href="https://x">Link</a>');
  // Pfad mit Schrägstrich: nur der reine `<name>`-Teil ist Platzhalter, `deployment/` bleibt.
  assert.equal(fmtCmd("deployment/<name>"), 'deployment/<span class="ph">&lt;name&gt;</span>');
});

test("kein Fehlalarm bei Git-Konfliktmarkern, Vergleichen und Emoticons (#311)", () => {
  // Git-Konfliktmarker: nach `<` folgt `<`, kein Buchstabe → kein Platzhalter.
  assert.equal(fmtCmd("<<<<<<< HEAD"), "<<<<<<< HEAD");
  // Vergleich mit Leerzeichen bleibt Text.
  assert.equal(fmtCmd("wenn a < b dann"), "wenn a < b dann");
  assert.equal(fmtCmd("Preis <3 Euro"), "Preis <3 Euro");
});

test("fmtCmd ist idempotent: ein zweiter Lauf ändert nichts mehr (#311)", () => {
  const once = fmtCmd("docker pull <image> mit <code>docker</code>");
  assert.equal(fmtCmd(once), once);
});

test("Red-Green: OHNE fmtCmd bliebe der bare Platzhalter unsichtbares HTML – MIT fmtCmd wird er sichtbar (#311)", () => {
  const raw = "cat <datei>";
  // Beweis, dass die Umsetzung wirklich greift (sonst wäre der Test wertlos):
  assert.ok(!raw.includes('class="ph"'), "Vorbedingung: roh trägt noch kein Badge");
  const rendered = fmtCmd(raw);
  assert.ok(rendered.includes('<span class="ph">&lt;datei&gt;</span>'), "Platzhalter wurde nicht sichtbar gemacht: " + rendered);
});
