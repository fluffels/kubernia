# Sicherheitsrichtlinie

## Unterstützte Version

Unterstützt wird der aktuelle Stand von `main` und das jeweils letzte Release (Container-Image mit dem neuesten `v*`-Tag). Ältere Releases bekommen keine Sicherheitskorrekturen.

## Schwachstelle melden

Bitte **nicht** öffentlich per Issue, Pull Request oder Discussion melden, sondern vertraulich über GitHub:

1. Im Repository den Reiter **Security** öffnen.
2. **Report a vulnerability** wählen (GitHub Private Vulnerability Reporting) oder direkt <https://github.com/fluffels/kubernia/security/advisories/new> öffnen.
3. Beschreiben, was betroffen ist, wie es sich nachstellen lässt und welche Wirkung es hat.

Es gibt bewusst keinen Meldeweg per E-Mail.

## Was dich erwartet

Kubernia ist ein Ein-Personen-Projekt ohne Backend: ein statisches Browserspiel, das den Spielstand lokal speichert. Die Maintainerin antwortet nach bestem Können, ohne Fristzusage. Eine bestätigte Lücke wird per Pull Request behoben; auf Wunsch wird die meldende Person im zugehörigen Advisory genannt.

## Automatische Prüfungen

Abhängigkeiten (`npm audit`, Dependabot), eigener Code (CodeQL), Lieferkette (Scorecard) und das Container-Image (Trivy) werden laufend gescannt; Details: [Architektur, Abschnitt Supply Chain](docs/arc42-architektur.md).
