import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, OrientationState } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_SD1_003_LIVE_START_PAY_ENERGY_TARGET_OTHER_HASUNOSORA_HEART_BLADE_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const PAY_ENERGY_STEP_ID = 'HS_SD1_003_LIVE_START_PAY_ENERGY';
const SELECT_TARGET_STEP_ID = 'HS_SD1_003_SELECT_OTHER_HASUNOSORA_HEART_BLADE_TARGET';
const DECLINE_OPTION_LABEL = '不发动';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsSd1003RurinoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_SD1_003_LIVE_START_PAY_ENERGY_TARGET_OTHER_HASUNOSORA_HEART_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsSd1003LiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_SD1_003_LIVE_START_PAY_ENERGY_TARGET_OTHER_HASUNOSORA_HEART_BLADE_ABILITY_ID,
    PAY_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishHsSd1003PayEnergy(game, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_SD1_003_LIVE_START_PAY_ENERGY_TARGET_OTHER_HASUNOSORA_HEART_BLADE_ABILITY_ID,
    SELECT_TARGET_STEP_ID,
    (game, input, context) =>
      finishHsSd1003Target(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startHsSd1003LiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  if (activeEnergyCardIds.length < 1) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_ACTIVE_ENERGY',
      { activeEnergyCardIds }
    );
  }

  const targetCardIds = getOtherHasunosoraStageMemberCardIds(game, player.id, ability.sourceCardId);
  if (targetCardIds.length === 0) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_OTHER_HASUNOSORA_TARGET',
      { activeEnergyCardIds, selectableCardIds: targetCardIds }
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
      stepText:
        '可以支付1张活跃能量。如此做时，选择此成员以外的1名『莲之空』成员获得[桃ハート]与[BLADE]。',
      awaitingPlayerId: player.id,
      selectableOptions: [
        { id: 'pay', label: '支付[E]' },
        { id: 'decline', label: DECLINE_OPTION_LABEL },
      ],
      metadata: {
        orderedResolution,
        activeEnergyCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_OPTION',
      activeEnergyCardIds,
      selectableCardIds: targetCardIds,
    },
  });
}

function finishHsSd1003PayEnergy(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getHsSd1003Effect(game, PAY_ENERGY_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return game;
  }

  const stateAfterCost = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    paidEnergyCardIds: costPayment.paidEnergyCardIds,
  });
  const targetCardIds = getOtherHasunosoraStageMemberCardIds(
    stateAfterCost,
    player.id,
    effect.sourceCardId
  );
  if (targetCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'PAY_ENERGY_NO_OTHER_HASUNOSORA_TARGET',
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
        selectableCardIds: targetCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: {
        ...effect,
        stepId: SELECT_TARGET_STEP_ID,
        stepText:
          '请选择此成员以外的1名『莲之空』成员。LIVE结束时为止，该成员获得[桃ハート]与[BLADE]。',
        selectableCardIds: targetCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择获得[桃ハート]与[BLADE]的莲之空成员',
        selectableOptions: undefined,
        confirmSelectionLabel: '确定',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_ENERGY_SELECT_TARGET',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      selectableCardIds: targetCardIds,
    }
  );
}

function finishHsSd1003Target(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getHsSd1003Effect(game, SELECT_TARGET_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getOtherHasunosoraStageMemberCardIds(game, player.id, effect.sourceCardId).includes(
      selectedCardId
    )
  ) {
    return game;
  }

  const heartResult = addHeartLiveModifierForMember(
    { ...game, activeEffect: null },
    {
      playerId: player.id,
      memberCardId: selectedCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    }
  );
  if (!heartResult) {
    return game;
  }

  const bladeResult = addBladeLiveModifierForSourceMember(heartResult.gameState, {
    playerId: player.id,
    sourceCardId: selectedCardId,
    abilityId: effect.abilityId,
    amount: 1,
  });
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(bladeResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_OTHER_HASUNOSORA_GAIN_PINK_HEART_BLADE',
      paidEnergyCardIds: getStringArrayMetadata(effect, 'paidEnergyCardIds'),
      targetMemberCardId: selectedCardId,
      heartBonus: [{ color: HeartColor.PINK, count: 1 }],
      bladeBonus: bladeResult.bladeBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
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
        step,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getHsSd1003Effect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId ===
    HS_SD1_003_LIVE_START_PAY_ENERGY_TARGET_OTHER_HASUNOSORA_HEART_BLADE_ABILITY_ID &&
    effect.stepId === stepId
    ? effect
    : null;
}

function getOtherHasunosoraStageMemberCardIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, groupAliasIs('蓮ノ空')).filter(
    (cardId) => cardId !== sourceCardId
  );
}

function getActiveEnergyCardIds(player: NonNullable<ReturnType<typeof getPlayerById>>): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function getStringArrayMetadata(effect: ActiveEffectState, key: string): readonly string[] {
  const value = effect.metadata?.[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
