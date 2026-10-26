/* Textreste entfernter Pfade, die an der Projekthistorie hängen (#1906, Fortsetzung des Kern-Tests `entfernte-pfade.test.ts` im Factory-Repo).
 *
 * @harness-waechter – Projekt-Test (bleibt im Projekt, zieht nicht ins Factory-Repo): die Muster leiten sich aus dem echten Repo-Namen
 * und dem Ticket-Skill-Namen der Projekt-Config ab, weil nur dieses Projekt einen Skill `<Repo-Name>-workflow`, ein Workflow-Skript
 * `<Repo-Name>-ticket` und das Skill-Verzeichnis `skills/<Ticket-Skill>/` hatte. Scan und Schnappschuss-Blöcke: `test/support/entfernte-pfade.ts`.
 *
 * Fundstellen der Muster (ADRs sind historisch und tragen die alten Namen, sie sind vom Scan ausgenommen):
 *  - `<Repo-Name>-workflow`: ADR 0012 (Tabellenzeile zum entfernten Skill) und ADR 0022;
 *  - `<Repo-Name>-ticket`: ADR 0022 (das Workflow-Skript `<Repo-Name>-ticket.js`);
 *  - `skills/<Ticket-Skill>/`: keine Fundstelle in `docs/adr/` (`git log -S` auf den Pfad findet dort nichts); die Regel ist nur synthetisch getestet.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, test } from "vitest";
import { AUSNAHMEN, type Rest, SCHNAPPSCHUSS_ENDE, SCHNAPPSCHUSS_START, findeReste as findeResteMit, getrackteTextdateien, meldungMitFix } from "../support/entfernte-pfade";
import { projektConfig, repoName } from "../support/fremd-config";
import { escapeRe as esc } from "../support/regex";

// Die Namen kommen aus der echten Projekt-Config, nicht aus Literalen: der Scan liest die echten Repo-Dateien.
const C = projektConfig();
const R = repoName(C);
const NAME_WORKFLOW = `Skill ${R}-workflow`;
const NAME_TICKET = `Workflow-Skript ${R}-ticket`;
const NAME_VERZEICHNIS = "altes Ticket-Skill-Verzeichnis";

const RESTE_PROJEKT: Rest[] = [
  { name: NAME_WORKFLOW, muster: new RegExp(`${esc(R)}-workflow`), fix: "den Ist-Zustand beschreiben: der Ticket-Skill ist der einzige Ablauf, oder den Satz löschen" },
  { name: NAME_TICKET, muster: new RegExp(`${esc(R)}-ticket`), fix: "den Ist-Zustand beschreiben: es gibt kein Workflow-Skript für den Ticket-Ablauf, oder den Satz löschen" },
  { name: "Vorlage des Ticket-Skills", muster: /factory-ticket\/SKILL\.md\.vorlage/, fix: "die Quelle .agents/skills/factory-ticket/SKILL.md nennen: der Export rendert sie, eine Vorlage gibt es nicht" },
  { name: NAME_VERZEICHNIS, muster: new RegExp(`skills/${esc(C.agenten.ticketSkill)}/`), fix: "das Verzeichnis .agents/skills/factory-ticket/ nennen" },
];

const findeReste = (dateien: { pfad: string; inhalt: string }[]): string[] => findeResteMit(dateien, RESTE_PROJEKT);
const reste = (pfad: string, inhalt: string): string[] => findeReste([{ pfad, inhalt }]);

describe("Textreste mit Projektnamen (#1906)", () => {
  test("das Repo ist frei von Resten außerhalb der begründeten Ausnahmen", () => {
    const dateien = getrackteTextdateien();
    assert.ok(dateien.length > 200, "Dateiliste unerwartet klein: git ls-files fehlgeschlagen?");
    const treffer = findeReste(dateien);
    assert.deepEqual(treffer, [], `${meldungMitFix(treffer, RESTE_PROJEKT)}\nTreffer: ${treffer.join(", ")}`);
  });

  test("jede Regel nennt einen konkreten Fix-Hinweis, die Meldung nur den der getroffenen", () => {
    for (const r of RESTE_PROJEKT) assert.ok(r.fix.length > 10, `Regel ${r.name} ohne Fix-Hinweis`);
    const meldung = meldungMitFix(reste("docs/x.md", `Skill ${R}-workflow`), RESTE_PROJEKT);
    assert.ok(meldung.includes(RESTE_PROJEKT[0].fix));
    assert.ok(!meldung.includes(RESTE_PROJEKT[1].fix));
  });

  test.each([
    [NAME_WORKFLOW, `Der Skill \`${R}-workflow\` startet den Lauf.`],
    [NAME_TICKET, `Workflow({ name: "${R}-ticket" })`],
    [NAME_VERZEICHNIS, `Datei .claude/skills/${C.agenten.ticketSkill}/SKILL.md`],
    ["Vorlage des Ticket-Skills", `Datei Vorlagen/.agents/skills/factory-ticket/${"SKILL.md"}.vorlage`], // zerlegt, sonst träfe der Scan diese Zeile
  ])("Negativfall: ein eingeschleuster Rest wird gefunden (%s)", (name, text) => {
    assert.deepEqual(reste("docs/beispiel.md", `vorher\n${text}\nnachher`), [`docs/beispiel.md:2: ${name}`]);
  });

  test("Negativfall: harmlose Nachbarn lösen nicht aus (Projektname mit großem T, Workflows der CI, neues Skill-Verzeichnis)", () => {
    const sauber = `Der ${R}-Ticket-Ablauf ist der Skill ${C.agenten.ticketSkill}; die CI läuft in .github/workflows/ci.yml, der Ablauf in .agents/skills/factory-ticket/SKILL.md.`;
    assert.deepEqual(reste("docs/x.md", sauber), []);
  });

  test("Ausnahmen: ADRs dürfen die Namen tragen, andere Pfade nicht", () => {
    const text = `${R}-ticket.js und ${R}-workflow`;
    assert.deepEqual(reste("docs/adr/0028-ein-ticket-ablauf.md", text), []);
    assert.ok(reste("docs/modul.md", text).length > 0);
  });

  test("Verankerung am echten Projekt: die abgeleiteten Muster treffen die echten Altnamen aus den ADRs (außerhalb der Ausnahme)", () => {
    // Die Muster kommen aus der Config; ein falsch abgeleiteter Name (z. B. der Owner-Präfix) bliebe mit selbstgebauten Beispielen grün.
    const adr = (nr: string): string => {
      const datei = getrackteTextdateien().find((d) => d.pfad.startsWith(`docs/adr/${nr}-`));
      assert.ok(datei, `ADR ${nr} fehlt`);
      return datei.inhalt;
    };
    const namen = (inhalt: string): string[] => reste("docs/x.md", inhalt).map((t) => t.replace(/^docs\/x\.md:\d+: /, ""));
    const aus0022 = namen(adr("0022"));
    assert.ok(aus0022.includes(NAME_WORKFLOW), "ADR 0022 trägt den alten Skill-Namen");
    assert.ok(aus0022.includes(NAME_TICKET), "ADR 0022 trägt den alten Workflow-Skript-Namen");
    assert.ok(namen(adr("0012")).includes(NAME_WORKFLOW), "ADR 0012 trägt den alten Skill-Namen");
    const rollen = [C.agenten.planer, C.agenten.umsetzer, C.agenten.lens, C.agenten.gruppe];
    assert.ok(rollen.some((n) => adr("0012").includes(`${n}.md`)), "ADR 0012 trägt alte Agenten-Dateinamen (Regel im Kern-Wächter)");
  }, 30_000);
});

// ---- Reste der Auslagerung des Kerns ins Factory-Repo (#1882, ADR 0022 F10) ----
// kubernia bezieht den Kern per Sync; Export-Werkzeug, Extraktionsliste, Produkt-Entwürfe und die Fremd-Config-Probe gibt es hier nicht mehr.
// Die Musterquellen nutzen Zeichenklassen bzw. zerlegte Literale, damit diese Datei sich nicht selbst trifft. Besitz-Dateien sind ausgenommen
// (sie pflegt upstream und der Drift-Wächter hält sie byte-gleich zum Tag).
// Nur ganze Dateien sind ausgenommen; Block- und Schlüssel-Einheiten (AGENTS.md#kern, .claude/settings.json#hooks) sind nur zum Teil Besitz, der Rest gehört dem Projekt.
const BESITZ = (JSON.parse(readFileSync(".factory/besitz.json", "utf8")) as { eintraege: { pfad: string; block?: string; schluessel?: string }[] }).eintraege
  .filter((e) => e.block === undefined && e.schluessel === undefined)
  .map((e) => e.pfad);
const AUSNAHMEN_K9 = [
  ...AUSNAHMEN,
  ...BESITZ.map((pfad) => ({ praefix: pfad, grund: "Besitz: pflegt upstream (Drift-Wächter)" })),
  { praefix: "test/harness/entfernte-pfade-liste.json", grund: "die Liste der entfernten Pfade nennt sie ausdrücklich (Wächter unten)" },
];
const WEG_K9 = "den Ist-Zustand beschreiben: der Kern kommt per Sync vom Tag des Factory-Repos, das Werkzeug lebt dort";
const RESTE_K9: Rest[] = [
  { name: "Export-Werkzeug", muster: /factory-export(?:-lib)?\.mjs/, fix: WEG_K9 },
  { name: "Extraktionsliste-Datei", muster: /\.factory\/extraktion\.json/, fix: WEG_K9 },
  { name: "Produkt-Entwürfe-Ordner", muster: /\.factory\/produkt\//, fix: WEG_K9 },
  { name: "Fremd-Config-Probe-Skript", muster: /probe:fremd[c]onfig/, fix: WEG_K9 },
];
const resteK9 = (pfad: string, inhalt: string): string[] => findeResteMit([{ pfad, inhalt }], RESTE_K9, AUSNAHMEN_K9);

describe("Reste der Auslagerung in das Factory-Repo (#1882)", () => {
  test("das Repo ist frei von Resten außerhalb von ADRs und Besitz", () => {
    const treffer = findeResteMit(getrackteTextdateien(), RESTE_K9, AUSNAHMEN_K9);
    assert.deepEqual(treffer, [], `${meldungMitFix(treffer, RESTE_K9)}\nTreffer: ${treffer.join(", ")}`);
  });

  test.each([
    ["Export-Werkzeug", `node scripts/${"factory-export"}.mjs`],
    ["Export-Werkzeug", `scripts/${"factory-export"}-lib.mjs`],
    ["Extraktionsliste-Datei", `siehe ${".factory"}/extraktion.json`],
    ["Produkt-Entwürfe-Ordner", `Vorlagen unter ${".factory"}/produkt/vorlagen`],
    ["Fremd-Config-Probe-Skript", `npm run ${"probe:fremd"}config`],
  ])("Negativfall: ein eingeschleuster Rest wird gefunden (%s)", (name, text) => {
    assert.deepEqual(resteK9("docs/beispiel.md", `vorher\n${text}\nnachher`), [`docs/beispiel.md:2: ${name}`]);
  });

  test("Negativfall: harmlose Nachbarn lösen nicht aus", () => {
    const sauber = "node scripts/factory-sync.mjs --quelle <klon>; .factory/besitz.json; .factory/projekt.json; scripts/factory-drift.mjs";
    assert.deepEqual(resteK9("docs/x.md", sauber), []);
  });

  test("Ausnahmen: ADRs und Besitz-Dateien dürfen die Namen tragen, andere Pfade nicht", () => {
    const text = `node scripts/${"factory-export"}.mjs`;
    assert.deepEqual(resteK9("docs/adr/0022-x.md", text), []);
    assert.deepEqual(resteK9(BESITZ[0], text), []);
    assert.ok(resteK9("docs/modul.md", text).length > 0);
  });
});

// ---- Testpfade in Markdown müssen existieren (#1882) ----
// Mit der Auslagerung der Kern-Tests nennen Brain-Seiten leicht Testdateien, die es hier nicht mehr gibt. Geschlossener Scan-Umfang: `*.md` und `*.mmd`
// der getrackten Dateien, ohne `docs/adr/` (historisch), ohne Besitz-Pfade, ohne datierte Schnappschüsse (Dateiname mit JJJJ-MM-TT) und ohne
// Schnappschuss-Blöcke. Grenzen: Pfade in URLs (davor steht ein Pfadzeichen) und Platzhalter mit `<…>` oder `*` zählen nicht; Nicht-Markdown
// (CODEOWNERS, JSON, Kommentare im Code) prüft nur die Breitensuche oben.
const TESTPFAD = /(?<![\w./-])test\/[\w./-]+\.(?:ts|mjs|json)/g;
const istDatiert = (pfad: string): boolean => /-\d{4}-\d{2}-\d{2}/.test(pfad);
const istScope = (pfad: string): boolean => /\.(?:md|mmd)$/.test(pfad) && !pfad.startsWith("docs/adr/") && !BESITZ.includes(pfad) && !istDatiert(pfad);

/** Pur: die genannten Testpfade je Zeile ohne Schnappschuss-Blöcke, als `pfad:zeile: testpfad`, die es nicht gibt (`existiert`). */
function fehlendeTestpfade(dateien: { pfad: string; inhalt: string }[], existiert: (p: string) => boolean): string[] {
  const aus: string[] = [];
  for (const d of dateien.filter((x) => istScope(x.pfad))) {
    let imBlock = false;
    d.inhalt.split("\n").forEach((zeile, i) => {
      const marker = zeile.trim();
      if (marker === SCHNAPPSCHUSS_START) imBlock = true;
      else if (marker === SCHNAPPSCHUSS_ENDE) imBlock = false;
      else if (!imBlock) for (const m of zeile.matchAll(TESTPFAD)) if (!existiert(m[0])) aus.push(`${d.pfad}:${i + 1}: ${m[0]}`);
    });
  }
  return aus;
}

