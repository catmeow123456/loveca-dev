import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { N_SD1_001_LIVE_START_PAY_ONE_ENERGY_OTHER_NIJIGASAKI_MEMBERS_GAIN_BLADE_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const PAY_ENERGY_STEP_ID = 'N_SD1_001_PAY_ENERGY_OTHER_NIJIGASAKI_MEMBERS_GAIN_BLADE';
const ACTIVATE_OPTION_ID = 'activate';
const nijigasakiMember = and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNSd1001AyumuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    N_SD1_001_LIVE_START_PAY_ONE_ENERGY_OTHER_NIJIGASAKI_MEMBERS_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startAyumuLiveStartWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    N_SD1_001_LIVE_START_PAY_ONE_ENERGY_OTHER_NIJIGASAKI_MEMBERS_GAIN_BLADE_ABILITY_ID,
    PAY_ENERGY_STEP_ID,
    (game, input, context) => {
      if (input.selectedOptionId === ACTIVATE_OPTION_ID) {
        return finishAyumuLiveStartWorkflow(game, context.continuePendingCardEffects);
      }
      if (input.selectedOptionId === null || input.selectedOptionId === undefined) {
        return finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
          step: 'DECLINE_PAY_ENERGY',
        });
      }
      return game;
    }
  );
}

function startAyumuLiveStartWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  const activeEnergyCardIds = player
    ? getEnergySelectionCandidates(game, player.id, 'TAP_ACTIVE_ENERGY')
    : [];
  const targetMemberCardIds = player
    ? getOtherNijigasakiStageMemberCardIds(game, player.id, ability.sourceCardId)
    : [];

  if (
    !player ||
    sourceSlot === null ||
    activeEnergyCardIds.length === 0 ||
    targetMemberCardIds.length === 0
  ) {
    return consumeNoOp(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      continuePendingCardEffects,
      {
        step:
          sourceSlot === null
            ? 'SOURCE_NOT_ON_STAGE'
            : activeEnergyCardIds.length === 0
              ? 'NO_ACTIVE_ENERGY'
              : 'NO_OTHER_NIJIGASAKI_MEMBER',
        sourceSlot,
        activeEnergyCardIds,
        targetMemberCardIds,
      }
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: PAY_ENERGY_STEP_ID,
      stepText: '可以支付[E]，使位于自己的舞台的其他『虹咲』成员获得[BLADE]。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: ACTIVATE_OPTION_ID, label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot,
        previewTargetMemberCardIds: targetMemberCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'START_PAY_ENERGY_OPTION',
      activeEnergyCardIds,
      previewTargetMemberCardIds: targetMemberCardIds,
    },
  });
}

function finishAyumuLiveStartWorkflow(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      N_SD1_001_LIVE_START_PAY_ONE_ENERGY_OTHER_NIJIGASAKI_MEMBERS_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== PAY_ENERGY_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (
    !player ||
    getSourceMemberSlot(game, player.id, effect.sourceCardId) === null ||
    getEnergySelectionCandidates(game, player.id, 'TAP_ACTIVE_ENERGY').length === 0
  ) {
    return finishSkippedActiveEffect(game, continuePendingCardEffects, {
      step: 'PAYMENT_BECAME_ILLEGAL',
    });
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return game;
  }

  let state = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const targetMemberCardIds = getOtherNijigasakiStageMemberCardIds(
    state,
    player.id,
    effect.sourceCardId
  );
  const appliedTargetMemberCardIds: string[] = [];
  for (const targetMemberCardId of targetMemberCardIds) {
    const bladeResult = addBladeLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: targetMemberCardId,
      abilityId: effect.abilityId,
      amount: 1,
    });
    if (!bladeResult) continue;
    state = bladeResult.gameState;
    appliedTargetMemberCardIds.push(targetMemberCardId);
  }

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step:
        appliedTargetMemberCardIds.length > 0
          ? 'PAY_ENERGY_OTHER_NIJIGASAKI_MEMBERS_GAIN_BLADE'
          : 'PAY_ENERGY_NO_TARGET_AFTER_PAYMENT',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      targetMemberCardIds,
      appliedTargetMemberCardIds,
      bladeBonusPerMember: 1,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumeNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getOtherNijigasakiStageMemberCardIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, nijigasakiMember).filter(
    (cardId) => cardId !== sourceCardId
  );
}
