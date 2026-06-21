/* Tests fürs Glossar (#226): der reine Marker-Helfer + Konsistenz der im
 * Lerntext gesetzten [[…]]-Marker gegen die GLOSSARY-Datenquelle. */
import { test } from "vitest";
import assert from "node:assert/strict";
import { KQContent } from "../src/content";
import { GLOSSARY, applyGlossary, glossaryMarkerKeys } from "../src/content/glossary";

/** Sammelt allen Lerntext, der beim Rendern durch `applyGlossary` läuft
 *  (Dialoge, Choice-Frage/-Optionen/-Antworten, teach-intro/text). Nur HIER
 *  dürfen [[…]]-Marker stehen – sonst würden sie nie zu Chips. */
function collectGlossaryHostTexts(): string[] {
  const out: string[] = [];
  for (const quest of KQContent.QUESTS) {
    for (const step of quest.steps) {
      if (step.type === "dialog") out.push(...step.lines);
      else if (step.type === "teach") out.push(step.cmd.intro, step.cmd.text);
      else if (step.type === "choice") {
        out.push(step.q);
        for (const o of step.options) out.push(o.t, o.reply);
      }
    }
  }
  return out;
}

test("applyGlossary: bekannter Marker wird zum Hover-Chip", () => {
  const html = applyGlossary("Hol es aus der [[Registry]].");
  assert.match(html, /<span class="gloss" title="[^"]+">Registry<\/span>/);
  assert.ok(!html.includes("[["), "kein roher Marker übrig");
});

test("applyGlossary: Anzeige|Schlüssel erlaubt flektierte Anzeige", () => {
  const html = applyGlossary("Zwei [[Images|image]] im Lager.");
  assert.match(html, /<span class="gloss" title="[^"]+">Images<\/span>/);
});

test("applyGlossary: unbekannter Marker fällt auf reinen Text zurück (nie kaputt anzeigen)", () => {
  assert.equal(applyGlossary("Ein [[Quasar]] erscheint."), "Ein Quasar erscheint.");
});

test("applyGlossary: Definition wird fürs title-Attribut maskiert (keine rohen <>)", () => {
  const m = applyGlossary("[[Build]]").match(/title="([^"]*)"/);
  assert.ok(m, "title vorhanden");
  assert.ok(!/[<>]/.test(m![1]), "keine rohen Winkelklammern im title");
});

test("Glossar: jeder Eintrag hat Begriff + nicht-leere Definition", () => {
  const bad = Object.entries(GLOSSARY)
    .filter(([, e]) => !e.begriff?.trim() || !e.def?.trim())
    .map(([k]) => k);
  assert.deepEqual(bad, [], "Einträge ohne Begriff/Definition: " + bad.join(", "));
});

test("Konsistenz: jeder [[…]]-Marker im Lerntext zeigt auf einen echten Glossar-Eintrag", () => {
  const unknown: string[] = [];
  for (const text of collectGlossaryHostTexts()) {
    for (const key of glossaryMarkerKeys(text)) {
      if (!GLOSSARY[key]) unknown.push(`${key} (in: ${text.slice(0, 50)}…)`);
    }
  }
  assert.deepEqual(unknown, [], "Unbekannte Marker: " + unknown.join(" | "));
});

test("Red-Green: ein erfundener Marker würde vom Konsistenz-Check gefangen", () => {
  assert.deepEqual(glossaryMarkerKeys("Test [[GibtsNicht]]"), ["gibtsnicht"]);
  assert.equal(GLOSSARY["gibtsnicht"], undefined);
});

test("Wiring-Smoke: es sind tatsächlich auflösbare Marker im Lerntext gesetzt", () => {
  let chips = 0;
  for (const text of collectGlossaryHostTexts()) chips += glossaryMarkerKeys(text).length;
  assert.ok(chips > 0, "kein einziger Glossar-Marker im Lerntext gefunden");
});
