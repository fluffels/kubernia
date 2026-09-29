/* Verweis-Wächter (#1079) – Freitext-Verweise „AGENTS.md § …" in den versionierten
 * `.claude/`-Dateien müssen in AGENTS.md (bzw. CLAUDE.md) wirklich existieren.
 *
 * Warum: Workflow-Skript, Skills und Planer-Agent schicken Phasen-Agenten per Freitext
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
 * `test/agents-md-native.test.ts`).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkInternalRefs from "../scripts/check-internalrefs.mjs";

// Begründete Ausnahme wie in test/agents-md-native.test.ts: das .mjs hat kein Declaration-File.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const listTrackedFiles: (rootDir?: string) => string[] = checkInternalRefs.listTrackedFiles;

const ROOT = fileURLToPath(new URL("..", import.meta.url));
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

const nurBegriffe = (vs: Verweis[]) => vs.map(({ ziel, begriff }) => ({ ziel, begriff }));

// CLAUDE.md ist eine auslaufende Brücke (#1078/#1087): fehlt sie, gilt sie als leer – ein noch
// übrig gebliebener `CLAUDE.md § …`-Verweis wird dann rot gemeldet, statt dass der Test crasht.
const DOCS: Record<Ziel, string> = {
  "AGENTS.md": read("AGENTS.md"),
  "CLAUDE.md": existsSync(ROOT + "CLAUDE.md") ? read("CLAUDE.md") : "",
};
const CLAUDE_DATEIEN = listTrackedFiles(ROOT).filter(
  (f) => f.startsWith(".claude/") && /\.(md|js|mjs|cjs|ts)$/.test(f),
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
    assert.ok(ECHTE_VERWEISE.some((v) => v.datei === ".claude/workflows/kubernia-ticket.js"));
    assert.ok(ECHTE_VERWEISE.some((v) => v.datei.startsWith(".claude/skills/")));
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
