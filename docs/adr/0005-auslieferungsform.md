# ADR 0005: Auslieferungsform bei Stardew-Scope — Web-App vs. Desktop-Download (bewusst offen gehalten)

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert als ergebnisoffener Grundsatz-ADR** · Datum: 2026-07-03 · Ticket: [#355](https://github.com/fluffels/kubequest/issues/355) (Grundsatz-Review), angelegt via [#606](https://github.com/fluffels/kubequest/issues/606)
> Verwandt: [ADR 0001 – Engine Phaser](0001-engine-phaser.md), [ADR 0002 – Kein Backend, keine DB](0002-kein-backend-keine-db.md), [ADR 0006 – Backend & Skalierung](0006-backend-und-skalierung.md); Bezug [#83](https://github.com/fluffels/kubequest/issues/83) (Tauri-Wrapper), [#198](https://github.com/fluffels/kubequest/issues/198) (Lazy-Load), [#339](https://github.com/fluffels/kubequest/issues/339) (Texture-Atlas).

## Status

**Akzeptiert — die Frage bleibt bewusst offen.** KubeQuest legt sich **nicht** vorab auf eine einzige Auslieferungsform fest. Dieser ADR hält den Entscheidungsraum, die bereits getroffenen Präzisierungen und die Re-Evaluierungs-Trigger fest, statt eine Option zu wählen. Er ist das Artefakt zu dem in [arc42 §9](../arc42-architektur.md#9-architekturentscheidungen-adrs) und in der [Ticket-Reihenfolge](../ticket-reihenfolge.md) als „offen gehalten" geführten ADR 0005 — bisher fehlte genau diese Datei (der Doku-vs-Realität-Drift, den das Projekt sonst maschinell bekämpft; iSAQB-Runde 3, [#606](https://github.com/fluffels/kubequest/issues/606)).

## Warum dieser ADR — und warum ergebnisoffen

Die Auslieferungsform **färbt save-, asset- und build-nahe Entscheidungen** (Persistenz-Strategie, Asset-Delivery, Backend-Bedarf), ohne heute erzwungen zu sein. Sie jetzt festzunageln wäre eine verfrühte Bindung: Der reale Trigger (Stardew-Scope, Plattform-Vertrieb, Cloud-Anspruch) ist noch nicht eingetreten. Gleichzeitig darf die Frage **nicht implizit** durch Einzelentscheidungen vorentschieden werden — genau das ist bei der Single-File-Offline-Frage schon passiert (siehe unten). Dieser ADR macht den offenen Zustand darum **explizit** und knüpft ihn an nachprüfbare Trigger (iSAQB-Prinzip: keine Entscheidung „für immer").

## Optionen (Entscheidungsraum, nicht Auswahl)

| Option | Kurz | Backend-Implikation (siehe [ADR 0006](0006-backend-und-skalierung.md)) | Passt zu Stardew-Scope? |
|---|---|---|---|
| **A — Gehostete Web-App** | statisches Hosting + CDN, im Browser gespielt | Cloud-Save/Achievements/Cross-Device gäbe es **nur mit eigenem (minimalem) Backend** — teuer, kippt [ADR 0002](0002-kein-backend-keine-db.md) | ja, wenn kein Cloud-Anspruch; Asset-Delivery via Lazy-Load/CDN (#198/#339) |
| **B — Desktop-Download über Plattform** | Steam/GOG/itch, ggf. via Tauri-Wrapper ([#83](https://github.com/fluffels/kubequest/issues/83)) | Cloud-Save/Achievements/Auto-Update/DLC kommen **gratis von der Plattform**, kein Eigenbau | ja — so löst es auch Stardew selbst |
| **C — Single-File-Offline** | eine `dist-offline/index.html` mit allen Assets als Data-URI, verschenkbar per Doppelklick | keine (rein lokal) | **nur bei kleiner Größe** — Base64 bläht ~33 %, hunderte MB müssten vor dem Boot komplett geparst werden ⇒ Boot-Killer |

Die Optionen schließen sich **nicht** gegenseitig aus: A und B können koexistieren (dieselbe Quelle, zwei Build-Wege — vgl. [`vite.config.ts`](../../vite.config.ts) `build` vs. `build:offline`), C ist ein reiner Zusatz-Export.

## Entscheidung

**Nicht Web vs. Desktop festlegen** — das bleibt offen, bis ein Trigger feuert. Festgehalten werden aber die **schon getroffenen Präzisierungen**, damit sie nicht wieder driften:

1. **Single-File-Offline (Option C) ist eine _größen-abhängige Option_, nicht das primäre Stardew-Scope-Format.** Das übernimmt die Entscheidung aus [ADR 0006 §5 + Punkt 4](0006-backend-und-skalierung.md): Bei ~35 Quests ist die eine verschenkbare Datei ein charmantes Feature; bei Stardew-Scope (hunderte MB Assets) wird sie zum Boot-Killer und verbaut den nötigen Lazy-Load-/CDN-Weg (#198/#339). **Sie bleibt als Demo-/Klein-Build-Export erhalten, wird aber nicht als Dogma über die Skalierung gestellt.**

2. **Widerspruch zur „Single-File = primäres Verteilformat"-Formulierung aufgelöst.** [ADR 0001](0001-engine-phaser.md) hält in seiner **datierten** Re-Eval-Momentaufnahme vom 2026-06-19 fest, `dist-offline/index.html` sei „das primäre Verteilformat", und die spielerseitige Doku ([README](../../README.md), [CLAUDE.md](../../CLAUDE.md)) beschreibt den Doppelklick-Export prominent. Das war zum damaligen Stand korrekt; **ADR 0006 (2026-06-21) hat es zwei Tage später präzisiert.** Für die Auslieferungsform gilt ab jetzt **dieser ADR 0005 als SSOT**: Single-File ist Option C (größen-abhängig), das *primäre* Format hängt an der noch offenen Web-vs-Desktop-Wahl. Die datierten Momentaufnahmen in ADR 0001 bleiben als historischer Record unangetastet; die README beschreibt Single-File weiterhin korrekt als **heutiges** Feature (aktuelle Größe), nicht als Stardew-Scope-Dauerzusage.

3. **Der „Offline-eine-Datei-Wert" bleibt ein Engine-Re-Eval-Trigger von [ADR 0001](0001-engine-phaser.md#re-evaluierungs-trigger), aber entkoppelt vom Verteilformat.** Wichtig ist der *Offline-Spielbarkeits-Wert* (kein Server nötig), nicht zwingend „**eine** Datei". Multi-File-Offline (Desktop-Bundle bzw. Service-Worker-Cache) erfüllt den Offline-Wert genauso, ohne den Base64-Boot-Killer.

### Bewusst *nicht* entschieden

- **Web (A) vs. Desktop (B)** — die eigentliche #355-Frage. Kein Termin, nur Trigger.
- **Konkreter Desktop-Wrapper** — Tauri ([#83](https://github.com/fluffels/kubequest/issues/83)) ist die vorgemerkte Richtung, aber erst relevant, wenn Option B gewählt wird.
- **Cloud-Save-Mechanismus** — hängt an A-mit-Cloud-Anspruch und damit an [ADR 0006](0006-backend-und-skalierung.md); erst bei Trigger.

## Konsequenzen

- **Positiv:** Der offene Zustand ist jetzt ein **echtes Artefakt** statt einer Doku-Referenz ins Leere; die Single-File-Präzisierung aus ADR 0006 ist an einem auffindbaren Ort gebündelt; save-/asset-/build-nahe Tickets haben eine Leitplanke, gegen die sie prüfen können.
- **Leitplanke:** Die Architektur wird **für keine der Optionen verbaut** — die SaveStore-Kapselung ([`src/store.ts`](../../src/store.ts)), die Phaser-freie Domäne und der Zwei-Build-Wege-Aufbau halten A **und** B offen. Wer eine Option faktisch ausschließt (z.B. Single-File zum harten Muss erklärt), muss diesen ADR kippen.
- **Negativ / bewusst in Kauf genommen:** Kein Cloud-Save/Cross-Device, solange nicht entschieden; die endgültige Verteilform-Politur (CDN-Setup, Steam-Integration, Tauri-Packaging) bleibt liegen, bis ein Trigger sie erzwingt.

## Re-Evaluierungs-Trigger

Neu zu bewerten (dann Web vs. Desktop konkret entscheiden), sobald **einer** eintritt:

- **Asset-Bundle übersteigt ~150 MB** oder die Start-Ladezeit wird spürbar (Richtwert aus [ADR 0006](0006-backend-und-skalierung.md)) → Multi-File + Lazy-Load/Atlas werden Pflicht, Single-File (C) fällt praktisch weg, die A/B-Wahl wird dringlich.
- **Cloud-Save / Cross-Device** wird hartes Feature-Ziel → zwingt die Backend-Frage ([ADR 0006](0006-backend-und-skalierung.md)) und damit A-mit-Backend vs. B-über-Plattform.
- **Plattform-Vertrieb** (Steam/itch/GOG) wird angestrebt → Option B inkl. Wrapper ([#83](https://github.com/fluffels/kubequest/issues/83)) konkret planen.
- **Der Offline-eine-Datei-Wert entfällt als Anforderung** → deckt sich mit dem gleichnamigen Engine-Trigger in [ADR 0001](0001-engine-phaser.md#re-evaluierungs-trigger); öffnet zusätzlich den Auslieferungs-Optionsraum.
