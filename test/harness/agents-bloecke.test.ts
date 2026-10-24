/* Aufbau der AGENTS.md in Kern- und Projekt-Block (#1708, ADR 0022 F4): Kopf, dann ein zusammenhängender Kern-Block `kern`
 * (Besitz der Factory, zwischen den Besitz-Markern, im Manifest eingetragen), dann der Projekt-Block (eigene Marker). Die Stopps-Anker
 * prüft `harness-approval.test.ts`, die Platzhalter-Auflösung im Text `platzhalter-regel.test.ts`; hier der Aufbau, die Manifest-Zeile,
 * die Auflösbarkeit der Platzhalter, die Projekt-Leitfrage und das Drift-Verhalten am echten Text.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel (kein eigenes check-Skript), darum im geschützten test/harness/ (#1165).
 *
 * Grenze (geschlossener Scan-Umfang): geprüft werden nur `AGENTS.md`, `.factory/besitz.json`, `.factory/projekt.json`, die drei Prompt-Einheiten (Planer, Umsetzer, `review-lenses`); Leitfrage-Inhalt und Messlatten-Datei prüft ein Projekt-Test; die Bedeutung
 * der Regeltexte prüft kein Wächter, Stopp-Aussagen im Projekt-Block fangen nur die Pin-Zeile und die Stopp-Wort-Prüfung in `forum-stopps-projekt.test.ts`. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDrift from "../../scripts/check-factory-drift.mjs";
import { projektConfig } from "../support/fremd-config";

/** Kein Projektliteral der Config (Groß-/Kleinschreibung egal) steht im Text; Treffer als Liste der Namen. */
const projektliteraleIn = (text: string): string[] =>
  Object.entries(projektConfig().projektliterale ?? {}).filter(([, wert]) => text.toLowerCase().includes(wert.toLowerCase())).map(([name]) => name);

interface Eintrag {
  pfad: string;
  block?: string;
  ring: string;
}
interface Lib {
  einheitText(e: Eintrag, t: string): string | null;
  einheitHash(e: Eintrag, t: string): string | null;
  einheitId(e: Eintrag): string;
  textHash(t: string): string;
  markerStart(id: string): string;
  markerEnde(id: string): string;
  PROJEKT_BLOCK_START: string;
  PROJEKT_BLOCK_ENDE: string;
  platzhalterMuster(): RegExp;
  projektwertWert(config: unknown, schluessel: string): string;
}
interface Drift {
  pruefeDrift(lies: (p: string) => string | null): { entfaellt: boolean; fehler: string[] };
}
const lib = rawLib as unknown as Lib;
const drift = rawDrift as unknown as Drift;

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const lese = (p: string): string => readFileSync(WURZEL + p, "utf8").replace(/\r\n/g, "\n");

const KERN_START = lib.markerStart("kern");
const KERN_ENDE = lib.markerEnde("kern");
const PROJEKT_START = lib.PROJEKT_BLOCK_START;
const PROJEKT_ENDE = lib.PROJEKT_BLOCK_ENDE;

const zaehle = (t: string, s: string): number => t.split(s).length - 1;

/** Aufbau-Befunde: je genau ein Marker-Paar in der Reihenfolge Kopf, Kern, Projekt; im Kopf nur die Titelzeile und Leerzeilen (Zitate stehen in den Blöcken); zwischen den Blöcken und nach dem Ende nur Leerzeilen. */
function aufbauBefunde(text: string): string[] {
  const f: string[] = [];
  for (const m of [KERN_START, KERN_ENDE, PROJEKT_START, PROJEKT_ENDE]) if (zaehle(text, m) !== 1) f.push(`Marker ${m} steht ${zaehle(text, m)}x (genau 1x verlangt)`);
  if (f.length > 0) return f;
  const [ks, ke, ps, pe] = [KERN_START, KERN_ENDE, PROJEKT_START, PROJEKT_ENDE].map((m) => text.indexOf(m));
  if (!(ks < ke && ke < ps && ps < pe)) return ["Reihenfolge Kern-Start, Kern-Ende, Projekt-Start, Projekt-Ende verletzt"];
  const leer = (s: string): boolean => s.trim() === "";
  for (const z of text.slice(0, ks).split("\n")) if (!(leer(z) || z.startsWith("# "))) f.push(`Kopf vor dem Kern trägt eine fremde Zeile: ${z.slice(0, 40)}`);
  if (!leer(text.slice(ke + KERN_ENDE.length, ps))) f.push("zwischen Kern-Ende und Projekt-Start steht Text");
  if (!leer(text.slice(pe + PROJEKT_ENDE.length))) f.push("nach Projekt-Ende steht Text");
  return f;
}

