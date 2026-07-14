import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { PlayerState } from '../../../../domain/entities/player.js';
import { addMemberLiveStartSuppressionUntilLiveEnd } from '../../../../domain/rules/live-start-suppressions.js';
import { SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type CardAbilityDefinition,
} from '../../ability-definition-types.js';
import { SP_BP2_001_ON_ENTER_SUPPRESS_LIELLA_MEMBER_LIVE_START_RECOVER_LIELLA_CARD_ABILITY_ID } from '../../ability-ids.js';
import { getCardAbilityDefinitionsForCardCode } from '../../definitions/lookup.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_LIELLA_MEMBER_STEP_ID = 'SP_BP2_001_SELECT_LIELLA_MEMBER';
const SELECT_WAITING_ROOM_LIELLA_CARD_STEP_ID = 'SP_BP2_001_SELECT_WAITING_ROOM_LIELLA_CARD';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const STAGE_SLOTS: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];

export function registerSpBp2001KanonWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP2_001_ON_ENTER_SUPPRESS_LIELLA_MEMBER_LIVE_START_RECOVER_LIELLA_CARD_ABILITY_ID,
    (game, ability, options, context) =>
      startSpBp2001KanonOnEnter(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP2_001_ON_ENTER_SUPPRESS_LIELLA_MEMBER_LIVE_START_RECOVER_LIELLA_CARD_ABILITY_ID,
    SELECT_LIELLA_MEMBER_STEP_ID,
    (game, input, context) =>
      finishSelectLiellaMember(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP2_001_ON_ENTER_SUPPRESS_LIELLA_MEMBER_LIVE_START_RECOVER_LIELLA_CARD_ABILITY_ID,
    SELECT_WAITING_ROOM_LIELLA_CARD_STEP_ID,
    (game, input, context) =>
      finishRecoverLiellaCard(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startSpBp2001KanonOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const targetCandidates = getSuppressibleLiellaStageMembers(game, player);
  if (targetCandidates.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      options.orderedResolution === true,
      {
        step: 'NO_SUPPRESSIBLE_LIELLA_MEMBER',
        conditionMet: false,
      },
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_LIELLA_MEMBER_STEP_ID,
      stepText:
        '可以选择自己舞台上1名『Liella!』成员，使其全部【LIVE开始时】能力直到LIVE结束时为止无效。',
      awaitingPlayerId: player.id,
      selectableCardIds: targetCandidates.map((candidate) => candidate.cardId),
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 0,
      maxSelectableCards: 1,
      selectionLabel: '选择要无效LIVE开始时能力的成员',
      confirmSelectionLabel: '无效并继续',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution: options.orderedResolution === true,
        targetCandidates,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_LIELLA_MEMBER_LIVE_START_SUPPRESSION',
      selectableCardIds: targetCandidates.map((candidate) => candidate.cardId),
    },
  });
}

