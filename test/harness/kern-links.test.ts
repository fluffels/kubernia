/* Kern-Link-Wächter (#1860, ADR 0022 F10): Markdown-Einheiten des Kerns dürfen nur auf Dateien verlinken, die selbst zum Kern gehören.
 * Ein Link auf eine Seite außerhalb des Besitz-Manifests `.factory/besitz.json` ist im Zielprojekt tot, sobald der Kern verteilt ist.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Geprüft: Markdown-Links `](ziel.md)` bzw. `](ziel.md#anker)` in den Markdown-Einheiten (Datei, Block zwischen Markern) der Manifest-Einträge,
 * die verteilt werden (`wirdVerteilt`). Ein Ziel ist in Ordnung, wenn es selbst ein verteilter Manifest-Pfad ist. Jedes andere
 * (Quelle, Ziel)-Paar steht in der Baseline `kern-links-baseline.json`, die nur sinken darf: ein neues Paar ist rot („Ziel ins Manifest (F10)
 * oder Link entfernen“), ein verschwundenes Paar ebenfalls („Eintrag streichen“).
 *
 * Bewusste Grenze (Link-Hülle): nicht geprüft werden Backtick-Pfade und Pfade im Fließtext, http(s)- und andere Schema-Links, reine
 * Anker-Links, Links in Code-Fences und in Inline-Code, Links auf Nicht-Markdown-Dateien (Skripte, JSON) und Link-Referenz-Definitionen
 * (`[x]: ziel.md`). Nicht-Markdown-Einheiten des Manifests werden nicht gelesen. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";

interface Eintrag {
  pfad: string;
  block?: string;
  schluessel?: string;
  ring: string;
  quelle: string;
}
interface BesitzLib {
  einheitText: (e: Eintrag, text: string) => string | null;
  wirdVerteilt: (e: Eintrag) => boolean;
}
const { einheitText, wirdVerteilt } = rawBesitz as unknown as BesitzLib;

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const MANIFEST = ".factory/besitz.json";
const BASELINE = "test/harness/kern-links-baseline.json";

const lesen = (pfad: string): string | null => (existsSync(WURZEL + pfad) ? readFileSync(WURZEL + pfad, "utf8") : null);

/** Text ohne Code-Fences (``` und ~~~) und ohne Inline-Code; Zeilenanzahl bleibt irrelevant. */
export function ohneCode(text: string): string {
  const zeilen: string[] = [];
  let zaun: string | null = null;
  for (const zeile of text.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^\s*(`{3,}|~{3,})/.exec(zeile);
    if (zaun === null) {
      if (m?.[1] !== undefined) zaun = m[1][0] ?? null;
      else zeilen.push(zeile.replace(/`[^`\n]*`/g, ""));
    } else if (m?.[1] !== undefined && m[1][0] === zaun) zaun = null;
  }
  return zeilen.join("\n");
}

