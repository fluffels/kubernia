# CLAUDE.md – Brücke zur Arbeitsanweisung

@AGENTS.md

> ⬆️ **Die Zeile darüber ist kein Verweis, sondern ein Import (#992).** Sie zieht die SSOT [AGENTS.md](AGENTS.md) verlässlich in jede Claude-Code-Session; wer den `@`-Import nicht auswertet (andere Tools, Mensch), folgt demselben Link — **ohne AGENTS.md gelesen zu haben, fängst du nicht an.** Bewacht von [`test/claude-bridge.test.ts`](test/claude-bridge.test.ts). Diese Datei trägt **keine eigenen Regeln**; sie entfällt ganz, sobald Claude Code AGENTS.md nativ lädt (#1078).

**Nachschlage-Referenz (on-demand, nicht in jeder Session geladen, #1078):**

- [🛠️ Befehle](docs/referenz/befehle.md) — alle `npm run`-Kommandos + Erste-Minute-Mechanik
- [🗺️ Repo-Landkarte](docs/referenz/repo-landkarte.md) — Subsystem → Schicht → Tiefendoc
- [🧭 Schichtregeln](docs/referenz/schichtregeln.md) — was du wo importieren darfst (`check:arch`)
- [📚 Anlaufstellen](docs/referenz/anlaufstellen.md) — wo welche Doku liegt
