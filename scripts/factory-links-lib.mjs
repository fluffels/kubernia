// Factory-Link-Bausteine (ADR 0022 F10, factory#130/factory#131/factory#167; Kern): pure Teile des Link-Wächters, geteilt von `check-factory-links.mjs` und `factory-sync.mjs`
// (ein Einstiegsskript importiert kein anderes, `einstieg-importe`). Nichts hier liest oder schreibt Dateien: Texte kommen über einen Leser, Ergebnisse als Plan.
import { besitzSpannen, einheitAusId, eolVon, normalisiereEol } from "./besitz-lib.mjs";
import { codeMaskiert, collectHeadingSlugs, entferneMarkup, externeLinkStellen, linkStellen, linkZiel, schnappschussBloecke, slugify, ueberschriftenStellen } from "./docs-gen/markdown.mjs";
import { factorySeite, factoryUrlTeile } from "./factory-seite.mjs";
import { globRegex } from "./pfad-glob.mjs";

export const INDEX_PFAD = ".factory/factory-links.json";

/** Zeile (1-basiert) einer Position im Text. */
const zeileVon = (md, pos) => md.slice(0, pos).split("\n").length;

/**
 * Pur: die Factory-Links (blob, tree, fremd) eines Markdown-Textes für das Repo `repo` (`owner/name`, Groß-/Kleinschreibung egal).
 * Stelle: `{ start, ende, zeile, url, form, ref, pfad, anker, refStart }`; Pfad und Anker sind dekodiert, Positionen gelten im Original.
 */
export function factoryLinkStellen(md, repo) {
  const stellen = [];
  for (const { start, ende, url } of externeLinkStellen(md)) {
    const k = factoryUrlTeile(url, repo);
    if (k) stellen.push({ start, ende, zeile: zeileVon(md, start), url, form: k.form, ref: k.ref, pfad: k.pfad, anker: k.anker, refStart: start + k.refOffset });
  }
  return stellen;
}

/** Zeilen (0-basiert) in den geschlossenen Schnappschuss-Blöcken (`schnappschussBloecke`; ein Start ohne Ende maskiert nichts, fail-closed); Marker in Code zählen nicht. */
function maskierteZeilen(text) {
  const aus = new Set();
  for (const [start, ende] of schnappschussBloecke(codeMaskiert(text).split("\n")).bloecke) for (let i = start; i <= ende; i++) aus.add(i);
  return aus;
}

/**
 * Alle erfassten Links im Umfang über einen Leser: `dateien` (repo-relative Pfade) und `lies(pfad)` (Text oder `null`). Ergebnis `{ datei, ...stelle }`,
 * in der Reihenfolge von `dateien`. `ausnahmen` sind Pfad-Globs (`factoryLinks.ausnahmen`), `einheiten` die Ids des Sync-Stands.
 */
export function sammleLinksAus({ dateien, lies }, { repo, einheiten = [], ausnahmen = [] }) {
  const besitz = einheiten.map(einheitAusId);
  const ausgenommen = ausnahmen.map(globRegex);
  const links = [];
  for (const datei of dateien) {
    if (ausgenommen.some((re) => re.test(datei))) continue;
    const text = lies(datei);
    if (text === null || text === undefined) continue;
    const aus = maskierteZeilen(text);
    const spannen = besitzSpannen(besitz, datei, text);
    for (const s of factoryLinkStellen(text, repo)) if (!aus.has(s.zeile - 1) && !spannen.some(([von, bis]) => s.start >= von && s.start <= bis)) links.push({ datei, ...s });
  }
  return links;
}

export const befund = (art, text, l) => ({ art, datei: l?.datei, zeile: l?.zeile, text });

/** Eine Befund-Zeile `datei:zeile: [art] text` (ohne Datei `[art] text`); einzige Quelle für Wächter und Sync. */
export const befundZeile = (b) => `${b.datei ? `${b.datei}:${b.zeile}: ` : ""}[${b.art}] ${b.text}`;

/** Pfad und Anker eines Links am Tag der Quelle: `pfad-tot` oder `anker-tot` als Befund, sonst `null`. */
export function zielBefund(l, leser) {
  const gibtEs = l.form === "tree" ? leser.pfade.some((p) => p.startsWith(`${l.pfad}/`)) : leser.pfade.includes(l.pfad);
  if (!gibtEs) return befund("pfad-tot", `${l.url}: ${l.pfad} gibt es am Tag nicht`, l);
  if (l.anker === "" || l.form !== "blob" || !l.pfad.endsWith(".md")) return null;
  return collectHeadingSlugs(leser.lies(l.pfad) ?? "").includes(l.anker) ? null : befund("anker-tot", `${l.url}: Anker #${l.anker} gibt es in ${l.pfad} am Tag nicht`, l);
}

