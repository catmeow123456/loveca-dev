import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

it('routes card-effect cheer movement through its event and trigger boundary', () => {
  const root = process.cwd();
  const offenders = readdirSync(join(root, 'src/application'), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) =>
      /\bimport\s*\{[^}]*\bmoveRevealedCheerCards\b[^}]*\}\s*from\s*/.test(
        readFileSync(file, 'utf8')
      )
    )
    .map((file) => relative(root, file))
    .sort();
  expect(offenders).toEqual([
    'src/application/card-effects/runtime/revealed-cheer-movement-triggers.ts',
  ]);
});
