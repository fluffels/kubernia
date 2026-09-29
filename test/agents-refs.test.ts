/* Verweis-Wächter (#1079) – Freitext-Verweise „AGENTS.md § …" in den versionierten
 * `.claude/`-Dateien müssen in AGENTS.md (bzw. CLAUDE.md) wirklich existieren.
 *
 * Warum: Workflow-Skript, Skills und Planer-Agent schicken Phasen-Agenten per Freitext
 * auf rund 30 Stellen in AGENTS.md (`AGENTS.md § Zu großes Ticket`, `§ Kein
 * Grün-durch-Aufweichen`, `§ „Worktree entfernen auf Windows – zwei Fallen"` …). Das
 * sind meist **fette Bullet-Titel, keine Überschriften** – `check:docdrift` (#529) prüft
 * nur Markdown-Anker und sieht sie nicht. Nach der Kürzung in #1064 trafen sie nur noch,
 * weil die Titel von Hand wortgleich gehalten wurden; vier trafen bereits nicht mehr.
 * Ein ins Leere zeigender Verweis lässt den Agenten die maßgebliche Regel suchen oder
 * raten – genau die Drift, die hier ROT wird.
 *
 * Extraktion (absatzweise, damit ein bares `§` die Zieldatei nur aus SEINEM Absatz erbt):
 *   - `AGENTS.md § Begriff` / `CLAUDE.md § Begriff` setzt die Zieldatei,
 *   - ein bares `§ Begriff` im selben Absatz erbt sie (Bullet-Listen, `§ A + § B`),
 *   - ein fremdes `*.md § …` (z.B. `docs/agent-harness.md § 2.5`) setzt sie zurück,
 *   - `§ „Begriff"` nimmt alles zwischen den Anführungszeichen, sonst endet der Begriff
 *     an Satzzeichen/Klammer/`+`/Em-Dash/Zeilenende (bewusst NICHT am En-Dash, der
 *     gehört zu Titeln wie „Alles wird abgetestet – auch Negativfälle"),
 *   - `…` im Begriff trennt Fragmente, die einzeln treffen müssen.
 * Geprüft wird per `includes` nach Normalisierung (Markdown-Hervorhebung/Backticks/
 * Anführungszeichen raus, Whitespace kollabiert) auf beiden Seiten.
 *
 * Grenze (bewusst, ehrlich): geprüft wird die EXISTENZ des Wortlauts, nicht die
 * Semantik – ein inhaltlich umgewidmeter Abschnitt mit gleichem Titel bleibt grün. Die
 * Terminator-Heuristik ist konservativ: lieber ein zu kurzer Begriff (schwächerer, aber
 * nie falsch-roter Wächter) als ein Gate, das bei jeder Prosa-Wendung rot wird und dann
 * abgeschaltet wird (#395-Antipattern). Gegen den umgekehrten Fehlermodus – ein Regex,
 * der nach einer Umformulierung still NICHTS mehr findet – schützt der Leerlauf-Test.
 *
 * Fitness-Function-Kategorie neben claude-bridge/docmap/docdrift (#482/#529/#992),
 * bewusst test-only ohne `scripts/check-*.mjs` (Begründung: Kopf von
 * `test/claude-bridge.test.ts`).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkInternalRefs from "../scripts/check-internalrefs.mjs";

// Begründete Ausnahme wie in test/claude-bridge.test.ts: das .mjs hat kein Declaration-File.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const listTrackedFiles: (rootDir?: string) => string[] = checkInternalRefs.listTrackedFiles;

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(ROOT + rel, "utf8");

type Ziel = "AGENTS.md" | "CLAUDE.md";
export interface Verweis {
  ziel: Ziel;
  begriff: string;
}

// Gruppe 1: optionaler Dateiname vor dem `§` (auch `AGENTS.md (§ …` / `[AGENTS.md § …`).
// Gruppe 2: quotierter Begriff `„…"`/`„…“`. Gruppe 3: unquotierter Begriff bis zum Terminator.
const VERWEIS_RE =
  /(?:([\w./-]+\.md)[\s([]*)?§\s*(?:„([^"“\n]{2,160})["“]|([^\n,.;:()[\]+—„"“…§]{2,160}))/g;

export function normalisiere(s: string): string {
  return s
    .replace(/[`*„“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extrahiereVerweise(text: string): Verweis[] {
  const verweise: Verweis[] = [];
  for (const absatz of text.split(/\n\s*\n/)) {
    let ziel: Ziel | null = null;
    for (const m of absatz.matchAll(VERWEIS_RE)) {
      const datei = m[1];
      if (datei !== undefined) {
        const name = datei.split("/").pop();
        ziel = name === "AGENTS.md" || name === "CLAUDE.md" ? name : null;
      }
      if (ziel === null) continue;
      const roh = m[2] ?? m[3] ?? "";
      for (const fragment of roh.split("…")) {
        const begriff = normalisiere(fragment);
        if (begriff.length >= 3) verweise.push({ ziel, begriff });
      }
    }
  }
  return verweise;
}

export function pruefe(verweise: Verweis[], docs: Record<Ziel, string>): Verweis[] {
  const norm = { "AGENTS.md": normalisiere(docs["AGENTS.md"]), "CLAUDE.md": normalisiere(docs["CLAUDE.md"]) };
  return verweise.filter((v) => !norm[v.ziel].includes(v.begriff));
}

const DOCS: Record<Ziel, string> = { "AGENTS.md": read("AGENTS.md"), "CLAUDE.md": read("CLAUDE.md") };
const CLAUDE_DATEIEN = listTrackedFiles(ROOT).filter(
  (f) => f.startsWith(".claude/") && /\.(md|js|mjs|cjs|ts)$/.test(f),
);
const ECHTE_VERWEISE = CLAUDE_DATEIEN.flatMap((datei) =>
  extrahiereVerweise(read(datei)).map((v) => ({ ...v, datei })),
);

describe("Verweis-Wächter: AGENTS.md § … aus .claude/ muss existieren (#1079)", () => {
  test("jeder Freitext-Verweis in .claude/ trifft seine Zieldatei", () => {
    const fehlend = pruefe(ECHTE_VERWEISE, DOCS) as typeof ECHTE_VERWEISE;
    assert.deepEqual(
      fehlend.map((v) => `${v.datei}: ${v.ziel} § ${v.begriff}`),
      [],
      "Diese Verweise zeigen ins Leere – den Verweis auf den echten (fetten) Titel in " +
        "AGENTS.md/CLAUDE.md umbiegen, oder den Titel wiederherstellen, falls er versehentlich " +
        "umformuliert wurde.",
    );
  });

  test("Leerlauf-Schutz: die Extraktion findet die echten Verweise überhaupt", () => {
    // Ein Regex, der nach einer Umformulierung nichts mehr matcht, wäre sonst still grün.
    assert.ok(
      ECHTE_VERWEISE.length >= 25,
      `nur ${ECHTE_VERWEISE.length} Verweise extrahiert – Extraktion kaputt?`,
    );
    assert.ok(ECHTE_VERWEISE.some((v) => v.datei === ".claude/workflows/kubernia-ticket.js"));
    assert.ok(ECHTE_VERWEISE.some((v) => v.ziel === "CLAUDE.md"));
  });

  test("Red-Green: ein erfundener Verweis wird gemeldet", () => {
    const docs = { "AGENTS.md": "- **Zu großes Ticket (Epic/Phase) → aufteilen.** …", "CLAUDE.md": "" };
    const verweise = extrahiereVerweise(
      "siehe AGENTS.md § Erfundener Abschnitt Xyzzy und § Zu großes Ticket.",
    );
    assert.deepEqual(pruefe(verweise, docs), [{ ziel: "AGENTS.md", begriff: "Erfundener Abschnitt Xyzzy und" }]);
  });

  test("Red-Green: ein Prosa-Anhängsel an einem echten Titel wird gemeldet", () => {
    const docs = { "AGENTS.md": "- **Goodhart-Guard für Gate-Konfiguration.**", "CLAUDE.md": "" };
    assert.equal(pruefe(extrahiereVerweise("(AGENTS.md § Goodhart-Guard)"), docs).length, 0);
    assert.equal(pruefe(extrahiereVerweise("(AGENTS.md § Goodhart-Guard gilt weiter)"), docs).length, 1);
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

  test("False-Positive-Schutz: fremde .md-Dateien und Absatzgrenzen vererben nicht", () => {
    assert.deepEqual(extrahiereVerweise("siehe docs/agent-harness.md § 2.5 und § Irgendwas"), []);
    assert.deepEqual(extrahiereVerweise("AGENTS.md § Oberste Regel\n\n§ Anderer Absatz"), [
      { ziel: "AGENTS.md", begriff: "Oberste Regel" },
    ]);
  });
});
