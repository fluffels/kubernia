// Kein Shebang — analog zu scripts/check-diffsize.mjs / check-docdrift.mjs: dieses
// Skript wird über `node scripts/check-lockfile.mjs` (npm run check:lockfile)
// gestartet UND von test/lockfile.test.ts importiert. Eine `#!`-Zeile bricht genau
// diesen Test-Import (Vitest/esbuild stolpert über das `#!`), darum weggelassen.
/**
 * Lockfile-Integritäts-Wächter (#593, Governance) — fängt Lockfile-Drift lokal,
 * bevor er gepusht wird.
 *
 * Hintergrund (iSAQB 2026-07-02): `package.json` nutzt durchgehend `^`-Ranges; die
 * CI ist über `npm ci` + `.nvmrc` reproduzierbar (ci.yml), aber KEIN Gate prüft
 * außerhalb der CI, ob `package-lock.json` noch zu `package.json` passt. Wer eine
 * Abhängigkeit von Hand in `package.json` ändert (Version bumpen, hinzufügen,
 * entfernen) und `npm install` vergisst, bemerkt das erst, wenn die PR-CI an
 * `npm ci` rot anläuft — eine teure, späte Rückmeldung.
 *
 * Dieser Wächter macht denselben Drift SOFORT lokal (in `npm run verify`, also im
 * pre-push-Hook) rot.
 *
 * WARUM statischer Vergleich statt `npm ci --dry-run` (das „o.ä." aus dem Ticket)?
 *  - Kein Netz, kein `node_modules`, deterministisch, in Millisekunden — passt in
 *    die bewusst build-/install-freie schnelle `verify`-Kette (#527).
 *  - Testbar mit injiziertem IO (wie check-diffsize/check-docdrift): die Prüflogik
 *    ist eine pure, dateisystem-freie Funktion und wird aus test/lockfile.test.ts
 *    importiert — EINE Quelle der Wahrheit zwischen Test und CLI.
 *  - Es prüft GENAU das, was `npm ci` als „in sync"-Vorbedingung zuerst prüft: die
 *    Wurzel `packages[""]` des Lockfiles v2/v3 spiegelt die dependency-Blöcke aus
 *    `package.json` 1:1 (inkl. der `^`-Ranges) + Name/Version. Weichen sie ab, ist
 *    der Lockfile nicht frisch regeneriert → Drift. `npm ci` selbst deckt die
 *    tiefere Baum-/Hash-Integrität weiterhin in der CI ab (zweite Grenze).
 *
 * Reines Node-Skript (nur Builtins), plattformübergreifend.
 *
 * Ausführen mit:  npm run check:lockfile   (oder als Teil von: npm run verify)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Die dependency-Blöcke, die `packages[""]` des Lockfiles 1:1 aus `package.json`
 *  spiegeln muss. Alle vier abgedeckt (nicht nur die heute genutzten
 *  dependencies/devDependencies), damit ein künftig ergänzter Block — z.B.
 *  optionalDependencies bei Stardew-Scope — automatisch mitbewacht wird. */
export const DEP_BUCKETS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

/** Vergleicht `package.json` gegen die Wurzel `packages[""]` des Lockfiles. Pure —
 *  kein Dateisystem, voll testbar. Rückgabe: { ok, problems } mit strukturierten
 *  Befunden (leer = in sync). Jeder Befund trägt ein `kind`, das das CLI rendert.
 *
 *  Erkannte Drift-Arten:
 *   - missing-lockfile / missing-root-package: der Lockfile fehlt oder hat keine
 *     `packages[""]`-Wurzel → nicht prüfbar, bewusst ROT (ein Gate, das nichts
 *     geprüft hat, darf nicht grün melden).
 *   - lockfile-version: v1-Lockfile (keine `packages`-Wurzel) → dieser statische
 *     Vergleich greift nicht; ROT mit Hinweis „auf npm >= 7 / lockfileVersion 2+".
 *   - name-mismatch / version-mismatch: Wurzel-Identität driftet (z.B. Projekt-
 *     Version in package.json gebumpt, aber kein `npm install`).
 *   - missing: Abhängigkeit steht in package.json, fehlt im Lockfile-Root.
 *   - extra: Abhängigkeit steht im Lockfile-Root, aber nicht (mehr) in package.json.
 *   - spec-mismatch: derselbe Name, aber unterschiedliche Range (Bump ohne install). */
