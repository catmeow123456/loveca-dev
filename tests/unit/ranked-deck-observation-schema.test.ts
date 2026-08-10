import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ranked deck observation schema', () => {
  it('keeps observations unique per seat and tied to durable ranked identities', () => {
    const sql = readFileSync('drizzle/0020_add_ranked_deck_observations.sql', 'utf8');

    expect(sql).toContain('PRIMARY KEY("match_id","seat")');
    expect(sql).toMatch(
      /FOREIGN KEY \("match_id"\)[\s\S]*REFERENCES "public"\."ranked_matches"\("match_id"\) ON DELETE cascade/
    );
    expect(sql).toMatch(
      /FOREIGN KEY \("season_id"\)[\s\S]*REFERENCES "public"\."ranked_seasons"\("id"\) ON DELETE restrict/
    );
    expect(sql).toMatch(
      /FOREIGN KEY \("user_id"\)[\s\S]*REFERENCES "public"\."profiles"\("id"\) ON DELETE restrict/
    );
    expect(sql).toContain('CHECK ("ranked_deck_observations"."seat" IN (\'FIRST\', \'SECOND\'))');
    expect(sql).toContain("'^sha256:[0-9a-f]{64}$'");
    expect(sql).toContain('jsonb_array_length("ranked_deck_observations"."main_deck_cards") > 0');
  });
});
