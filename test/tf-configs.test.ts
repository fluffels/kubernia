/* Tests: Terraform-Konfig-Inhalte (Content-as-Data, #147).
 * Die benannten Beispiel-Szenarien der Expeditions-Flotte (Modul / Remote State /
 * Provider / Variablen+Outputs) sind echter Spielinhalt – also wird hier geprüft:
 *  1. Jede Konfig läuft real durch die Sim (init → plan → apply → output, state list,
 *     cat) ohne Fehler – die Quests bauen darauf.
 *  2. Der angezeigte .tf-Text deckt sich mit dem modellierten Sim-Zustand
 *     (jeder deklarierte Provider/Modul/Backend/Output/Ressource taucht als Block im
 *     Text auf; kein nicht deklarierter Provider) – sonst liest der Spieler etwas
 *     anderes, als der Simulator tut. Der Konsistenz-Prüfer wird mit einer bewusst
 *     kaputten Konfig gegengetestet (Red-Green: er MUSS Fehler finden).
 *  3. `scenarioRef` (die Brücke „Quest verweist auf Konfig") löst beim Laden korrekt
 *     auf – inkl. Fehlerfälle (unbekannte Referenz, scenario + scenarioRef zugleich). */
import { test } from "vitest";
import assert from "node:assert/strict";
import { Sim } from "../src/sim";
import { KQContent } from "../src/content";
import { getTfConfigs, parseQuests, ContentValidationError, type TfConfig } from "../src/content/loader";

const CONFIGS = getTfConfigs();

/** RegExp-Sonderzeichen in einem Bezeichner entschärfen (Adressen können `[0]` o.ä. tragen). */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Sammelt Text↔Modell-Abweichungen einer Konfig (leer = konsistent). Bewusst eine reine
 *  Funktion, damit sie unten an einer kaputten Konfig gegengetestet werden kann. */
