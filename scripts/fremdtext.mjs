/**
 * Fremdtext-Gate (#1433): Text Dritter ist Daten, nie Anweisung.
 *
 * Liest ein Issue (`--issue <nr>`) oder einen PR (`--pr <nr>`) samt Kommentaren und gibt vertrauten Text
 * (Repo-Owner, `github-actions[bot]`, `dependabot[bot]`, je mit REST-Typ `Bot`) unverändert aus. Jeder Text
 * anderer Autoren wird zu einem Platzhalter mit Autor und URL; Titel und Body eines fremden Eintrags
 * verschwinden ganz. Ein Eintrag mit Label `forum` gilt als Fremdeingang (Text Dritter über die Discussions),
 * auch wenn die Action ihn anlegte. Die Prüfung ist deterministisch (Autor), kein Sanitizing beliebiger Bodies.
 *
 *   node scripts/fremdtext.mjs --issue <nr> | --pr <nr>
 *
 * Exit 0 = Eingang vertraut, 3 = Fremdeingang (nicht automatisch umsetzen), 2 = Aufruf- oder gh-Fehler
 * (fail-closed). Brain-Seite: docs/sicherheit-agenten.md. Der Kern ist pur, gh ist injizierbar (Test).
 */
import { ghText } from "./gh-cli.mjs";
import { pathToFileURL } from "node:url";

/** REST-Logins vertrauter Bots (zusätzlich zum Repo-Owner); gelten nur mit `type === "Bot"`. */
export const VERTRAUTE_BOTS = Object.freeze(["github-actions[bot]", "dependabot[bot]"]);
/** Labels, die einen Eintrag als Fremdeingang kennzeichnen, egal wer ihn anlegte. */
export const FREMDEINGANG_LABELS = Object.freeze(["forum"]);

/** Ist der REST-User `{login, type}` vertraut? Alles Unbekannte, auch `null`, ist fremd. */
export function istVertraut(user, owner) {
  if (!user || typeof user.login !== "string" || user.login === "") return false;
  if (typeof owner === "string" && owner !== "" && user.login.toLowerCase() === owner.toLowerCase()) return true;
  return user.type === "Bot" && VERTRAUTE_BOTS.includes(user.login);
}

const loginVon = (user) => (user && typeof user.login === "string" && user.login !== "" ? user.login : "unbekannt");
const platzhalter = (art, user, url) => `[Fremdtext ausgeblendet: ${art} von @${loginVon(user)}, ${url}]`;

/**
 * Trennt Eintrag (Issue/PR) und Beiträge nach Autor.
 * `beitraege`: `[{art, user, body, html_url, created_at?}]` (Kommentar, Review, Review-Kommentar).
 * Liefert `{fremdeingang, grund, autorVertraut, teile: [{art, autor, vertraut, text, url, datum}]}`.
 */
export function trenneFremdtext({ owner, art, eintrag, beitraege }) {
  const autorVertraut = istVertraut(eintrag.user, owner);
  const label = (eintrag.labels ?? []).map((l) => (typeof l === "string" ? l : l?.name)).find((n) => FREMDEINGANG_LABELS.includes(n));
  const fremdeingang = !autorVertraut || label !== undefined;
  const grund = !autorVertraut
    ? `Autor @${loginVon(eintrag.user)} ist nicht vertraut`
    : label !== undefined
      ? `Label ${label} (Text Dritter über das Forum)`
      : "";
  const bodyVertraut = !fremdeingang;
  const teile = [
    {
      art,
      autor: loginVon(eintrag.user),
      vertraut: bodyVertraut,
      text: bodyVertraut ? (eintrag.body ?? "") : platzhalter(art, eintrag.user, eintrag.html_url),
      url: eintrag.html_url,
      datum: eintrag.created_at ?? "",
    },
  ];
  for (const b of beitraege ?? []) {
    if (b.art === "Review" && (b.body ?? "") === "") continue;
    const vertraut = istVertraut(b.user, owner);
    teile.push({
      art: b.art,
      autor: loginVon(b.user),
      vertraut,
      text: vertraut ? (b.body ?? "") : platzhalter(b.art, b.user, b.html_url),
      url: b.html_url,
      datum: b.created_at ?? "",
    });
  }
  return { fremdeingang, grund, autorVertraut, teile };
}

