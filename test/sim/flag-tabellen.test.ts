/* Konsistenz der Flag-Tabellen aller Befehlsfamilien (#1989, #1996): `requiredFlags` müssen in `flags` (eigene oder persistente
 * der Ebenen darüber) stehen; Ziele mit `realFlags` sind eine geschlossene Welt: ein echtes Flag meldet nie `unknown flag`,
 * ein anderes immer. Die Orakel-Listen unten sind aus den kubectl-Quellen abgeschrieben (kubernetes/kubernetes, Tag v1.37.1,
 * `kubectl/pkg/cmd/<gruppe>/<datei>.go`, die `cmd.Flags()`-Aufrufe samt `cmdutil.Add*Flag*` und `PrintFlags.AddFlags`) und
 * bewusst NICHT aus `src/sim/kubectl/real-flags.ts` gebildet: ein Tippfehler dort fällt hier auf.
 *   (a) Regeln über alle Dispatch-Tabellen, (b) Ratchet: welche kubectl-Ziele noch offen sind, (c) Orakel je Ziel,
 *   (d) die kuratierte Unbekannt-Liste gibt es nicht mehr, (e) Scan-Wächter.
 *
 * Grenze (e): gefunden werden nur Tabellen, die als `export const X: Dispatch<…>` in `src/sim/**` stehen; der Scan-Wächter
 * verlangt, dass jede davon über einen Familien-Kopf erreichbar ist. Eine Tabelle ohne diese Schreibweise sieht der Test nicht. */
import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { dispatchSub, flag, OFFENE_LISTE, type Dispatch, type FlagSpec, type SubEntry } from "../../src/sim/cliargs";
import { KUBECTL } from "../../src/sim/kubectl";
import { KUBECTL_OPTIONS } from "../../src/sim/kubectl/real-flags";
import { DOCKER } from "../../src/sim/docker";
import { HELM } from "../../src/sim/helm";
import { ARGOCD } from "../../src/sim/argocd";
import { GLAB } from "../../src/sim/glab";
import { GIT } from "../../src/sim/git";
import { KUBEADM } from "../../src/sim/kubeadm";
import { AWS } from "../../src/sim/s3";
import { TERRAFORM } from "../../src/sim/terraform";

const host = { _err: (m: string, tip?: string) => m + (tip ? "\n" + tip : "") };
type D = Dispatch<SubEntry<unknown>>;
const KOEPFE: Record<string, D> = { KUBECTL, DOCKER, HELM, ARGOCD, GLAB, GIT, KUBEADM, AWS, TERRAFORM };

interface Blatt {
  ziel: string[]; entry: SubEntry<unknown>; wirksam: FlagSpec[]; eigene: FlagSpec[]; real: readonly string[] | undefined; style: string | undefined;
}

/** Alle Blätter einer Tabelle (Aliase einmal) mit den geerbten persistenten Flags; `ebenen` sammelt jede besuchte Ebene. */
function blaetter(d: D, ebenen: Set<D> = new Set(), ziel: string[] = [], flags: readonly FlagSpec[] = [], style?: string): Blatt[] {
  ebenen.add(d);
  const fl = [...flags, ...(d.flags ?? [])];
  const st = d.style ?? style;
  const seen = new Set<unknown>();
  const out: Blatt[] = [];
  for (const [key, e] of Object.entries(d.table)) {
    if (seen.has(e)) continue;
    seen.add(e);
    if ("group" in e) out.push(...blaetter(e.group, ebenen, [...ziel, key], fl, st));
    else out.push({ ziel: [...ziel, key], entry: e, wirksam: [...fl, ...(e.flags ?? [])], eigene: [...(e.flags ?? [])], real: e.realFlags, style: e.style ?? st });
  }
  return out;
}
const namen = (fs: readonly FlagSpec[]) => fs.flatMap(f => f.names);
const dubletten = (l: readonly string[]) => l.filter((n, i) => l.indexOf(n) !== i);

/** Die Regelverstöße eines Blatts (leer = in Ordnung). */
function verstoesse(b: Blatt): string[] {
  const v: string[] = [];
  const wo = b.ziel.join(" ");
  const wirksam = namen(b.wirksam);
  for (const r of b.entry.requiredFlags ?? []) if (!wirksam.includes(r)) v.push(wo + ": requiredFlags '" + r + "' steht nicht in flags");
  for (const n of dubletten(b.real ?? [])) v.push(wo + ": realFlags '" + n + "' doppelt");
  for (const n of (b.real ?? []).filter(x => wirksam.includes(x))) v.push(wo + ": realFlags '" + n + "' ist zugleich ein Flag des Ziels");
  const form = b.style === "goflag" ? /^-[A-Za-z0-9][A-Za-z0-9-]*$/ : /^(-[A-Za-z0-9]|--[A-Za-z0-9][A-Za-z0-9-]+)$/;
  for (const n of b.real ?? []) if (!form.test(n)) v.push(wo + ": realFlags '" + n + "' hat keine Flag-Form");
  return v;
}

