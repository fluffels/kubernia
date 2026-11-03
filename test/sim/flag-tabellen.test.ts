/* Konsistenz der Flag-Tabellen aller CLI-Familien (#1989): `requiredFlags` müssen in `flags` (eigene oder persistente der
 * Ebenen darüber) stehen, `unknownFlags` dürfen sich nicht mit den Flags des Ziels überschneiden, und bei kubectl nennt
 * `unknownFlags` nie ein globales Flag (`kubectl options`: `--user`, `--as`, `--context` … gelten an jedem Ziel).
 *
 * Grenze: gefunden werden nur Tabellen, die als `export const X: Dispatch<…>` in `src/sim/**` stehen; der Scan-Wächter
 * verlangt, dass jede davon über einen Familien-Kopf erreichbar ist. Eine Tabelle ohne diese Schreibweise sieht der Test nicht. */
import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { flag, OFFENE_LISTE, type Dispatch, type SubEntry } from "../../src/sim/cliargs";
import { KUBECTL } from "../../src/sim/kubectl";
import { DOCKER } from "../../src/sim/docker";
import { HELM } from "../../src/sim/helm";
import { ARGOCD } from "../../src/sim/argocd";
import { GLAB } from "../../src/sim/glab";
import { GIT } from "../../src/sim/git";
import { KUBEADM } from "../../src/sim/kubeadm";
import { AWS } from "../../src/sim/s3";
import { TERRAFORM } from "../../src/sim/terraform";

type Tab = Dispatch<SubEntry<unknown>>;
const KOEPFE: Record<string, Tab> = { KUBECTL, DOCKER, HELM, ARGOCD, GLAB, GIT, KUBEADM, AWS, TERRAFORM };

/** Die globalen kubectl-Flags (https://kubernetes.io/docs/reference/kubectl/generated/kubectl_options/): geschlossene Liste. */
const KUBECTL_GLOBALE_FLAGS = [
  "--as", "--as-group", "--as-uid", "--cache-dir", "--certificate-authority", "--client-certificate", "--client-key", "--cluster",
  "--context", "--disable-compression", "--insecure-skip-tls-verify", "--kubeconfig", "--match-server-version", "-n", "--namespace",
  "--password", "--profile", "--profile-output", "--request-timeout", "-s", "--server", "--tls-server-name", "--token", "--user",
  "--username", "-v", "--v", "--vmodule", "--warnings-as-errors",
];

interface Eintrag { pfad: string; entry: SubEntry<unknown>; flags: readonly string[]; kubectl: boolean }

/** Alle Blätter samt der Flag-Namen, die dort gelten (persistente Flags der Ebenen darüber plus die eigenen), und alle besuchten Ebenen. */
function besuche(d: Tab, kubectl: boolean, geerbt: readonly string[] = [], ebenen: Set<Tab> = new Set(), blaetter: Eintrag[] = []): { blaetter: Eintrag[]; ebenen: Set<Tab> } {
  ebenen.add(d);
  const hier = [...geerbt, ...(d.flags ?? []).flatMap(f => f.names)];
  for (const [key, e] of Object.entries(d.table)) {
    if ("group" in e) { besuche(e.group, kubectl, hier, ebenen, blaetter); continue; }
    blaetter.push({ pfad: d.cmd + " " + key, entry: e, flags: [...hier, ...(e.flags ?? []).flatMap(f => f.names)], kubectl });
  }
  return { blaetter, ebenen };
}

function verstoesse(b: Eintrag): string[] {
  const v: string[] = [];
  for (const n of b.entry.requiredFlags ?? []) if (!b.flags.includes(n)) v.push(b.pfad + ": requiredFlags '" + n + "' steht nicht in flags");
  for (const n of b.entry.unknownFlags ?? []) {
    if (b.flags.includes(n)) v.push(b.pfad + ": unknownFlags '" + n + "' ist zugleich ein Flag des Ziels");
    if (b.kubectl && KUBECTL_GLOBALE_FLAGS.includes(n)) v.push(b.pfad + ": unknownFlags '" + n + "' ist ein globales kubectl-Flag");
  }
  return v;
}

const alle = Object.entries(KOEPFE).map(([name, d]) => ({ name, ...besuche(d, name === "KUBECTL") }));
const alleBlaetter = alle.flatMap(a => a.blaetter);

describe("Flag-Tabellen aller Familien: requiredFlags und unknownFlags sind konsistent", () => {
  test.each(alle.map(a => [a.name, a.blaetter] as const))("%s", (_name, blaetter) => {
    expect(blaetter.flatMap(verstoesse)).toEqual([]);
  });

  test("nicht vakuös: der Besuch findet die Einträge mit unknownFlags und requiredFlags", () => {
    expect(alleBlaetter.length).toBeGreaterThan(80);
    expect(alleBlaetter.filter(b => b.entry.unknownFlags?.length).length).toBeGreaterThanOrEqual(15);
    expect(alleBlaetter.filter(b => b.entry.requiredFlags?.length).length).toBeGreaterThanOrEqual(2);
    expect(alleBlaetter.some(b => b.pfad === "kubectl create secret tls")).toBe(true);
  });

  test("Negativfall: eine kaputte Tabelle liefert beide Verstöße", () => {
    const kaputt: Tab = {
      cmd: "x",
      flags: [flag(true, "-n")],
      table: {
        a: { run: () => "", maxArgs: OFFENE_LISTE, flags: [flag(true, "--aa")], requiredFlags: ["--fehlt"], unknownFlags: ["--aa"] },
        b: { run: () => "", maxArgs: OFFENE_LISTE, unknownFlags: ["--user", "-n"] },
      },
    };
    const v = besuche(kaputt, true).blaetter.flatMap(verstoesse);
    expect(v).toEqual([
      "x a: requiredFlags '--fehlt' steht nicht in flags",
      "x a: unknownFlags '--aa' ist zugleich ein Flag des Ziels",
      "x b: unknownFlags '--user' ist ein globales kubectl-Flag",
      "x b: unknownFlags '-n' ist zugleich ein Flag des Ziels",
      "x b: unknownFlags '-n' ist ein globales kubectl-Flag",
    ]);
  });

  test("ein persistentes Flag der Ebene zählt als Flag des Ziels (requiredFlags darf darauf zeigen)", () => {
    const d: Tab = { cmd: "x", flags: [flag(true, "-n")], table: { a: { run: () => "", maxArgs: OFFENE_LISTE, requiredFlags: ["-n"] } } };
    expect(besuche(d, false).blaetter.flatMap(verstoesse)).toEqual([]);
  });

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
    const besucht = new Set<Tab>(alle.flatMap(a => [...a.ebenen]));
    const unerreichbar: string[] = [];
    for (const eintrag of gefunden) {
      const [datei, name] = eintrag.split(":");
      const modul = (MODULE_CACHE[datei] ?? {}) as Record<string, Tab>;
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
