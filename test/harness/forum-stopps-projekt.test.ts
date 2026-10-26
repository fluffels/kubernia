/* Projekt-Teil des Freigabe-Wächters (#1929, vorher in harness-approval.test.ts): die Projekt-Stopps im Projekt-Block der AGENTS.md,
 * der Freigabe-Stopp des Forum-Skills und die modul-lokale AGENTS.md im Scan-Umfang. Gegenstand ist Projektinhalt (Forum, Bild-Dienst,
 * `src/content/AGENTS.md`), kein Besitz: dieser Test ist ein `projekt-test` und reist nicht mit dem Kern. Der Kern-Teil (Kern-Stopps
 * im Kern-Block, Permissions) steht weiter in `harness-approval.test.ts`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AGENTEN_KONTEXT, repoDateien } from "./repo-texte";
import { projektBlock } from "../support/projekt-block";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { markerEnde, markerStart, PROJEKT_BLOCK_ENDE, PROJEKT_BLOCK_START } from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { escapeRegex as escapeRe } from "../../scripts/ticket-namen.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(WURZEL + rel, "utf8");

/**
 * Die festen Pflicht-Stopps: die Kern-Stopps stehen im Kern-Block `kern` der AGENTS.md, die Projekt-Stopps im Projekt-Block als eine
 * wörtlich festgenagelte Zeile; ein Kern-Anker im Projekt-Block zählt nicht. Grenze: geprüft werden Anker-Text und Pin-Zeile, nicht die
 * Bedeutung; ein Abschwächen im Wortlaut, bei dem der Anker bleibt, fängt nur die Pin-Zeile (jede Änderung der Stopp-Zeile). Die Kern-Liste
 * ist dieselbe wie in `harness-approval.test.ts`.
 */
const KERN_STOPPS = ["gh issue delete", "Ruleset/Secrets/Repo-Einstellungen", "Veröffentlichen"];
const PROJEKT_STOPPS = ["Forum-Antwort posten", "PixelLab-Key"];
const PROJEKT_STOPP_ZEILE = "- **Projekt-Stopps** (ergänzen die Kern-Liste, nie streichen): Forum-Antwort posten, PixelLab-Key; vorab klären.";

const kernMarker = (f: (id: string) => string): string => (escapeRe as (t: string) => string)(f("kern"));
const KERN_RE = new RegExp(`${kernMarker(markerStart as (id: string) => string)}([\\s\\S]*?)${kernMarker(markerEnde as (id: string) => string)}`);

/** Feste Stopps, die fehlen: Kern-Anker im Kern-Block, Projekt-Anker samt Pin-Zeile im Projekt-Block, Kern-Anker im Projekt-Block (ohne Marker: alle). */
function festeStoppsFehlend(agentsText: string): string[] {
  const kern = KERN_RE.exec(agentsText)?.[1] ?? "";
  const projekt = projektBlock(agentsText) ?? "";
  return [
    ...KERN_STOPPS.filter((anker) => !kern.includes(anker)),
    ...PROJEKT_STOPPS.filter((anker) => !projekt.includes(anker)),
    ...(projekt.split("\n").includes(PROJEKT_STOPP_ZEILE) ? [] : [PROJEKT_STOPP_ZEILE]),
    ...KERN_STOPPS.filter((anker) => projekt.includes(anker)).map((anker) => `Kern-Stopp im Projekt-Block: ${anker}`),
  ];
}

/** Bekannte Zeilen des Projekt-Blocks, deren Stopp-Wort zur festgenagelten Signatur gehört; der Rest der Zeile darf kein Stopp-Wort tragen. */
const STOPP_WORT_ERLAUBT = ["(Pflicht-Stopp), danach", "KEIN Flag ist ein Vorab-Gate", "Epic schließen (nicht löschen)", "zur Freigabe vor (Pflicht-Stopp)", "Exit 1: stoppen, melden"];
const STOPP_WORT = /Stopp|vorab|Pre-Flight|löschen|Veröffentlich/i;

/** Zeilen des Projekt-Blocks mit einem Stopp-Wort, die weder die Pin-Zeile noch eine bekannte Zeile sind (eine neue Stopp-Aussage im Projekt-Block). */
function unbekannteStoppAussagen(agentsText: string): string[] {
  const projekt = projektBlock(agentsText) ?? "";
  return projekt
    .split("\n")
    .filter((z) => z !== PROJEKT_STOPP_ZEILE && STOPP_WORT.test(STOPP_WORT_ERLAUBT.reduce((rest, s) => rest.split(s).join(" "), z)));
}