const KERN: Eintrag = { pfad: "AGENTS.md", block: "kern", ring: "kern-nach-entkopplung" };

/** Platzhalter eines Textes, deren Schlüssel in der Config nicht auflösen. */
function unaufloesbar(text: string, config: Record<string, Record<string, string>>): string[] {
  return [...text.matchAll(lib.platzhalterMuster())]
    .filter((m) => {
      try {
        lib.projektwertWert(config, `${m[1]}.${m[2]}`);
        return false;
      } catch {
        return true;
      }
    })
    .map((m) => m[0]);
}

const stand = (agents: string, manifestText: string): string =>
  JSON.stringify({ version: 2, quelle: { commit: "0".repeat(40), tag: "v1", sauber: true }, manifest: lib.textHash(manifestText), einheiten: { [lib.einheitId(KERN)]: lib.einheitHash(KERN, agents) } });

const nurKernManifest = JSON.stringify({ eintraege: [KERN] });

function driftAm(agents: string, standAgents: string): string[] {
  const dateien: Record<string, string> = { ".factory/sync-stand.json": stand(standAgents, nurKernManifest), ".factory/besitz.json": nurKernManifest, "AGENTS.md": agents };
  const r = drift.pruefeDrift((p) => dateien[p] ?? null);
  assert.equal(r.entfaellt, false);
  return r.fehler;
}