/** Pur: den Text einer Datei mit allen Refs der übergebenen Links (alle aus dieser Datei) auf `tag` gesetzt; von hinten nach vorn, Zeilenenden bleiben, Links mit `ref === tag` bleiben. */
export function refsGesetzt(text, links, tag) {
  let neu = text;
  for (const l of [...links].filter((x) => x.ref !== tag).sort((a, b) => b.refStart - a.refStart)) neu = neu.slice(0, l.refStart) + tag + neu.slice(l.refStart + l.ref.length);
  return neu;
}

/** Index-Text: Schlüssel sortiert, je Pfad eine Zeile, abschließender Zeilenumbruch; ohne Ziele `"ziele": {}`. */
export function indexText({ repo, tag, commit }, links) {
  const ziele = new Map();
  for (const l of links) ziele.set(l.pfad, new Set([...(ziele.get(l.pfad) ?? []), l.anker]));
  const sortiert = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const zeilen = [...ziele.keys()].sort(sortiert).map((p) => `    ${JSON.stringify(p)}: ${JSON.stringify([...ziele.get(p)].sort(sortiert))}`);
  const kopf = `{\n  "repo": ${JSON.stringify(repo)},\n  "tag": ${JSON.stringify(tag)},\n  "commit": ${JSON.stringify(commit)},\n`;
  return zeilen.length === 0 ? `${kopf}  "ziele": {}\n}\n` : `${kopf}  "ziele": {\n${zeilen.join(",\n")}\n  }\n}\n`;
}

/**
 * Pur: Link-Plan auf einem Leser. Prüft jeden Link gegen den Baum des Tags (`leser`: `{ pfade, lies, vorladen }`; Befunde `form`, `pfad-tot`, `anker-tot`) und
 * setzt ohne Befund die Refs und den Index. Ergebnis `{ befunde, dateien, geschrieben, ziele, tag }`; `dateien` (Pfad → neuer Text) enthält nur Geändertes
 * (Index: nur wenn er sich CRLF-neutral ändert; Zeilenende der vorhandenen Datei bleibt), bei Befunden ist sie leer.
 */
export function planeFactoryLinks({ dateien, lies, repo, einheiten, ausnahmen, tag, commit, leser }) {
  const links = sammleLinksAus({ dateien, lies }, { repo, einheiten, ausnahmen });
  const echte = links.filter((l) => l.form !== "fremd");
  leser.vorladen(echte.filter((l) => l.anker !== "" && l.form === "blob" && l.pfad.endsWith(".md")).map((l) => l.pfad));
  const befunde = [
    ...links.filter((l) => l.form === "fremd").map((l) => befund("form", `${l.url}: keine geprüfte Form (erwartet blob oder tree, Ref, Pfad, optional Anker)`, l)),
    ...echte.map((l) => zielBefund(l, leser)).filter(Boolean),
  ];
  const ergebnis = { befunde, dateien: new Map(), geschrieben: echte.length, ziele: new Set(echte.map((l) => l.pfad)).size, tag };
  if (befunde.length > 0) return { ...ergebnis, geschrieben: 0, ziele: 0 };
  const jeDatei = new Map();
  for (const l of echte) jeDatei.set(l.datei, [...(jeDatei.get(l.datei) ?? []), l]);
  for (const [datei, liste] of jeDatei) {
    const text = lies(datei);
    const neu = refsGesetzt(text, liste, tag);
    if (neu !== text) ergebnis.dateien.set(datei, neu);
  }
  const alt = lies(INDEX_PFAD);
  const soll = indexText({ repo, tag, commit }, echte);
  if (alt === null || alt === undefined || normalisiereEol(alt) !== soll) {
    const eol = alt === null || alt === undefined ? "\n" : eolVon(alt);
    ergebnis.dateien.set(INDEX_PFAD, eol === "\n" ? soll : soll.replace(/\n/g, eol));
  }
  return ergebnis;
}

// ── Anker-Stubs (factory#132): Kern-Links auf Seiten außerhalb des Besitzes sind im Bezieher gedeckt ──

