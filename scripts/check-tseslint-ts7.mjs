// Kein Shebang — analog zu scripts/check-doc-tickets.mjs: dieses Skript wird über
// `node scripts/check-tseslint-ts7.mjs` (npm run check:tseslint-ts7) gestartet UND
// von test/tseslint-ts7.test.ts importiert. Ein `#!` bricht genau diesen esbuild-Import.
/**
 * TS-7-Freigabe-Wächter (#847) — meldet aktiv, sobald das TypeScript-7-Upgrade
 * upstream möglich wird, damit es NICHT vergessen wird.
 *
 * Hintergrund (#847): Der koordinierte Upgrade auf TypeScript 7 (der native
 * Compiler-Port) ist aktuell UNMÖGLICH — `@typescript-eslint/typescript-estree`
 * (der Parser hinter dem Lint-Gate) hat einen harten Peer `typescript >=4.8.4
 * <6.1.0` und crasht mit TS 7 zur Laufzeit (empirisch: „Cannot read properties of
 * undefined (reading 'Cjs')"). Es gibt in KEINEM veröffentlichten Kanal (latest,
 * canary, alpha) eine typescript-eslint-Version, die TS 7 unterstützt. Darum ist
 * der TS-Major in .github/dependabot.yml (vorübergehend) ge-ignore-t und #847 bleibt
 * offen als Tracker.
 *
 * Das Risiko dabei: ein stiller `ignore` wird vergessen und man bleibt für immer
 * auf TS 6. Dieser Wächter ist das Gegenmittel — die Maschine passt auf statt des
 * menschlichen Gedächtnisses (gleiches Prinzip wie check:docdrift/#529,
 * check:doctickets/#610): er fragt die npm-Registry nach dem `typescript`-Peer des
 * NEUESTEN `@typescript-eslint/typescript-estree` und ALARMIERT (roter Schritt),
 * sobald dieser Peer eine 7.x-Version zulässt. Dann ist zu tun: den dependabot-
 * ignore entfernen, `typescript` + `typescript-eslint` koordiniert hochziehen,
 * TypeCheck + Lint grün halten und #847 schließen.
 *
 * BEWUSST NICHT Teil von `npm run verify` / der Vitest-Suite: der Registry-Abgleich
 * braucht Netz und ist nicht deterministisch — er darf die hermetische, offline-
 * fähige Gate-Kette nicht netzabhängig machen. Er läuft als eigener (bewusst
 * non-blocking, „alarmierender") CI-Job und lokal auf Zuruf. Die REINE Range-Logik
 * (`peerAllowsTs7`) ist dagegen offline + deterministisch und wird von
 * test/tseslint-ts7.test.ts Red-Green geprüft.
 *
 * Graceful degradation (wie check:doctickets ohne gh): scheitert der Netz-Abruf
 * (offline, Registry weg, frischer Clone ohne Netz), wird ÜBERSPRUNGEN (exit 0) mit
 * klarer Meldung — nicht fälschlich grün, aber auch nicht rot aus dem falschen Grund.
 * ROT (exit 1, non-blocking) gibt es NUR, wenn der Peer sicher eine TS-7-Version
 * zulässt — das ist das gewollte „jetzt geht's!"-Signal.
 *
 * Ausführen mit:  npm run check:tseslint-ts7
 */

import { pathToFileURL } from "node:url";

/** Das Paket, dessen typescript-Peer der echte Engpass ist (der Parser, der mit
 *  TS 7 crasht) — nicht das Meta-Paket `typescript-eslint`. */
export const ESTREE_PKG = "@typescript-eslint/typescript-estree";

// ── reine Range-Logik (offline, deterministisch, getestet) ───────────────────────

