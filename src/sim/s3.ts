/* ===== Kubernia – S3-kompatibler Object Store (sim/s3.ts, #241) =====
 * Ein MinIO-/S3-artiger Object Store als eigene Befehlsfamilie `aws s3 …`. Der Store
 * liegt bewusst **off-cluster** („im Hafen"): Buckets + Objekte sind ein eigener,
 * vom Cluster-Volume getrennter Speicher. Sie überleben Pod/Node/PVC – genau das macht
 * den Store als Backup-Ziel tauglich (#140-Folgequest).
 *
 * Storage-Modelle nebeneinander begreifbar machen:
 *   - emptyDir (#240)      → flüchtig, lebt mit dem Pod
 *   - PV/PVC  (#122/#129)  → dauerhaft, aber AN den Cluster gebunden (Block/File)
 *   - Object Store (#241)  → dauerhaft UND unabhängig vom Cluster (Object/Key→Inhalt)
 *
 * Unterstützte Verben (echte `aws s3`-CLI-Form):
 *   aws s3 mb s3://<bucket>           Bucket anlegen (make bucket)
 *   aws s3 rb s3://<bucket> [--force] Bucket löschen (remove bucket; --force auch nicht-leer)
 *   aws s3 ls [s3://<bucket>[/präfix]]Buckets bzw. Objekte auflisten
 *   aws s3 cp <quelle> <ziel>         hochladen (Datei→s3), herunterladen (s3→Datei), kopieren (s3→s3)
 *   aws s3 rm s3://<bucket>/<key>     Objekt löschen
 *
 * Phaser-frei (pure Domäne): arbeitet nur auf `objectStore` + `files` über das schmale
 * S3Host-Interface; kein Rückimport nach sim.ts (kein Zyklus).
 */
import type { S3Bucket, S3Object } from "./state";
import { flag, dispatchSub, type Dispatch, type Call, type SubEntry } from "./cliargs";

/** Was die aws-s3-Befehle vom Simulator brauchen (von der `Sim`-Klasse erfüllt). */
export interface S3Host {
  objectStore: { buckets: S3Bucket[] };
  /** Das lokale „Pod-/Arbeitsverzeichnis" (dieselben Dateien wie `ls`/`cat`): Quelle beim
   *  Upload, Ziel beim Download. So wird der Round-Trip Datei ↔ Bucket greifbar. */
  files: Record<string, string>;
  clock: number;
  _err(msg: string, tip?: string): string;
}

type S3Handler = (host: S3Host, c: Call) => string;

/** Hinweise zu den globalen aws-Flags, die Spieler aus dem echten Werkzeug kennen (der Store ist ein einziger). */
const GLOBAL_HINTS: Readonly<Record<string, string>> = {
  "--endpoint-url": "Es gibt genau EINEN Object Store im Hafen – einen anderen Endpoint wählst du nicht.",
  "--region": "Regionen gibt es nicht – der Object Store liegt im Hafen.",
  "--profile": "Profile und Zugangsdaten gibt es nicht – der Object Store ist ohne Anmeldung erreichbar.",
};
const RECURSIVE_HINT: Readonly<Record<string, string>> = {
  ...GLOBAL_HINTS,
  "--recursive": "Ordner gibt es nicht – jeder Key steht für sich; nenne das Objekt ('s3://bucket/key').",
};

// `ls --recursive` wird angenommen, aber nicht ausgewertet: die Sim listet ohnehin flach alle Keys mit dem Präfix.
const S3: Dispatch<SubEntry<S3Handler>> = { cmd: "aws s3", table: {
  mb: { run: s3MakeBucket, hints: GLOBAL_HINTS },
  rb: { run: s3RemoveBucket, flags: [flag(false, "--force")], hints: GLOBAL_HINTS },
  ls: { run: s3List, flags: [flag(false, "--recursive")], hints: GLOBAL_HINTS },
  cp: { run: s3Copy, hints: RECURSIVE_HINT },
  rm: { run: s3Remove, hints: RECURSIVE_HINT },
},
  // Echte `aws s3`-Verben, die die Sim nicht kann.
  real: ["sync", "mv", "presign", "website"],
};

