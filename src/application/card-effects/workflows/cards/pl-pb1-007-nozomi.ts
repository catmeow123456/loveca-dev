import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupIs, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { PL_PB1_007_ACTIVATED_SUCCESS_COUNT_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const DISCARD_STEP = 'PL_PB1_007_SELECT_DYNAMIC_HAND_DISCARD';
const RECOVER_STEP = 'PL_PB1_007_SELECT_MUSE_LIVE_FROM_WAITING_ROOM';
const museLive = and(typeIs(CardType.LIVE), groupIs("μ's"));

export function registerPlPb1007NozomiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(
    PL_PB1_007_ACTIVATED_SUCCESS_COUNT_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
    (game, playerId, cardId) => start(game, playerId, cardId, deps.enqueueTriggeredCardEffects)
  );
  registerActiveEffectStepHandler(
    PL_PB1_007_ACTIVATED_SUCCESS_COUNT_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
    DISCARD_STEP,
    (game, input, context) =>
      payAndContinue(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_PB1_007_ACTIVATED_SUCCESS_COUNT_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
    RECOVER_STEP,
    (game, input, context) =>
      finishRecovery(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function start(
  game: GameState,
  playerId: string,
  cardId: string,
  enqueue: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.players[game.activePlayerIndex]?.id !== playerId
  )
    return game;
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  if (
    !player ||
    !source ||
    source.ownerId !== playerId ||
    !isMemberCardData(source.data) ||
    !cardCodeMatchesBase(source.data.cardCode, 'PL!-pb1-007') ||
    sourceSlot === null
  )
    return game;
  const discardCount = Math.max(0, 3 - player.successZone.cardIds.length);
  if (player.hand.cardIds.length < discardCount) return game;
  const id = `${PL_PB1_007_ACTIVATED_SUCCESS_COUNT_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`;
  if (discardCount === 0)
    return afterCost(
      game,
      {
        id,
        abilityId: PL_PB1_007_ACTIVATED_SUCCESS_COUNT_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: playerId,
        sourceSlot,
      },
      [],
      (g) => g
    );
  return addAction(
    {
      ...game,
      activeEffect: {
        id,
        abilityId: PL_PB1_007_ACTIVATED_SUCCESS_COUNT_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: playerId,
        effectText: getAbilityEffectText(
          PL_PB1_007_ACTIVATED_SUCCESS_COUNT_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID
        ),
        stepId: DISCARD_STEP,
        stepText: `请选择${discardCount}张手牌放置入休息室。`,
        awaitingPlayerId: playerId,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: discardCount,
        maxSelectableCards: discardCount,
        selectionLabel: `选择要放置入休息室的${discardCount}张手牌`,
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
        metadata: { sourceSlot, discardCount },
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: PL_PB1_007_ACTIVATED_SUCCESS_COUNT_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
      sourceCardId: cardId,
      step: 'SELECT_DISCARD',
      discardCount,
    }
  );
}

function payAndContinue(
  game: GameState,
  selected: readonly string[],
  cont: (game: GameState, ordered: boolean) => GameState,
  enqueue: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== DISCARD_STEP) return game;
  const player = getPlayerById(game, effect.controllerId);
  const count = Number(effect.metadata?.discardCount ?? -1);
  const unique = [...new Set(selected)];
  if (
    !player ||
    count <= 0 ||
    unique.length !== selected.length ||
    unique.length !== count ||
    !unique.every(
      (id) => effect.selectableCardIds?.includes(id) && player.hand.cardIds.includes(id)
    )
  )
    return game;
  const result = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    unique,
    { count, candidateCardIds: effect.selectableCardIds ?? [] },
    enqueue
  );
  if (!result) return game;
  return afterCost(
    result.gameState,
    {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: player.id,
      sourceSlot: effect.metadata?.sourceSlot,
    },
    result.discardedCardIds,
    cont
  );
}

function afterCost(
  game: GameState,
  effect: {
    id: string;
    abilityId: string;
    sourceCardId: string;
    controllerId: string;
    sourceSlot: unknown;
  },
  discardedCardIds: readonly string[],
  cont: (game: GameState, ordered: boolean) => GameState
): GameState {
  let state = recordPayCostAction(game, effect.controllerId, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.sourceSlot,
    discardedHandCardIds: discardedCardIds,
  });
  state = recordAbilityUseForContext(state, effect.controllerId, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });
  const hasOther = getStageMemberCardIdsMatching(
    state,
    effect.controllerId,
    and(typeIs(CardType.MEMBER), unitAliasIs('lilywhite'))
  ).some((id) => id !== effect.sourceCardId);
  const candidates = hasOther ? selectWaitingRoomCardIds(state, effect.controllerId, museLive) : [];
  if (!hasOther || candidates.length === 0)
    return cont(
      addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: hasOther ? 'NO_TARGET' : 'NO_OTHER_LILY_WHITE',
        discardedHandCardIds: discardedCardIds,
      }),
      false
    );
  return addAction(
    {
      ...state,
      activeEffect: createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
        effectText: getAbilityEffectText(effect.abilityId),
        stepId: RECOVER_STEP,
        stepText: "请选择自己休息室1张『μ's』的LIVE卡加入手牌。",
        awaitingPlayerId: effect.controllerId,
        selectableCardIds: candidates,
        canSkipSelection: false,
        metadata: { sourceSlot: effect.sourceSlot, discardedHandCardIds: discardedCardIds },
        zoneSelection: createWaitingRoomToHandSelectionConfig({
          minCount: 1,
          maxCount: 1,
          optional: false,
        }),
      }),
    },
    'PAY_COST',
    effect.controllerId,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      discardedHandCardIds: discardedCardIds,
      selectableCardIds: candidates,
    }
  );
}

function finishRecovery(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined,
  cont: (game: GameState, ordered: boolean) => GameState
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_PB1_007_ACTIVATED_SUCCESS_COUNT_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID ||
    effect.stepId !== RECOVER_STEP ||
    selectedCardId === null
  )
    return game;
  if (effect.selectableCardIds?.includes(selectedCardId) !== true) return game;

  const player = getPlayerById(game, effect.controllerId);
  const selectedCard = getCardById(game, selectedCardId);
  if (
    !player ||
    !selectedCard ||
    selectedCard.ownerId !== player.id ||
    !player.waitingRoom.cardIds.includes(selectedCardId) ||
    !museLive(selectedCard)
  ) {
    return cont(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'STALE_TARGET',
        selectedCardId,
      }),
      false
    );
  }

  return finishWaitingRoomToHandWorkflow(game, selectedCardId, selectedCardIds, cont);
}
