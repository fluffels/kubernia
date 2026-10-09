// Kein Shebang: Bibliothek, importiert von scripts/subagent-laufzeit.mjs und getestet über test/subagent-laufzeit.test.ts.
/**
 * Patch-Zugriffe eines Lens-Laufs (#1582): wie viel vom vollen Patch (`Patch:`) und vom Delta-Patch (`Delta-Patch:`) hat der Lauf gelesen?
 *
 * Quelle sind nur die Transkriptzeilen und der Prompt. Ein Read gilt mit dem Bereich aus `toolUseResult.file` (`startLine`, `numLines`,
 * `totalLines`), ohne dieses Feld mit offset/limit aus der Eingabe (Standard-Limit 2000, Gesamtzahl unbekannt). Ein Grep auf den Patch
 * ist gezielt (zählt als Zugriff, nicht als Zeilen). Ein Shell-Aufruf ist komplett, wenn `cat`/`Get-Content`/`type` den Patch ohne
 * Begrenzung ausgibt, sonst gezielt (`sed -n`, `head`, `tail`, `grep`, `Select-Object -First`/`-Last`, `-TotalCount`, `-Tail`).
 * `komplett` heißt: Anteil der gelesenen Zeilen (Vereinigung) ≥ 0,9, ein unbegrenzter `cat`, oder ein Read ohne offset/limit bei unbekannter Länge.
 * Pur, ohne IO.
 */

export const KOMPLETT_AB = 0.9;
const STANDARD_LIMIT = 2000;

const norm = (p) => String(p ?? "").replace(/\\/g, "/").toLowerCase();
const basename = (p) => norm(p).split("/").pop() ?? "";
const GEZIELT = /\b(?:sed|head|tail|grep|rg|awk)\b|Select-Object|Select-String|-TotalCount|-Tail|-First|-Last/i;
const VOLLLESER = /(?:^|[\s;&|(])(?:cat|type|Get-Content|gc)\s/i;

/** Pfade aus dem Prompt: `Patch: <pfad>` (voll) und `Delta-Patch: <pfad>`, jeweils als Basename. */
export function patchPfade(prompt) {
  // Nur Pfade auf eine .patch-Datei: Fließtext wie "Patch:`" oder "Delta-Patch: ein" im Auftrag zählt nicht.
  // Ohne Label (Workflow-Prompt: "Patch-Datei bereit … :\n  <pfad>") gilt der erste Pfad der Form kq-<nr>-r<n>[-delta].patch.
  const voll = /(?<![\w-])Patch:\s*(\S+?\.patch)(?![\w-])/i.exec(prompt)?.[1] ?? /\S*kq-\d+-r\d+\.patch(?![\w-])/i.exec(prompt)?.[0] ?? null;
  const delta = /Delta-Patch:\s*(\S+?\.patch)(?![\w-])/i.exec(prompt)?.[1] ?? /\S*kq-\d+-r\d+-delta\.patch(?![\w-])/i.exec(prompt)?.[0] ?? null;
  // Ein Delta-Pfad im Feld "Patch:" (falsch gespawnt) ist der Delta-Patch, kein voller.
  if (voll && !delta && /-delta\.patch$/i.test(voll)) return { voll: null, delta: basename(voll), vollPfad: null };
  return { voll: voll ? basename(voll) : null, delta: delta ? basename(delta) : null, vollPfad: voll };
}

function neu() {
  return { bereiche: [], gesamt: null, zugriffe: 0, catKomplett: false, readUnbegrenzt: false };
}

function lesen(z, bereich, gesamt) {
  z.zugriffe += 1;
  if (bereich) z.bereiche.push(bereich);
  if (Number.isFinite(gesamt)) z.gesamt = Math.max(z.gesamt ?? 0, gesamt);
}

function vereinigung(bereiche) {
  const s = [...bereiche].sort((a, b) => a[0] - b[0]);
  let summe = 0;
  let cur = null;
  for (const [a, b] of s) {
    if (!cur || a > cur[1] + 1) {
      if (cur) summe += cur[1] - cur[0] + 1;
      cur = [a, b];
    } else if (b > cur[1]) cur[1] = b;
  }
  return summe + (cur ? cur[1] - cur[0] + 1 : 0);
}

function fertig(z) {
  const zeilen = vereinigung(z.bereiche);
  const anteil = z.gesamt ? Math.min(1, zeilen / z.gesamt) : null;
  const komplett = z.catKomplett || (anteil !== null && anteil >= KOMPLETT_AB) || (z.readUnbegrenzt && z.gesamt === null);
  return { zugriffe: z.zugriffe, zeilen, gesamt: z.gesamt, anteil, komplett };
}

/** Ein Read: Bereich aus dem Ergebnis, sonst aus offset/limit der Eingabe. */
function readAuf(z, eingabe, ergebnis) {
  const f = ergebnis?.file;
  if (f && Number.isFinite(f.numLines) && Number.isFinite(f.startLine)) {
    lesen(z, [f.startLine, f.startLine + f.numLines - 1], f.totalLines);
    return;
  }
  const start = Number.isFinite(eingabe?.offset) ? Math.max(1, eingabe.offset) : 1;
  const limit = Number.isFinite(eingabe?.limit) ? eingabe.limit : STANDARD_LIMIT;
  if (eingabe?.offset === undefined && eingabe?.limit === undefined) z.readUnbegrenzt = true;
  lesen(z, [start, start + limit - 1], null);
}

/**
 * Patch-Kennzahlen aus Prompt und Transkriptzeilen; `null` ohne `Patch:`/`Delta-Patch:` im Prompt.
 * @returns {{ ticket: number|null, runde: number|null, voll: object, delta: object|null } | null}
 */
export function patchAus(prompt, zeilen) {
  const p = patchPfade(prompt);
  if (!p.voll && !p.delta) return null;
  const voll = neu();
  const delta = neu();
  const ziel = (text) => {
    const b = basename(text);
    if (p.delta && b === p.delta) return delta;
    if (p.voll && b === p.voll) return voll;
    return null;
  };
  const aufrufe = new Map();
  for (const r of zeilen) {
    if (!Array.isArray(r?.message?.content)) continue;
    for (const c of r.message.content) {
      if (r.type === "assistant" && c?.type === "tool_use" && c.id) aufrufe.set(c.id, c);
      else if (r.type === "user" && c?.type === "tool_result" && !c.is_error && aufrufe.has(c.tool_use_id)) {
        const a = aufrufe.get(c.tool_use_id);
        const e = a.input ?? {};
        if (a.name === "Read") {
          const z = ziel(e.file_path);
          if (z) readAuf(z, e, r.toolUseResult);
        } else if (a.name === "Grep") {
          const z = ziel(e.path);
          if (z) lesen(z, null, null);
        } else if (a.name === "Bash" || a.name === "PowerShell") {
          const cmd = String(e.command ?? "");
          for (const [name, z] of [[p.delta, delta], [p.voll, voll]]) {
            if (!name || !norm(cmd).includes(name)) continue;
            lesen(z, null, null);
            if (VOLLLESER.test(cmd) && !GEZIELT.test(cmd)) z.catKomplett = true;
          }
        }
      }
    }
  }
  const m = /kq-(\d+)-r(\d+)/.exec(p.voll ?? p.delta ?? "");
  return { ticket: m ? Number(m[1]) : null, runde: m ? Number(m[2]) : null, voll: fertig(voll), delta: p.delta ? fertig(delta) : null };
}
