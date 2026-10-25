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

interface Stand { quellen: { ordner: string }[]; zeiger: { ordner: string }[] }
const liesStand = (skillsSyncModul as unknown as { liesStand: (w: string) => Stand }).liesStand;
const collectMarkdown = (checkBasis as unknown as { collectMarkdown: (r?: string) => string[] }).collectMarkdown;
const listTrackedFiles = (checkBasis as unknown as { listTrackedFiles: (r?: string) => string[] }).listTrackedFiles;

const QUELLE = `${QUELL_VERZEICHNIS}/forum/SKILL.md`;
const ZEIGER = `${ZEIGER_WURZEL}/forum/SKILL.md`;
const LESER = ".claude/agents/forum-leser.md";
const ZEILE = "| Forum-Triage (Quarantäne) | `sonnet` | `medium` |";

describe("Forum-Anteile der Kern-Wächter (#1930)", () => {
  const doku = liesMitProjektwerten("docs/model-routing.md");

  test("Matrix: die Zeile Forum-Triage steht in der Tabelle Projekt-Phase (Alias und Effort prüft der Kern-Test generisch gegen ihr Frontmatter)", () => {
    expect(doku.split(ZEILE)).toHaveLength(2);
    const kopf = doku.indexOf("| Projekt-Phase |");
    expect(kopf).toBeGreaterThanOrEqual(0);
    expect(kopf).toBeLessThan(doku.indexOf(ZEILE));
    expect(doku.slice(doku.indexOf(ZEILE))).toContain("Subagent `forum-leser`");
    expect(lies(LESER)).toContain("name: forum-leser");
  });

  test("Skill-Quelle und Zeiger forum liegen im Scan des Zeiger-Generators und der Verweis-Wächter", () => {
    const stand = liesStand(WURZEL);
    expect(stand.quellen.map((q) => q.ordner)).toContain("forum");
    expect(stand.zeiger.map((z) => z.ordner)).toContain("forum");
  });

  test("die Quelle forum liegt im Markdown-Scan von docdrift und unter den versionierten Dateien (Fremdtext, Verweise)", () => {
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
