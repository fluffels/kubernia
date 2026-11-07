#!/usr/bin/env node
/**
 * Blocker-Migration (factory#202 L1): setzt für offene Issues mit einer Blocker-Textzeile die fehlende native GitHub-Abhängigkeit „blocked by“
 * (Projekt-Board zeigt dann das Blocked-Icon). Die Textzeile bleibt maßgeblich; die Kante kommt zusätzlich. Je Repo fährt sie der Bezieher selbst.
 *
 *   node scripts/blocker-migration.mjs [--anwenden] [--repo <owner/name>]
 *
 * Standard ist der Trockenlauf (nur Ausgabe); `--anwenden` schreibt je fehlender Kante eine Mutation. Übersprungen und gelistet: Blocker, die
 * nicht offen sind, und Blocker in fremden Repos (bewusst kein REST-Lookup über `echteVerknuepfung`: im Factory-Repo sind 29 von 31 übersprungenen
 * Verweisen Herkunftsnennungen auf Tickets des Quellprojekts, die Kante bräuchte Lesezugriff auf dieses Repo und zeigte kein Blocked-Icon an erledigter Arbeit;
 * die Textzeile bleibt maßgeblich; Stand der Messung 2026-11-05). Grenze: je Issue werden höchstens 100 vorhandene Kanten gelesen (`blockedBy(first:100)`, ohne Paginierung). Idempotent: schon native Kanten werden abgezogen. Ausgabe endet mit einer Kostenzeile
 * („k Abfragen, m Mutationen“). Exit 0 = fertig, 1 = gh-Fehler (laufende Kanten werden weiter versucht), 2 = Aufruffehler.
 */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { addBlockedBy } from "./blocker-lib.mjs";
import { fehlerText, ghJson, tokenFuerZiel } from "./gh-cli.mjs";
import { REPO } from "./board-lib.mjs";
import { ladeProjektConfig, spracheAus } from "./projekt-config-lib.mjs";
import { istRepoForm, zerlegeRepo } from "./repo-form.mjs";
import { blockerVerweise } from "./spezifikation-lib.mjs";

const AUFRUF = "Aufruf: node scripts/blocker-migration.mjs [--anwenden] [--repo <owner/name>]";
const OPTIONEN = { anwenden: { type: "boolean" }, repo: { type: "string" } };
const SEITE = 50;
const FRAGE = `query($owner:String!,$name:String!,$after:String){ repository(owner:$owner,name:$name){ issues(states:OPEN, first:${SEITE}, after:$after){ pageInfo{ hasNextPage endCursor } nodes{ id number body blockedBy(first:100){ nodes{ number repository{ nameWithOwner } } } } } } }`;

/**
 * Die fehlenden nativen Kanten. `issues`: offene Issues `{ nummer, id, body, nativ: [{ nummer, repo }] }` (alle offenen des Repos `repo`),
 * `sprache`: Spezifikations-Sprache (Blocker-Wort). Ein eigener Blocker, der nicht unter den offenen steht, gilt als nicht offen. Pur.
 * Rückgabe `{ kanten: [{ nummer, blockerNummer, issueNodeId, blockerNodeId }], uebersprungen: [{ nummer, ref, grund }] }`.
 */
export function fehlendeKanten({ issues, repo, sprache }) {
  const offene = new Map(issues.map((i) => [i.nummer, i]));
  const kanten = [];
  const uebersprungen = [];
  for (const i of issues) {
    const schon = new Set(i.nativ.filter((n) => n.repo === repo).map((n) => n.nummer));
    for (const v of blockerVerweise(i.body ?? "", sprache)) {
      const eigen = v.repo === null || v.repo === repo;
      const ref = `${eigen ? "" : v.repo}#${v.nummer}`;
      if (!eigen) uebersprungen.push({ nummer: i.nummer, ref, grund: "fremdes Repo" });
      else if (v.nummer === i.nummer) uebersprungen.push({ nummer: i.nummer, ref, grund: "Selbstverweis" });
      else if (!offene.has(v.nummer)) uebersprungen.push({ nummer: i.nummer, ref, grund: "Blocker nicht offen" });
      else if (!schon.has(v.nummer)) kanten.push({ nummer: i.nummer, blockerNummer: v.nummer, issueNodeId: i.id, blockerNodeId: offene.get(v.nummer).id });
    }
  }
  return { kanten, uebersprungen };
}

/** Lädt alle offenen Issues seitenweise (`ladeSeite(nach)` → `{ issues, weiter }`); Rückgabe `{ issues, abfragen }`. */
function ladeAlle(ladeSeite) {
  const issues = [];
  let nach = null;
  let abfragen = 0;
  do {
    const s = ladeSeite(nach);
    abfragen++;
    issues.push(...s.issues);
    nach = s.weiter;
  } while (nach !== null);
  return { issues, abfragen };
}

