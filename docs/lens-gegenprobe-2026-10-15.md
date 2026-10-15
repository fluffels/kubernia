# Lens-Gegenprobe 2026-10-15: `omitClaudeMd: true` für die Lens (#1568)

> 📸 **Momentaufnahme vom 2026-10-15 — wird nicht aktualisiert** ([Lebenszyklus-Regel](referenz/doku-vorlagen.md#schnappschuss-analyse-audit-review)).
>
> Wiederholung der [Lens-Gegenprobe vom 2026-10-09](lens-gegenprobe-2026-10-09.md) mit anderer Frage: nicht das Modell, sondern die Kontextdateien (`AGENTS.md` und die globale Datei des Nutzers) im Lens-Subagenten. Die gültige Entscheidung steht in [model-routing.md › Lens-Kostenstruktur](model-routing.md#lens-kostenstruktur-1582) (a), hier Regel, Aufbau und Rohwerte.

**Frage.** Spart `omitClaudeMd: true` (Ersparnis 8 bis 21 % je Lens laut Messung #1582, T zwischen 6,9k und 16k Tokens) Kosten, ohne dass die Lens echte Blocker verpasst?

**Entscheidungsregel (vor den Hauptläufen festgelegt, mit diesem Commit).** Arm A ist die aktuelle `kubernia-lens` (mit Kontextdateien), Arm B dieselbe Definition mit `omitClaudeMd: true` unter dem Namen `kubernia-lens-ohne-kontext` (nur untracked im Experiment-Worktree). Beide Arme laufen frisch (die Lens-Definition hat sich seit dem 2026-10-09 geändert, #1582) auf den 8 Patches der Ledger vom 2026-10-09 (Prompts bytegleich aus dem Transkript der damaligen Opus-neu-Läufe, `datei` dort; Hash des ersten User-Eintrags im Subagenten-Transkript belegt es). Es gibt **eine** Agent-Definition für alle Brillen, B gilt darum nur, wenn **jede** gelaufene Brille besteht:

1. **Kriterium 1:** B verpasst keinen echten Blocker, den A in derselben Brille und auf demselben Patch findet.
2. **Kriterium 2:** die Falsch-Blocker von B liegen höchstens bei A plus 1 (summiert über die Patches der Brille).
3. **Frühstopp:** beim ersten Verpasser einer Brille laufen deren übrige Patches nicht mehr; die Brille hat nicht bestanden und damit B insgesamt nicht.

**Deckel** 25 $ (aufgezeichnet, `total_cost_usd` der Headless-Läufe samt Orchestrator und Richter). **Echt** heißt: entspricht einem historisch bekannt echten Blocker der Ledger vom 2026-10-09 oder wird von einem blinden Opus-Richter als echt eingestuft. Ist B auf keinem Weg spawnbar, endet die Gegenprobe mit „nicht fahrbar, `omitClaudeMd` bleibt aus“ (der einzige zulässige Weg zu „nicht machbar“).

**Mechanik.** Die Agent-Definitionen einer laufenden Session sind eingefroren, darum läuft jeder Lauf als eigener Headless-Prozess (`claude -p`, Arbeitsverzeichnis im Experiment-Worktree `kq-1568-exp`, der B als untracked Datei trägt). Ein direkter Aufruf mit `--agent kubernia-lens-ohne-kontext` (Hauptthread) lässt `omitClaudeMd` wirkungslos (beide Arme: 30.058 Zeichen `instructions`-Anhang, erster Call 31.860 gegen 31.448 Tokens); der Schlüssel wirkt nur beim Spawn als Subagent. Darum spawnt ein Orchestrator (Sonnet) den Subagenten mit dem Prompt aus einer Datei. Wirkungsnachweis (Probe auf Patch p8, Doku): erster Call von A 30.768, von B 15.590 Tokens (T = 15,2k), Hash des ersten User-Eintrags beider `5fc54283d4` und gleich dem der Datei. Die Orchestrator-Kosten stehen getrennt von den Lens-Kosten (aus dem Subagenten-Transkript, aufgezeichnete Usage).
