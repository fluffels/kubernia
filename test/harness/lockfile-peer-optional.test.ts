/* Lockfile-Wächter (#1638) – kein Eintrag, der nur wegen einer optionalen Peer-Kante existiert.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Hintergrund: Ein Paket mit `peer` + `optional` im Lockfile steht dort nur, weil eine
 * optionale Peer-Dependency (z.B. fdir → picomatch) von oben nicht erfüllt ist. Dependabots
 * Lockfile-Erzeugung verliert solche Einträge, `npm ci` bricht dann mit
 * „Missing: <name>@<version> from lock file“ ab. Abhilfe: das Paket als direkte
 * devDependency führen, dann ist die Kante von der Wurzel aus gültig.
 *
 * Bekannte Grenze: der Wächter prüft die Vorbedingung im Lockfile des Branches. Entsteht ein
 * solcher Eintrag erst innerhalb eines Dependabot-PRs (den Dependabot dann wieder verwirft),
 * bleibt er grün und nur `npm ci` wird rot, mit seiner eigenen Meldung.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const LOCKFILE = new URL('../../package-lock.json', import.meta.url);

export interface PeerOptionalEintrag {
  pfad: string;
  name: string;
  version: string;
}

function istObjekt(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function nurOptionalePeerEintraege(lock: unknown): PeerOptionalEintrag[] {
  if (!istObjekt(lock)) throw new Error('Lockfile ist kein Objekt');
  const v = lock.lockfileVersion;
  if (typeof v !== 'number' || v < 2) throw new Error('lockfileVersion < 2: kein packages-Block');
  const pakete = lock.packages;
  if (!istObjekt(pakete)) throw new Error('Lockfile ohne packages-Block');
  const treffer: PeerOptionalEintrag[] = [];
  for (const [pfad, eintrag] of Object.entries(pakete)) {
    if (pfad === '' || !istObjekt(eintrag)) continue;
    if (eintrag.peer === true && eintrag.optional === true) {
      const name = pfad.slice(pfad.lastIndexOf('node_modules/') + 'node_modules/'.length);
      treffer.push({ pfad, name, version: typeof eintrag.version === 'string' ? eintrag.version : '?' });
    }
  }
  return treffer;
}

export function meldung(e: PeerOptionalEintrag): string {
  return (
    `${e.pfad}@${e.version} steht nur wegen einer optionalen Peer-Kante im Lockfile; ` +
    `Dependabots Lockfile-Erzeugung verliert solche Einträge, npm ci bricht dann mit ` +
    `"Missing: ${e.name}@${e.version} from lock file" ab. ` +
    `Abhilfe: ${e.name} in passender Version als direkte devDependency führen (#1638).`
  );
}

describe('Lockfile ohne reine optionale Peer-Einträge (#1638)', () => {
  it('der echte Lockfile hat keinen', () => {
    const lock: unknown = JSON.parse(readFileSync(LOCKFILE, 'utf8'));
    const liste = nurOptionalePeerEintraege(lock);
    expect(liste.map(meldung)).toEqual([]);
  });

  it('Leerlauf-Schutz: der echte Lockfile hat v2+ und Pakete', () => {
    const lock = JSON.parse(readFileSync(LOCKFILE, 'utf8')) as {
      lockfileVersion: number;
      packages: Record<string, unknown>;
    };
    expect(lock.lockfileVersion).toBeGreaterThanOrEqual(2);
    expect(Object.keys(lock.packages).length).toBeGreaterThan(0);
  });

  it('meldet peer+optional, auch mit verschachteltem Scope-Namen', () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { name: 'x' },
        'node_modules/a/node_modules/picomatch': { version: '4.0.7', peer: true, optional: true },
        'node_modules/b/node_modules/@s/p': { version: '1.0.0', peer: true, optional: true },
        'node_modules/c': { peer: true, optional: true },
      },
    };
    const liste = nurOptionalePeerEintraege(lock);
    expect(liste.map((e) => e.name)).toEqual(['picomatch', '@s/p', 'c']);
    expect(liste[2].version).toBe('?');
    expect(liste[0].version).toBe('4.0.7');
  });

  it('meldet nicht: nur optional, nur peer, Wurzel', () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { peer: true, optional: true },
        'node_modules/fsevents': { version: '2.0.0', optional: true },
        'node_modules/react': { version: '1.0.0', peer: true },
        'node_modules/leer': null,
      },
    };
    expect(nurOptionalePeerEintraege(lock)).toEqual([]);
  });

  it('wirft bei kaputtem Lockfile statt still grün zu sein', () => {
    expect(() => nurOptionalePeerEintraege({ lockfileVersion: 3 })).toThrow(/packages/);
    expect(() => nurOptionalePeerEintraege({ lockfileVersion: 1, dependencies: {} })).toThrow(/lockfileVersion/);
    expect(() => nurOptionalePeerEintraege({ packages: {} })).toThrow(/lockfileVersion/);
    expect(() => nurOptionalePeerEintraege({ lockfileVersion: '3', packages: {} })).toThrow(/lockfileVersion/);
    expect(() => nurOptionalePeerEintraege({ lockfileVersion: 3, packages: [] })).toThrow(/packages/);
    expect(nurOptionalePeerEintraege({ lockfileVersion: 2, packages: {} })).toEqual([]);
    expect(() => nurOptionalePeerEintraege(null)).toThrow(/Objekt/);
  });

  it('Meldung nennt Pfad, Version, Fehlertext und Abhilfe', () => {
    const m = meldung({ pfad: 'node_modules/a/node_modules/p', name: 'p', version: '1.2.3' });
    expect(m).toContain('node_modules/a/node_modules/p@1.2.3');
    expect(m).toContain('Missing: p@1.2.3 from lock file');
    expect(m).toContain('direkte devDependency');
  });
});
