import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_CL1_010_LIVE_START_HIGH_COST_HASUNOSORA_MEMBER_GAIN_TWO_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_HIGH_COST_HASUNOSORA_MEMBER_STEP_ID =
  'HS_CL1_010_SELECT_HIGH_COST_HASUNOSORA_MEMBER_BLADE_TARGET';
const BLADE_BONUS = 2;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const hasunosoraMember = and(typeIs(CardType.MEMBER), groupAliasIs('蓮ノ空'));

export function registerHsCl1010AwokeWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_CL1_010_LIVE_START_HIGH_COST_HASUNOSORA_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsCl1010AwokeLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_CL1_010_LIVE_START_HIGH_COST_HASUNOSORA_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
    SELECT_HIGH_COST_HASUNOSORA_MEMBER_STEP_ID,
    (game, input, context) =>
      finishHsCl1010SelectBladeTarget(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startHsCl1010AwokeLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = getHighCostHasunosoraStageMemberIds(game, player.id);
  const stateWithoutPending = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_HIGH_COST_HASUNOSORA_MEMBER_TARGET',
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...stateWithoutPending,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_HIGH_COST_HASUNOSORA_MEMBER_STEP_ID,
        stepText: '请选择自己舞台上1名有效费用10以上的「莲之空」成员获得 BLADE +2。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择获得 BLADE +2 的莲之空成员',
        confirmSelectionLabel: '获得 BLADE',
        canSkipSelection: false,
        metadata: {
          orderedResolution,
          eventIds: ability.eventIds,
          timingId: ability.timingId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_HIGH_COST_HASUNOSORA_MEMBER_BLADE_TARGET',
      selectableCardIds,
    }
  );
}

function finishHsCl1010SelectBladeTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_CL1_010_LIVE_START_HIGH_COST_HASUNOSORA_MEMBER_GAIN_TWO_BLADE_ABILITY_ID ||
    effect.stepId !== SELECT_HIGH_COST_HASUNOSORA_MEMBER_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !getHighCostHasunosoraStageMemberIds(game, player.id).includes(selectedCardId)) {
    return game;
  }

  const bladeResult = addBladeLiveModifierForSourceMember(game, {
    playerId: player.id,
    sourceCardId: selectedCardId,
    abilityId: effect.abilityId,
    amount: BLADE_BONUS,
  });
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...bladeResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_HIGH_COST_HASUNOSORA_MEMBER_GAIN_BLADE',
      targetMemberCardId: selectedCardId,
      bladeBonus: BLADE_BONUS,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getHighCostHasunosoraStageMemberIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, hasunosoraMember).filter(
    (cardId) => getMemberEffectiveCost(game, playerId, cardId) >= 10
  );
}