/** Eine Stub-Meldung: der Kern-Link (`quelle:zeile`) und die Soll-URL aus `factorySeite`. */
const stubText = (k, was, soll) => `${was} (Kern-Link ${k.quelle}:${k.zeile} → ${k.ziel}${k.anker ? `#${k.anker}` : ""}); Soll: \`Kern: [..](${soll})\``;

/** Pur: die zu deckenden Kern-Links der Markdown-Einheiten (`besitz`: Einheiten, `lies`): `{ quelle, zeile, ziel, anker }`, je (Quelle, Ziel, Anker) einmal an der ersten Stelle. Nur `.md`-Ziele ohne Einheit. */
export function kernLinkZiele({ besitz, lies }) {
  const kernPfade = new Set(besitz.map((e) => e.pfad));
  const quellen = [...kernPfade].filter((p) => p.endsWith(".md") && besitz.some((e) => e.pfad === p && e.schluessel === undefined));
  const gesehen = new Set();
  const ziele = [];
  for (const quelle of quellen) {
    const text = lies(quelle);
    if (text === null || text === undefined) continue;
    const spannen = besitzSpannen(besitz, quelle, text);
    for (const s of linkStellen(text)) {
      const pfad = s.path.replace(/\?.*$/, "");
      if (!pfad.endsWith(".md") || !spannen.some(([von, bis]) => s.start >= von && s.start <= bis)) continue;
      const ziel = linkZiel(quelle, pfad);
      const schluessel = `${quelle}\0${ziel}\0${s.anchor}`;
      if (kernPfade.has(ziel) || gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      ziele.push({ quelle, zeile: zeileVon(text, s.start), ziel, anker: s.anchor });
    }
  }
  return ziele;
}

/** Zeilenbereich `{ von, bis }` (0-basiert, `bis` ausgeschlossen) des Abschnitts mit dem Anker: ab der Überschrift bis zur nächsten gleicher oder höherer Ebene; `null` ohne Überschrift. */
function abschnitt(text, anker) {
  const hs = ueberschriftenStellen(text);
  const i = hs.findIndex((h) => h.slug === anker);
  if (i < 0) return null;
  const naechste = hs.slice(i + 1).find((h) => h.ebene <= hs[i].ebene);
  return { von: hs[i].zeile, bis: naechste ? naechste.zeile : Infinity };
}

/** Der Befund eines Kern-Links `k` oder `null`: `stub-ziel`, `stub-anker` oder `stub-link` (Factory-Link auf genau `pfad#anker` am Tag, im Abschnitt der Überschrift bzw. ohne Anker irgendwo in der Datei). */
function stubBefund(k, { lies, repo, tag }) {
  const text = lies(k.ziel);
  const soll = factorySeite({ pfad: k.ziel, anker: k.anker, repo, tag });
  if (text === null || text === undefined) return befund("stub-ziel", stubText(k, `${k.ziel} fehlt`, soll), { datei: k.quelle, zeile: k.zeile });
  const bereich = k.anker === "" ? { von: 0, bis: Infinity } : abschnitt(text, k.anker);
  if (!bereich) return befund("stub-anker", stubText(k, `keine Überschrift mit dem Anker #${k.anker} in ${k.ziel}`, soll), { datei: k.quelle, zeile: k.zeile });
  const gedeckt = sammleLinksAus({ dateien: [k.ziel], lies }, { repo }).some(
    (l) => l.form === "blob" && l.zeile - 1 >= bereich.von && l.zeile - 1 < bereich.bis && factorySeite({ pfad: l.pfad, anker: k.anker === "" ? "" : l.anker, repo, tag: l.ref }) === soll,
  );
  const ort = k.anker === "" ? "in der Datei" : `unter der Überschrift #${k.anker}`;
  return gedeckt ? null : befund("stub-link", stubText(k, `${k.ziel} trägt ${ort} keinen Factory-Link auf ${soll}`, soll), { datei: k.ziel, zeile: k.anker === "" ? 1 : bereich.von + 1 });
}

/**
 * Pur: Anker-Stubs der Markdown-Einheiten (`einheiten`: Ids des Sync-Stands). Jeder relative `.md`-Link einer Einheit (ganze Datei oder Block) auf ein Ziel ohne Einheit
 * muss auf eine vorhandene Datei zeigen; mit Anker trägt sie eine Überschrift mit gleichem Anker (roh verglichen) und darunter (bis zur nächsten Überschrift gleicher oder
 * höherer Ebene) einen Factory-Link auf genau `pfad#anker` am Tag `tag`, ohne Anker irgendwo in der Datei einen Factory-Link auf die Seite. Factory-Links in
 * Schnappschuss-Blöcken zählen nicht. Ergebnis `{ befunde, geprueft }` (`geprueft` = Zahl der Kern-Links nach Dedupe).
 */
export function stubBefunde({ lies, einheiten, repo, tag }) {
  const ziele = kernLinkZiele({ besitz: einheiten.map(einheitAusId), lies });
  return { befunde: ziele.map((k) => stubBefund(k, { lies, repo, tag })).filter(Boolean), geprueft: ziele.length };
}

// ── Anker-Stub-Seiten anlegen (factory#167): fehlende Kern-Link-Ziele bekommen beim Sync eine Seite aus Überschriften und Factory-Links ──

/** Slug-neutral: `[t](u)` wird `t`, Backticks und Inline-Markup-Zeichen entfallen (`slugify` streicht beides ohnehin, der Anker bleibt gleich). */
const schlichterText = (t) => entferneMarkup(t).trim();

/** Die aufzunehmenden Überschriften einer Tag-Seite: die erste Ebene-1-Überschrift, jede mit einem Kern-Anker als Slug und vor ihr alle früheren mit gleichem Basis-Slug (die `-1`-Suffixe bleiben so gleich). */
function stubUeberschriften(text, ankerSet) {
  const zeilen = text.split(/\r?\n/);
  const hs = ueberschriftenStellen(text).map((h) => ({ ...h, text: schlichterText(zeilen[h.zeile].replace(/^#{1,6}\s+/, "")) }));
  const basis = (h) => slugify(h.text);
  const nimm = new Set();
  const h1 = hs.findIndex((h) => h.ebene === 1);
  if (h1 >= 0) nimm.add(h1);
  hs.forEach((h, i) => {
    if (!ankerSet.has(h.slug)) return;
    hs.forEach((frueher, j) => {
      if (j <= i && basis(frueher) === basis(h)) nimm.add(j);
    });
  });
  return { ausgewaehlt: hs.filter((_, i) => nimm.has(i)), h1: h1 >= 0 ? hs[h1] : null, alle: hs };
}

/** Der feste Anfang des Hinweises, den jede Stub-Seite trägt (Erkennungszeichen, Quelle der Form: `stubSeite`). */
const STUB_HINWEIS = "Anker-Stub: Der Text dieser Seite steht im Factory-Repo;";

/** Ist `text` eine von `planeAnkerStubs` angelegte Stub-Seite (Hinweis am Zeilenanfang)? */
export function istAnkerStub(text) {
  return text.split("\n").some((z) => z.startsWith(STUB_HINWEIS)); // CRLF stört nicht: nur der Zeilenanfang zählt
}

/**
 * Ist `text` ein reiner Stub (factory#166): ausschließlich Sync-Ausgabe von `planeAnkerStubs`, also genau eine Hinweiszeile, sonst nur Überschriften (`#` bis `######`) und Kern-Zeilen
 * (`Kern: [..](https://..)`), und auf jede Überschrift außer der ersten Ebene-1-Überschrift folgt als nächste nicht leere Zeile eine Kern-Zeile. CRLF-neutral.
 * Grenze: jede andere Zeile (Projektzeile, Absatz, weitere Hinweiszeile) macht die Seite zur Bezieher-Seite, die der Sync nie anfasst.
 */
export function istReinerStub(text) {
  const zeilen = normalisiereEol(text).split("\n").filter((z) => z.trim() !== "");
  const kernZeile = (z) => /^Kern: \[[^\]\n]*\]\(https:\/\/[^)\s]+\)$/.test(z);
  if (zeilen.filter((z) => z.startsWith(STUB_HINWEIS)).length !== 1) return false;
  let ersteH1 = true;
  for (const [i, z] of zeilen.entries()) {
    if (z.startsWith(STUB_HINWEIS) || kernZeile(z)) continue;
    if (!/^#{1,6} /.test(z)) return false;
    if (ersteH1 && z.startsWith("# ")) {
      ersteH1 = false;
      continue;
    }
    if (!kernZeile(zeilen[i + 1] ?? "")) return false;
  }
  return true;
}

/** Der Text einer Stub-Seite (Zeilenende \n): Überschriften der Tag-Seite, jede mit einem Factory-Link auf ziel#slug am Tag (bei Kern-Ankern `anker`), vorn der Hinweis samt Seitenlink. Ergebnis { text, links }. */
function stubSeite(ziel, { ausgewaehlt, h1 }, anker, { repo, tag }) {
  const url = (a) => factorySeite({ pfad: ziel, anker: a, repo, tag });
  const einleitung = `${STUB_HINWEIS} hier stehen nur die Überschriften, auf die der Kern verlinkt. Kern: [${ziel}](${url("")})`;
  const ankerLink = (h) => `Kern: [${ziel}#${h.slug}](${url(h.slug)})`;
  const bloecke = h1 ? [] : [einleitung];
  let links = 1;
  for (const h of ausgewaehlt) {
    const eigene = h === h1 ? [einleitung] : [];
    if (h !== h1 || anker.has(h.slug)) {
      eigene.push(ankerLink(h));
      links++;
    }
    bloecke.push(`${"#".repeat(h.ebene)} ${h.text}`, ...eigene);
  }
  return { text: `${bloecke.join("\n\n")}\n`, links };
}

/**
 * Pur: legt zu jedem Kern-Link-Ziel, das es nicht gibt (`lies(ziel)` ist `null`, Ziel ohne Einheit), eine Stub-Seite an (factory#167): die erste Ebene-1-Überschrift und jede Überschrift,
 * auf die der Kern verlinkt (samt früherer gleichnamiger), je mit Factory-Link auf `ziel#anker` am Tag `tag`; der Text kommt vom Leser des Tags. Eine vorhandene Seite wird nie angefasst, außer sie ist ein reiner Stub (`reineStubs`, factory#166): die erneuert der Sync aus dem Tag (gleiche Form wie angelegt, ohne Kern-Link nur Titel und Hinweis).
 * `vorhanden(pfad)` (Vorgabe: `lies` liefert Text) ist die Frage, ob das Ziel die Seite schon hat; der Sync fragt auch nach Symlinks, die `lies` als `null` meldet, damit nie über einen Symlink geschrieben wird.
 * Ergebnis `{ dateien: Map<pfad, text>, erneuert: Set<pfad>, hinweise, ueberschriften, links }` (`erneuert` = die Pfade aus `reineStubs`, der Rest ist angelegt; `ueberschriften` und `links` zählen nur die angelegten); ein Ziel oder Anker, den es am Tag nicht gibt, ist ein Hinweis (`check:factorylinks` meldet es als `stub-ziel`/`stub-anker`).
 */
export function planeAnkerStubs({ lies, einheiten, repo, tag, leser, ausnahmen = [], reineStubs = [], vorhanden = (pfad) => lies(pfad) != null }) {
  const ausgenommen = ausnahmen.map(globRegex);
  const frei = (ziel) => !ausgenommen.some((re) => re.test(ziel));
  const offen = kernLinkZiele({ besitz: einheiten.map(einheitAusId), lies }).filter((k) => (!vorhanden(k.ziel) || reineStubs.includes(k.ziel)) && frei(k.ziel));
  const jeZiel = new Map(reineStubs.filter(frei).map((p) => [p, new Set()]));
  for (const k of offen) jeZiel.set(k.ziel, new Set([...(jeZiel.get(k.ziel) ?? []), k.anker]));
  leser.vorladen([...jeZiel.keys()].filter((p) => leser.pfade.includes(p)));
  const ergebnis = { dateien: new Map(), erneuert: new Set(), hinweise: [], ueberschriften: 0, links: 0 };
  for (const [ziel, anker] of [...jeZiel].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const text = leser.pfade.includes(ziel) ? leser.lies(ziel) : null;
    if (text === null || text === undefined) {
      ergebnis.hinweise.push(`Anker-Stub: ${ziel} gibt es am Tag ${tag} nicht, keine Stub-Seite (check:factorylinks meldet stub-ziel)`);
      continue;
    }
    const { ausgewaehlt, h1, alle } = stubUeberschriften(text, anker);
    for (const a of anker) if (a !== "" && !alle.some((h) => h.slug === a)) ergebnis.hinweise.push(`Anker-Stub: ${ziel} hat am Tag ${tag} keine Überschrift #${a} (check:factorylinks meldet stub-anker)`);
    const s = stubSeite(ziel, { ausgewaehlt, h1 }, anker, { repo, tag });
    ergebnis.dateien.set(ziel, s.text);
    if (reineStubs.includes(ziel)) ergebnis.erneuert.add(ziel);
    if (reineStubs.includes(ziel)) continue; // erneuert: zählt nicht zu den angelegten Seiten (Zahlen im Sync-Hinweis)
    ergebnis.ueberschriften += ausgewaehlt.length;
    ergebnis.links += s.links;
  }
  return ergebnis;
}
