/* Forum-Anteile der Kern-Wächter (#1930, ADR 0022 F10, Teil 7b-2): die Prüfungen, die im Kern keinen Forum-Skill voraussetzen dürfen,
 * liegen hier als `projekt-test` (nur kubernia führt den Forum-Eingang): Matrix-Zeile, Skill-Quelle und Zeiger im Scan der Kern-Wächter,
 * kein `.gitignore`-Treffer. Der Kern-Anker für „Skill-Quelle ohne Besitz liegt im Scan“ ist die Quelle der Rolle ticketSkill.
 *
 * @harness-waechter – einziger Durchsetzer der Forum-Anteile, darum im geschützten test/harness/ (#1165). */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { WURZEL, lies } from "./repo-texte";
import { liesMitProjektwerten } from "../support/ticket-ablauf";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as skillsSyncModul from "../../scripts/skills-sync.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkBasis from "../../scripts/check-basis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { QUELL_VERZEICHNIS, ZEIGER_WURZEL } from "../../scripts/skill-pfade.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { parseFrontmatter } from "../../scripts/docs-gen/markdown.mjs";

interface Stand { quellen: { ordner: string }[]; zeiger: { ordner: string }[] }
const liesStand = (skillsSyncModul as unknown as { liesStand: (w: string) => Stand }).liesStand;
const collectMarkdown = (checkBasis as unknown as { collectMarkdown: (r?: string) => string[] }).collectMarkdown;
const listTrackedFiles = (checkBasis as unknown as { listTrackedFiles: (r?: string) => string[] }).listTrackedFiles;
const frontmatter = parseFrontmatter as (md: string) => Record<string, string>;

const QUELLE = `${QUELL_VERZEICHNIS}/forum/SKILL.md`;
const ZEIGER = `${ZEIGER_WURZEL}/forum/SKILL.md`;
const LESER = ".claude/agents/forum-leser.md";
const ZEILE = "| Forum-Triage (Quarantäne) | `sonnet` | `medium` |";

/** Die Zeile „Forum-Triage“ der Tabelle „Projekt-Phasen“ (Alias, Effort) gegen das Frontmatter des Quarantäne-Lesers: Abweichungen. */
const forumZeileAbweichungen = (doku: string, fm: Record<string, string>): string[] => {
  const zeile = doku.split("\n").find((z) => z.startsWith("| Forum-Triage"));
  if (zeile === undefined) return ["Zeile „Forum-Triage“ fehlt"];
  const [, alias, effort] = zeile.split("|").slice(1, -1).map((c) => c.replace(/`/g, "").trim());
  const fehler: string[] = [];
  if (fm.effort !== effort) fehler.push(`Effort „${effort}“ ≠ Frontmatter „${fm.effort}“`);
  if (fm.model !== alias) fehler.push(`Alias „${alias}“ ≠ Frontmatter „${fm.model}“`);
  return fehler;
};

describe("Forum-Anteile der Kern-Wächter (#1930)", () => {
  const doku = liesMitProjektwerten("docs/model-routing.md");

  test("Matrix: die Zeile Forum-Triage der Projekt-Phasen stimmt mit dem Frontmatter des Quarantäne-Lesers überein", () => {
    expect(doku.split(ZEILE)).toHaveLength(2);
    expect(forumZeileAbweichungen(doku, frontmatter(lies(LESER)))).toEqual([]);
  });

  test("Negativfälle der Matrix-Zeile: Effort `high`, falscher Alias, fehlende Zeile", () => {
    const fm = frontmatter(lies(LESER));
    expect(forumZeileAbweichungen(doku.replace(ZEILE, "| Forum-Triage (Quarantäne) | `sonnet` | `high` |"), fm).join("\n")).toMatch(/Effort „high“ ≠ Frontmatter „medium“/);
    expect(forumZeileAbweichungen(doku.replace(ZEILE, "| Forum-Triage (Quarantäne) | `opus` | `medium` |"), fm).join("\n")).toMatch(/Alias „opus“ ≠ Frontmatter „sonnet“/);
    expect(forumZeileAbweichungen("kein Text", fm)).toEqual(["Zeile „Forum-Triage“ fehlt"]);
  });

  test("Skill-Quelle und Zeiger forum liegen im Scan des Zeiger-Generators und der Verweis-Wächter", () => {
    const stand = liesStand(WURZEL);
    expect(stand.quellen.map((q) => q.ordner)).toContain("forum");
    expect(stand.zeiger.map((z) => z.ordner)).toContain("forum");
  });

  test("die Quelle forum liegt im Markdown-Scan (docdrift, Ticket-Ablauf, Modell-Pins) und unter den versionierten Dateien (Fremdtext, Verweise)", () => {
    expect(collectMarkdown()).toContain(QUELLE);
    expect(listTrackedFiles()).toContain(QUELLE);
    expect(listTrackedFiles()).toContain(ZEIGER);
  });

  test("Quelle und Zeiger forum sind nicht von .gitignore erfasst", () => {
    const ignoriert = (pfad: string) => spawnSync("git", ["check-ignore", "--no-index", "-q", pfad], { cwd: WURZEL }).status === 0;
    expect(ignoriert(".claude/settings.local.json")).toBe(true); // Negativkontrolle: das Prüfen greift überhaupt
    for (const pfad of [QUELLE, ZEIGER]) expect(ignoriert(pfad), pfad).toBe(false);
  });
});
