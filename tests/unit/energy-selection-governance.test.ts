import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const WORKFLOW_ROOT = path.join(ROOT, 'src/application/card-effects/workflows');
const ENERGY_SELECTION_ROOTS = [
  WORKFLOW_ROOT,
  path.join(ROOT, 'src/application/card-effects/runtime'),
  path.join(ROOT, 'src/application/effects'),
];
const CARD_EFFECT_ROOTS = [
  WORKFLOW_ROOT,
  path.join(ROOT, 'src/application/card-effects/runtime'),
];

function readTypeScriptFiles(dir: string): readonly { readonly file: string; readonly source: string }[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return readTypeScriptFiles(file);
    return entry.isFile() && entry.name.endsWith('.ts')
      ? [{ file: path.relative(ROOT, file), source: fs.readFileSync(file, 'utf8') }]
      : [];
  });
}

describe('energy selection governance', () => {
  it('keeps first-N energy orientation helpers out of card workflows', () => {
    const offenders = readTypeScriptFiles(WORKFLOW_ROOT)
      .filter(({ source }) => source.includes('setFirstEnergyCardsOrientation'))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('keeps raw energy-zone-to-deck movement out of card workflows', () => {
    const offenders = readTypeScriptFiles(WORKFLOW_ROOT)
      .filter(({ source }) => /\bmoveEnergyZoneCardsToEnergyDeck\s*\(/.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('confines card-effect energy return movement to the shared runtime boundary', () => {
    const offenders = CARD_EFFECT_ROOTS.flatMap(readTypeScriptFiles)
      .filter(({ source }) => /\bmoveEnergyZoneCardsToEnergyDeckByCardEffect\s*\(/.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual(['src/application/card-effects/runtime/energy-return.ts']);
  });

  it('keeps direct first or first-N energy-zone selection out of card-effect code', () => {
    const offenders = ENERGY_SELECTION_ROOTS.flatMap(readTypeScriptFiles)
      .filter(({ source }) =>
        /energyZone\.cardIds\s*(?:\.slice\s*\(|\[\s*0\s*\])/.test(source)
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('routes legacy automatic helpers through the common selection resolver', () => {
    const effectCosts = fs.readFileSync(
      path.join(ROOT, 'src/application/effects/effect-costs.ts'),
      'utf8'
    );
    const runtimeActions = fs.readFileSync(
      path.join(ROOT, 'src/application/card-effects/runtime/actions.ts'),
      'utf8'
    );
    const energyBelow = fs.readFileSync(
      path.join(ROOT, 'src/application/effects/energy-below.ts'),
      'utf8'
    );
    expect(effectCosts).toContain('resolveEnergySelectionForOperation');
    expect(runtimeActions).toContain('resolveEnergySelectionForOperation');
    expect(energyBelow).toContain('resolveEnergySelectionForOperation');
  });
});