const alle = Object.entries(KOEPFE).map(([name, d]) => { const ebenen = new Set<D>(); return { name, d, ebenen, blaetter: blaetter(d, ebenen) }; });
const alleBlaetter = alle.flatMap(a => a.blaetter);

// Die Titel der drei Tests aus #1989 bleiben (Merge-Testabgleich); seit #1996 gilt ihre Regel für `realFlags` statt der alten Unbekannt-Liste.
describe("Flag-Tabellen aller Familien: requiredFlags und unknownFlags sind konsistent", () => {
  describe("(a) Regeln über alle Dispatch-Tabellen", () => test.each(alle.map(a => [a.name, a] as const))("%s: requiredFlags sind Flags des Ziels, realFlags ohne Dubletten, ohne Überschneidung, in Flag-Form", (_n, a) => {
    expect(dubletten(a.d.realFlags ?? [])).toEqual([]);
    expect(a.blaetter.flatMap(verstoesse)).toEqual([]);
  }));
  test("KUBECTL_OPTIONS: ohne Dubletten, in der Familien-Liste der Wurzel", () => {
    expect(dubletten(KUBECTL_OPTIONS)).toEqual([]);
    expect(KUBECTL.realFlags).toBe(KUBECTL_OPTIONS);
  });
  test("nicht vakuös: der Besuch findet die Einträge mit unknownFlags und requiredFlags", () => {
    expect(alleBlaetter.length).toBeGreaterThan(80);
    expect(alleBlaetter.filter(b => b.real !== undefined).length).toBeGreaterThanOrEqual(15);
    expect(alleBlaetter.filter(b => b.entry.requiredFlags?.length).length).toBeGreaterThanOrEqual(2);
    expect(alleBlaetter.some(b => b.ziel.join(" ") === "create secret tls")).toBe(true);
  });
  test("Negativfall: eine kaputte Tabelle liefert beide Verstöße", () => {
    const kaputt: D = {
      cmd: "x",
      flags: [flag(true, "-n")],
      table: {
        a: { run: () => "", maxArgs: OFFENE_LISTE, flags: [flag(true, "--aa")], requiredFlags: ["--fehlt"], realFlags: ["--aa"] },
      },
    };
    expect(blaetter(kaputt).flatMap(verstoesse)).toEqual([
      "a: requiredFlags '--fehlt' steht nicht in flags",
      "a: realFlags '--aa' ist zugleich ein Flag des Ziels",
    ]);
  });
  test("Negativfall: eine Dublette und eine falsche Flag-Form in realFlags werden gemeldet", () => {
    const kaputt: D = { cmd: "x", table: { a: { run: () => "", maxArgs: OFFENE_LISTE, realFlags: ["--bb", "--bb", "-xx", "--y"] } } };
    expect(blaetter(kaputt).flatMap(verstoesse)).toEqual([
      "a: realFlags '--bb' doppelt",
      "a: realFlags '-xx' hat keine Flag-Form",
      "a: realFlags '--y' hat keine Flag-Form",
    ]);
  });
  test("ein persistentes Flag der Ebene zählt als Flag des Ziels (requiredFlags darf darauf zeigen)", () => {
    const d: D = { cmd: "x", flags: [flag(true, "-n")], table: { a: { run: () => "", maxArgs: OFFENE_LISTE, requiredFlags: ["-n"] } } };
    expect(blaetter(d).flatMap(verstoesse)).toEqual([]);
  });
});

describe("(b) Ratchet: die kubectl-Ziele, die noch offen sind", () => {
  // Folge-Ticket: #1998 (realFlags für diese Ziele; danach ist die Liste leer und der Test verlangt lauter geschlossene Ziele).
  // Die Liste darf nur schrumpfen: ein Ziel, das geschlossen ist, steht nicht mehr hier, ein offenes, das hier fehlt, macht den Test rot.
  const OFFENE_ZIELE = ["apply", "delete", "describe", "expose", "get", "label", "logs", "scale", "top"];
  test("offen ist genau das, was die Liste nennt", () => {
    const offen = blaetter(KUBECTL).filter(b => b.real === undefined).map(b => b.ziel.join(" ")).sort();
    expect(offen).toEqual(OFFENE_ZIELE);
  });
});