/** Die `aws`-Ebene: nur der Dienst `s3` ist simuliert, die anderen echten Dienste sind „nicht simuliert“. */
const AWS: Dispatch<SubEntry<S3Handler>> = {
  cmd: "aws",
  table: { s3: { group: S3 } },
  real: ["ec2", "iam", "sts", "s3api", "lambda", "ecr", "ecs", "eks", "dynamodb", "rds", "sqs", "sns", "cloudformation", "cloudwatch", "logs", "route53", "kms", "secretsmanager", "ssm", "configure"],
};

/** Zerlegt eine `s3://bucket/key…`-Adresse. Gibt null, wenn es keine s3-Adresse ist
 *  (dann ist es ein lokaler Pfad). `key` ist "" für `s3://bucket` bzw. `s3://bucket/`. */
function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  if (!uri.startsWith("s3://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash < 0) return { bucket: rest, key: "" };
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
}

/** Letztes Pfad-Segment (Dateiname) – fürs Auffüllen eines Key/Ziels ohne expliziten Namen. */
function baseName(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

function findBucket(host: S3Host, name: string): S3Bucket | undefined {
  return host.objectStore.buckets.find(b => b.name === name);
}

/** Object Store als „aws s3"-Befehlsfamilie. `t` sind die Tokens (Quotes schon aufgelöst); Flags und Positionsargumente
 *  liest die gemeinsame Eingabegrenze (`parseCall`). */
export function awsCommand(host: S3Host, t: string[]): string {
  const r = dispatchSub(host, AWS, t, 1);
  return typeof r === "string" ? r : r.entry.run(host, r.call);
}

/** aws s3 mb s3://<bucket> – Bucket anlegen. */
function s3MakeBucket(host: S3Host, c: Call): string {
  const target = c.args[0];
  const ref = target ? parseS3Uri(target) : null;
  if (!ref || !ref.bucket || ref.key) {
    return host._err("aws s3 mb: Bitte einen Bucket angeben.", "z.B. 'aws s3 mb s3://hafen-backup'.");
  }
  if (findBucket(host, ref.bucket)) {
    return host._err("make_bucket failed: s3://" + ref.bucket + " BucketAlreadyOwnedByYou: Den Bucket gibt es schon.",
      "Mit 'aws s3 ls' siehst du, welche Buckets es bereits gibt.");
  }
  host.objectStore.buckets.push({ name: ref.bucket, objects: [], created: host.clock });
  return "make_bucket: " + ref.bucket;
}

/** aws s3 rb s3://<bucket> [--force] – Bucket löschen (nur leer, außer --force). */
function s3RemoveBucket(host: S3Host, c: Call): string {
  const target = c.args[0] ?? null;
  const ref = target ? parseS3Uri(target) : null;
  if (!ref || !ref.bucket || ref.key) {
    return host._err("aws s3 rb: Welchen Bucket?", "z.B. 'aws s3 rb s3://hafen-backup' (leer) oder '… --force' (mit Inhalt).");
  }
  const bucket = findBucket(host, ref.bucket);
  if (!bucket) {
    return host._err("remove_bucket failed: s3://" + ref.bucket + " NoSuchBucket: Den Bucket gibt es nicht.",
      "Mit 'aws s3 ls' siehst du die vorhandenen Buckets.");
  }
  const force = c.has("--force");
  if (bucket.objects.length > 0 && !force) {
    return host._err("remove_bucket failed: s3://" + ref.bucket + " BucketNotEmpty: Der Bucket ist nicht leer (" + bucket.objects.length + " Objekt(e)).",
      "Erst die Objekte löschen ('aws s3 rm …') oder den Bucket mit '--force' samt Inhalt entfernen.");
  }
  host.objectStore.buckets = host.objectStore.buckets.filter(b => b !== bucket);
  return "remove_bucket: " + ref.bucket;
}

/** aws s3 ls [s3://<bucket>[/präfix]] – Buckets bzw. Objekte auflisten. */
function s3List(host: S3Host, c: Call): string {
  const target = c.args[0] ?? null;
  // Ohne Argument: alle Buckets.
  if (!target) {
    if (host.objectStore.buckets.length === 0) return "(keine Buckets)";
    return host.objectStore.buckets.map(b => fmtDate(b.created) + " " + b.name).join("\n");
  }
  const ref = parseS3Uri(target);
  if (!ref || !ref.bucket) {
    return host._err("aws s3 ls: '" + target + "' ist keine s3-Adresse.", "z.B. 'aws s3 ls s3://hafen-backup'.");
  }
  const bucket = findBucket(host, ref.bucket);
  if (!bucket) {
    return host._err("An error occurred (NoSuchBucket): Den Bucket 's3://" + ref.bucket + "' gibt es nicht.",
      "Mit 'aws s3 ls' siehst du die vorhandenen Buckets.");
  }
  const matches = bucket.objects.filter(o => o.key.startsWith(ref.key));
  if (matches.length === 0) return "(leerer Bucket)";
  // Format wie aws: "<datum> <size> <key>" (size rechtsbündig wie das CLI grob nachgebildet).
  return matches.map(o => fmtDate(o.created) + " " + String(o.size).padStart(10, " ") + " " + o.key).join("\n");
}

/** Ziel-Key auffüllen: ein expliziter Key bleibt, ein leerer bzw. auf „/" endender Key
 *  (Verzeichnis-Form) bekommt den Dateinamen der Quelle angehängt – wie echtes `aws s3 cp`. */
function resolveKey(key: string, srcName: string): string {
  return key && !key.endsWith("/") ? key : key + baseName(srcName);
}

/** Upload: lokale Datei → Bucket-Objekt (`aws s3 cp <datei> s3://…`). */
function s3Upload(host: S3Host, src: string, dstRef: { bucket: string; key: string }): string {
  if (host.files[src] === undefined) {
    return host._err("aws s3 cp: Die lokale Datei '" + src + "' gibt es nicht.", "Mit 'ls' siehst du, was hier liegt.");
  }
  const bucket = findBucket(host, dstRef.bucket);
  if (!bucket) return noSuchBucket(host, dstRef.bucket);
  const key = resolveKey(dstRef.key, src);
  putObject(host, bucket, key, host.files[src]);
  return "upload: " + src + " to s3://" + bucket.name + "/" + key;
}

/** Download: Bucket-Objekt → lokale Datei (`aws s3 cp s3://… <datei>`). */
function s3Download(host: S3Host, srcRef: { bucket: string; key: string }, dst: string): string {
  const bucket = findBucket(host, srcRef.bucket);
  if (!bucket) return noSuchBucket(host, srcRef.bucket);
  const obj = bucket.objects.find(o => o.key === srcRef.key);
  if (!obj) return noSuchKey(host, srcRef.bucket, srcRef.key);
  const dest = dst === "." || dst.endsWith("/") ? (dst === "." ? "" : dst) + baseName(srcRef.key) : dst;
  host.files[dest] = obj.content;
  return "download: s3://" + bucket.name + "/" + obj.key + " to " + dest;
}

/** Copy: Objekt von Bucket zu Bucket (`aws s3 cp s3://… s3://…`). */
function s3CopyObject(host: S3Host, srcRef: { bucket: string; key: string }, dstRef: { bucket: string; key: string }): string {
  const sBucket = findBucket(host, srcRef.bucket);
  if (!sBucket) return noSuchBucket(host, srcRef.bucket);
  const obj = sBucket.objects.find(o => o.key === srcRef.key);
  if (!obj) return noSuchKey(host, srcRef.bucket, srcRef.key);
  const dBucket = findBucket(host, dstRef.bucket);
  if (!dBucket) return noSuchBucket(host, dstRef.bucket);
  const key = resolveKey(dstRef.key, obj.key);
  putObject(host, dBucket, key, obj.content);
  return "copy: s3://" + sBucket.name + "/" + obj.key + " to s3://" + dBucket.name + "/" + key;
}

/** aws s3 cp <quelle> <ziel> – Upload (Datei→s3), Download (s3→Datei) oder Copy (s3→s3).
 *  Dünner Dispatcher: welche Seite eine s3-Adresse ist, wählt den Modus. */
function s3Copy(host: S3Host, c: Call): string {
  const [src, dst] = c.args;
  if (!src || !dst) {
    return host._err("aws s3 cp: Bitte Quelle UND Ziel angeben.",
      "Hochladen: 'aws s3 cp daten.txt s3://hafen-backup/daten.txt' · Herunterladen: 'aws s3 cp s3://hafen-backup/daten.txt daten.txt'.");
  }
  const srcRef = parseS3Uri(src), dstRef = parseS3Uri(dst);
  if (!srcRef && dstRef) return s3Upload(host, src, dstRef);
  if (srcRef && !dstRef) return s3Download(host, srcRef, dst);
  if (srcRef && dstRef) return s3CopyObject(host, srcRef, dstRef);
  // Beides lokal – das ist `cp`, nicht `aws s3 cp`.
  return host._err("aws s3 cp: Mindestens Quelle oder Ziel muss eine s3-Adresse (s3://…) sein.",
    "Für lokale Kopien ist 'aws s3 cp' nicht da – hier geht es um den Object Store.");
}

/** aws s3 rm s3://<bucket>/<key> – Objekt löschen. */
function s3Remove(host: S3Host, c: Call): string {
  const target = c.args[0] ?? null;
  const ref = target ? parseS3Uri(target) : null;
  if (!ref || !ref.bucket) {
    return host._err("aws s3 rm: Welches Objekt?", "z.B. 'aws s3 rm s3://hafen-backup/daten.txt'.");
  }
  const bucket = findBucket(host, ref.bucket);
  if (!bucket) return noSuchBucket(host, ref.bucket);
  if (!ref.key) {
    return host._err("aws s3 rm: Bitte einen Objekt-Key angeben.", "z.B. 'aws s3 rm s3://" + ref.bucket + "/daten.txt'. Ganze Buckets löschst du mit 'aws s3 rb'.");
  }
  const obj = bucket.objects.find(o => o.key === ref.key);
  if (!obj) return noSuchKey(host, ref.bucket, ref.key);
  bucket.objects = bucket.objects.filter(o => o !== obj);
  return "delete: s3://" + bucket.name + "/" + ref.key;
}

/** Legt ein Objekt an bzw. überschreibt es (idempotenter Upload, wie echtes S3). */
function putObject(host: S3Host, bucket: S3Bucket, key: string, content: string) {
  const size = objectByteLength(content);
  const existing = bucket.objects.find(o => o.key === key);
  if (existing) {
    existing.content = content;
    existing.size = size;
    existing.created = host.clock;
  } else {
    bucket.objects.push({ key, content, size, created: host.clock });
  }
}

/** Größe in Bytes (UTF-8) – nicht die JS-String-Länge, damit Umlaute korrekt zählen.
 *  Exportiert, damit reset()/merge in sim.ts dieselbe Berechnung nutzen (eine Quelle). */
export function objectByteLength(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) || 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Deterministisches Datum (kein echtes Wall-Clock – die Sim ist reproduzierbar). */
function fmtDate(clock: number): string {
  const mm = String((clock % 60)).padStart(2, "0");
  const ss = String((clock * 7) % 60).padStart(2, "0");
  return "2024-01-01 12:" + mm + ":" + ss;
}

function noSuchBucket(host: S3Host, name: string): string {
  return host._err("An error occurred (NoSuchBucket): Den Bucket 's3://" + name + "' gibt es nicht.",
    "Mit 'aws s3 ls' siehst du die vorhandenen Buckets, mit 'aws s3 mb s3://" + name + "' legst du ihn an.");
}

function noSuchKey(host: S3Host, bucket: string, key: string): string {
  return host._err("An error occurred (NoSuchKey): Das Objekt 's3://" + bucket + "/" + key + "' gibt es nicht.",
    "Mit 'aws s3 ls s3://" + bucket + "' siehst du, welche Objekte im Bucket liegen.");
}

export type { S3Object };
