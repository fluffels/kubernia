/* ===== Kubernia – typisierter Feldzugriff auf geparste Manifeste (sim/manifest/fields.ts, #1139) =====
 * Leaf-Modul der Manifest-Mapper: kapselt den Zugriff auf `YamlValue` so, dass jeder Typfehler den
 * Feldpfad nennt (z.B. `spec.template.spec.containers[0].image: Pflichtfeld fehlt`). Ein Fehlpfad
 * wirft `ManifestError`; die Registry macht daraus den kubectl-Fehlertext. Rein, ohne Sim-Zustand. */
import type { YamlValue } from "../yaml";

/** Ein inhaltlicher Fehler im Manifest. `raw` = die Meldung ist schon ein fertiger kubectl-Text. */
export class ManifestError extends Error {
  constructor(message: string, readonly hint?: string, readonly raw = false) {
    super(message);
    this.name = "ManifestError";
  }
}

function typeName(v: YamlValue | undefined): string {
  if (v === undefined || v === null) return "nichts";
  if (Array.isArray(v)) return "eine Liste";
  if (typeof v === "object") return "ein Mapping";
  if (typeof v === "string") return "Text";
  return typeof v === "number" ? "eine Zahl" : "ein Boolean";
}

/** Ein (evtl. fehlender) Wert samt Pfad. Fehlende Zwischenebenen bleiben fehlend, statt zu werfen. */
export class Leaf {
  constructor(readonly value: YamlValue | undefined, readonly path: string) {}

  /** Gesetzt = vorhanden und nicht `null`. */
  get present(): boolean {
    return this.value !== undefined && this.value !== null;
  }

  private bad(expected: string): never {
    throw new ManifestError(this.path + ": erwartet " + expected + ", gefunden " + typeName(this.value));
  }

  /** Kindfeld eines Mappings; ist dieser Wert kein Mapping, ein Typfehler. */
  key(k: string): Leaf {
    const path = this.path ? this.path + "." + k : k;
    const v = this.value;
    if (v === undefined || v === null) return new Leaf(undefined, path);
    if (typeof v !== "object" || Array.isArray(v)) return this.bad("ein Mapping");
    return new Leaf(Object.prototype.hasOwnProperty.call(v, k) ? v[k] : undefined, path);
  }

  /** Ob dieses Mapping den Key überhaupt enthält (auch mit leerem Wert, z.B. `emptyDir: {}`). */
  has(k: string): boolean {
    const v = this.value;
    return typeof v === "object" && v !== null && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, k);
  }

  /** Die Listenelemente als `Leaf`s (`[]`, wenn das Feld fehlt). */
  items(): Leaf[] {
    if (!this.present) return [];
    if (!Array.isArray(this.value)) return this.bad("eine Liste");
    return this.value.map((v, i) => new Leaf(v, this.path + "[" + i + "]"));
  }

  /** Wie `items()`, aber mindestens ein Element Pflicht. */
  reqItems(): Leaf[] {
    const list = this.items();
    if (list.length === 0) throw new ManifestError(this.path + ": Pflichtfeld fehlt (mindestens ein Eintrag)");
    return list;
  }

  str(): string | undefined {
    if (!this.present) return undefined;
    return typeof this.value === "string" ? this.value : this.bad("Text");
  }

  reqStr(): string {
    const s = this.str();
    if (s === undefined || s === "") throw new ManifestError(this.path + ": Pflichtfeld fehlt");
    return s;
  }

  /** Ganze Zahl ≥ 0. */
  int(): number | undefined {
    if (!this.present) return undefined;
    if (typeof this.value !== "number") return this.bad("eine ganze Zahl");
    if (!Number.isInteger(this.value) || this.value < 0) throw new ManifestError(this.path + ": erwartet eine ganze Zahl ≥ 0, gefunden " + this.value);
    return this.value;
  }

  bool(): boolean | undefined {
    if (!this.present) return undefined;
    return typeof this.value === "boolean" ? this.value : this.bad("true oder false");
  }
}