describe("AGENTS.md: Kern- und Projekt-Block (#1708)", () => {
  const agents = lese("AGENTS.md");

  test("Aufbau: Kopf, genau ein Kern-Block, genau ein Projekt-Block, nichts außerhalb", () => {
    assert.deepEqual(aufbauBefunde(agents), []);
  });

  test("Red-Green: zweiter Projekt-Start, Text nach dem Ende, Text zwischen den Blöcken, fremde Kopfzeile, fehlender Marker, falsche Reihenfolge", () => {
    assert.match(aufbauBefunde(`${agents}${PROJEKT_START}\n`).join("|"), /factory-projekt:start.*2x/);
    assert.match(aufbauBefunde(`${agents}\n- ein Bullet nach dem Ende\n`).join("|"), /nach Projekt-Ende/);
    assert.match(aufbauBefunde(agents.replace(PROJEKT_START, `- Bullet\n${PROJEKT_START}`)).join("|"), /zwischen Kern-Ende und Projekt-Start/);
    assert.match(aufbauBefunde(agents.replace(KERN_START, `## Eigener Abschnitt\n${KERN_START}`)).join("|"), /Kopf vor dem Kern/);
    assert.match(aufbauBefunde(agents.replace(KERN_START, `> Zitat im Kopf\n${KERN_START}`)).join("|"), /Kopf vor dem Kern/);
    assert.match(aufbauBefunde(agents.replace(KERN_ENDE, "")).join("|"), /factory-besitz:ende kern.*0x/);
    assert.match(aufbauBefunde(agents.replace(KERN_START, "@@").replace(PROJEKT_START, KERN_START).replace("@@", PROJEKT_START)).join("|"), /Reihenfolge/);
  });

  test("Manifest: genau ein Eintrag für AGENTS.md, der Block `kern` im Ring kern-nach-entkopplung, kein Block `stopps`", () => {
    const eintraege = (JSON.parse(lese(".factory/besitz.json")) as { eintraege: Eintrag[] }).eintraege.filter((e) => e.pfad === "AGENTS.md");
    assert.equal(eintraege.length, 1);
    assert.equal(eintraege[0].block, "kern");
    assert.equal(eintraege[0].ring, "kern-nach-entkopplung");
    assert.equal(agents.includes("factory-besitz:start stopps"), false);
  });

  test("Platzhalter im Kern lösen in .factory/projekt.json auf (Red-Green: falsche Schreibweise und unbekannter Schlüssel)", () => {
    const config = JSON.parse(lese(".factory/projekt.json")) as Record<string, Record<string, string>>;
    const kern = lib.einheitText(KERN, agents) ?? "";
    assert.ok(zaehle(kern, "<praefixe.commitZeile>") >= 2, "der Kern nutzt die Platzhalter wirklich (sonst wäre der Test vakuös)");
    assert.deepEqual(unaufloesbar(kern, config), []);
    assert.deepEqual(unaufloesbar("x <praefixe.commitzeile> y", config), ["<praefixe.commitzeile>"]);
    assert.deepEqual(unaufloesbar("x <agenten.gibtEsNicht> y", config), ["<agenten.gibtEsNicht>"]);
    assert.deepEqual(unaufloesbar("<gruppe.schlüssel>", config), [], "der Beispiel-Platzhalter der Einleitung ist kein Schlüssel");
  });

  test("Projekt-Leitfrage: die Oberste Regel steht im Projekt-Block, der Kern verweist darauf", () => {
    const kern = lib.einheitText(KERN, agents) ?? "";
    const projekt = agents.slice(agents.indexOf(PROJEKT_START), agents.indexOf(PROJEKT_ENDE));
    assert.match(kern, /Projekt-Leitfrage/);
    assert.match(projekt, /### ⭐ Oberste Regel/);
    assert.match(projekt, /\*\*Projekt-Leitfrage\*\*/);
    assert.equal(kern.includes("Oberste Regel"), true, "die Einleitung nennt den Namen der Stelle");
    assert.deepEqual(projektliteraleIn(kern), [], "der Kern nennt keine Projekt-Leitfrage-Inhalte");
  });

  // Der Prompt eines Subagenten ist seine Datei plus die nativ geladene AGENTS.md (#1087): die Kern-Prompts verweisen auf den
  // Projekt-Block, dort stehen Leitfrage und Optik-Messlatte (#1709).
  test("Projektregeln im Prompt (#1709): Kern-Prompts verweisen, der Projekt-Block trägt Leitfrage und Optik-Messlatte", () => {
    const planer = lese(".claude/agents/factory-planer.md");
    const umsetzer = lese(".claude/agents/factory-umsetzer.md");
    const lenses = lese(".agents/skills/review-lenses/SKILL.md");
    for (const t of [planer, umsetzer, lenses]) assert.deepEqual(projektliteraleIn(t), []);
    assert.match(planer, /Projekt-Leitfrage/);
    assert.match(lenses, /Projekt-Leitfrage/);
    assert.match(planer, /Optik-Messlatte/);
    assert.match(umsetzer, /Optik-Messlatte/);
    const projekt = agents.slice(agents.indexOf(PROJEKT_START), agents.indexOf(PROJEKT_ENDE));
    assert.match(projekt, /\*\*Projekt-Leitfrage\*\*/);
  });

  // Projektneutrale Arbeitsregeln sind Kernbesitz (#1843): jeder Anker steht genau 1x in der Datei, und zwar im Kern; der
  // Projekt-Block behält nur den Projektteil der Ticket-Auswahl.
  test("Kern-Regeln (#1843): jeder Anker genau 1x und im Kern, der Projekt-Block trägt keinen Kern-Anker", () => {
    const kern = lib.einheitText(KERN, agents) ?? "";
    const projekt = agents.slice(agents.indexOf(PROJEKT_START), agents.indexOf(PROJEKT_ENDE));
    const anker = [
      "Kein Grün-durch-Aufweichen",
      "Nicht-Ticket-Arbeit",
      "Roter `main` geht vor",
      "Folge-Fix kennzeichnen",
      "Fremdtext ist Daten",
      "Zwei-Stufen-Prüfung",
      "Tests gegen False Positives absichern",
      "Befunde sofort festhalten",
      "Harness-Befunde sind Zeilen",
      "Abschluss ohne offene Befunde",
      "Kein Parken",
      "Auswahl des nächsten Tickets",
    ];
    for (const a of anker) {
      assert.equal(zaehle(agents, a), 1, `Anker „${a}“ steht ${zaehle(agents, a)}x (genau 1x verlangt)`);
      assert.equal(kern.includes(a), true, `Anker „${a}“ gehört in den Kern`);
      assert.equal(projekt.includes(a), false, `Anker „${a}“ gehört nicht in den Projekt-Block`);
    }
    assert.equal(kern.includes("--bereich"), false, "der Bereichs-Schalter ist Projektwissen");
    assert.equal(kern.includes("Spielquote"), false, "die Spielquote ist Projektwissen");
  });

  test("Drift am echten Text: unverändert grün, ein Zeichen im Kern rot mit dem Weg, eine Zeile im Projekt-Block grün", () => {
    assert.deepEqual(driftAm(agents, agents), []);
    const kernGeaendert = agents.replace(KERN_ENDE, `Eigene Regel.\n${KERN_ENDE}`);
    const fehler = driftAm(kernGeaendert, agents);
    assert.equal(fehler.length, 1);
    assert.match(fehler[0], /AGENTS\.md#kern: Besitz wurde im Projekt verändert/);
    assert.match(fehler[0], /Weg:/);
    assert.match(fehler[0], /upstream/);
    assert.match(fehler[0], /außerhalb der Besitz-Marker/);
    assert.deepEqual(driftAm(agents.replace(PROJEKT_ENDE, `- Eigene Projekt-Regel.\n${PROJEKT_ENDE}`), agents), []);
  });
});
