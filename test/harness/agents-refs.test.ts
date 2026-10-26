/* Verweis-Wächter (#1079) – Freitext-Verweise „AGENTS.md § …" in den versionierten
 * `.claude/`- und `.agents/`-Dateien (Skill-Quellen, #1848) müssen in AGENTS.md wirklich existieren (CLAUDE.md ist seit #1087 gelöscht).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Warum: Skills und Planer-Agent schicken Phasen-Agenten per Freitext
 * auf Stellen in AGENTS.md (`AGENTS.md § Zu großes Ticket`, `§ Kein
 * Grün-durch-Aufweichen`, `§ „Worktree entfernen auf Windows – zwei Fallen"`,
 * `AGENTS.md › Mehr-Perspektiven-Review` …). Das sind meist **fette Bullet-Titel, keine
 * Überschriften** – `check:docdrift` (#529) prüft nur Markdown-Anker (und lässt `.claude/`
 * ganz aus). Nach der Kürzung in #1064 trafen sie nur noch, weil die Titel von Hand
 * wortgleich gehalten wurden; vier trafen bereits nicht mehr. Ein ins Leere zeigender
 * Verweis lässt den Agenten die maßgebliche Regel suchen oder raten – genau die Drift,
 * die hier ROT wird.
 *
 * Extraktion (absatzweise, damit ein bares `§` die Zieldatei nur aus SEINEM Absatz erbt):
 *   - `AGENTS.md § Begriff` / `CLAUDE.md § Begriff` setzt die Zieldatei,
 *   - ein bares `§ Begriff` im selben Absatz erbt sie (Bullet-Listen, `§ A + § B`),
 *   - `AGENTS.md › Begriff` (Link-Text-Form) und `AGENTS.md „Begriff"` (ohne `§`) zählen
 *     ebenso, erben aber nicht weiter – ein bares `›` ist oft nur ein Pfeil,
 *   - ein fremdes `*.md § …` (z.B. `docs/agent-harness.md § 2.5`) setzt die Zieldatei zurück,
 *   - `„Begriff"` nimmt alles zwischen den Anführungszeichen, sonst endet der Begriff
 *     an Satzzeichen/Klammer/`+`/Em-Dash/`§`/Zeilenende (bewusst NICHT am En-Dash, der
 *     gehört zu Titeln wie „Alles wird abgetestet – auch Negativfälle"),
 *   - `…` im Begriff trennt Fragmente, die einzeln treffen müssen.
 * Geprüft wird per `includes` nach Normalisierung (Markdown-Hervorhebung/Backticks/
 * Anführungszeichen raus, Whitespace kollabiert) auf beiden Seiten.
 *
 * Grenze (bewusst, ehrlich): geprüft wird die EXISTENZ des Wortlauts irgendwo in der
 * Zieldatei, nicht die Semantik und nicht, dass er ein Titel ist – ein umgewidmeter
 * Abschnitt mit gleichem Wortlaut bleibt grün. Die Terminator-Heuristik ist konservativ:
 * lieber ein zu kurzer Begriff (schwächerer, aber nie falsch-roter Wächter) als ein Gate,
 * das bei jeder Prosa-Wendung rot wird und dann abgeschaltet wird (#395-Antipattern).
 * Gegen den umgekehrten Fehlermodus – eine Extraktion, die nach einer Umformulierung
 * still nichts mehr findet – schützt der Leerlauf-Test, und zwar je Verweis-Form.
 *
 * Fitness-Function-Kategorie neben agents-md-native/docmap/docdrift (#482/#529/#992),
 * bewusst test-only ohne `scripts/check-*.mjs` (Begründung: Kopf von
 * `test/harness/agents-md-native.test.ts`).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkBasis from "../../scripts/check-basis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { ROLLEN_PFADE } from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";
import { type BesitzEintragKurz, ladeBesitzManifest } from "../support/besitz-anker";
import { projektBlock } from "../support/projekt-block";

interface BesitzLibKurz {
  einheitText: (e: { pfad: string; block?: string }, text: string) => string | null;
  wirdVerteilt: (e: BesitzEintragKurz) => boolean;
  istGanzeDatei: (e: { block?: string; schluessel?: string }) => boolean;
}
const { einheitText, wirdVerteilt, istGanzeDatei } = rawBesitz as unknown as BesitzLibKurz;

// Begründete Ausnahme wie in test/harness/agents-md-native.test.ts: das .mjs hat kein Declaration-File.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const listTrackedFiles: (rootDir?: string) => string[] = checkBasis.listTrackedFiles;

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const VORLAGE = ".factory/produkt/vorlagen/AGENTS.md.vorlage";
const read = (rel: string) => readFileSync(ROOT + rel, "utf8");

type Ziel = "AGENTS.md" | "CLAUDE.md";
/** Wie der Verweis geschrieben war – nur für den Leerlauf-Schutz je Form. */
type Form = "§" | "§ geerbt" | "›" | "Zitat ohne §";
interface Verweis {
  ziel: Ziel;
  begriff: string;
  form: Form;
}

