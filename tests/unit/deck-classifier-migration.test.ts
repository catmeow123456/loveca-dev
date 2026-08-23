import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('deck classifier migration', () => {
  it('建立可原子发布、可重试、可审计且绑定长期卡组观察的数据边界', () => {
    const sql = readFileSync('drizzle/0032_add_deck_classifier.sql', 'utf8');

    expect(sql).toContain("'BUILDING', 'ACTIVE', 'SUPERSEDED', 'FAILED'");
    expect(sql).toContain('uq_deck_classifier_releases_active');
    expect(sql).toContain('uq_deck_classifier_releases_building');
    expect(sql).toContain('WHERE "deck_classifier_releases"."status" = \'ACTIVE\'');
    expect(sql).toContain('deck_classification_assignments_observation_fk');
    expect(sql).toContain('deck_classification_assignments_run_release_fk');
    expect(sql).toContain('deck_archetype_templates_source_observation_fk');
    expect(sql).toContain('"representative_card_code" text');
    expect(sql).toContain('deck_archetypes_representative_card_code_cards_card_code_fk');
    expect(sql).toContain('idx_ranked_deck_observations_fingerprint_observed');
    expect(sql).toContain(
      'FOREIGN KEY ("match_id","seat") REFERENCES "public"."ranked_deck_observations"("match_id","seat") ON DELETE cascade'
    );
    expect(sql).toContain('uq_deck_classification_overrides_active_global');
    expect(sql).toContain('uq_deck_classification_overrides_active_release');
    expect(sql).toContain('"idempotency_key" text NOT NULL');
    expect(sql).toContain('"excluded_count" integer DEFAULT 0 NOT NULL');
    expect(sql).toContain("'RANKED', 'DECK_CLASSIFIER', 'THEME_TABLE'");
    expect(sql).toContain(
      "VALUES (1, 'HIDDEN', false, false, false, 'PLAYER_EQUAL', true, false, false, 0)"
    );
    expect(sql).toContain("'HIDDEN', 'PLAYER_EQUAL', 'MATCH_EQUAL', 'BOTH'");
    expect(sql).toContain('"show_usage" boolean DEFAULT true NOT NULL');
    expect(sql).toContain('"show_winner" boolean DEFAULT true NOT NULL');
    expect(sql).toContain('"show_top_ranked" boolean DEFAULT false NOT NULL');
    expect(sql).toContain('"top_ranked_player_count" integer DEFAULT 30 NOT NULL');
    expect(sql).toContain('BETWEEN 10 AND 100');
    expect(sql).toContain('deck_classifier_settings_visibility_check');
    expect(sql).toContain('"card_display_mode" text DEFAULT \'PLAYER_EQUAL\' NOT NULL');
    expect(sql).toContain('"card_show_usage" boolean DEFAULT true NOT NULL');
    expect(sql).toContain('"card_show_winner" boolean DEFAULT false NOT NULL');
    expect(sql).toContain('"card_show_top_ranked" boolean DEFAULT false NOT NULL');
    expect(sql).toContain('deck_classifier_settings_card_display_mode_check');
    expect(sql).toContain('deck_classifier_settings_card_visibility_check');
  });
});