/** Deterministischer Ausgabetext. Fremder Titel erscheint nie. */
export function formatiere(ergebnis, eintrag, art) {
  const out = [];
  const titelSichtbar = !ergebnis.fremdeingang;
  out.push(`${art} #${eintrag.number}${titelSichtbar ? ` — ${eintrag.title}` : ""}`);
  out.push(`Autor: @${loginVon(eintrag.user)} (vertraut: ${ergebnis.autorVertraut ? "ja" : "nein"}) · ${eintrag.html_url}`);
  for (const t of ergebnis.teile) {
    out.push("", `--- ${t.art} von @${t.autor}${t.datum ? `, ${t.datum}` : ""}, ${t.url}`);
    out.push(t.vertraut ? (t.text === "" ? "(leer)" : t.text) : t.text);
  }
  out.push("", ergebnis.fremdeingang ? `FREMDEINGANG: ja (${ergebnis.grund})` : "FREMDEINGANG: nein");
  return out.join("\n") + "\n";
}

/** Genau eines von `--issue <nr>` / `--pr <nr>` mit positiver Ganzzahl, sonst Fehler. */
export function parseArgs(argv) {
  const treffer = [];
  for (const flag of ["--issue", "--pr"]) {
    const i = argv.indexOf(flag);
    if (i >= 0) treffer.push([flag, argv[i + 1]]);
  }
  if (treffer.length !== 1 || argv.length !== 2) throw new Error("Aufruf: node scripts/fremdtext.mjs --issue <nr> | --pr <nr>");
  const [flag, wert] = treffer[0];
  if (!/^[1-9][0-9]*$/.test(wert ?? "")) throw new Error(`${flag} braucht eine positive Ganzzahl`);
  return { art: flag.slice(2), nr: Number(wert) };
}

/** `gh api --paginate --slurp` liefert eine Liste von Seiten; flach machen. */
export function flach(slurped) {
  return Array.isArray(slurped) ? slurped.flat() : [];
}

const mitArt = (art, liste) => liste.map((b) => ({ art, user: b.user, body: b.body, html_url: b.html_url, created_at: b.created_at }));

/** Holt die Daten über `gh api` (injizierbar) und liefert `{owner, kopf, eintrag, beitraege}`. */
export function lade({ art, nr }, gh) {
  const json = (args) => JSON.parse(gh(args));
  const liste = (pfad) => flach(json(["api", "--paginate", "--slurp", pfad]));
  const owner = json(["api", "repos/{owner}/{repo}"]).owner?.login;
  if (!owner) throw new Error("Repo-Owner nicht ermittelbar");
  if (art === "issue") {
    const eintrag = json(["api", `repos/{owner}/{repo}/issues/${nr}`]);
    if (eintrag.pull_request) throw new Error(`#${nr} ist ein PR, nutze --pr ${nr}`);
    return { owner, kopf: "Issue", eintrag, beitraege: mitArt("Kommentar", liste(`repos/{owner}/{repo}/issues/${nr}/comments?per_page=100`)) };
  }
  const eintrag = json(["api", `repos/{owner}/{repo}/pulls/${nr}`]);
  return {
    owner,
    kopf: "PR",
    eintrag,
    beitraege: [
      ...mitArt("Kommentar", liste(`repos/{owner}/{repo}/issues/${nr}/comments?per_page=100`)),
      ...mitArt("Review", liste(`repos/{owner}/{repo}/pulls/${nr}/reviews?per_page=100`)),
      ...mitArt("Review-Kommentar", liste(`repos/{owner}/{repo}/pulls/${nr}/comments?per_page=100`)),
    ],
  };
}

/** Exit-Code aus dem Ergebnis: 3 = Fremdeingang, 0 = vertraut. */
export const exitCodeFuer = (ergebnis) => (ergebnis.fremdeingang ? 3 : 0);

/** Ganzer Ablauf ohne Prozess-Seiteneffekte: `{code, out, err}`; jeder Fehler ist Exit 2 (fail-closed). */
export function pruefe(argv, gh) {
  try {
    const ziel = parseArgs(argv);
    const { owner, kopf, eintrag, beitraege } = lade(ziel, gh);
    const ergebnis = trenneFremdtext({ owner, art: kopf, eintrag, beitraege });
    return { code: exitCodeFuer(ergebnis), out: formatiere(ergebnis, eintrag, kopf), err: "" };
  } catch (e) {
    return { code: 2, out: "", err: `✖ fremdtext: ${e instanceof Error ? e.message : String(e)}\n` };
  }
}

function main(argv) {
  const { code, out, err } = pruefe(argv, (args) => ghText(args));
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
