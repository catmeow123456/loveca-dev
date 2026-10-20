import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForSourceMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, GamePhase, HeartColor } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, hasBladeHeart, typeIs } from '../../../effects/card-selectors.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import {
  N_BP8_004_ACTIVATED_HAND_PAY_TWO_DISCARD_SELF_RECOVER_BLADE_HEART_MEMBER_ABILITY_ID as ACTIVATED,
  N_BP8_004_LIVE_START_REVEAL_NIJIGASAKI_HAND_TOP_CHOOSE_HEART_ABILITY_ID as LIVE_START,
} from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { registerActivatedAbilityResourceQuery } from '../../runtime/ability-resource-query.js';
import { moveHandCardToDeckTopForPlayer } from '../../runtime/actions.js';
import {
  finishSkippedActiveEffect,
  revealHandCardForActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { payHandSourceEnergyAndDiscardCost } from '../../runtime/hand-source-cost.js';
import {
  queryCardSelection,
  queryConfirmSelection,
  queryOptionSelection,
} from '../../runtime/selection-query.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const BASE = 'PL!N-bp8-004';
const RECOVER = 'N_BP8_004_SELECT_BLADE_HEART_MEMBER';
const REVEAL = 'N_BP8_004_REVEAL_NIJIGASAKI_HAND';
const PLACE_TOP = 'N_BP8_004_PLACE_REVEALED_HAND_TOP';
const COLOR = 'N_BP8_004_CHOOSE_HEART_COLOR';
const MEMBER_WITH_BLADE_HEART = and(typeIs(CardType.MEMBER), hasBladeHeart());
const NIJIGASAKI_MEMBER = and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'));
const COLORS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
] as const;
const TOKENS = [
  '[桃ハート]',
  '[赤ハート]',
  '[黄ハート]',
  '[緑ハート]',
  '[青ハート]',
  '[紫ハート]',
] as const;
type Continue = (game: GameState, ordered: boolean) => GameState;

export function registerNBp8004KarinWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
  readonly continuePendingCardEffects: Continue;
}): void {
  registerActivatedAbilityHandler(
    ACTIVATED,
    (game, playerId, cardId) => startActivated(game, playerId, cardId, deps),
    canActivate
  );
  registerActivatedAbilityResourceQuery(ACTIVATED, (game, playerId, cardId) =>
    canActivate(game, playerId, cardId)
      ? {
          costs: [{ kind: 'TAP_ACTIVE_ENERGY', count: 2 }],
          targetCardIds: selectWaitingRoomCardIds(game, playerId, MEMBER_WITH_BLADE_HEART),
          destination: 'HAND',
        }
      : undefined
  );
  registerActiveEffectStepHandler(
    ACTIVATED,
    RECOVER,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        {
          currentCandidateCardIds: selectWaitingRoomCardIds(
            game,
            game.activeEffect!.controllerId,
            MEMBER_WITH_BLADE_HEART
          ),
        }
      ),
    queryCardSelection
  );
  registerPendingAbilityStarterHandler(LIVE_START, (game, ability, options, context) =>
    startLive(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    LIVE_START,
    REVEAL,
    (game, input, context) =>
      revealHand(game, input.selectedCardId ?? null, context.continuePendingCardEffects),
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    LIVE_START,
    PLACE_TOP,
    (game) => placeTop(game),
    queryConfirmSelection
  );
  registerActiveEffectStepHandler(
    LIVE_START,
    COLOR,
    (game, input, context) =>
      chooseColor(game, input.selectedOptionId ?? null, context.continuePendingCardEffects),
    queryOptionSelection
  );
}