describe("Jeder in Markdown genannte Testpfad existiert (#1882)", () => {
  const getrackt = new Set(execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean));
  const existiert = (p: string): boolean => getrackt.has(p);

  test("das Repo nennt keinen Testpfad, den es nicht gibt (Kern-Tests leben im Factory-Repo: verlinken statt Pfad nennen)", () => {
    const fehlend = fehlendeTestpfade(getrackteTextdateien(), existiert);
    assert.deepEqual(fehlend, [], "Die Datei gibt es hier nicht mehr: den Kern-Test im Factory-Repo verlinken oder den Satz löschen");
  });

  test("Negativfall: ein genannter, nicht vorhandener Testpfad wird gefunden", () => {
    assert.deepEqual(fehlendeTestpfade([{ pfad: "docs/x.md", inhalt: "a\nsiehe `test/harness/gibt-es-nicht.test.ts`." }], existiert), ["docs/x.md:2: test/harness/gibt-es-nicht.test.ts"]);
  });

  test("Negativfall: Endungen mjs und json, Diagramm-Dateien (mmd) und der Rest nach einem Schnappschuss-Block werden geprüft", () => {
    assert.deepEqual(fehlendeTestpfade([{ pfad: "docs/x.md", inhalt: "test/fehlt.mjs und test/fixtures/fehlt.json" }], existiert), ["docs/x.md:1: test/fehlt.mjs", "docs/x.md:1: test/fixtures/fehlt.json"]);
    assert.deepEqual(fehlendeTestpfade([{ pfad: "docs/diagramme/x.mmd", inhalt: "test/fehlt.test.ts" }], existiert), ["docs/diagramme/x.mmd:1: test/fehlt.test.ts"]);
    const nachBlock = `${SCHNAPPSCHUSS_START}\ntest/im-block.test.ts\n${SCHNAPPSCHUSS_ENDE}\ntest/danach.test.ts`;
    assert.deepEqual(fehlendeTestpfade([{ pfad: "docs/x.md", inhalt: nachBlock }], existiert), ["docs/x.md:4: test/danach.test.ts"]);
  });

  test("Leerlauf-Schutz: der Scan sieht echte Fundstellen (nicht-leere Dateiliste, Markdown im Scope)", () => {
    const treffer = getrackteTextdateien().filter((d) => istScope(d.pfad) && new RegExp(TESTPFAD.source).test(d.inhalt));
    assert.ok(treffer.length > 0, "der Scan sieht keine einzige Testpfad-Nennung: Dateiliste leer oder Pfadformat verändert");
  });

  test("Block-Einheiten sind nicht als ganze Datei ausgenommen: AGENTS.md liegt im Scope", () => {
    assert.ok(istScope("AGENTS.md"), "AGENTS.md hat einen Projekt-Block und gehört in den Scan");
    assert.ok(!BESITZ.includes("AGENTS.md") && !BESITZ.includes(".claude/settings.json"));
  });

  test("harmlose Nachbarn: vorhandener Pfad, URL, Platzhalter, ADR, Schnappschuss-Block, datierte Datei, Nicht-Markdown", () => {
    const echt = "test/harness/spielbezug.test.ts";
    assert.ok(existiert(echt), "Vorbedingung: der Beispielpfad ist getrackt");
    const weg = "test/harness/gibt-es-nicht.test.ts";
    const text = `${echt}\nhttps://github.com/x/y/blob/main/${weg}\ntest/harness/<name>.test.ts und test/harness/*.test.ts`;
    assert.deepEqual(fehlendeTestpfade([{ pfad: "docs/x.md", inhalt: text }], existiert), []);
    const block = `${SCHNAPPSCHUSS_START}\n2026-01-01 ${weg}\n${SCHNAPPSCHUSS_ENDE}`;
    assert.deepEqual(fehlendeTestpfade([{ pfad: "docs/x.md", inhalt: block }], existiert), []);
    const besitzMarkdown = BESITZ.find((p) => p.endsWith(".md"));
    assert.ok(besitzMarkdown, "Vorbedingung: der Besitz führt mindestens eine ganze Markdown-Datei");
    for (const pfad of ["docs/adr/0001-x.md", "docs/analyse-2026-07-03-x.md", "docs/x.txt", besitzMarkdown]) {
      assert.deepEqual(fehlendeTestpfade([{ pfad, inhalt: weg }], existiert), [], pfad);
    }
  });
});

