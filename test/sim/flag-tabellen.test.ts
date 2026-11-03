/* Konsistenz der Flag-Tabellen aller Befehlsfamilien (#1996): Ziele mit `realFlags` sind eine geschlossene Welt, ein echtes
 * Flag meldet nie `unknown flag`, ein anderes immer. Die Orakel-Listen unten sind aus den kubectl-Quellen abgeschrieben
 * (kubernetes/kubernetes, Tag v1.37.1, `kubectl/pkg/cmd/<gruppe>/<datei>.go`, die `cmd.Flags()`-Aufrufe samt
 * `cmdutil.Add*Flag*` und `PrintFlags.AddFlags`) und bewusst NICHT aus `src/sim/kubectl/real-flags.ts` gebildet: ein Tippfehler
 * dort fällt hier auf.
 *   (a) Regeln über alle Dispatch-Tabellen, (b) Ratchet: welche kubectl-Ziele noch offen sind, (c) Orakel je Ziel,
 *   (d) die kuratierte Unbekannt-Liste gibt es nicht mehr. */
import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dispatchSub, type Dispatch, type FlagSpec, type SubEntry } from "../../src/sim/cliargs";
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
const FAMILIEN: [string, D][] = [
  ["kubectl", KUBECTL], ["docker", DOCKER], ["helm", HELM], ["argocd", ARGOCD],
  ["glab", GLAB], ["git", GIT], ["kubeadm", KUBEADM], ["aws", AWS],
  ["terraform", TERRAFORM],
];

interface Blatt {
  ziel: string[]; entry: SubEntry<unknown>; wirksam: FlagSpec[]; eigene: FlagSpec[]; real: readonly string[] | undefined;
  familie: readonly string[]; style: string | undefined;
}

/** Alle Blätter einer Tabelle (Aliase einmal) mit den geerbten persistenten Flags und Familien-Listen. */
function blaetter(d: D, ziel: string[] = [], flags: readonly FlagSpec[] = [], familie: readonly string[] = [], style?: string): Blatt[] {
  const fl = [...flags, ...(d.flags ?? [])];
  const fam = [...familie, ...(d.realFlags ?? [])];
  const st = d.style ?? style;
  const seen = new Set<unknown>();
  const out: Blatt[] = [];
  for (const [key, e] of Object.entries(d.table)) {
    if (seen.has(e)) continue;
    seen.add(e);
    if ("group" in e) out.push(...blaetter(e.group, [...ziel, key], fl, fam, st));
    else out.push({ ziel: [...ziel, key], entry: e, wirksam: [...fl, ...(e.flags ?? [])], eigene: [...(e.flags ?? [])], real: e.realFlags, familie: fam, style: e.style ?? st });
  }
  return out;
}
const namen = (fs: readonly FlagSpec[]) => fs.flatMap(f => f.names);
const dubletten = (l: readonly string[]) => l.filter((n, i) => l.indexOf(n) !== i);

describe("(a) Regeln über alle Dispatch-Tabellen", () => {
  test.each(FAMILIEN)("%s: Pflicht-Flags sind Flags des Ziels, realFlags ohne Dubletten, Form und Überschneidung", (_n, d) => {
    expect(dubletten(d.realFlags ?? [])).toEqual([]);
    for (const b of blaetter(d)) {
      const wo = b.ziel.join(" ");
      const wirksam = namen(b.wirksam);
      for (const r of b.entry.requiredFlags ?? []) expect(wirksam, wo + " verlangt " + r).toContain(r);
      expect(dubletten(b.real ?? []), wo).toEqual([]);
      expect((b.real ?? []).filter(n => wirksam.includes(n)), wo + ": realFlags ∩ flags").toEqual([]);
      const form = b.style === "goflag" ? /^-[A-Za-z0-9][A-Za-z0-9-]*$/ : /^(-[A-Za-z0-9]|--[A-Za-z0-9][A-Za-z0-9-]+)$/;
      for (const n of b.real ?? []) expect(n, wo).toMatch(form);
    }
  });
  test("KUBECTL_OPTIONS: ohne Dubletten, in der Familien-Liste der Wurzel", () => {
    expect(dubletten(KUBECTL_OPTIONS)).toEqual([]);
    expect(KUBECTL.realFlags).toBe(KUBECTL_OPTIONS);
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
const GLOBAL = [...KUBECTL_OPTIONS, "-n", "--namespace"];
const lauf = (...t: string[]) => dispatchSub(host, KUBECTL, ["kubectl", ...t], 1);
const text = (r: ReturnType<typeof lauf>) => (typeof r === "string" ? r : "");
const UNBEKANNT = /unknown (shorthand )?flag/;
const kubectlBlaetter = blaetter(KUBECTL).filter(b => b.real !== undefined);

describe("(c) Orakel je geschlossenem kubectl-Ziel", () => {
  test("jedes geschlossene Ziel hat ein Orakel und umgekehrt", () => {
    expect(kubectlBlaetter.map(b => b.ziel.join(" ")).sort()).toEqual(Object.keys(ORAKEL).sort());
  });
  test.each(kubectlBlaetter.map(b => [b.ziel.join(" "), b] as const))("%s: flags ∪ realFlags = Orakel (ohne globale Flags)", (wo, b) => {
    const ist = [...namen(b.eigene), ...(b.real ?? [])].filter(n => !GLOBAL.includes(n));
    expect([...new Set(ist)].sort()).toEqual([...new Set(ORAKEL[wo].filter(n => !GLOBAL.includes(n)))].sort());
  });
  test.each(Object.entries(ORAKEL))("%s: kein echtes Flag meldet „unknown flag“", (wo, flags) => {
    for (const n of flags) {
      const r = lauf(...wo.split(" "), n + "=1");
      expect(text(r), wo + " " + n).not.toMatch(UNBEKANNT);
    }
  });
  test.each(Object.keys(ORAKEL))("%s: ein globales Flag ist „Nicht simuliert“ (nie „unknown“), ein fremdes meldet den pflag-Text", wo => {
    for (const n of KUBECTL_OPTIONS) expect(text(lauf(...wo.split(" "), n + "=1")), wo + " " + n).not.toMatch(UNBEKANNT);
    expect(text(lauf(...wo.split(" "), "--gibts-nicht=1"))).toMatch(/^error: unknown flag: --gibts-nicht\n/);
    expect(text(lauf(...wo.split(" "), "-Z"))).toMatch(/^error: unknown shorthand flag: 'Z' in -Z\n/);
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