function canActivate(game: GameState, playerId: string, cardId: string): boolean {
  const player = getPlayerById(game, playerId),
    source = getCardById(game, cardId);
  return (
    !game.activeEffect &&
    game.currentPhase === GamePhase.MAIN_PHASE &&
    game.players[game.activePlayerIndex]?.id === playerId &&
    !!player &&
    !!source &&
    source.ownerId === playerId &&
    isMemberCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, BASE) &&
    player.hand.cardIds.includes(cardId) &&
    getEnergySelectionCandidates(game, playerId, 'TAP_ACTIVE_ENERGY').length >= 2
  );
}
function startActivated(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: {
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
    readonly continuePendingCardEffects: Continue;
  }
): GameState {
  if (!canActivate(game, playerId, cardId)) return game;
  const paid = payHandSourceEnergyAndDiscardCost(
    game,
    playerId,
    cardId,
    { baseCardCodes: [BASE], energyCost: 2 },
    deps.enqueueTriggeredCardEffects
  );
  if (!paid) return game;
  const state = recordAbilityUseForContext(
    recordPayCostAction(paid.gameState, playerId, {
      abilityId: ACTIVATED,
      sourceCardId: cardId,
      paidEnergyCardIds: paid.paidEnergyCardIds,
      energyCardIds: paid.paidEnergyCardIds,
      discardedCardIds: paid.discardedCardIds,
      enterWaitingRoomEventId: paid.enterWaitingRoomEvent?.eventId ?? null,
    }),
    playerId,
    { abilityId: ACTIVATED, sourceCardId: cardId }
  );
  const candidates = selectWaitingRoomCardIds(state, playerId, MEMBER_WITH_BLADE_HEART);
  if (candidates.length === 0)
    return deps.continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', playerId, {
        abilityId: ACTIVATED,
        sourceCardId: cardId,
        step: 'PAID_COST_NO_TARGET',
        recoveredCardIds: [],
      }),
      false
    );
  return {
    ...state,
    activeEffect: createWaitingRoomToHandEffectState({
      id: `${ACTIVATED}:${cardId}:action-${state.actionSequence}`,
      abilityId: ACTIVATED,
      sourceCardId: cardId,
      controllerId: playerId,
      effectText: getAbilityEffectText(ACTIVATED),
      stepId: RECOVER,
      stepText: '请选择自己的休息室中1张持有BLADE HEART的成员卡加入手牌。',
      awaitingPlayerId: playerId,
      selectableCardIds: candidates,
      selectionLabel: '选择要加入手牌的成员卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };
}
function getHandCandidates(game: GameState, playerId: string): readonly string[] {
  return (getPlayerById(game, playerId)?.hand.cardIds ?? []).filter((id) => {
    const card = getCardById(game, id);
    return !!card && card.ownerId === playerId && NIJIGASAKI_MEMBER(card);
  });
}
function startLive(
  game: GameState,
  ability: PendingAbilityState,
  ordered: boolean,
  next: Continue
): GameState {
  const candidates = getHandCandidates(game, ability.controllerId);
  if (candidates.length === 0)
    return next(
      addAction(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter((pending) => pending.id !== ability.id),
        },
        'RESOLVE_ABILITY',
        ability.controllerId,
        {
          abilityId: LIVE_START,
          sourceCardId: ability.sourceCardId,
          pendingAbilityId: ability.id,
          step: 'NO_HAND_MEMBER_TO_REVEAL',
        }
      ),
      ordered
    );
  return startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      id: ability.id,
      abilityId: LIVE_START,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(LIVE_START),
      stepId: REVEAL,
      stepText:
        '可以公开手牌中1张『虹咲』的成员卡。展示结束后将其放置于卡组顶，再指定1种HEART颜色。',
      awaitingPlayerId: ability.controllerId,
      selectableCardIds: candidates,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要公开的虹咲成员卡',
      confirmSelectionLabel: '公开',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution: ordered },
    },
    actionPayload: { step: 'START_SELECT_HAND_CARD' },
  });
}
function revealHand(game: GameState, selectedId: string | null, next: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== LIVE_START || effect.stepId !== REVEAL) return game;
  if (selectedId === null)
    return finishSkippedActiveEffect(game, next, { step: 'DECLINE_REVEAL_HAND' });
  if (
    !effect.selectableCardIds?.includes(selectedId) ||
    !getHandCandidates(game, effect.controllerId).includes(selectedId)
  )
    return game;
  const revealed = revealHandCardForActiveEffect(game, {
    effect,
    playerId: effect.controllerId,
    selectedCardId: selectedId,
    nextStepId: PLACE_TOP,
    nextStepText: '展示结束后，将公开的成员卡放置于卡组顶，再指定1种HEART颜色。',
    actionStep: 'REVEAL_NIJIGASAKI_HAND_MEMBER',
    selectableCardIds: undefined,
    selectableCardVisibility: 'PUBLIC',
    canSkipSelection: false,
    metadata: { revealedHandCardId: selectedId },
  });
  return recordPayCostAction(revealed, effect.controllerId, {
    abilityId: LIVE_START,
    sourceCardId: effect.sourceCardId,
    revealedHandCardIds: [selectedId],
  });
}
function placeTop(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== LIVE_START || effect.stepId !== PLACE_TOP) return game;
  const selectedId = effect.metadata?.revealedHandCardId;
  if (typeof selectedId !== 'string') return game;
  // Revealing paid the cost. Failure to move that card cannot cancel the following color choice.
  const moved = moveHandCardToDeckTopForPlayer(game, effect.controllerId, selectedId, {
    candidateCardIds: [selectedId],
  });
  return addAction(
    {
      ...(moved?.gameState ?? game),
      activeEffect: {
        ...effect,
        stepId: COLOR,
        stepText: '请选择LIVE结束时为止此成员获得的1个HEART的颜色。',
        revealedCardIds: undefined,
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectionLabel: '选择获得的HEART颜色',
        confirmSelectionLabel: '获得HEART',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        effectChoice: {
          mode: 'SINGLE',
          options: COLORS.map((color, index) => ({
            id: color,
            text: `此成员获得${TOKENS[index]}。`,
          })),
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true,
        },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      abilityId: LIVE_START,
      sourceCardId: effect.sourceCardId,
      step: 'PLACE_REVEALED_HAND_TOP',
      movedCardIds: moved ? [selectedId] : [],
    }
  );
}
function chooseColor(game: GameState, color: string | null, next: Continue): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== LIVE_START ||
    effect.stepId !== COLOR ||
    !COLORS.includes(color as (typeof COLORS)[number])
  )
    return game;
  const result = isCurrentStageMemberAbilitySource(game, effect)
    ? addHeartLiveModifierForSourceMember(game, {
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        abilityId: LIVE_START,
        hearts: [{ color: color as HeartColor, count: 1 }],
      })
    : null;
  return next(
    addAction(
      { ...(result?.gameState ?? game), activeEffect: null },
      'RESOLVE_ABILITY',
      effect.controllerId,
      {
        abilityId: LIVE_START,
        sourceCardId: effect.sourceCardId,
        step: 'GAIN_CHOSEN_HEART',
        heartColor: color,
        heartCount: result ? 1 : 0,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}
