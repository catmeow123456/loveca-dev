import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import {
  HS_CL1_006_ON_ENTER_GAIN_THREE_BLADE_ABILITY_ID,
  N_BP7_024_ON_ENTER_THREE_R3BIRTH_GAIN_PINK_HEART_ABILITY_ID,
  N_SD2_019_ON_ENTER_GAIN_BLUE_HEART_ABILITY_ID,
  S_BP6_013_ON_ENTER_GAIN_TWO_BLADE_ABILITY_ID,
  S_PR_016_ON_ENTER_GAIN_ONE_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerManualConfirmablePendingAbilityStarterHandler } from '../../runtime/workflow-helpers.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type OnEnterSourceMemberLiveModifierConfig =
  | {
      readonly abilityId: string;
      readonly kind: 'BLADE';
      readonly amount: number;
      readonly actionStep: string;
      readonly manualConfirmable?: boolean;
      readonly requiredStageUnitAlias?: string;
      readonly minStageUnitMemberCount?: number;
    }
  | {
      readonly abilityId: string;
      readonly kind: 'HEART';
      readonly color: HeartColor;
      readonly amount: number;
      readonly actionStep: string;
      readonly manualConfirmable?: boolean;
      readonly requiredStageUnitAlias?: string;
      readonly minStageUnitMemberCount?: number;
    };

const ON_ENTER_SOURCE_MEMBER_LIVE_MODIFIER_CONFIGS: readonly OnEnterSourceMemberLiveModifierConfig[] =
  [
    {
      abilityId: S_PR_016_ON_ENTER_GAIN_ONE_BLADE_ABILITY_ID,
      kind: 'BLADE',
      amount: 1,
      actionStep: 'ON_ENTER_SOURCE_MEMBER_GAIN_ONE_BLADE',
    },
    {
      abilityId: S_BP6_013_ON_ENTER_GAIN_TWO_BLADE_ABILITY_ID,
      kind: 'BLADE',
      amount: 2,
      actionStep: 'ON_ENTER_SOURCE_MEMBER_GAIN_TWO_BLADE',
    },
    {
      abilityId: HS_CL1_006_ON_ENTER_GAIN_THREE_BLADE_ABILITY_ID,
      kind: 'BLADE',
      amount: 3,
      actionStep: 'ON_ENTER_SOURCE_MEMBER_GAIN_THREE_BLADE',
    },
    {
      abilityId: N_SD2_019_ON_ENTER_GAIN_BLUE_HEART_ABILITY_ID,
      kind: 'HEART',
      color: HeartColor.BLUE,
      amount: 1,
      actionStep: 'ON_ENTER_SOURCE_MEMBER_GAIN_BLUE_HEART',
      manualConfirmable: true,
    },
    {
      abilityId: N_BP7_024_ON_ENTER_THREE_R3BIRTH_GAIN_PINK_HEART_ABILITY_ID,
      kind: 'HEART',
      color: HeartColor.PINK,
      amount: 1,
      actionStep: 'ON_ENTER_THREE_R3BIRTH_GAIN_PINK_HEART',
      requiredStageUnitAlias: 'R3BIRTH',
      minStageUnitMemberCount: 3,
    },
  ];

export function registerOnEnterSourceMemberGainLiveModifierWorkflowHandlers(): void {
  for (const config of ON_ENTER_SOURCE_MEMBER_LIVE_MODIFIER_CONFIGS) {
    const resolver: Parameters<typeof registerPendingAbilityStarterHandler>[1] = (
      game,
      ability,
      options,
      context
    ) =>
      resolveOnEnterSourceMemberLiveModifier(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    if (config.manualConfirmable === true) {
      registerManualConfirmablePendingAbilityStarterHandler(config.abilityId, resolver);
    } else {
      registerPendingAbilityStarterHandler(config.abilityId, resolver);
    }
  }
}

function resolveOnEnterSourceMemberLiveModifier(
  game: GameState,
  ability: PendingAbilityState,
  config: OnEnterSourceMemberLiveModifierConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const player = getPlayerById(stateWithoutPending, ability.controllerId);
  if (!player) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', null, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot: ability.sourceSlot,
        step: 'CONTROLLER_NOT_FOUND_NO_OP',
        sourceOnStage: false,
        modifierKind: config.kind,
        modifierAmount: 0,
      }),
      orderedResolution
    );
  }

  const sourceOnStage = getAllMemberCardIds(player.memberSlots).includes(ability.sourceCardId);
  const qualifyingStageUnitMemberCardIds =
    config.requiredStageUnitAlias === undefined
      ? []
      : getStageMemberCardIdsMatching(
          stateWithoutPending,
          player.id,
          unitAliasIs(config.requiredStageUnitAlias)
        );
  const stageUnitMemberConditionMet =
    config.minStageUnitMemberCount === undefined ||
    qualifyingStageUnitMemberCardIds.length >= config.minStageUnitMemberCount;
  const modifierResult =
    !sourceOnStage || !stageUnitMemberConditionMet
      ? null
      : config.kind === 'BLADE'
        ? addBladeLiveModifierForSourceMember(stateWithoutPending, {
            playerId: player.id,
            sourceCardId: ability.sourceCardId,
            abilityId: ability.abilityId,
            amount: config.amount,
          })
        : addHeartLiveModifierForMember(stateWithoutPending, {
            playerId: player.id,
            memberCardId: ability.sourceCardId,
            sourceCardId: ability.sourceCardId,
            abilityId: ability.abilityId,
            hearts: [{ color: config.color, count: config.amount }],
          });
  const modifierApplied = modifierResult !== null;

  return continuePendingCardEffects(
    addAction(modifierResult?.gameState ?? stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: modifierApplied ? config.actionStep : `SOURCE_MEMBER_GAIN_${config.kind}_NO_OP`,
      sourceOnStage,
      requiredStageUnitAlias: config.requiredStageUnitAlias,
      minStageUnitMemberCount: config.minStageUnitMemberCount,
      qualifyingStageUnitMemberCardIds,
      stageUnitMemberConditionMet,
      modifierKind: config.kind,
      modifierAmount: modifierApplied ? config.amount : 0,
      expectedModifierAmount: config.amount,
      modifierApplied,
      ...(config.kind === 'BLADE'
        ? {
            bladeBonus:
              modifierResult && 'bladeBonus' in modifierResult ? modifierResult.bladeBonus : 0,
            expectedBladeBonus: config.amount,
            bladeApplied: modifierApplied,
          }
        : {
            heartColor: config.color,
            heartBonus: modifierApplied ? config.amount : 0,
            expectedHeartBonus: config.amount,
            heartApplied: modifierApplied,
          }),
    }),
    orderedResolution
  );
}
