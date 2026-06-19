import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Dockerfile runtime assets', () => {
  it('includes preset deck YAML files required by server-side solitaire opponent setup', () => {
    const dockerfile = readFileSync('Dockerfile', 'utf8');

    expect(dockerfile).toContain('COPY assets/decks ./assets/decks');
  });
});