// ---- Entfernte Dateien kommen nicht zurück (#1882) ----
// Die Textregeln oben fangen nur Erwähnungen. Diese Regel prüft die Pfade selbst: keine getrackte Datei steht in der Liste der entfernten Dateien,
// und unter den entfernten Ordnern liegt nichts. Die Liste (`entfernte-pfade-liste.json`) enthält Export-Werkzeug, Extraktionsliste und die gelöschten
// Test-Dateien; ein Pfad, den es nur im Factory-Repo geben soll, wird so auch durch ein bloßes Wiederanlegen rot.
type EntfernteListe = { dateien: string[]; praefixe: string[] };
const ENTFERNT = JSON.parse(readFileSync("test/harness/entfernte-pfade-liste.json", "utf8")) as EntfernteListe;

/** Pur: welche der getrackten Pfade stehen in der Liste der entfernten Dateien oder unter einem entfernten Ordner? */
function wiederangelegt(getrackt: string[], liste: EntfernteListe): string[] {
  const dateien = new Set(liste.dateien);
  return getrackt.filter((p) => dateien.has(p) || liste.praefixe.some((pre) => p.startsWith(pre)));
}

describe("Entfernte Dateien kommen nicht zurück (#1882)", () => {
  test("keine getrackte Datei steht in der Liste der entfernten Dateien", () => {
    const getrackt = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
    assert.deepEqual(wiederangelegt(getrackt, ENTFERNT), [], "Diese Dateien leben im Factory-Repo (Kern per Sync vom Tag): nicht wieder anlegen");
  });

  test("die Liste enthält die drei Pfade aus dem Ticket und den Ordner der Produkt-Entwürfe", () => {
    for (const p of [`.factory/${"extraktion"}.json`, `scripts/${"factory-export"}.mjs`, `scripts/${"factory-export"}-lib.mjs`, `test/harness/${"factory-export"}.test.ts`, "test/harness/kern-abdeckung.json"]) {
      assert.ok(ENTFERNT.dateien.includes(p), p);
    }
    assert.ok(ENTFERNT.praefixe.includes(`.factory/${"produkt"}/`));
  });

  test("Negativfall: ein wieder angelegter Pfad (Datei oder unter dem Ordner) wird gefunden, Nachbarn nicht", () => {
    const liste: EntfernteListe = { dateien: ["a/x.mjs"], praefixe: ["b/dir/"] };
    assert.deepEqual(wiederangelegt(["a/x.mjs", "b/dir/y.md", "b/dir/tief/z"], liste), ["a/x.mjs", "b/dir/y.md", "b/dir/tief/z"]);
    assert.deepEqual(wiederangelegt(["a/x.mjs.bak", "a/y.mjs", "b/dirx/y", "b/dir"], liste), []);
  });
});