/* ---- (c) Orakel: die Flags je Ziel laut kubectl-Quelle (ohne die globalen Flags und -n) ---- */
const PRINT = ["-o", "--output", "--show-managed-fields", "--template", "--allow-missing-template-keys"];
const DATEI = ["-f", "--filename", "-R", "--recursive", "-k", "--kustomize"];
const SELEKTOR = ["-l", "--selector"];
const BASIS = [...PRINT, "--save-config", "--validate", "--dry-run", "--field-manager"];
/** Pfad → Flags des Ziels; Quelle je Eintrag im Kommentar. */
const ORAKEL: Record<string, string[]> = {
  // create/create_deployment.go
  "create deployment": [...BASIS, "--image", "--port", "-r", "--replicas"],
  // create/create_serviceaccount.go
  "create serviceaccount": [...BASIS],
  // create/create_role.go
  "create role": [...BASIS, "--verb", "--resource", "--resource-name"],
  // create/create_clusterrole.go
  "create clusterrole": [...BASIS, "--verb", "--non-resource-url", "--resource", "--resource-name", "--aggregation-rule"],
  // create/create_rolebinding.go
  "create rolebinding": [...BASIS, "--clusterrole", "--role", "--user", "--group", "--serviceaccount"],
  // create/create_clusterrolebinding.go (kein --role)
  "create clusterrolebinding": [...BASIS, "--clusterrole", "--user", "--group", "--serviceaccount"],
  // create/create_configmap.go
  "create configmap": [...BASIS, "--from-file", "--from-literal", "--from-env-file", "--append-hash"],
  // create/create_secret.go
  "create secret generic": [...BASIS, "--from-file", "--from-literal", "--from-env-file", "--type", "--append-hash"],
  // create/create_secret_tls.go
  "create secret tls": [...BASIS, "--cert", "--key", "--append-hash"],
  // set/set_image.go (PrintFlags, RecordFlags, Filename, --all, --local, --dry-run, --field-manager, Selektor)
  "set image": [...PRINT, "--record", ...DATEI, "--all", "--local", "--dry-run", "--field-manager", ...SELEKTOR],
  // set/set_env.go
  "set env": [...DATEI, "-c", "--containers", "--from", "--prefix", "-e", "--env", "--keys", "--list", "--resolve", "--local", "--all", "--overwrite", "--field-manager", ...SELEKTOR, ...PRINT, "--dry-run"],
  // set/set_resources.go
  "set resources": [...PRINT, "--record", ...DATEI, "--all", ...SELEKTOR, "-c", "--containers", "--local", "--dry-run", "--limits", "--requests", "--field-manager"],
  // rollout/rollout_restart.go
  "rollout restart": [...DATEI, "--field-manager", ...SELEKTOR, ...PRINT],
  // rollout/rollout_history.go
  "rollout history": ["--revision", ...SELEKTOR, ...DATEI, ...PRINT],
  // rollout/rollout_undo.go
  "rollout undo": ["--to-revision", ...DATEI, "--dry-run", ...SELEKTOR, ...PRINT],
  // auth/cani.go
  "auth can-i": ["-A", "--all-namespaces", "-q", "--quiet", "--subresource", "--list", "--no-headers"],
};
/** Die globalen kubectl-Flags (`kubectl options`) laut Quelle, unabhängig von KUBECTL_OPTIONS abgeschrieben:
 *  cli-runtime/pkg/genericclioptions/config_flags.go (AddFlags), kubectl/pkg/cmd/cmd.go (PersistentFlags: Profiling, --warnings-as-errors,
 *  --kuberc, MatchVersionFlags), component-base/logs (-v/--v, --vmodule, --log-flush-frequency). `-n/--namespace` ist die persistente `NS` der Wurzel. */
const GLOBALE_ORAKEL = [
  "--kubeconfig", "--cache-dir", "--client-certificate", "--client-key", "--token", "--as", "--as-uid", "--as-group", "--as-user-extra",
  "--username", "--password", "--cluster", "--user", "--context", "-s", "--server", "--tls-server-name", "--insecure-skip-tls-verify",
  "--certificate-authority", "--request-timeout", "--disable-compression", "--proxy-url", "--profile", "--profile-output",
  "--warnings-as-errors", "--kuberc", "--match-server-version", "-v", "--v", "--vmodule", "--log-flush-frequency",
];
const GLOBAL = [...GLOBALE_ORAKEL, "-n", "--namespace"];
const lauf = (...t: string[]) => dispatchSub(host, KUBECTL, ["kubectl", ...t], 1);
const text = (r: ReturnType<typeof lauf>) => (typeof r === "string" ? r : "");
const UNBEKANNT = /unknown (shorthand )?flag/;
const geschlossene = blaetter(KUBECTL).filter(b => b.real !== undefined);

