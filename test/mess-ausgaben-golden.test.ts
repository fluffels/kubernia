/* Golden der Messskripte (#1745, ADR 0022 F3): Agentennamen, Worktree-Präfix, Commit-Zeile und Repo-Name kommen aus der Config;
 * für die Fremd-Config `FREMD` bleiben die Ausgaben (Text und JSON) byte-gleich; sie hängen nur über diese Namen von der Config ab (Fortschreibung #1899).
 * Die erwarteten Werte stehen in test/fixtures/mess-golden.json und entstehen aus `messGoldenFaelle(S, FREMD)` (Weg: Kopf von test/support/mess-golden-faelle.mjs), nie von Hand. Die Fälle: test/support/mess-golden-faelle.mjs.
 * Der Shim `S` ist die einzige Stelle, die die Aufrufform der Skripte kennt.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lzRaw from "../scripts/subagent-laufzeit.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as ktRaw from "../scripts/kontext-treiber.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as hzRaw from "../scripts/hauptchat-zerlegung.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as tbRaw from "../scripts/token-baseline.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as akRaw from "../scripts/langfuse-abgleich-kern.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as otRaw from "../scripts/langfuse-otlp.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as klRaw from "../scripts/kontingent-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as namenRaw from "../scripts/ticket-namen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sliceRaw from "../scripts/slice-override.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as faelleRaw from "./support/mess-golden-faelle.mjs";
import { FREMD, repoName } from "./support/fremd-config";

type Fn = (...a: unknown[]) => unknown;
type Modul = Record<string, Fn>;
const lz = lzRaw as unknown as Modul;
const kt = ktRaw as unknown as Modul;
const hz = hzRaw as unknown as Modul;
const tb = tbRaw as unknown as Modul;
const ak = akRaw as unknown as Modul;
const ot = otRaw as unknown as Modul;
const kl = klRaw as unknown as Modul;
const messGoldenFaelle = (faelleRaw as unknown as { messGoldenFaelle: (s: Record<string, Fn>, config: unknown) => Record<string, string> }).messGoldenFaelle;

const CONFIG = FREMD;
const NAMEN = (namenRaw as unknown as Modul).ticketNamen(CONFIG);
const ZEILEN = (sliceRaw as Modul).commitZeilenAus(CONFIG) as { plan: string };
const REPO = repoName(CONFIG);
const WORKTREE = (namenRaw as Modul).worktreePraefix(CONFIG) as string;

const S: Record<string, Fn> = {
  laufzeiten: (e) => lz.laufzeiten({ namen: NAMEN, ...(e as object) }),
  typenUebersicht: (e) => lz.typenUebersicht({ namen: NAMEN, ...(e as object) }),
  laufzeitMarkdown: (r) => lz.renderMarkdown(r),
  laufzeitTypen: (r) => lz.renderTypen(r),
  kontextTreiber: (e) => kt.kontextTreiber({ namen: NAMEN, ...(e as object) }),
  kontextMarkdown: (r) => kt.renderMarkdown(r),
  phaseDerCalls: (z) => kt.phaseDerCalls(z, null, NAMEN),
  zerlegeHauptchat: (e) => hz.zerlegeHauptchat({ config: CONFIG, ...(e as object) }),
  hauptchatMarkdown: (r) => hz.renderMarkdown(r, { repoName: REPO }),
  summarize: (run, bounds) => tb.summarize(run, bounds, null, { umsetzer: CONFIG.agenten.umsetzer }),
  baselineMarkdown: (s, loop) => tb.renderMarkdown(s, loop, { planZeile: ZEILEN.plan }),
  sollEintraege: (s, o) => ak.sollEintraege(s, { ...(o as object), worktree: WORKTREE }),
  bauePayloads: (s, e, o) => ot.bauePayloads(s, e, { ...(o as object), repoName: REPO }),
  logPfad: (env) => kl.logPfad(env, { lade: () => CONFIG }),
};

const golden = JSON.parse(readFileSync(join(__dirname, "./fixtures/mess-golden.json"), "utf8")) as Record<string, string>;
const ist = messGoldenFaelle(S, FREMD);

describe("Messskripte: Ausgaben für die Fremd-Config byte-gleich (Golden)", () => {
  test("die Fälle decken genau die Golden-Schlüssel ab", () => {
    expect(Object.keys(ist).sort()).toEqual(Object.keys(golden).sort());
  });
  test.each(Object.keys(golden))("%s", (name) => {
    expect(ist[name]).toBe(golden[name]);
  });
});
