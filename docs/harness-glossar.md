# Harness-Glossar: die Begriffe der Agenten-Maschinerie

> **Fachlich geprüft am: 2026-11-02.**
>
> **Projektanteil.** Das Harness-Glossar steht im Factory-Repo: [Harness-Glossar](https://github.com/fluffels/self-improving-agent-harness-and-factory/blob/v0.6.0/docs/harness-glossar.md). Hier stehen nur die Begriffe, die dieses Projekt ergänzt. Die Begriffe des Projekts selbst stehen getrennt im [Glossar](glossar.md); welche Seite Projekt und welche Kern ist: [Inventar](referenz/anlaufstellen.md#factory-seiten-projektanteil-und-kern).

## Grenzen und Prüfungen

<!-- factory-projekt:start -->

| Begriff | Bedeutung | Mehr dazu |
|---|---|---|
| SBOM | Stückliste der npm-Abhängigkeiten im Format CycloneDX, je CI-Build als Artefakt (`npm run sbom`). Die SBOM des Release-Images ist SPDX. | [Befehle](referenz/befehle.md) |

<!-- factory-projekt:ende -->

## Messung und Richtung

<!-- factory-projekt:start -->

| Begriff | Bedeutung | Mehr dazu |
|---|---|---|
| Factory-Seite | Eine Doku-Seite, die aus dem Factory-Repo stammt (Art `factory-seite` der Extraktionsliste im Factory-Repo): ihr Kern gehört dem Factory-Repo, das Projekt ergänzt nur in `factory-projekt`-Blöcken und generierten Abschnitten. Welche Seite was ist, steht im Inventar. | [Inventar](referenz/anlaufstellen.md#factory-seiten-projektanteil-und-kern) |
| Anker-Stub | Die Überschrift eines gelöschten Kern-Abschnitts samt genau einer Kern-Zeile `Kern: [Titel](Factory-Link#anker)` (eine ganze Seite als Stub trägt nur `# Titel` und eine `>`-Zeile mit dem Factory-Link) (der Verweis auf den Kern-Abschnitt im Factory-Repo). Sie bleibt nur, wenn ein ADR, eine Besitz-Einheit (auch als Textverweis), ein datierter Schnappschuss, ein Projekt-Test oder ein Projekt-Skript auf den Anker zeigt; Links aus lebender Projekt-Doku zeigen direkt auf den Factory-Link. | [Fortschreibung #1967](adr/fortschreibungen/0022-1967-factory-seiten-projektanteil.md), [#1968](adr/fortschreibungen/0022-1968-harness-doku-kern-restseiten.md) |
| Projektanteil | Das, was von einer Factory-Seite im Projekt bleibt: die `factory-projekt`-Blöcke und die generierten `GEN:`-Blöcke. Alles andere ist Kern und steht nur im Factory-Repo; die Anker-Stubs sind nur Verweise darauf. | [Inventar](referenz/anlaufstellen.md#factory-seiten-projektanteil-und-kern) |
| Factory-Link-Wächter | Das Kern-Gate `npm run check:factorylinks` (`scripts/check-factory-links.mjs`): prüft hermetisch, dass jeder Factory-Link der Doku den Sync-Tag als Ref nennt und mit Pfad und Anker im Index `.factory/factory-links.json` steht, und kein Index-Eintrag verwaist ist. Mit `--schreiben --quelle <klon>` setzt er nach einem Sync auf einen neuen Tag die Refs und schreibt den Index; Befund ⇒ nichts geschrieben. Kern (factory#130): Ohne `.factory/sync-stand.json` gibt es nichts zu prüfen (Exit 0); die Ausnahmen stehen als Globs in `.factory/projekt.json` › `factoryLinks.ausnahmen`. | [Fortschreibung #1966](adr/fortschreibungen/0022-1966-factory-links.md) |
| Factory-Link | Ein Markdown-Link `https://github.com/<repo>/(blob\|tree)/<ref>/<pfad>[#anker]` ins Factory-Repo (`<repo>` aus `quelle.repo` im Sync-Stand, sonst aus dem Board mit Rolle `factory`), dessen Ref der Sync-Tag aus `quelle.tag` in `.factory/sync-stand.json` ist; im Scan-Umfang des Wächters (Kopfkommentar des Skripts), nicht in den Ausnahmen aus `factoryLinks.ausnahmen` (ADRs, Lessons Learned, Gegenproben), Schnappschüssen und Besitz-Einheiten. | [Fortschreibung #1966](adr/fortschreibungen/0022-1966-factory-links.md) |
| Trace-Tag `kubernia` | Der Tag, den `CC_LANGFUSE_TRACE_TAGS` je Session beim Start an alle Traces hängt; Projektfilter der Langfuse-Auswertung. Bedeutung und Gültigkeit (ab wann er durchgängig hängt) stehen in der Zuordnung auf der Factory-Seite; hier gilt `environment` `kubernia` für getaggte Sessions, `dev` für die übrigen. | [Zuordnung in Langfuse](model-routing.md#zuordnung-in-langfuse-1266) |

<!-- factory-projekt:ende -->