function tfConfigIssues(cfg: TfConfig): string[] {
  const issues: string[] = [];
  const sc = cfg.scenario;
  const files = sc.files ?? {};
  const allText = Object.values(files).join("\n");
  const has = (re: RegExp) => re.test(allText);

  for (const p of sc.tfProviders ?? []) {
    if (!has(new RegExp(`provider\\s+"${escapeRe(p.name)}"`))) {
      issues.push(`${cfg.id}: Provider „${p.name}" fehlt als provider-Block im .tf-Text`);
    }
  }
  const declared = new Set((sc.tfProviders ?? []).map(p => p.name));
  for (const r of sc.tfResources ?? []) {
    if (r.provider && !declared.has(r.provider)) {
      issues.push(`${cfg.id}: Ressource ${r.addr} nutzt nicht deklarierten Provider „${r.provider}"`);
    }
    const [type, name] = r.addr.split(".");
    if (type && name && !has(new RegExp(`resource\\s+"${escapeRe(type)}"\\s+"${escapeRe(name)}"`))) {
      issues.push(`${cfg.id}: Ressource ${r.addr} fehlt als resource-Block im .tf-Text`);
    }
  }
  for (const m of sc.tfModules ?? []) {
    if (!has(new RegExp(`module\\s+"${escapeRe(m.name)}"`))) {
      issues.push(`${cfg.id}: Modul „${m.name}" fehlt als module-Block im .tf-Text`);
    }
    const dir = (m.source ?? "").replace(/^\.\//, "");
    const dirText = Object.entries(files).filter(([f]) => f.startsWith(dir + "/")).map(([, t]) => t).join("\n");
    if (dir && dirText.length === 0) {
      issues.push(`${cfg.id}: Modul-Quelle „${m.source}" hat keine Dateien unter ${dir}/`);
    }
    for (const res of m.resources ?? []) {
      const [type, name] = res.split(".");
      if (type && name && !new RegExp(`resource\\s+"${escapeRe(type)}"\\s+"${escapeRe(name)}"`).test(dirText)) {
        issues.push(`${cfg.id}: Modul-Ressource ${res} fehlt im Quell-Ordner ${dir}/`);
      }
    }
  }
  if (sc.tfBackend && !has(new RegExp(`backend\\s+"${escapeRe(sc.tfBackend.type)}"`))) {
    issues.push(`${cfg.id}: Backend „${sc.tfBackend.type}" fehlt als backend-Block im .tf-Text`);
  }
  for (const o of sc.tfOutputs ?? []) {
    if (!has(new RegExp(`output\\s+"${escapeRe(o.name)}"`))) {
      issues.push(`${cfg.id}: Output „${o.name}" fehlt als output-Block im .tf-Text`);
    }
  }
  return issues;
}

test("tf-configs: die erwarteten vier Flotten-Konfigs sind geladen, IDs eindeutig", () => {
  const ids = CONFIGS.map(c => c.id);
  for (const want of ["flotte-modul", "flotte-remote-state", "flotte-provider", "flotte-variablen-outputs"]) {
    assert.ok(ids.includes(want), `Konfig „${want}" fehlt`);
  }
  assert.equal(new Set(ids).size, ids.length, "keine doppelten Konfig-IDs");
  // Die Fassade reicht dieselbe (memoisierte) Sammlung durch.
  assert.equal(KQContent.TF_CONFIGS, CONFIGS, "KQContent.TF_CONFIGS spiegelt getTfConfigs()");
});

test("tf-configs: jede Konfig hat ein nicht-leeres label und lesbare .tf-Dateien", () => {
  for (const cfg of CONFIGS) {
    assert.ok(cfg.label.trim().length > 0, `${cfg.id}: label fehlt`);
    const files = cfg.scenario.files ?? {};
    assert.ok(Object.keys(files).length > 0, `${cfg.id}: keine .tf-Dateien`);
    for (const [fn, text] of Object.entries(files)) {
      assert.ok(text.trim().length > 0, `${cfg.id}: Datei ${fn} ist leer`);
    }
  }
});

test("tf-configs: angezeigter .tf-Text deckt sich mit dem Sim-Modell", () => {
  for (const cfg of CONFIGS) {
    assert.deepEqual(tfConfigIssues(cfg), [], `${cfg.id} ist inkonsistent`);
  }
});

test("tf-configs: jede Konfig läuft durch die Sim (init→plan→apply→output, state list, cat)", () => {
  for (const cfg of CONFIGS) {
    // Klon, damit Tests sich keinen Szenario-Zustand teilen.
    const scenario = JSON.parse(JSON.stringify(cfg.scenario));
    const sim = new Sim(scenario);

    const init = sim.exec("terraform init");
    assert.equal(init.error, false, `${cfg.id}: init schlägt fehl: ${init.output}`);

    const plan = sim.exec("terraform plan");
    assert.equal(plan.error, false, `${cfg.id}: plan schlägt fehl: ${plan.output}`);
    assert.doesNotMatch(plan.output!, /is not present/, `${cfg.id}: plan meldet unbekannten Provider`);
    assert.match(plan.output!, /to add/, `${cfg.id}: plan legt keine Ressourcen an`);

    const apply = sim.exec("terraform apply");
    assert.equal(apply.error, false, `${cfg.id}: apply schlägt fehl: ${apply.output}`);
    assert.match(apply.output!, /Apply complete/, `${cfg.id}: apply ohne Erfolgsmeldung`);

    const list = sim.exec("terraform state list");
    assert.equal(list.error, false, `${cfg.id}: state list schlägt fehl`);
    assert.ok(list.output!.trim().length > 0, `${cfg.id}: state list ist leer`);

    // Deklarierte Outputs sind nach dem apply gezielt abrufbar (Rohwert, auch sensible).
    for (const o of cfg.scenario.tfOutputs ?? []) {
      const out = sim.exec(`terraform output ${o.name}`);
      assert.equal(out.error, false, `${cfg.id}: output ${o.name} schlägt fehl`);
      assert.equal(out.output, o.value, `${cfg.id}: output ${o.name} liefert falschen Wert`);
    }

    // Der Spieler kann jede Datei per cat lesen – Inhalt unverändert.
    for (const [fn, text] of Object.entries(cfg.scenario.files ?? {})) {
      const cat = sim.exec(`cat ${fn}`);
      assert.equal(cat.error, false, `${cfg.id}: cat ${fn} schlägt fehl`);
      assert.equal(cat.output, text, `${cfg.id}: cat ${fn} liefert anderen Inhalt`);
    }
  }
});

test("tf-configs: der Konsistenz-Prüfer fängt eine bewusst kaputte Konfig (Red-Green)", () => {
  const kaputt: TfConfig = {
    id: "kaputt",
    label: "absichtlich inkonsistent",
    scenario: {
      files: { "main.tf": "# leer – ohne passende Blöcke\n" },
      tfProviders: [{ name: "fehlt-im-text", source: "x/y" }],
      tfResources: [{ addr: "ding.eins", desc: "x", provider: "nicht-deklariert" }],
      tfBackend: { type: "s3", name: "lager", locking: true },
      tfModules: [{ name: "geist", source: "./modules/geist", resources: ["foo.bar"] }],
      tfOutputs: [{ name: "fehlt", value: "1" }],
    } as unknown as TfConfig["scenario"],
  };
  const issues = tfConfigIssues(kaputt);
  assert.ok(issues.length > 0, "der Prüfer hätte die kaputte Konfig durchgewunken");
  // Er fängt jede Sorte Defekt – nicht nur einen.
  assert.ok(issues.some(i => /Provider .fehlt-im-text/.test(i)), "fehlender provider-Block nicht erkannt");
  assert.ok(issues.some(i => /nicht deklarierten Provider/.test(i)), "undeklarierter Provider nicht erkannt");
  assert.ok(issues.some(i => /Backend/.test(i)), "fehlender backend-Block nicht erkannt");
  assert.ok(issues.some(i => /Modul .geist/.test(i)), "fehlender module-Block nicht erkannt");
  assert.ok(issues.some(i => /Output .fehlt/.test(i)), "fehlender output-Block nicht erkannt");
});

/* ===== scenarioRef – die Brücke „Quest verweist auf Konfig" (#147) ===== */

/** Baut eine minimale, valide Roh-Quest mit genau einem terminal-Schritt; `extra` wird
 *  in den Schritt gemischt (z.B. `scenarioRef`/`scenario`). */
function questWithStep(extra: Record<string, unknown>) {
  return [{
    id: "ref-test", title: "Referenztest", giver: "theo", topic: "terraform",
    rewardXp: 1, rewardCoins: 1,
    steps: [{
      type: "terminal", brief: "B", ...extra,
      tasks: [{ id: "t1", text: "Tu was", accept: ["^x$"], solution: "x", hint: "h" }],
    }],
  }];
}

test("scenarioRef: löst beim Laden zum hinterlegten Beispiel-Szenario auf", () => {
  const quests = parseQuests(questWithStep({ scenarioRef: "flotte-provider" }), "ref-test");
  const step = quests[0].steps[0];
  const cfg = CONFIGS.find(c => c.id === "flotte-provider")!;
  assert.deepEqual(step.scenario, cfg.scenario, "scenarioRef wurde nicht zum Konfig-Szenario expandiert");
});

test("scenarioRef: unbekannte Referenz scheitert hart beim Laden", () => {
  assert.throws(
    () => parseQuests(questWithStep({ scenarioRef: "gibt-es-nicht" }), "ref-test"),
    (e: unknown) => e instanceof ContentValidationError && /unbekannte Konfig-Referenz/.test((e as Error).message),
  );
});

test("scenarioRef: scenario UND scenarioRef zugleich ist mehrdeutig und scheitert", () => {
  assert.throws(
    () => parseQuests(questWithStep({ scenario: { files: { "a.tf": "x" } }, scenarioRef: "flotte-modul" }), "ref-test"),
    (e: unknown) => e instanceof ContentValidationError && /gleichzeitig gesetzt/.test((e as Error).message),
  );
});
