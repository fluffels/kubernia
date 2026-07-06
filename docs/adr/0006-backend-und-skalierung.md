# ADR 0006: Braucht Kubernia bei Stardew-Scope ein Backend? — Skalierungs-Review

- **Status:** akzeptiert (2026-06-21) · ergebnisoffenes Grundsatz-Review
- **Kontext-Ticket:** [#400](https://github.com/fluffels/kubequest/issues/400)
- **Verwandt:** [ADR 0001 – Engine Phaser](0001-engine-phaser.md), [ADR 0002 – Kein Backend, keine DB](0002-kein-backend-keine-db.md), [ADR 0004 – Skalierungs-Fundament](0004-skalierungs-fundament.md); **eng verzahnt mit [#355](https://github.com/fluffels/kubequest/issues/355) (Auslieferungsform Web vs. Desktop)** — die Backend-Frage ist von der Auslieferungsform **nicht unabhängig** entscheidbar (siehe unten).

## Warum dieser ADR — die alten Annahmen bewusst anzweifeln

[ADR 0002](0002-kein-backend-keine-db.md) beantwortet die Frage „Backend ja/nein?" bereits mit einem klaren **Nein** und wurde 2026-06-19 (#291) bestätigt. Dieser ADR **nickt das nicht ab**. Auftrag (oberste Regel + #400): die Entscheidung gegen **echten Stardew-Scope** stresstesten — 100+ Quests, 50+ NPCs, viele Welten, hunderte Sprites/Tilemaps/Sounds, jahrelange Entwicklung — und prüfen, ob die *Begründungen* der alten ADRs bei dieser Größe noch tragen. Ergebnis: Die Grundsatz-Entscheidung „kein eigenes Backend" trägt, **aber drei ihrer Begründungen wackeln** und eine konkrete Lücke (Eviction-Schutz) ist heute offen.

## Recherche-Befunde (Best Practices bei Stardew-Scope)

### 1. Die Vergleichsgröße: Stardew Valley betreibt selbst kein Backend

Stardew Valley ist ein **rein lokales Offline-Spiel**: kein Server, keine DB, keine Accounts. Die „Backend-typischen" Komfort-Features kommen **nicht** vom Entwickler-Server, sondern von der **Vertriebsplattform**:

| Feature | Wie Stardew es löst | Eigenes Backend nötig? |
|---|---|---|
| Cloud-Saves / Cross-Device | **Steam Cloud** (Plattform synchronisiert die lokalen Save-Dateien) | nein |
| Achievements | **Steam-Achievements-API** | nein |
| Auto-Update / Patches | **Steam/GOG-Updater** | nein |
| DLC / Content-Delivery | über die Plattform ausgeliefert | nein |
| Telemetrie / Lern-Analytik | (gibt es bei Stardew nicht) | — |

**Kernerkenntnis:** Selbst ein *fertiges, riesiges* Singleplayer-Spiel braucht für all das **kein selbstgebautes Backend** — sofern es über eine Plattform (Steam/GOG/itch) ausgeliefert wird, die diese Dienste mitbringt. Das stützt ADR 0002 in der Sache.

### 2. ⚠️ Die Backend-Frage hängt an der Auslieferungsform (#355)

Genau hier wackelt eine implizite Annahme: Die Plattform liefert die Backend-Features **nur, wenn man auf einer Plattform ausliefert** (Desktop-Download via Steam/itch, #355). Eine **reine, gehostete Web-App hat keine solche Plattform** — dort gibt es kein Steam Cloud, keine Achievements-API. Will die Web-Variante Cloud-Saves oder Cross-Device-Fortschritt als echtes Feature, **bliebe nur ein eigenes (minimales) Backend**.

Damit ist **#400 nicht ohne #355 entscheidbar**: „kein Backend" ist für die Desktop-Auslieferung gratis, für eine Web-only-Auslieferung mit Cloud-Anspruch dagegen die teure Variante. Beide ADRs müssen zusammen gelesen werden.

### 3. ⚠️ Save-Architektur: ADR 0004 begründet IndexedDB mit dem falschen Engpass

[ADR 0004](0004-skalierungs-fundament.md) und der Kommentar in [`src/store.ts`](../../src/store.ts) begründen den Umstieg auf IndexedDB mit der **Kapazität** („localStorage-Limit 5–10 MB sprengt Stardew-Scale-Stände"). Der Stardew-Vergleich entlarvt das als nicht den eigentlichen Punkt:

- **Ein Stardew-Save ist selbst nur ~5–10 MB** (XML, ein komplettes Bauernhof-Leben). Kubernia speichert deutlich weniger pro Stand. **Die Kapazität ist also gar nicht der Stardew-Scope-Engpass** — selbst localStorage läge grenzwertig im Rahmen, IndexedDB hat massiv Headroom (Firefox best-effort ~10 GiB bzw. 10 % der Platte, Chrome ~60 % der Platte).
- Der **echte, bisher ungenannte Engpass ist Eviction.** Browser-Speicher ist „geliehen, nicht besessen": Unter Speicherdruck löscht der Browser **best-effort**-Origins per LRU komplett — IndexedDB, Cache API und OPFS einer Origin werden zusammen entfernt. Ein Spiel, in das man 100 h steckt und das man nur sporadisch im Browser-Tab öffnet, ist **genau ein LRU-Kandidat**. IndexedDB allein schützt davor **nicht**.
- **Schutz dagegen:** `navigator.storage.persist()` macht die Origin persistent (immun gegen LRU-Eviction; nur noch manuelles Löschen durch den Nutzer entfernt Daten). Chrome/Safari gewähren das automatisch nach Interaktions-Historie/Engagement (PWA-Installation, Lesezeichen, Wiederbesuche helfen), Firefox per Prompt. Dazu `navigator.storage.estimate()` zum Überwachen. **Heute ruft Kubernia `persist()` nirgends auf** (im Code verifiziert) — der Stand ist also ungeschützt. → Folge-Ticket, siehe unten.
- **Brauchen wir SQLite-WASM / OPFS statt IndexedDB?** (Ticket-Frage 2) **Nein.** Beide unterliegen **derselben** Storage-Policy und werden bei Eviction genauso gelöscht — sie lösen das eigentliche Problem (Persistenz) **nicht**. Ihr Mehrwert wäre nur strukturierte Queries / Datei-artige Saves; bei 5–10 MB Save ist das **Over-Engineering** (verstößt gegen ADR 0002s Geist). Der wirksame Hebel ist `persist()` + verlässlicher **JSON-Export/Import** (existiert), nicht ein anderes Backend.

### 4. Asset-Delivery: das echte Stardew-Scope-Problem — und es ist kein Backend-Problem

Die große Zahl bei Stardew ist **nicht** der Save (10 MB), sondern die **Asset-Menge** (~490 MB–1 GB: hunderte Sprites, Tilemaps, Sounds, Musik). Das ist die Dimension, die bei Kubernia zuerst gegen eine Wand läuft — und sie wird **client-seitig** gelöst, ohne Backend:

- **Texture-Atlas** statt Einzel-Dateien (TexturePacker-JSON, von Phaser nativ unterstützt) → weniger Draw-Calls, weniger HTTP-Requests. → **bereits als [#339](https://github.com/fluffels/kubequest/issues/339) erfasst.**
- **Lazy-Loading pro Insel/Szene** statt alles im `preload` → keine Minuten-Ladezeit beim Start. → **bereits als [#198](https://github.com/fluffels/kubequest/issues/198) erfasst.**
- **Caching:** statisches Hosting + CDN (Web-Auslieferung) bzw. Service Worker / Cache API für Offline-Wiederbesuch.

**Statisches Hosting/CDN ist kein „Backend" im Sinne von ADR 0002** (kein Server-Stack, keine DB, kein Service-Split) — es ist nur das Ausliefern unveränderlicher Dateien. Das widerspricht ADR 0002 nicht.

### 5. ⚠️ Lock-in: was die Tür offen hält — und die eine Annahme, die sie zudrückt

**Hält die Tür offen (gut):**
- **SaveStore-Kapselung** ([`src/store.ts`](../../src/store.ts)): Das Backend ist hinter `read/write` versteckt; IndexedDB → (später) Cloud-Sync wäre ein lokal gekapselter Austausch, kein Aufrufer ändert sich.
- **Phaser-freie Domänenschicht** (ADR 0001/0004): Spiellogik ist im Node testbar und nicht an Browser/Engine gebunden — auch ein Desktop-Wrapper (#355) erbt sie 1:1.
- **JSON-Export/Import:** verlustfreier manueller Save-Transfer ohne jede Server-Abhängigkeit.

**Drückt die Tür zu (Befund — hier wackelt ADR 0001/0002):**
- Der **„Single-File-Offline-Build als Kern-Wert"** (`dist-offline/index.html`, **alle** Assets als Data-URI inline). Bei Stardew-Scope ist das **kein tragfähiges Verteilformat**: Base64 bläht Assets um ~33 % auf, und der Browser müsste eine HTML-Datei von hunderten MB **komplett parsen und in den Speicher laden**, bevor das Spiel startet. Was bei ~35 Quests ein charmantes „eine verschenkbare Datei"-Feature ist, wird bei Stardew-Scope zum Boot-Killer. Wer dieses Feature als **Dogma** behandelt, verbaut sich genau den Lazy-Load-/CDN-Weg (#198/#339), den der Scope erzwingt. → **Konsequenz: Single-File-Offline ist ein Verteilformat für die *heutige* Größe (Demo/kleine Builds), nicht das primäre Stardew-Scope-Format.** Diese Einordnung gehört in die Auslieferungs-Entscheidung #355.

## Entscheidung

1. **Kein eigenes Backend bauen — bestätigt, aber präzisiert.** ADR 0002 gilt weiter: kein Server-Stack/DB/Service-Split als Selbstzweck. **Neu festgehalten:** Die „Backend-Features" (Cloud-Save, Achievements, Auto-Update, DLC) werden bei Stardew-Scope über die **Vertriebsplattform** (#355) abgedeckt, **nicht** über Eigenbau. Ein eigenes Backend kommt nur in Frage, wenn die Auslieferung **Web-only bleibt UND** Cloud-Features zum harten Ziel werden (siehe Trigger).

2. **Save bleibt client-seitig (IndexedDB), aber der Engpass wird korrekt benannt:** nicht Kapazität, sondern **Eviction**. → `navigator.storage.persist()` anfordern + `estimate()` überwachen ist eine **offene, nötige Härtung** (Folge-Ticket). **Kein** Wechsel auf SQLite-WASM/OPFS — löst das Problem nicht und ist Over-Engineering.

3. **Asset-Skalierung ist client-seitig und bereits eingeplant** (#198 Lazy-Load, #339 Texture-Atlas) — kein Backend. CDN/Service-Worker sind reines statisches Ausliefern und ADR-0002-konform.

4. **Single-File-Offline wird vom „Kern-Wert" zur größen-abhängigen Option herabgestuft** — verbindlich zu entscheiden in #355 (Auslieferungsform). Bei Stardew-Scope: Multi-File + Lazy-Load + (Web) CDN bzw. (Desktop) gepacktes Bundle.

### Bewusst *nicht* entschieden

- **Keine Festlegung Web vs. Desktop** — das ist #355. Dieser ADR liefert nur die Backend-Implikation: Desktop-via-Plattform macht Backend-Features gratis, Web-only macht sie teuer.
- **Kein konkreter Cloud-Save-Mechanismus** — erst relevant, wenn ein Trigger feuert.

## Konsequenzen

- **Positiv:** Die Stardew-Scope-Frage ist beantwortet ohne Server-Stack-Overhead; der einzige offene Skalierungs-Engpass (Eviction) ist benannt und tickettauglich; #400 und #355 sind sauber verzahnt; eine veraltete Begründung (IndexedDB = Kapazität) ist korrigiert.
- **Negativ / bewusst in Kauf genommen:** kein Cloud-Save/Cross-Device in der Web-Variante ohne spätere Neuentscheidung; Single-File-Offline verliert bei Wachstum seinen Status als primäres Format.
- **Leitplanke:** Wer ein eigenes Backend einziehen will, muss **ADR 0002 *und* diesen ADR** kippen — nicht „nebenbei" einen Server hinzufügen.

## Re-Evaluierungs-Trigger

Neu zu bewerten, sobald **einer** eintritt (ergänzt die Trigger aus ADR 0002):

- **Cloud-Saves / Cross-Device** wird hartes Feature-Ziel **und** die Auslieferung bleibt **Web-only** (ohne Plattform, die Sync liefert) → minimales Save-Sync-Backend prüfen (vgl. zurückgestellte #158–#160).
- **Serverseitige Lern-Analytik** über mehrere Spieler hinweg wird gewünscht.
- **Asset-Bundle übersteigt einen Schwellenwert** (Richtwert: > ~150 MB Gesamt-Assets oder Start-Ladezeit > einige Sekunden auf Multi-File) → Lazy-Load/Atlas/CDN sind dann **Pflicht**, nicht Komfort (#198/#339 hochpriorisieren).
- **Eviction tritt real auf** (Nutzer berichten verlorene Stände) → `persist()`-Härtung wird dringlich.

## Folge-Tickets

- **Neu angelegt: [#401](https://github.com/fluffels/kubequest/issues/401)** — „`navigator.storage.persist()` + Quota-Monitoring beim Boot anfordern". Schließt die in Befund 3 gefundene Eviction-Lücke (heute ruft Kubernia `persist()` nirgends auf). Client-seitig, session-groß, ohne Backend.
- **Bereits im Backlog (Asset-Skalierung):** [#198](https://github.com/fluffels/kubequest/issues/198) Lazy-Asset-Loading, [#339](https://github.com/fluffels/kubequest/issues/339) Texture-Atlas.
- **Offen, koppelt hier an:** [#355](https://github.com/fluffels/kubequest/issues/355) Auslieferungsform — entscheidet, ob die Plattform die Backend-Features liefert.

## Quellen (Recherche 2026-06)

- [MDN – Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) (LRU-Eviction, best-effort vs. persistent, Quota-Zahlen, OPFS/IndexedDB gleich behandelt)
- [RxDB – IndexedDB Max Storage Size Limit](https://rxdb.info/articles/indexeddb-max-storage-limit.html), [Bugnet – Game Save Best Practices for Web Games](https://bugnet.io/blog/game-save-best-practices-web) (Export anbieten, `persist()` anfordern, auf `visibilitychange` speichern)
- [Stardew Valley Wiki – Saves](https://stardewvalleywiki.com/Saves) (Save-Größe/-Struktur); Asset-/Spielgröße ~490 MB–1 GB
- [Phaser Docs – Loader](https://docs.phaser.io/phaser/concepts/loader), [Phaser – Texture Atlas laden](https://phaser.io/examples/v3.55.0/loader/texture-atlas-json/view/load-texture-atlas) (Atlas + Lazy-Loading)
- [itch.io Devlog – Steam release / Achievements & Cloud Saves](https://itch.io/devlog/274190/steam-release.amp) (Plattform liefert Cloud-Save/Achievements/Auto-Update, nicht der Entwickler)