/** Repo-relative Markdown-Ziele der Links in `text` einer Datei `quelle` (normalisiert, ohne Anker, dedupliziert). Schema-Links und reine Anker bleiben außen vor. */
export function markdownZiele(quelle: string, text: string): string[] {
  const ziele = new Set<string>();
  for (const m of ohneCode(text).matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const roh = m[1] ?? "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(roh) || roh.startsWith("#")) continue;
    const ohneAnker = roh.split(/[#?]/)[0] ?? "";
    if (!ohneAnker.toLowerCase().endsWith(".md")) continue;
    const pfad = ohneAnker.startsWith("/") ? posix.normalize(ohneAnker.slice(1)) : posix.normalize(posix.join(posix.dirname(quelle), ohneAnker));
    ziele.add(pfad);
  }
  return [...ziele];
}

/** Die Link-Paare `quelle -> ziel`, deren Ziel kein verteilter Manifest-Pfad ist (sortiert, ohne Doppelte). */
export function fremdeLinks(eintraege: Eintrag[], lies: (pfad: string) => string | null): string[] {
  const verteilt = eintraege.filter(wirdVerteilt);
  const kern = new Set(verteilt.map((e) => e.pfad));
  const paare = new Set<string>();
  for (const e of verteilt) {
    if (!e.pfad.toLowerCase().endsWith(".md") || e.schluessel !== undefined) continue;
    const text = lies(e.pfad);
    const einheit = text === null ? null : einheitText(e, text);
    if (einheit === null) continue;
    for (const ziel of markdownZiele(e.pfad, einheit)) if (!kern.has(ziel)) paare.add(`${e.pfad} -> ${ziel}`);
  }
  return [...paare].sort();
}

/** Meldungen: neue Paare (nicht in der Baseline) und verschwundene Paare (nur noch in der Baseline). */
export function vergleiche(ist: string[], baseline: string[]): string[] {
  const out: string[] = [];
  const bekannt = new Set(baseline);
  const aktuell = new Set(ist);
  for (const p of ist) if (!bekannt.has(p)) out.push(`${p}: Link auf eine Datei außerhalb des Kerns. Fix: Ziel ins Besitz-Manifest aufnehmen (F10) oder den Link entfernen`);
  for (const p of baseline) if (!aktuell.has(p)) out.push(`${p}: steht in der Baseline, der Link existiert nicht mehr. Fix: Eintrag aus ${BASELINE} streichen`);
  return out;
}

const manifest = JSON.parse(lesen(MANIFEST) ?? "{}") as { eintraege: Eintrag[] };
const baselinePaare = (JSON.parse(lesen(BASELINE) ?? "{}") as { paare?: string[] }).paare ?? [];

describe("Kern-Links (#1860)", () => {
  test("jeder Link einer Kern-Einheit führt in den Kern oder steht in der Baseline; die Baseline kennt nur noch echte Paare", () => {
    assert.deepEqual(vergleiche(fremdeLinks(manifest.eintraege, lesen), baselinePaare), []);
  });

  test("die Baseline ist sortiert und ohne Doppelte (ein Paar, eine Zeile)", () => {
    assert.deepEqual(baselinePaare, [...new Set(baselinePaare)].sort());
  });

  describe("markdownZiele", () => {
    test("löst relative Ziele gegen die Quelle auf, schneidet Anker und Titel ab, normalisiert ../", () => {
      const t = "[a](adr/0014.md#x) [b](../AGENTS.md) [c](./k.md \"Titel\") [d](/docs/w.md)";
      assert.deepEqual(markdownZiele("docs/sub/q.md", t), ["docs/sub/adr/0014.md", "docs/AGENTS.md", "docs/sub/k.md", "docs/w.md"]);
    });
    test("http(s), mailto, reine Anker und Nicht-Markdown-Ziele zählen nicht", () => {
      const t = "[a](https://x.de/a.md) [b](mailto:a@b.md) [c](#abschnitt) [d](skript.mjs) [e](bild.png#a.md)";
      assert.deepEqual(markdownZiele("docs/q.md", t), []);
    });
    test("Links in Code-Fences (``` und ~~~) und in Inline-Code zählen nicht, danach geht es normal weiter", () => {
      const t = "```\n[a](a.md)\n```\n`[b](b.md)` text\n~~~\n[c](c.md)\n~~~\n[d](d.md)";
      assert.deepEqual(markdownZiele("q.md", t), ["d.md"]);
    });
    test("ein längerer Zaun wird nur von gleichem Zeichen beendet; ein ~~~ in einem ```-Zaun schließt nicht", () => {
      const t = "```\n~~~\n[a](a.md)\n```\n[b](b.md)";
      assert.deepEqual(markdownZiele("q.md", t), ["b.md"]);
    });
    test("doppelte Ziele erscheinen einmal; Backtick-Pfade und Fließtext sind keine Links (bewusste Grenze)", () => {
      assert.deepEqual(markdownZiele("q.md", "[a](a.md) [b](a.md#z) `docs/x.md` siehe docs/y.md"), ["a.md"]);
    });
    test("CRLF-Text liefert dieselben Ziele wie LF", () => {
      assert.deepEqual(markdownZiele("q.md", "```\r\n[a](a.md)\r\n```\r\n[b](b.md)\r\n"), ["b.md"]);
    });
  });

  describe("fremdeLinks", () => {
    const e = (pfad: string, extra: Partial<Eintrag> = {}): Eintrag => ({ pfad, ring: "kern", quelle: "t", ...extra });
    const dateien: Record<string, string> = {
      "docs/a.md": "[kern](b.md) [fremd](x.md) [fremd2](x.md#z)",
      "docs/b.md": "[zurück](a.md)",
      "docs/blk.md": "vor [außen](ausser.md)\n<!-- factory-besitz:start k -->\n[innen](innen.md)\n<!-- factory-besitz:ende k -->",
      "docs/nurfactory.md": "[f](x.md)",
      "docs/skript.mjs": "[nicht](geprueft.md)",
    };
    const lies = (p: string): string | null => dateien[p] ?? null;

    test("ein Link auf einen Manifest-Pfad ist in Ordnung, einer daneben ist ein Paar (ohne Doppelte)", () => {
      assert.deepEqual(fremdeLinks([e("docs/a.md"), e("docs/b.md")], lies), ["docs/a.md -> docs/x.md"]);
    });
    test("ein Ziel nur im Ring der Factory (wird nicht verteilt) zählt als außerhalb", () => {
      const nurFactory = rawBesitz as unknown as { NUR_FACTORY: string[] };
      const ring = nurFactory.NUR_FACTORY[0];
      assert.ok(ring, "NUR_FACTORY ist leer: der Test braucht einen nicht verteilten Ring");
      assert.deepEqual(fremdeLinks([e("docs/b.md"), e("docs/a.md", { ring })], lies), ["docs/b.md -> docs/a.md"]);
      assert.deepEqual(fremdeLinks([e("docs/a.md"), e("docs/b.md", { ring })], lies), ["docs/a.md -> docs/b.md", "docs/a.md -> docs/x.md"]);
    });
    test("nur der Block zwischen den Markern zählt; Nicht-Markdown, JSON-Schlüssel und fehlende Dateien werden übersprungen", () => {
      const eintraege = [e("docs/blk.md", { block: "k" }), e("docs/skript.mjs"), e("docs/fehlt.md"), e("docs/a.md", { schluessel: "s" })];
      assert.deepEqual(fremdeLinks(eintraege, lies), ["docs/blk.md -> docs/innen.md"]);
    });
  });

  describe("vergleiche", () => {
    test("gleiche Mengen: keine Meldung", () => {
      assert.deepEqual(vergleiche(["a -> b"], ["a -> b"]), []);
      assert.deepEqual(vergleiche([], []), []);
    });
    test("ein neues Paar ist rot und nennt den Fix (Ziel ins Manifest oder Link entfernen)", () => {
      const m = vergleiche(["a -> b", "a -> c"], ["a -> b"]);
      assert.equal(m.length, 1);
      assert.match(m[0] ?? "", /^a -> c: .*Besitz-Manifest aufnehmen \(F10\) oder den Link entfernen/);
    });
    test("ein verschwundenes Paar ist rot und verlangt, den Eintrag zu streichen", () => {
      const m = vergleiche(["a -> b"], ["a -> b", "a -> c"]);
      assert.equal(m.length, 1);
      assert.match(m[0] ?? "", /^a -> c: .*Eintrag aus test\/harness\/kern-links-baseline\.json streichen/);
    });
  });
});
