// Langfuse-Zugangsdaten (#1663 H1): aus Umgebung, `~/.config/agent-secrets.env`, Plugin-Optionen der User-Settings und `~/.langfuse-secret`.
// Geteilt von Hook-Einstieg (scripts/langfuse-abgleich-hook.mjs) und Vorbedingung (scripts/langfuse-vorbedingung.mjs); Einstiegsskripte importieren nicht
// voneinander, darum eine Bibliothek. Nur Builtins.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ZUGANGSNAMEN = ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_BASE_URL"];

/** Die drei Zugangsnamen aus dem Text einer `KEY=VALUE`-Datei (optional `export `, optional Anführungszeichen); alles andere wird ignoriert. */
export function leseZugang(text) {
  const out = {};
  for (const zeile of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(zeile);
    if (!m || !ZUGANGSNAMEN.includes(m[1])) continue;
    const roh = m[2];
    out[m[1]] = /^(["']).*\1$/.test(roh) && roh.length >= 2 ? roh.slice(1, -1) : roh;
  }
  return out;
}

/** Secret-Key aus `~/.langfuse-secret`: die erste nicht leere Zeile, roh (nur der Key) oder als `LANGFUSE_SECRET_KEY=…`; sonst `undefined`. */
export function leseSecretDatei(text) {
  const zeile = String(text).split(/\r?\n/).map((z) => z.trim()).find((z) => z !== "" && !z.startsWith("#"));
  if (!zeile) return undefined;
  const benannt = leseZugang(zeile).LANGFUSE_SECRET_KEY;
  if (benannt) return benannt;
  return zeile.includes("=") ? undefined : zeile;
}

/** Öffentlicher Key und Basis-URL aus den Plugin-Optionen der User-Settings (`pluginConfigs.<…langfuse…>.options`); kaputtes JSON: leer. */
export function lesePluginOptionen(text) {
  const out = {};
  try {
    const configs = JSON.parse(text)?.pluginConfigs ?? {};
    for (const [name, c] of Object.entries(configs)) {
      if (!/langfuse/i.test(name)) continue;
      for (const k of ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_BASE_URL"]) if (typeof c?.options?.[k] === "string" && c.options[k]) out[k] ??= c.options[k];
    }
  } catch {
    // kein JSON: nichts
  }
  return out;
}

/**
 * Umgebung des Kindes: fehlende Zugangsnamen kommen aus `~/.config/agent-secrets.env` (optional), den Plugin-Optionen in `~/.claude/settings.json`
 * (öffentlicher Key, URL) und `~/.langfuse-secret` (Secret-Key); ein Projekt-Hook sieht den Secret-Key sonst nicht. Die Umgebung hat Vorrang vor allem.
 */
export function kindEnv(env, home, lies = (p) => readFileSync(p, "utf8")) {
  const versuche = (pfad, f) => {
    try {
      return f(lies(pfad));
    } catch {
      return {}; // keine oder kaputte Datei: ohne diese Quelle weiter
    }
  };
  const quellen = [
    versuche(join(home, ".config", "agent-secrets.env"), leseZugang),
    versuche(join(home, ".claude", "settings.json"), lesePluginOptionen),
    versuche(join(home, ".langfuse-secret"), (t) => ({ LANGFUSE_SECRET_KEY: leseSecretDatei(t) })),
  ];
  const out = { ...env };
  for (const name of ZUGANGSNAMEN) if (!out[name]) out[name] = quellen.map((q) => q[name]).find(Boolean) ?? out[name];
  for (const name of ZUGANGSNAMEN) if (out[name] === undefined) delete out[name];
  return out;
}
