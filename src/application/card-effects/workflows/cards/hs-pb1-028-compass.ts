import { isMemberCardData, type CardInstance } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getMemberEffectiveCost } from '../../../../domain/rules/member-effective-cost.js';
import { SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase, normalizeCardCode } from '../../../../shared/utils/card-code.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type CardAbilityDefinition,
} from '../../ability-definition-types.js';
import { HS_PB1_028_LIVE_START_ACTIVATE_DOLLCHESTRA_MEMBER_LIVE_START_ABILITY_ID } from '../../ability-ids.js';
import { CARD_ABILITY_DEFINITIONS } from '../../definitions/index.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import type { DelegatePendingAbility } from '../../runtime/starter-registry.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';

const SELECT_DOLLCHESTRA_TARGET_STEP_ID = 'HS_PB1_028_SELECT_DOLLCHESTRA_TARGET';
const SELECT_TARGET_LIVE_START_ABILITY_STEP_ID = 'HS_PB1_028_SELECT_TARGET_LIVE_START_ABILITY';
const DECLINE_OPTION_ID = 'decline';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface CompassTarget {
  readonly cardId: string;
  readonly slot: SlotPosition;
  readonly abilityDefinitions: readonly CardAbilityDefinition[];
}

export function registerHsPb1028CompassWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_028_LIVE_START_ACTIVATE_DOLLCHESTRA_MEMBER_LIVE_START_ABILITY_ID,
    (game, ability, options, context) =>
      startHsPb1028Compass(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PB1_028_LIVE_START_ACTIVATE_DOLLCHESTRA_MEMBER_LIVE_START_ABILITY_ID,
    SELECT_DOLLCHESTRA_TARGET_STEP_ID,
    (game, input, context) =>
      selectCompassTarget(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PB1_028_LIVE_START_ACTIVATE_DOLLCHESTRA_MEMBER_LIVE_START_ABILITY_ID,
    SELECT_TARGET_LIVE_START_ABILITY_STEP_ID,
    (game, input, context) =>
      delegateCompassTargetAbility(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects,
        context.delegatePendingAbility
      )
  );
}

function startHsPb1028Compass(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const targets = getCompassTargets(game, player.id);
  if (targets.length === 0) {
    return skipCompassWithoutActiveEffect(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_DOLLCHESTRA_TARGET'
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
      stepId: SELECT_DOLLCHESTRA_TARGET_STEP_ID,
      stepText: '请选择自己舞台上1名费用大于等于10的『DOLLCHESTRA』成员。',
      awaitingPlayerId: player.id,
      selectableCardIds: targets.map((target) => target.cardId),
      selectableCardVisibility: 'PUBLIC',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      selectionLabel: '选择要代发LIVE开始能力的成员',
      confirmSelectionLabel: '选择能力',
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
        compassEventIds: ability.eventIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_SELECT_DOLLCHESTRA_TARGET',
      selectableCardIds: targets.map((target) => target.cardId),
    },
  });
}

function selectCompassTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_PB1_028_LIVE_START_ACTIVATE_DOLLCHESTRA_MEMBER_LIVE_START_ABILITY_ID ||
    effect.stepId !== SELECT_DOLLCHESTRA_TARGET_STEP_ID
  ) {
    return game;
  }

  if (selectedCardId === null) {
    return finishSkippedActiveEffect(game, continuePendingCardEffects, {
      step: 'DECLINE_SELECT_DOLLCHESTRA_TARGET',
    });
  }

  const target = getCompassTargets(game, effect.controllerId).find(
    (candidate) => candidate.cardId === selectedCardId
  );
  if (!target || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_TARGET_LIVE_START_ABILITY_STEP_ID,
        stepText: '请选择要发动的该成员【LIVE开始时】能力，也可以不发动。',
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectableOptions: [
          ...target.abilityDefinitions.map((definition) => ({
            id: definition.abilityId,
            label: `发动：${definition.effectText}`,
          })),
          { id: DECLINE_OPTION_ID, label: '不发动' },
        ],
        selectionLabel: '选择要发动的能力',
        confirmSelectionLabel: '发动',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          targetCardId: target.cardId,
          targetSlot: target.slot,
          targetAbilityIds: target.abilityDefinitions.map((definition) => definition.abilityId),
        },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_DOLLCHESTRA_TARGET',
      targetCardId: target.cardId,
      targetSlot: target.slot,
      targetAbilityIds: target.abilityDefinitions.map((definition) => definition.abilityId),
    }
  );
}