export function auditLockfile({ pkg, lock }) {
  if (lock == null || typeof lock !== "object") {
    return { ok: false, problems: [{ kind: "missing-lockfile" }] };
  }
  const problems = [];

  const lv = lock.lockfileVersion;
  if (typeof lv !== "number" || lv < 2) {
    // v1-Lockfiles haben keine packages[""]-Wurzel — der Wurzel-Spiegel-Vergleich
    // ist nicht anwendbar. Nicht still grün, sondern klar melden.
    problems.push({ kind: "lockfile-version", version: lv });
    return { ok: false, problems };
  }

  const root = lock.packages && lock.packages[""];
  if (root == null || typeof root !== "object") {
    problems.push({ kind: "missing-root-package" });
    return { ok: false, problems };
  }

  if ((pkg.name ?? undefined) !== (root.name ?? undefined)) {
    problems.push({ kind: "name-mismatch", pkg: pkg.name, lock: root.name });
  }
  if ((pkg.version ?? undefined) !== (root.version ?? undefined)) {
    problems.push({ kind: "version-mismatch", pkg: pkg.version, lock: root.version });
  }

  for (const bucket of DEP_BUCKETS) {
    const inPkg = pkg[bucket] ?? {};
    const inLock = root[bucket] ?? {};
    for (const [name, spec] of Object.entries(inPkg)) {
      if (!(name in inLock)) {
        problems.push({ kind: "missing", bucket, name, spec });
      } else if (inLock[name] !== spec) {
        problems.push({ kind: "spec-mismatch", bucket, name, pkgSpec: spec, lockSpec: inLock[name] });
      }
    }
    for (const [name, lockSpec] of Object.entries(inLock)) {
      if (!(name in inPkg)) {
        problems.push({ kind: "extra", bucket, name, lockSpec });
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

/** Formuliert einen Befund als lesbare rote Zeile. Pure (für den Test mitprüfbar). */
export function describeProblem(p) {
  switch (p.kind) {
    case "missing-lockfile":
      return "package-lock.json fehlt oder ist kein Objekt — Lockfile kann nicht geprüft werden.";
    case "lockfile-version":
      return `lockfileVersion ${p.version ?? "?"} wird nicht unterstützt (brauche 2+, npm >= 7). „npm install" mit aktuellem npm neu erzeugen.`;
    case "missing-root-package":
      return `package-lock.json hat keine Wurzel packages[""] — unerwartetes Format, „npm install" neu erzeugen.`;
    case "name-mismatch":
      return `Projekt-Name driftet: package.json „${p.pkg}" ≠ Lockfile „${p.lock}".`;
    case "version-mismatch":
      return `Projekt-Version driftet: package.json „${p.pkg}" ≠ Lockfile „${p.lock}".`;
    case "missing":
      return `${p.bucket}: „${p.name}@${p.spec}" steht in package.json, fehlt aber im Lockfile.`;
    case "extra":
      return `${p.bucket}: „${p.name}@${p.lockSpec}" steht im Lockfile, aber nicht (mehr) in package.json.`;
    case "spec-mismatch":
      return `${p.bucket}: „${p.name}" — package.json „${p.pkgSpec}" ≠ Lockfile „${p.lockSpec}".`;
    default:
      return `unbekannter Befund: ${JSON.stringify(p)}`;
  }
}

/** Liest package.json + package-lock.json von der Platte und prüft sie. `rootDir`
 *  überschreibbar (Test/Aufruf). Ein fehlender/kaputter Lockfile wird als Befund
 *  gemeldet, nicht als Absturz. */
export function checkLockfile(rootDir = ROOT) {
  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  let lock;
  try {
    lock = JSON.parse(readFileSync(join(rootDir, "package-lock.json"), "utf8"));
  } catch {
    lock = null; // fehlend/kaputt → auditLockfile meldet missing-lockfile
  }
  return auditLockfile({ pkg, lock });
}

// ── CLI ────────────────────────────────────────────────────────────────────────
function main() {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);

  const { ok, problems } = checkLockfile();

  if (!ok) {
    for (const p of problems) console.error(red(`✖ ${describeProblem(p)}`));
    console.error(
      `\npackage-lock.json ist nicht mehr synchron zu package.json (Lockfile-Drift).\n` +
        `„npm install" ausführen (regeneriert den Lockfile) und die Änderung mitcommitten.`,
    );
    process.exit(1);
  }

  console.log(green(`✔ check:lockfile ok — package-lock.json ist synchron zu package.json.`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
