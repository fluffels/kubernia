/* Golden der Messskripte (#1745, ADR 0022 F3): Agentennamen, Worktree-Präfix, Commit-Zeile und Repo-Name kommen aus der Projekt-Config;
 * für dieses Projekt bleiben die Ausgaben (Text und JSON) byte-gleich, damit Langfuse und Messreihen kontinuierlich bleiben.
 * Die erwarteten Werte stehen in test/fixtures/mess-golden.json und wurden am Stand vor der Umstellung erzeugt. Die Fälle: test/support/mess-golden-faelle.mjs.
 * Der Shim `S` ist die einzige Stelle, die die Aufrufform der Skripte kennt.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lzRaw from "../../scripts/subagent-laufzeit.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as ktRaw from "../../scripts/kontext-treiber.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as hzRaw from "../../scripts/hauptchat-zerlegung.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as tbRaw from "../../scripts/token-baseline.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as akRaw from "../../scripts/langfuse-abgleich-kern.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as otRaw from "../../scripts/langfuse-otlp.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as klRaw from "../../scripts/kontingent-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as faelleRaw from "../support/mess-golden-faelle.mjs";

type Fn = (...a: unknown[]) => unknown;
type Modul = Record<string, Fn>;
const lz = lzRaw as unknown as Modul;
const kt = ktRaw as unknown as Modul;
const hz = hzRaw as unknown as Modul;
const tb = tbRaw as unknown as Modul;
const ak = akRaw as unknown as Modul;
const ot = otRaw as unknown as Modul;
const kl = klRaw as unknown as Modul;
const messGoldenFaelle = (faelleRaw as unknown as { messGoldenFaelle: (s: Record<string, Fn>) => Record<string, string> }).messGoldenFaelle;

const S: Record<string, Fn> = {
  laufzeiten: (e) => lz.laufzeiten(e),
  typenUebersicht: (e) => lz.typenUebersicht(e),
  laufzeitMarkdown: (r) => lz.renderMarkdown(r),
  laufzeitTypen: (r) => lz.renderTypen(r),
  kontextTreiber: (e) => kt.kontextTreiber(e),
  kontextMarkdown: (r) => kt.renderMarkdown(r),
  phaseDerCalls: (z) => kt.phaseDerCalls(z),
  zerlegeHauptchat: (e) => hz.zerlegeHauptchat(e),
  hauptchatMarkdown: (r) => hz.renderMarkdown(r),
  summarize: (run, bounds) => tb.summarize(run, bounds),
  baselineMarkdown: (s, loop) => tb.renderMarkdown(s, loop),
  sollEintraege: (s, o) => ak.sollEintraege(s, o),
  bauePayloads: (s, e, o) => ot.bauePayloads(s, e, o),
  logPfad: (env) => kl.logPfad(env),
};

const golden = JSON.parse(readFileSync(join(__dirname, "../fixtures/mess-golden.json"), "utf8")) as Record<string, string>;
const ist = messGoldenFaelle(S);

describe("Messskripte: Ausgaben für dieses Projekt byte-gleich (Golden)", () => {
  test("die Fälle decken genau die Golden-Schlüssel ab", () => {
    expect(Object.keys(ist).sort()).toEqual(Object.keys(golden).sort());
  });
  test.each(Object.keys(golden))("%s", (name) => {
    expect(ist[name]).toBe(golden[name]);
  });
});