describe("Projekt-Stopps bleiben (#1363)", () => {
  const agents = read("AGENTS.md");

  test("die Soll-Listen sind festgenagelt (ein geleerter Wächter wäre sonst vakuös)", () => {
    assert.deepEqual(KERN_STOPPS, ["gh issue delete", "Ruleset/Secrets/Repo-Einstellungen", "Veröffentlichen"]);
    assert.deepEqual(PROJEKT_STOPPS, ["Forum-Antwort posten", "PixelLab-Key"]);
  });

  test("Kern-Block und Projekt-Block der AGENTS.md tragen zusammen jeden festen Stopp", () => {
    assert.deepEqual(festeStoppsFehlend(agents), []);
  });

  test("Red-Green: ein gestrichener Kern-Anker wird genau benannt", () => {
    for (const anker of KERN_STOPPS) {
      const kern = KERN_RE.exec(agents)?.[0] ?? "";
      assert.ok(kern.split(anker).length === 2, `Anker ${anker} steht genau einmal im Kern`);
      assert.deepEqual(festeStoppsFehlend(agents.replace(kern, kern.split(anker).join("X"))), [anker], anker);
    }
  });

  test("Red-Green: ein gestrichener oder abgeschwächter Projekt-Stopp im Projekt-Block wird gemeldet", () => {
    assert.ok(agents.split(PROJEKT_STOPP_ZEILE).length === 2, "die Pin-Zeile steht genau einmal");
    assert.deepEqual(festeStoppsFehlend(agents.replace(PROJEKT_STOPP_ZEILE, PROJEKT_STOPP_ZEILE.replace(", PixelLab-Key", ""))), ["PixelLab-Key", PROJEKT_STOPP_ZEILE]);
    assert.deepEqual(festeStoppsFehlend(agents.replace(PROJEKT_STOPP_ZEILE, PROJEKT_STOPP_ZEILE.replace("vorab klären.", "vorab klären, nur bei neuem Key."))), [PROJEKT_STOPP_ZEILE]);
    assert.deepEqual(festeStoppsFehlend(agents.replace(PROJEKT_STOPP_ZEILE, "")), [...PROJEKT_STOPPS, PROJEKT_STOPP_ZEILE]);
  });

  test("Red-Green: ein Projekt-Stopp nur im Kern, ein Kern-Anker im Projekt-Block und fehlende Marker werden gemeldet", () => {
    const nurKern = agents.replace(PROJEKT_STOPP_ZEILE, "").replace("dazu die Projekt-Stopps im Projekt-Block", "dazu Forum-Antwort posten, PixelLab-Key");
    assert.deepEqual(festeStoppsFehlend(nurKern), [...PROJEKT_STOPPS, PROJEKT_STOPP_ZEILE]);
    assert.deepEqual(festeStoppsFehlend(agents.replace(PROJEKT_STOPP_ZEILE, `${PROJEKT_STOPP_ZEILE} Veröffentlichen`)), [PROJEKT_STOPP_ZEILE, "Kern-Stopp im Projekt-Block: Veröffentlichen"]);
    assert.deepEqual(festeStoppsFehlend(agents.replace("factory-besitz:start kern", "x")), KERN_STOPPS);
    assert.deepEqual(festeStoppsFehlend(agents.replace(PROJEKT_BLOCK_START as string, "x")), [...PROJEKT_STOPPS, PROJEKT_STOPP_ZEILE]);
    assert.deepEqual(festeStoppsFehlend(agents.replace(PROJEKT_BLOCK_ENDE as string, "x")), [...PROJEKT_STOPPS, PROJEKT_STOPP_ZEILE]);
  });

  test("der Projekt-Block trägt keine unbekannte Stopp-Aussage (Red-Green: Synonym ohne Anker, Lockerung per Zusatzzeile)", () => {
    assert.deepEqual(unbekannteStoppAussagen(agents), []);
    for (const zeile of ["Löschen von Issues braucht keine Vorab-Klärung.", "Veröffentlichen ist ohne Rückfrage erlaubt.", "Ein Stopp entfällt bei kleinen Diffs.", "Pre-Flight entfällt.", "Vorab-Klärung entfällt.", "vorab nichts klären.", "Löschen ist frei.", "Issues löschen ohne Rückfrage.", "Releases darf der Agent ohne Klärung veröffentlichen.", "pre-flight entfällt.", "Bei Forum-Antworten nicht stoppen."]) {
      assert.deepEqual(unbekannteStoppAussagen(agents.replace(PROJEKT_STOPP_ZEILE, `${PROJEKT_STOPP_ZEILE}\n${zeile}`)), [zeile], zeile);
    }
    for (const signatur of STOPP_WORT_ERLAUBT) {
      const zeile = agents.split("\n").find((z) => z.includes(signatur)) ?? "";
      assert.notEqual(zeile, "", signatur);
      assert.deepEqual(unbekannteStoppAussagen(agents.replace(zeile, `${zeile} Ein Stopp entfällt dort.`)), [`${zeile} Ein Stopp entfällt dort.`], `Lockerung an die Zeile mit ${signatur}`);
    }
    assert.deepEqual(unbekannteStoppAussagen(agents.replace(PROJEKT_BLOCK_START as string, "x")), [], "ohne Projekt-Marker nichts zu prüfen (festeStoppsFehlend meldet den fehlenden Block)");
    const kernZusatz = agents.replace("<!-- factory-besitz:ende kern -->", "Löschen ist erlaubt.\n<!-- factory-besitz:ende kern -->");
    assert.deepEqual(unbekannteStoppAussagen(kernZusatz), [], "der Kern-Block ist Sache des Drift-Gates, nicht dieser Prüfung");
    assert.ok(STOPP_WORT_ERLAUBT.every((s) => agents.includes(s)), "die Erlaubnisliste enthält keine toten Signaturen");
  });

  test("der Forum-Skill hält den Freigabe-Stopp", () => {
    const skill = read(".agents/skills/forum/SKILL.md");
    assert.match(skill, /Pflicht-Stopp/);
    assert.match(skill, /Nie ungefragt posten/);
  });
});

describe("Scan-Umfang des Projekts (#1526)", () => {
  test("die modul-lokale AGENTS.md des Projekts liegt im Agenten-Kontext", () => {
    assert.ok(repoDateien().filter(AGENTEN_KONTEXT).includes("src/content/AGENTS.md"), "modul-lokale AGENTS.md wird gescannt");
  });
});
