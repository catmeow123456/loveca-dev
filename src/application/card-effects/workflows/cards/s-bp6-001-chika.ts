import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  CardType,
  OrientationState,
  SlotPosition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { S_BP6_001_ON_ENTER_FROM_WAITING_WAIT_OPPONENT_SIDE_HIGH_COST_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import {
  consumeOnEnterSourceZoneMismatch,
  isOnEnterFromWaitingRoom,
} from '../../runtime/on-enter-source-zone.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { setMemberOrientation } from '../../../effects/member-state.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const S_BP6_001_SELECT_OPPONENT_SIDE_HIGH_COST_STEP_ID =
  'S_BP6_001_SELECT_OPPONENT_SIDE_HIGH_COST_MEMBER_TO_WAIT';
const SIDE_SLOTS = [SlotPosition.LEFT, SlotPosition.RIGHT] as const;

export function registerSBp6001ChikaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(
    S_BP6_001_ON_ENTER_FROM_WAITING_WAIT_OPPONENT_SIDE_HIGH_COST_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startSBp6001ChikaWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP6_001_ON_ENTER_FROM_WAITING_WAIT_OPPONENT_SIDE_HIGH_COST_MEMBER_ABILITY_ID,
    S_BP6_001_SELECT_OPPONENT_SIDE_HIGH_COST_STEP_ID,
    (game, input, context) =>
      finishSBp6001ChikaWorkflow(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startSBp6001ChikaWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  if (!isOnEnterFromWaitingRoom(ability)) {
    return consumeOnEnterSourceZoneMismatch(game, ability, {
      expectedFromZone: ZoneType.WAITING_ROOM,
      orderedResolution,
      continuePendingCardEffects,
    });
  }

  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const selectableCardIds = getOpponentSideHighCostTargetIds(game, opponent.id);
  if (selectableCardIds.length === 0) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot: ability.sourceSlot,
        step: 'SKIP_NO_TARGET',
        expectedFromZone: ZoneType.WAITING_ROOM,
        actualFromZone: ZoneType.WAITING_ROOM,
        targetPlayerId: opponent.id,
        allowedSlots: SIDE_SLOTS,
        minCost: 13,
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createSelectionEffect(ability, player.id, opponent.id, selectableCardIds, {
        orderedResolution,
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_SELECT_OPPONENT_SIDE_HIGH_COST_MEMBER',
      expectedFromZone: ZoneType.WAITING_ROOM,
      actualFromZone: ZoneType.WAITING_ROOM,
      targetPlayerId: opponent.id,
      allowedSlots: SIDE_SLOTS,
      minCost: 13,
      selectableCardIds,
    }
  );
}

function finishSBp6001ChikaWorkflow(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      S_BP6_001_ON_ENTER_FROM_WAITING_WAIT_OPPONENT_SIDE_HIGH_COST_MEMBER_ABILITY_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const targetPlayerId =
    typeof effect.metadata?.targetPlayerId === 'string' ? effect.metadata.targetPlayerId : null;
  if (!player || !targetPlayerId) {
    return game;
  }
  if (!getOpponentSideHighCostTargetIds(game, targetPlayerId).includes(selectedCardId)) {
    return game;
  }

  const orientationChange = setMemberOrientation(
    game,
    targetPlayerId,
    selectedCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!orientationChange) {
    return game;
  }

  const stateWithTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            sourceSlot: effect.metadata?.sourceSlot,
            step: 'WAIT_OPPONENT_SIDE_HIGH_COST_MEMBER',
            targetPlayerId,
            targetCardId: selectedCardId,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
            allowedSlots: SIDE_SLOTS,
            minCost: 13,
          }
        ),
    }
  );

  return continuePendingCardEffects(
    stateWithTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function createSelectionEffect(
  ability: PendingAbilityState,
  playerId: string,
  targetPlayerId: string,
  selectableCardIds: readonly string[],
  metadata: { readonly orderedResolution: boolean }
): ActiveEffectState {
  return {
    id: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    controllerId: playerId,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: S_BP6_001_SELECT_OPPONENT_SIDE_HIGH_COST_STEP_ID,
    stepText: '请选择对方左侧或右侧区域1名费用大于等于13的成员变为待机状态。',
    awaitingPlayerId: playerId,
    selectableCardIds,
    selectionLabel: '选择对方侧边高费用成员',
    metadata: {
      sourceSlot: ability.sourceSlot,
      orderedResolution: metadata.orderedResolution,
      targetPlayerId,
    },
  };
}

function getOpponentSideHighCostTargetIds(game: GameState, playerId: string): string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return SIDE_SLOTS.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId) {
      return [];
    }
    const card = getCardById(game, cardId);
    const cardState = player.memberSlots.cardStates.get(cardId);
    return card &&
      isMemberCardData(card.data) &&
      card.data.cardType === CardType.MEMBER &&
      card.data.cost >= 13 &&
      cardState?.orientation !== OrientationState.WAITING
      ? [cardId]
      : [];
  });
}