/**
 * Migration mit injizierter I/O (`repo`, `sprache`, `ladeSeite`, `setze(issueNodeId, blockerNodeId)`): Ergebnis `{ code, out, err }`.
 * Ein Fehler beim Laden endet mit Exit 1; ein Fehler beim Setzen einer Kante wird gemeldet, die übrigen Kanten laufen weiter (Exit 1).
 */
export function migriere({ anwenden }, io) {
  let geladen;
  try {
    geladen = ladeAlle(io.ladeSeite);
  } catch (e) {
    return { code: 1, out: "", err: `✖ Issues nicht ladbar: ${fehlerText(e)}\n` };
  }
  const { kanten, uebersprungen } = fehlendeKanten({ issues: geladen.issues, repo: io.repo, sprache: io.sprache });
  const zeilen = [`${anwenden ? "Setze" : "Trockenlauf, würde setzen"} ${kanten.length} Kante(n) in ${io.repo}:`];
  const fehler = [];
  let mutationen = 0;
  for (const k of kanten) {
    zeilen.push(`  #${k.nummer} ← #${k.blockerNummer}`);
    if (!anwenden) continue;
    mutationen++;
    try {
      io.setze(k.issueNodeId, k.blockerNodeId);
    } catch (e) {
      fehler.push(`✖ #${k.nummer} ← #${k.blockerNummer}: ${fehlerText(e)}`);
    }
  }
  if (uebersprungen.length > 0) zeilen.push(`Übersprungen (${uebersprungen.length}):`, ...uebersprungen.map((u) => `  #${u.nummer} ${u.ref}: ${u.grund}`));
  zeilen.push(`${geladen.abfragen} Abfragen, ${mutationen} Mutationen`);
  return { code: fehler.length > 0 ? 1 : 0, out: `${zeilen.join("\n")}\n`, err: fehler.length > 0 ? `${fehler.join("\n")}\n` : "" };
}

/** Argumente prüfen und ausführen (`io` voll oder leer: `ladeSeite`, `setze`, `sprache`; ohne `io` kommt alles aus der echten Anbindung). Ergebnis `{ code, out, err }`. */
export function fuehreAus(argv, io = {}) {
  const { werte, fehler } = flagsLesen(argv, OPTIONEN);
  if (fehler) return { code: AUFRUF_EXIT, out: "", err: `${fehler.text}\n${AUFRUF}\n` };
  const repo = io.repo ?? werte.repo ?? REPO;
  if (!istRepoForm(repo)) return { code: AUFRUF_EXIT, out: "", err: `✖ Repo „${repo}“ ist nicht von der Form owner/name\n${AUFRUF}\n` };
  const echt = Object.keys(io).length === 0 ? echteIo(repo) : io;
  return migriere({ anwenden: werte.anwenden === true }, { ...echt, repo });
}

/** Echte Anbindung über `gh` (GraphQL, Token des Ziel-Repos). */
export function echteIo(repo, { gh = ghJson, env = process.env } = {}) {
  const opts = { token: tokenFuerZiel({ ziel: repo, eigenes: REPO, env }) };
  const { owner, name } = zerlegeRepo(repo);
  return {
    sprache: spracheAus(ladeProjektConfig()).spezifikation,
    ladeSeite: (nach) => {
      const args = ["api", "graphql", "-f", `query=${FRAGE}`, "-f", `owner=${owner}`, "-f", `name=${name}`, ...(nach === null ? [] : ["-f", `after=${nach}`])];
      const s = gh(args, opts).data.repository.issues;
      return {
        issues: s.nodes.map((n) => ({ nummer: n.number, id: n.id, body: n.body, nativ: n.blockedBy.nodes.map((b) => ({ nummer: b.number, repo: b.repository.nameWithOwner })) })),
        weiter: s.pageInfo.hasNextPage ? s.pageInfo.endCursor : null,
      };
    },
    setze: (issueNodeId, blockerNodeId) => addBlockedBy({ issueNodeId, blockerNodeId, opts }, gh),
  };
}

/** Der Direktaufruf: `fuehreAus` (injizierbar), ein geworfener Fehler wird zu Exit 1 mit Fehlerzeile. Ergebnis `{ code, out, err }`. */
export function direktLauf(argv, fuehre = fuehreAus) {
  try {
    return fuehre(argv);
  } catch (e) {
    return { code: 1, out: "", err: `✖ ${fehlerText(e)}\n` };
  }
}

if (istDirektaufruf(import.meta.url)) {
  const r = direktLauf(process.argv.slice(2));
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exitCode = r.code;
}