function delegateCompassTargetAbility(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  delegatePendingAbility: DelegatePendingAbility
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_PB1_028_LIVE_START_ACTIVATE_DOLLCHESTRA_MEMBER_LIVE_START_ABILITY_ID ||
    effect.stepId !== SELECT_TARGET_LIVE_START_ABILITY_STEP_ID
  ) {
    return game;
  }

  if (selectedOptionId === null || selectedOptionId === DECLINE_OPTION_ID) {
    return finishSkippedActiveEffect(game, continuePendingCardEffects, {
      step: 'DECLINE_TARGET_LIVE_START_ABILITY',
    });
  }

  const player = getPlayerById(game, effect.controllerId);
  const targetCardId = getStringMetadata(effect, 'targetCardId');
  if (!player || !targetCardId) {
    return game;
  }

  const target = getCompassTargets(game, player.id).find(
    (candidate) => candidate.cardId === targetCardId
  );
  const selectedAbility = target?.abilityDefinitions.find(
    (definition) => definition.abilityId === selectedOptionId
  );
  if (!target || !selectedAbility) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'TARGET_ABILITY_NOT_AVAILABLE',
        targetCardId,
        selectedAbilityId: selectedOptionId,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const syntheticAbility: PendingAbilityState = {
    id: `compass:${effect.id}:${target.cardId}:${selectedAbility.abilityId}`,
    abilityId: selectedAbility.abilityId,
    sourceCardId: target.cardId,
    controllerId: player.id,
    mandatory: false,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: getStringArrayMetadata(effect, 'compassEventIds', [`compass:${effect.id}`]),
    sourceSlot: target.slot,
    metadata: {
      delegatedByAbilityId: effect.abilityId,
      delegatedBySourceCardId: effect.sourceCardId,
      delegatedTargetCardId: target.cardId,
    },
  };

  const state = addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'DELEGATE_DOLLCHESTRA_LIVE_START_ABILITY',
    targetCardId: target.cardId,
    targetSlot: target.slot,
    delegatedAbilityId: selectedAbility.abilityId,
    syntheticPendingAbilityId: syntheticAbility.id,
  });

  return delegatePendingAbility(state, syntheticAbility, {
    orderedResolution: effect.metadata?.orderedResolution === true,
    skipManualConfirmation: true,
  });
}

function skipCompassWithoutActiveEffect(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      sourceSlot: ability.sourceSlot,
    }),
    orderedResolution
  );
}

function getCompassTargets(game: GameState, playerId: string): readonly CompassTarget[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  const targets: CompassTarget[] = [];
  for (const slot of MEMBER_SLOT_ORDER) {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId) {
      continue;
    }

    const card = getCardById(game, cardId);
    if (!card || !isCompassEligibleTarget(game, playerId, card, slot)) {
      continue;
    }

    const abilityDefinitions = getDelegatableLiveStartDefinitions(card, slot);
    if (abilityDefinitions.length > 0) {
      targets.push({ cardId, slot, abilityDefinitions });
    }
  }
  return targets;
}

function isCompassEligibleTarget(
  game: GameState,
  playerId: string,
  card: CardInstance,
  slot: SlotPosition
): boolean {
  return (
    card.ownerId === playerId &&
    isMemberCardData(card.data) &&
    unitAliasIs('DOLLCHESTRA')(card) &&
    getMemberEffectiveCost(game, playerId, card.instanceId) >= 10 &&
    getDelegatableLiveStartDefinitions(card, slot).length > 0
  );
}

function getDelegatableLiveStartDefinitions(
  card: CardInstance,
  slot: SlotPosition
): readonly CardAbilityDefinition[] {
  return CARD_ABILITY_DEFINITIONS.filter((definition) => {
    if (
      !definition.implemented ||
      !definition.queued ||
      definition.category !== CardAbilityCategory.LIVE_START ||
      definition.sourceZone !== CardAbilitySourceZone.STAGE_MEMBER ||
      definition.triggerCondition !== TriggerCondition.ON_LIVE_START ||
      !doesDefinitionMatchCardCode(definition, card.data.cardCode)
    ) {
      return false;
    }
    return (
      definition.requiredSourceSlots === undefined ||
      definition.requiredSourceSlots.length === 0 ||
      definition.requiredSourceSlots.includes(slot)
    );
  });
}

function doesDefinitionMatchCardCode(
  definition: CardAbilityDefinition,
  cardCode: string
): boolean {
  const normalizedCardCode = normalizeCardCode(cardCode);
  return (
    definition.cardCodes?.map(normalizeCardCode).includes(normalizedCardCode) === true ||
    definition.baseCardCodes?.some((baseCardCode) =>
      cardCodeMatchesBase(normalizedCardCode, baseCardCode)
    ) === true
  );
}

function getStringMetadata(effect: ActiveEffectState, key: string): string | null {
  const value = effect.metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function getStringArrayMetadata(
  effect: ActiveEffectState,
  key: string,
  fallback: readonly string[]
): readonly string[] {
  const value = effect.metadata?.[key];
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string')
    ? value
    : fallback;
}