function finishSelectLiellaMember(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || effect.stepId !== SELECT_LIELLA_MEMBER_STEP_ID || !player) {
    return game;
  }

  if (selectedCardId === null) {
    return finishPendingEffect(game, continuePendingCardEffects, {
      step: 'DECLINE_LIELLA_MEMBER_LIVE_START_SUPPRESSION',
      conditionMet: false,
      suppressedMemberCardId: null,
      suppressedAbilityIds: [],
      recoveredCardIds: [],
    });
  }

  const target = getSuppressibleLiellaStageMembers(game, player).find(
    (candidate) => candidate.cardId === selectedCardId
  );
  if (!target || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const stateAfterSuppression = addMemberLiveStartSuppressionUntilLiveEnd(game, {
    playerId: player.id,
    suppressedMemberCardId: target.cardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
  });
  const recoveryCandidates = getLiellaWaitingRoomCardIds(stateAfterSuppression, player.id);
  if (recoveryCandidates.length === 0) {
    return finishPendingEffect(
      {
        ...stateAfterSuppression,
        activeEffect: effect,
      },
      continuePendingCardEffects,
      {
        step: 'SUPPRESS_LIELLA_MEMBER_LIVE_START_NO_RECOVERY_TARGET',
        conditionMet: true,
        suppressedMemberCardId: target.cardId,
        suppressedAbilityIds: target.liveStartAbilityIds,
        recoveredCardIds: [],
      }
    );
  }

  return addAction(
    {
      ...stateAfterSuppression,
      activeEffect: {
        ...effect,
        stepId: SELECT_WAITING_ROOM_LIELLA_CARD_STEP_ID,
        stepText: '请选择自己的休息室中1张『Liella!』卡加入手牌。',
        selectableCardIds: recoveryCandidates,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        selectionLabel: '选择要加入手牌的卡',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          publicCardSelectionConfirmation: { destination: 'HAND' },
          targetMemberCardId: target.cardId,
          suppressedAbilityIds: target.liveStartAbilityIds,
          recoveryCandidates,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SUPPRESS_LIELLA_MEMBER_LIVE_START_SELECT_RECOVERY',
      conditionMet: true,
      suppressedMemberCardId: target.cardId,
      suppressedAbilityIds: target.liveStartAbilityIds,
      selectableCardIds: recoveryCandidates,
    }
  );
}

function finishRecoverLiellaCard(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.stepId !== SELECT_WAITING_ROOM_LIELLA_CARD_STEP_ID ||
    !player ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds: effect.selectableCardIds,
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  return finishPendingEffect(
    {
      ...recoveryResult.gameState,
      activeEffect: effect,
    },
    continuePendingCardEffects,
    {
      step: 'RECOVER_LIELLA_CARD_AFTER_LIVE_START_SUPPRESSION',
      conditionMet: true,
      suppressedMemberCardId: effect.metadata?.targetMemberCardId ?? null,
      suppressedAbilityIds: effect.metadata?.suppressedAbilityIds ?? [],
      selectedCardId,
      recoveredCardIds: recoveryResult.movedCardIds,
    }
  );
}

function finishPendingEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        ...payload,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
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

function getSuppressibleLiellaStageMembers(
  game: GameState,
  player: PlayerState
): readonly {
  readonly cardId: string;
  readonly slot: SlotPosition;
  readonly liveStartAbilityIds: readonly string[];
}[] {
  return STAGE_SLOTS.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId) {
      return [];
    }
    const memberCardId = cardId;
    const card = getCardById(game, memberCardId);
    if (
      !card ||
      card.ownerId !== player.id ||
      !isMemberCardData(card.data) ||
      !groupAliasIs('Liella!')(card)
    ) {
      return [];
    }

    const liveStartAbilityIds = getStageMemberLiveStartAbilityDefinitions(
      card.data.cardCode,
      slot
    ).map((definition) => definition.abilityId);
    return liveStartAbilityIds.length > 0
      ? [{ cardId: memberCardId, slot, liveStartAbilityIds }]
      : [];
  });
}

function getStageMemberLiveStartAbilityDefinitions(
  cardCode: string,
  sourceSlot: SlotPosition
): readonly CardAbilityDefinition[] {
  return getCardAbilityDefinitionsForCardCode(cardCode).filter(
    (definition) =>
      definition.category === CardAbilityCategory.LIVE_START &&
      definition.sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
      definition.triggerCondition === TriggerCondition.ON_LIVE_START &&
      definition.queued &&
      definition.implemented &&
      doesSourceSlotSatisfyAbility(definition, sourceSlot)
  );
}

function doesSourceSlotSatisfyAbility(
  ability: CardAbilityDefinition,
  sourceSlot: SlotPosition
): boolean {
  return (
    ability.requiredSourceSlots === undefined ||
    ability.requiredSourceSlots.length === 0 ||
    ability.requiredSourceSlots.includes(sourceSlot)
  );
}

function getLiellaWaitingRoomCardIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, groupAliasIs('Liella!'));
}
