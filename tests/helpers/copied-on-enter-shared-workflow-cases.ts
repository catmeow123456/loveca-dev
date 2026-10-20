import * as IDs from '../../src/application/card-effects/ability-ids';

// Each entry is exercised in copied-on-enter-shared-workflows.test.ts with native and real host results.
export const SHARED_COPY_SOURCE_CASES = [
  {
    code: 'PL!HS-PR-001-PR',
    representativeCardCode: 'PL!HS-PR-001-PR',
    abilityId: IDs.GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
    workflowPath:
      'src/application/card-effects/workflows/shared/discard-look-top-select-to-hand.ts',
  },
  {
    code: 'PL!HS-PR-019-PR',
    representativeCardCode: 'PL!HS-PR-019-PR',
    abilityId: IDs.HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/mill-top-gain-live-modifier.ts',
  },
  {
    code: 'PL!HS-PR-021-PR',
    representativeCardCode: 'PL!HS-PR-021-PR',
    abilityId: IDs.HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/mill-top-gain-live-modifier.ts',
  },
  {
    code: 'PL!HS-PR-031-PR',
    representativeCardCode: 'PL!HS-PR-031-PR',
    abilityId: IDs.HS_PR_031_ON_ENTER_DISCARD_TWO_DRAW_TO_FIVE_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/discard-then-draw.ts',
  },
  {
    code: 'PL!HS-PR-036-PR',
    representativeCardCode: 'PL!HS-PR-036-PR',
    abilityId: IDs.PR_FILL_WAITING_ROOM_TO_EIGHT_OPTIONAL_MILLED_LIVE_TO_DECK_TOP_ABILITY_ID,
    workflowPath:
      'src/application/card-effects/workflows/shared/fill-waiting-room-to-eight-optional-milled-live-to-deck-top.ts',
  },
  {
    code: 'PL!HS-PR-038-PR',
    representativeCardCode: 'PL!HS-PR-038-PR',
    abilityId: IDs.HS_PR_038_ON_ENTER_NON_HAND_GAIN_PURPLE_HEART_ABILITY_ID,
    workflowPath:
      'src/application/card-effects/workflows/shared/on-enter-source-member-gain-live-modifier.ts',
  },
  {
    code: 'PL!HS-bp1-001-P',
    representativeCardCode: 'PL!HS-bp1-001-P',
    abilityId: IDs.MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID,
    workflowPath:
      'src/application/card-effects/workflows/shared/on-enter-activate-waiting-energy.ts',
  },
  {
    code: 'PL!HS-bp1-005-P',
    representativeCardCode: 'PL!HS-bp1-005-P',
    abilityId: IDs.HS_BP1_005_ON_ENTER_DISCARD_UP_TO_THREE_DRAW_SAME_COUNT_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/discard-then-draw.ts',
  },
  {
    code: 'PL!HS-bp1-006-P',
    representativeCardCode: 'PL!HS-bp1-006-P',
    abilityId: IDs.HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/draw-then-discard.ts',
  },
  {
    code: 'PL!HS-bp1-010-N',
    representativeCardCode: 'PL!HS-bp1-010-N',
    abilityId: IDs.HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/draw-then-discard.ts',
  },
  {
    code: 'PL!HS-bp1-011-N',
    representativeCardCode: 'PL!HS-bp1-011-N',
    abilityId: IDs.BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID,
    workflowPath:
      'src/application/card-effects/workflows/shared/discard-look-top-select-to-hand.ts',
  },
  {
    code: 'PL!HS-bp2-002-P',
    representativeCardCode: 'PL!HS-bp2-002-P',
    abilityId: IDs.HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/waiting-room-to-hand.ts',
  },
  {
    code: 'PL!HS-bp2-011-N',
    representativeCardCode: 'PL!HS-bp2-011-N',
    abilityId: IDs.HS_BP2_011_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/direct-mill-top.ts',
  },
  {
    code: 'PL!HS-bp2-016-N',
    representativeCardCode: 'PL!HS-bp2-016-N',
    abilityId: IDs.HS_PB1_024_ON_ENTER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/arrange-inspected-deck-edge.ts',
  },
  {
    code: 'PL!HS-bp2-017-N',
    representativeCardCode: 'PL!HS-bp2-017-N',
    abilityId: IDs.HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/member-on-enter-draw.ts',
  },
  {
    code: 'PL!HS-bp5-001-AR',
    representativeCardCode: 'PL!HS-bp5-001-AR',
    abilityId: IDs.HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/mill-top-gain-live-modifier.ts',
  },
  {
    code: 'PL!HS-bp5-008-AR',
    representativeCardCode: 'PL!HS-bp5-008-AR',
    abilityId: IDs.HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
    workflowPath:
      'src/application/card-effects/workflows/shared/wait-discard-look-top-select-to-hand.ts',
  },
  {
    code: 'PL!HS-bp5-011-N',
    representativeCardCode: 'PL!HS-bp5-011-N',
    abilityId: IDs.MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/member-on-enter-draw.ts',
  },
  {
    code: 'PL!HS-bp6-001-P',
    representativeCardCode: 'PL!HS-bp6-001-P',
    abilityId: IDs.HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/arrange-inspected-deck-edge.ts',
  },
  {
    code: 'PL!HS-bp6-004-P',
    representativeCardCode: 'PL!HS-bp6-004-P',
    abilityId: IDs.HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/opponent-wait-target.ts',
  },
  {
    code: 'PL!HS-bp6-012-R',
    representativeCardCode: 'PL!HS-bp6-012-R',
    abilityId: IDs.HS_BP6_012_ON_ENTER_OTHER_CERISE_BOUQUET_ACTIVATE_ENERGY_ABILITY_ID,
    workflowPath:
      'src/application/card-effects/workflows/shared/on-enter-other-identity-activate-energy.ts',
  },
  {
    code: 'PL!HS-cl1-006-CL',
    representativeCardCode: 'PL!HS-cl1-006-CL',
    abilityId: IDs.HS_CL1_006_ON_ENTER_GAIN_THREE_BLADE_ABILITY_ID,
    workflowPath:
      'src/application/card-effects/workflows/shared/on-enter-source-member-gain-live-modifier.ts',
  },
  {
    code: 'PL!HS-pb1-010-P+',
    representativeCardCode: 'PL!HS-pb1-010-P+',
    abilityId: IDs.HS_PB1_010_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/opponent-wait-target.ts',
  },
  {
    code: 'PL!HS-pb1-020-N',
    representativeCardCode: 'PL!HS-pb1-020-N',
    abilityId:
      IDs.HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/grouped-recovery.ts',
  },
  {
    code: 'PL!HS-sd1-008-SD',
    representativeCardCode: 'PL!HS-sd1-008-SD',
    abilityId: IDs.HS_SD1_008_ON_ENTER_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/draw-then-discard.ts',
  },
  {
    code: 'PL!HS-sd1-013-SD',
    representativeCardCode: 'PL!HS-sd1-013-SD',
    abilityId: IDs.HS_SD1_013_ON_ENTER_MILL_GAIN_BLUE_HEART_ABILITY_ID,
    workflowPath: 'src/application/card-effects/workflows/shared/mill-top-gain-live-modifier.ts',
  },
  {
    code: 'PL!HS-sd1-014-SD',
    representativeCardCode: 'PL!HS-sd1-014-SD',
    abilityId: IDs.HS_SD1_014_ON_ENTER_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID,
    workflowPath:
      'src/application/card-effects/workflows/shared/on-enter-discard-recover-unit-card.ts',
  },
] as const;

export const SHARED_COPY_SOURCE_VARIANT_CASES = [
  {
    code: 'PL!HS-bp2-010-N',
    representativeCardCode: 'PL!HS-bp2-010-N',
    abilityId: IDs.GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
    workflowPath:
      'src/application/card-effects/workflows/shared/discard-look-top-select-to-hand.ts',
  },
] as const;