// Gruppe 1: optionaler Dateiname (auch `AGENTS.md (§ …` / `[AGENTS.md § …`).
// Gruppe 2: optionaler Trenner `§`/`›`. Gruppe 3: quotierter Begriff `„…"`/`„…“`.
// Gruppe 4: unquotierter Begriff bis zum Terminator. Welche Kombinationen gelten, entscheidet
// `formVon`. Der Lookahead verankert jeden Treffer an einem Dateinamen oder Trenner – sonst
// matcht der (dann ganz optionale) Vorspann beliebige Prosa und frisst den nächsten Dateinamen.
const VERWEIS_RE =
  /(?=[\w./-]+\.md|§|›)(?:([\w./-]+\.md)[\s([]*)?(§|›)?\s*(?:„([^"“\n]{2,160})["“]|([^\n,.;:()[\]+—„"“…§›]{2,160}))/g;

function normalisiere(s: string): string {
  return s
    .replace(/[`*„“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function zielVon(datei: string): Ziel | null {
  const name = datei.split("/").pop();
  return name === "AGENTS.md" || name === "CLAUDE.md" ? name : null;
}

/** Ordnet einen Treffer einer Verweis-Form zu; `null` = kein Verweis (z.B. Prosa nach „AGENTS.md"). */
function formVon(datei: string | undefined, trenner: string | undefined, zitiert: boolean): Form | null {
  if (trenner === "§") return datei === undefined ? "§ geerbt" : "§";
  if (datei === undefined) return null; // bares `›` bzw. bare Anführungszeichen: kein Verweis
  if (trenner === "›") return "›";
  return zitiert ? "Zitat ohne §" : null;
}

function extrahiereVerweise(text: string): Verweis[] {
  const verweise: Verweis[] = [];
  for (const absatz of text.split(/\n\s*\n/)) {
    let geerbt: Ziel | null = null;
    for (const m of absatz.matchAll(VERWEIS_RE)) {
      const [, datei, trenner, zitat, frei] = m;
      const form = formVon(datei, trenner, zitat !== undefined);
      if (form === null) continue;
      // Nur ein `§` mit Dateinamen setzt (oder löscht) die Zieldatei, die bare `§` erben.
      if (form === "§") geerbt = zielVon(datei ?? "");
      const ziel = form === "§ geerbt" ? geerbt : zielVon(datei ?? "");
      if (ziel === null) continue;
      for (const fragment of (zitat ?? frei ?? "").split("…")) {
        const begriff = normalisiere(fragment);
        if (begriff.length >= 3) verweise.push({ ziel, begriff, form });
      }
    }
  }
  return verweise;
}

function pruefe<V extends Verweis>(verweise: V[], docs: Record<Ziel, string>): V[] {
  const norm = { "AGENTS.md": normalisiere(docs["AGENTS.md"]), "CLAUDE.md": normalisiere(docs["CLAUDE.md"]) };
  return verweise.filter((v) => !norm[v.ziel].includes(v.begriff));
}

/** Ganze Dateien des verteilten Besitzes (Kern-Ringe) außer der AGENTS.md selbst: ihre Verweise müssen im Zielprojekt auflösen. Pur. */
function kernDateienVon(eintraege: (BesitzEintragKurz & { block?: string; schluessel?: string })[]): Set<string> {
  return new Set(eintraege.filter((e) => wirdVerteilt(e) && istGanzeDatei(e) && e.pfad !== "AGENTS.md").map((e) => e.pfad));
}

/** Verweisziel für Kern-Dateien: der Kern-Block der AGENTS.md plus die AGENTS-Vorlage des Zielprojekts (nicht der Projekt-Block dieses Repos). Pur. */
function kernDocsVon(agentsText: string, vorlageText: string): Record<Ziel, string> {
  return { "AGENTS.md": `${einheitText({ pfad: "AGENTS.md", block: "kern" }, agentsText) ?? ""}\n${vorlageText}`, "CLAUDE.md": "" };
}

/**
 * Text der „AGENTS-Vorlage des Zielprojekts“: die Vorlage selbst, wo sie liegt (dieses Repo); im Factory-Repo gibt es sie nicht, dort ist der Projekt-Block der
 * eigenen AGENTS.md das, was die Vorlage hier verteilt (`null`: kein Vorlagen-Text). Ohne beides („kein Projekt-Block“) bleibt der Text leer: dann trifft kein
 * Verweis auf einen Titel außerhalb des Kern-Blocks (streng). Pur.
 */
function vorlageOderProjektBlock(vorlageText: string | null, agentsText: string): string {
  if (vorlageText !== null) return vorlageText;
  return projektBlock(agentsText) ?? "";
}

const nurBegriffe = (vs: Verweis[]) => vs.map(({ ziel, begriff }) => ({ ziel, begriff }));

// CLAUDE.md ist seit #1087 gelöscht: fehlt sie, gilt sie als leer – ein noch
// übrig gebliebener `CLAUDE.md § …`-Verweis wird dann rot gemeldet, statt dass der Test crasht.
const DOCS: Record<Ziel, string> = {
  "AGENTS.md": read("AGENTS.md"),
  "CLAUDE.md": existsSync(ROOT + "CLAUDE.md") ? read("CLAUDE.md") : "",
};
const CLAUDE_DATEIEN = listTrackedFiles(ROOT).filter(
  (f) => (f.startsWith(".claude/") || f.startsWith(".agents/")) && /\.(md|js|mjs|cjs|ts)$/.test(f),
);
const ECHTE_VERWEISE = CLAUDE_DATEIEN.flatMap((datei) =>
  extrahiereVerweise(read(datei)).map((v) => ({ ...v, datei })),
);

describe("Verweis-Wächter: AGENTS.md § … aus .claude/ muss existieren (#1079)", () => {
  test("jeder Freitext-Verweis in .claude/ trifft seine Zieldatei", () => {
    assert.deepEqual(
      pruefe(ECHTE_VERWEISE, DOCS).map((v) => `${v.datei}: ${v.ziel} ${v.form} ${v.begriff}`),
      [],
      "Diese Verweise zeigen ins Leere – den Verweis auf den echten (fetten) Titel in " +
        "AGENTS.md/CLAUDE.md umbiegen, oder den Titel wiederherstellen, falls er versehentlich " +
        "umformuliert wurde.",
    );
  });

  test("jeder Verweis einer Kern-Datei trifft den Kern-Block der AGENTS.md oder deren Vorlage (im Zielprojekt gibt es den Projekt-Block dieses Repos nicht)", () => {
    const kern = kernDateienVon(ladeBesitzManifest().eintraege);
    const kernVerweise = ECHTE_VERWEISE.filter((v) => kern.has(v.datei));
    assert.ok(kernVerweise.length > 0, "keine Verweise aus Kern-Dateien extrahiert");
    assert.deepEqual(
      pruefe(kernVerweise, kernDocsVon(DOCS["AGENTS.md"], vorlageOderProjektBlock(existsSync(ROOT + VORLAGE) ? read(VORLAGE) : null, DOCS["AGENTS.md"]))).map((v) => `${v.datei}: ${v.ziel} ${v.form} ${v.begriff}`),
      [],
      "Kern-Dateien werden in jedes Projekt verteilt: der Verweis muss im Kern-Block oder in der AGENTS-Vorlage stehen, " +
        "sonst den Titel in den Kern-Block heben oder in die Vorlage aufnehmen.",
    );
  });

  test("Red-Green: ein Titel nur im Projekt-Block trifft für eine Kern-Datei nicht, ein Titel in der Vorlage oder im Kern-Block schon", () => {
    const agents = [
      "<!-- factory-besitz:start kern -->\n- **Kern-Titel.**\n<!-- factory-besitz:ende kern -->",
      "<!-- factory-projekt:start -->\n- **Nur im Projekt.**\n<!-- factory-projekt:ende -->",
    ].join("\n");
    const gegen = (text: string, vorlage = "") => pruefe(extrahiereVerweise(text), kernDocsVon(agents, vorlage)).length;
    assert.equal(gegen("AGENTS.md § Kern-Titel"), 0);
    assert.equal(gegen("AGENTS.md § Nur im Projekt"), 1);
    assert.equal(gegen("AGENTS.md § Nur im Projekt", "- **Nur im Projekt.**"), 0);
    assert.equal(pruefe(extrahiereVerweise("AGENTS.md § Nur im Projekt"), { "AGENTS.md": agents, "CLAUDE.md": "" }).length, 0);
  });

  test("Vorlage fehlt (Factory-Repo): Rückfall auf den Projekt-Block der eigenen AGENTS.md, ohne Block leer (streng)", () => {
    const agents = ["<!-- factory-besitz:start kern -->\n- **Kern-Titel.**\n<!-- factory-besitz:ende kern -->", "<!-- factory-projekt:start -->\n- **Im Projekt-Block.**\n<!-- factory-projekt:ende -->", "- **Dahinter.**"].join("\n");
    assert.equal(vorlageOderProjektBlock("- **Vorlagen-Titel.**", agents), "- **Vorlagen-Titel.**");
    const rueckfall = vorlageOderProjektBlock(null, agents);
    assert.match(rueckfall, /Im Projekt-Block/);
    assert.doesNotMatch(rueckfall, /Dahinter|Kern-Titel/);
    assert.equal(vorlageOderProjektBlock(null, "- **Kern-Titel.**"), "");
    assert.equal(vorlageOderProjektBlock(null, "<!-- factory-projekt:ende -->\n<!-- factory-projekt:start -->\nx"), "");
    assert.equal(vorlageOderProjektBlock(null, "<!-- factory-projekt:start -->\n- **Nur Start.**\nRest"), "");
    const gegen = (text: string, vorlage: string | null) => pruefe(extrahiereVerweise(text), kernDocsVon(agents, vorlageOderProjektBlock(vorlage, agents))).length;
    assert.equal(gegen("AGENTS.md § Im Projekt-Block", null), 0);
    assert.equal(gegen("AGENTS.md § Im Projekt-Block", "- **Anderes.**"), 1);
    assert.equal(gegen("AGENTS.md § Gibt es nicht", null), 1);
  });

  test("Kern-Dateien: nur verteilte ganze Dateien, weder Blöcke, Schlüssel, die AGENTS.md noch Factory-Oberfläche", () => {
    const m = [
      { pfad: "a.md", ring: "kern" },
      { pfad: "b.md", ring: "kern-nach-entkopplung" },
      { pfad: "AGENTS.md", ring: "kern" },
      { pfad: "c.md", ring: "kern", block: "x" },
      { pfad: "d.json", ring: "kern", schluessel: "k" },
      { pfad: "e.md", ring: "oberflaeche" },
    ];
    assert.deepEqual([...kernDateienVon(m)].sort(), ["a.md", "b.md"]);
  });

  test("Leerlauf-Schutz: jede Verweis-Form wird in den echten Dateien gefunden", () => {
    // Bricht die Extraktion einer Form, fällt sie hier auf, statt still ungeprüft zu bleiben.
    // Bewusst keine Gesamtzahl: legitim entfernte Verweise sollen nicht rot werden.
    const formen: Form[] = ["§", "§ geerbt", "›", "Zitat ohne §"];
    for (const form of formen) {
      assert.ok(
        ECHTE_VERWEISE.some((v) => v.form === form),
        `keine Verweise der Form „${form}" extrahiert – Extraktion kaputt oder Form ausgestorben?`,
      );
    }
    assert.ok(ECHTE_VERWEISE.some((v) => v.datei.startsWith(".claude/agents/")));
    assert.ok(ECHTE_VERWEISE.some((v) => v.datei.startsWith(".agents/skills/")));
    // Die Skill-Quellen unter .agents/skills/ (#1848) liegen im Scan: die Quelle der Rolle ticketSkill steht dort als Datei, auch ohne Verweis.
    assert.ok(CLAUDE_DATEIEN.includes((ROLLEN_PFADE as Record<string, string>).ticketSkill), "Quelle der Rolle ticketSkill fehlt im Scan");
    // Bewusst KEINE Pflicht auf ein CLAUDE.md-Ziel: diese Verweise sollen mit #1086/#1087 aussterben.
  });

  test("Red-Green: ein erfundener Verweis wird gemeldet", () => {
    const docs = { "AGENTS.md": "- **Zu großes Ticket (Epic/Phase) → aufteilen.** …", "CLAUDE.md": "" };
    const verweise = extrahiereVerweise("siehe AGENTS.md § Erfundener Abschnitt Xyzzy und § Zu großes Ticket.");
    assert.deepEqual(nurBegriffe(pruefe(verweise, docs)), [
      { ziel: "AGENTS.md", begriff: "Erfundener Abschnitt Xyzzy und" },
    ]);
  });

  test("Red-Green: ein Prosa-Anhängsel an einem echten Titel wird gemeldet", () => {
    const docs = { "AGENTS.md": "- **Goodhart-Guard für Gate-Konfiguration.**", "CLAUDE.md": "" };
    assert.equal(pruefe(extrahiereVerweise("(AGENTS.md § Goodhart-Guard)"), docs).length, 0);
    assert.equal(pruefe(extrahiereVerweise("(AGENTS.md § Goodhart-Guard gilt weiter)"), docs).length, 1);
  });

  test("Red-Green: geprüft wird pro Zieldatei, nicht über beide", () => {
    const docs = { "AGENTS.md": "## Schichtregeln", "CLAUDE.md": "## Befehle" };
    assert.equal(pruefe(extrahiereVerweise("CLAUDE.md § Befehle"), docs).length, 0);
    assert.equal(pruefe(extrahiereVerweise("CLAUDE.md § Schichtregeln"), docs).length, 1);
  });

  test("Red-Green: ein nicht treffendes …-Fragment wird gemeldet", () => {
    const docs = { "AGENTS.md": "**🤖 Dependabot-Sammel-Ticket X → mergen statt implementieren.**", "CLAUDE.md": "" };
    assert.equal(pruefe(extrahiereVerweise("AGENTS.md § „🤖 Dependabot-Sammel-Ticket … → mergen statt implementieren\""), docs).length, 0);
    assert.deepEqual(
      nurBegriffe(pruefe(extrahiereVerweise("AGENTS.md § „🤖 Dependabot-Sammel-Ticket … → abmergen\""), docs)),
      [{ ziel: "AGENTS.md", begriff: "→ abmergen" }],
    );
  });

  test("Formen: quotiert, bare § im Absatz, Klammer nach dem Dateinamen, Ellipse", () => {
    const text = [
      "AGENTS.md (§ Das Wichtigste zuerst + § Wo die TODOs leben), insbesondere:",
      "- § Kollisionsschutz bei parallelen Agenten — eigener Worktree",
      "- § „Worktree entfernen auf Windows – zwei Fallen\" und § „Alpha … Beta\"",
    ].join("\n");
    assert.deepEqual(
      extrahiereVerweise(text).map((v) => v.begriff),
      [
        "Das Wichtigste zuerst",
        "Wo die TODOs leben",
        "Kollisionsschutz bei parallelen Agenten",
        "Worktree entfernen auf Windows – zwei Fallen",
        "Alpha",
        "Beta",
      ],
    );
  });

  test("Formen: › als Link-Text und Zitat ohne § werden erkannt, erben aber nicht", () => {
    const text =
      "Regel-Heimat: [AGENTS.md › Mehr-Perspektiven-Review](../../AGENTS.md#x) und " +
      "AGENTS.md „Tests gegen False Positives absichern\" sowie › Pfeil und § Kein Erbe.";
    assert.deepEqual(extrahiereVerweise(text), [
      { ziel: "AGENTS.md", begriff: "Mehr-Perspektiven-Review", form: "›" },
      { ziel: "AGENTS.md", begriff: "Tests gegen False Positives absichern", form: "Zitat ohne §" },
    ]);
  });

  test("False-Positive-Schutz: Prosa nach dem Dateinamen, fremde .md-Dateien, Absatzgrenzen", () => {
    assert.deepEqual(extrahiereVerweise("AGENTS.md + CLAUDE.md liegen bereits im Kontext."), []);
    assert.deepEqual(extrahiereVerweise("siehe docs/agent-harness.md § 2.5 und § Irgendwas"), []);
    assert.deepEqual(nurBegriffe(extrahiereVerweise("AGENTS.md § Oberste Regel\n\n§ Anderer Absatz")), [
      { ziel: "AGENTS.md", begriff: "Oberste Regel" },
    ]);
  });
});
