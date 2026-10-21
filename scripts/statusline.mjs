#!/usr/bin/env node
/**
 * Statusline-Weiche (#1358): Claude Code startet dieses Skript als `statusLine` und übergibt den Zustand als JSON auf stdin.
 * 1) legt `rate_limits` als Snapshot im OS-Temp ab (kontoweit, für Budget-Pacing, docs/model-routing.md §6);
 * 2) reicht die persönliche Statusline aus `~/.claude/settings.json` unverändert durch (die Projekt-Einstellung verdrängt sie sonst).
 * Wirft nie und endet immer mit Exit 0: eine kaputte Statusline darf keine Session stören.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ausStatusline, liesSnapshot, schreibeSnapshot } from "./budget-lib.mjs";
import { umgebungsWert } from "./projekt-config-lib.mjs";

/** Shell wie Claude Code: unter Windows Git Bash, sonst die Standard-Shell. */
function shellArgs(kommando) {
  if (process.platform !== "win32") return { datei: "/bin/sh", args: ["-c", kommando] };
  const kandidaten = [process.env.CLAUDE_CODE_GIT_BASH_PATH, "C:\\Program Files\\Git\\bin\\bash.exe"].filter(Boolean);
  const bash = kandidaten.find((k) => existsSync(k));
  return bash ? { datei: bash, args: ["-c", kommando] } : { datei: kommando, args: [], shell: true };
}

try {
  let roh = "";
  try {
    roh = readFileSync(0, "utf8");
  } catch {
    /* kein stdin: leer weiterreichen */
  }
  try {
    const snapshot = ausStatusline(JSON.parse(roh));
    // Ein Teil-Snapshot ohne 7-Tage-Fenster ersetzt keinen vorhandenen mit Wochenstand (z.B. aus der Probe).
    if (snapshot && (snapshot.sevenDay || !liesSnapshot().snapshot?.sevenDay)) schreibeSnapshot(snapshot);
  } catch {
    /* kein JSON oder nicht schreibbar: nur durchreichen */
  }
  if (umgebungsWert(process.env, "FACTORY_STATUSLINE_DURCHREICHEN") !== "1") {
    try {
      const settings = umgebungsWert(process.env, "FACTORY_USER_SETTINGS") || join(homedir(), ".claude", "settings.json");
      const kommando = JSON.parse(readFileSync(settings, "utf8"))?.statusLine?.command;
      if (typeof kommando === "string" && kommando.trim()) {
        const { datei, args, shell } = shellArgs(kommando);
        const r = spawnSync(datei, args, {
          input: roh,
          timeout: 5000,
          shell,
          env: { ...process.env, FACTORY_STATUSLINE_DURCHREICHEN: "1" },
        });
        if (r.stdout?.length) process.stdout.write(r.stdout);
      }
    } catch {
      /* keine persönliche Statusline */
    }
  }
} catch {
  /* nie werfen */
}
process.exit(0);