describe("(c) Orakel je geschlossenem kubectl-Ziel", () => {
  test("jedes geschlossene Ziel hat ein Orakel und umgekehrt", () => {
    expect(geschlossene.map(b => b.ziel.join(" ")).sort()).toEqual(Object.keys(ORAKEL).sort());
  });
  test.each(geschlossene.map(b => [b.ziel.join(" "), b] as const))("%s: flags ∪ realFlags = Orakel (ohne globale Flags)", (wo, b) => {
    const ist = [...namen(b.eigene), ...(b.real ?? [])].filter(n => !GLOBAL.includes(n));
    expect([...new Set(ist)].sort()).toEqual([...new Set(ORAKEL[wo].filter(n => !GLOBAL.includes(n)))].sort());
  });
  test.each(Object.entries(ORAKEL))("%s: kein echtes Flag meldet „unknown flag“", (wo, flags) => {
    for (const n of flags) expect(text(lauf(...wo.split(" "), n + "=1")), wo + " " + n).not.toMatch(UNBEKANNT);
  });
  test.each(Object.keys(ORAKEL))("%s: ein fremdes Flag meldet den pflag-Text", wo => {
    expect(text(lauf(...wo.split(" "), "--gibts-nicht=1"))).toMatch(/^error: unknown flag: --gibts-nicht\n/);
    expect(text(lauf(...wo.split(" "), "-Z"))).toMatch(/^error: unknown shorthand flag: 'Z' in -Z\n/);
  });
  test("KUBECTL_OPTIONS = die globalen Flags laut Quelle (Mengengleichheit mit dem Orakel)", () => {
    expect([...KUBECTL_OPTIONS].sort()).toEqual([...GLOBALE_ORAKEL].sort());
  });
  test.each(GLOBALE_ORAKEL)("das globale Flag %s meldet an jedem geschlossenen Ziel nie „unknown flag“", n => {
    for (const wo of Object.keys(ORAKEL)) expect(text(lauf(...wo.split(" "), n + "=1")), wo + " " + n).not.toMatch(UNBEKANNT);
  });
  test("ein globales Flag zwei Ebenen tief: „Nicht simuliert“", () => {
    expect(text(lauf("create", "secret", "tls", "t", "--kubeconfig=x"))).toContain("Nicht simuliert: das Flag '--kubeconfig' bei 'kubectl create secret tls'");
  });
  test("ein Flag eines Geschwister-Ziels meldet den echten Fehler (create clusterrolebinding --role)", () => {
    expect(text(lauf("create", "clusterrolebinding", "b", "--clusterrole=c", "--role=x"))).toMatch(/^error: unknown flag: --role\n/);
  });
});

describe("(d) die kuratierte Unbekannt-Liste gibt es nicht mehr", () => {
  // Grenze: gesucht wird nur in src/**/*.ts und docs/**/*.md; der alte Name steht auch nirgends sonst.
  const alt = new RegExp("\\bunknown" + "Flags\\b");
  const dateien = (dir: string, ext: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? dateien(join(dir, e.name), ext) : e.name.endsWith(ext) ? [join(dir, e.name)] : []);
  test("kein Treffer in src und docs", () => {
    const treffer = [...dateien("src", ".ts"), ...dateien("docs", ".md")].filter(f => alt.test(readFileSync(f, "utf8")));
    expect(treffer).toEqual([]);
  });
});

describe("(e) Scan-Wächter", () => {
  test("Scan-Wächter: jede `export const X: Dispatch<…>` unter src/sim ist über einen Familien-Kopf erreichbar", () => {
    const wurzel = join(__dirname, "..", "..", "src", "sim");
    const dateien: string[] = [];
    const lies = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) lies(join(dir, e.name));
        else if (e.name.endsWith(".ts")) dateien.push(join(dir, e.name));
      }
    };
    lies(wurzel);
    const gefunden: string[] = [];
    for (const f of dateien) {
      for (const m of readFileSync(f, "utf8").matchAll(/export const (\w+): Dispatch</g)) gefunden.push(relative(wurzel, f).replace(/\\/g, "/") + ":" + m[1]);
    }
    expect(gefunden.length).toBeGreaterThanOrEqual(13);
    const besucht = new Set<D>(alle.flatMap(a => [...a.ebenen]));
    const unerreichbar: string[] = [];
    for (const eintrag of gefunden) {
      const [datei, name] = eintrag.split(":");
      const modul = (MODULE_CACHE[datei] ?? {}) as Record<string, D>;
      if (!(name in modul)) unerreichbar.push(eintrag + " (nicht ladbar)");
      else if (!besucht.has(modul[name])) unerreichbar.push(eintrag);
    }
    expect(unerreichbar).toEqual([]);
  });
});

/** Die geladenen Module je Datei (synchron über `import.meta.glob`, beim Laden dieser Datei gefüllt). */
const MODULE_CACHE: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(import.meta.glob("../../src/sim/**/*.ts", { eager: true })).map(([pfad, m]) => [pfad.replace("../../src/sim/", ""), m as Record<string, unknown>]),
);