/** Zerlegt eine Version in [major, minor, patch] (Prerelease/Build ignoriert). */
function parseVer(v) {
  const m = String(v).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Vergleicht zwei [major,minor,patch]-Tripel: -1 / 0 / 1. */
function cmpVer(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** Erfüllt `ver` den EINEN Komparator (z.B. ">=4.8.4", "<6.1.0", "=5.0.0", "5.0.0")?
 *  Unbekannte/nicht parsebare Tokens (z.B. "*", "^7", Bereichs-Bindestrich) gelten
 *  bewusst als NICHT einschränkend (→ true): für einen „sag Bescheid, sobald es
 *  geht"-Wächter ist ein Fehlalarm (Mensch prüft kurz) harmlos, ein verpasstes
 *  Signal wäre der eigentliche Schaden. */
function satisfiesComparator(ver, comp) {
  const m = comp.trim().match(/^(>=|<=|>|<|=)?\s*v?(\d+\.\d+\.\d+)/);
  if (!m) return true; // nicht einschränkend (permissiver Bias, s.o.)
  const op = m[1] || "=";
  const target = parseVer(m[2]);
  if (!target) return true;
  const c = cmpVer(ver, target);
  switch (op) {
    case ">=": return c >= 0;
    case "<=": return c <= 0;
    case ">": return c > 0;
    case "<": return c < 0;
    default: return c === 0; // "="
  }
}

/** Erlaubt der Peer-Range mindestens EINE TypeScript-7.x-Version?
 *  Range-Grammatik von typescript-eslint ist eine UND-Verknüpfung Space-getrennter
 *  Komparatoren (">=4.8.4 <6.1.0"); `||` wird als ODER unterstützt. Getestet werden
 *  repräsentative 7.x-Stichproben — trifft eine davon, ist TS 7 (in irgendeiner
 *  Minor) freigegeben. Leere Range / "*" / null → unbeschränkt → true. */
export function peerAllowsTs7(range) {
  if (range == null) return true;
  const r = String(range).trim();
  if (r === "" || r === "*") return true;
  const alternatives = r.split("||").map((s) => s.trim()).filter(Boolean);
  const samples = ["7.0.0", "7.0.2", "7.99.99"].map(parseVer);
  return samples.some((ver) =>
    alternatives.some((alt) => alt.split(/\s+/).filter(Boolean).every((c) => satisfiesComparator(ver, c))),
  );
}

// ── Registry-Abgleich (nur in der CLI, nicht im Test) ────────────────────────────

/** Holt Version + typescript-Peer des neuesten estree-Pakets aus der npm-Registry.
 *  Wirft bei Netz-/Parse-Fehlern (der Aufrufer degradiert dann graceful). */
async function fetchLatestPeer() {
  const url = `https://registry.npmjs.org/${ESTREE_PKG.replace("/", "%2F")}/latest`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Registry HTTP ${res.status}`);
  const manifest = await res.json();
  return { version: manifest.version, peer: manifest.peerDependencies?.typescript ?? null };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────
async function main() {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);
  const yellow = (s) => paint("33", s);

  let info;
  try {
    info = await fetchLatestPeer();
  } catch (err) {
    console.error(
      yellow(`… npm-Registry nicht erreichbar — TS-7-Freigabe-Abgleich übersprungen (${err.message}).`),
    );
    return; // graceful skip: offline darf nicht rot aus dem falschen Grund sein
  }

  const { version, peer } = info;
  if (peerAllowsTs7(peer)) {
    console.error(
      red(
        `🎉 ${ESTREE_PKG}@${version} erlaubt jetzt TypeScript 7 (Peer „${peer}")!\n` +
          `   → TS 7 ist upstream freigegeben. Zu tun (#847):\n` +
          `     1. dependabot-ignore für den typescript-Major in .github/dependabot.yml entfernen,\n` +
          `     2. typescript + typescript-eslint koordiniert hochziehen (npm ci muss ohne ERESOLVE laufen),\n` +
          `     3. npm run typecheck && npm run lint grün halten, dann #847 schließen.`,
      ),
    );
    process.exit(1); // gewolltes Alarm-Signal (non-blocking CI-Job)
  }

  console.log(
    green(
      `✔ TS 7 weiterhin upstream blockiert: ${ESTREE_PKG}@${version} verlangt „${peer}" — kein TS 7. ` +
        `#847 bleibt zurecht gehalten, dependabot-ignore korrekt.`,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
