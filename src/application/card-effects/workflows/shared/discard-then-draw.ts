import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { EnterWaitingRoomEvent } from '../../../../domain/events/game-events.js';
import { CardType, TriggerCondition } from '../../../../shared/types/enums.js';
import { unitAliasIs, typeIs, type CardSelector } from '../../../effects/card-selectors.js';
import {
  HS_BP1_005_ON_ENTER_DISCARD_UP_TO_THREE_DRAW_SAME_COUNT_ABILITY_ID,
  HS_PB1_003_ON_ENTER_DISCARD_MIRACRA_MEMBERS_DRAW_PLUS_ONE_ABILITY_ID,
  HS_PR_031_ON_ENTER_DISCARD_TWO_DRAW_TO_FIVE_ABILITY_ID,
  S_BP3_003_ON_ENTER_DISCARD_LIVE_DRAW_THREE_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { discardHandCardsToWaitingRoomAndEnqueueTriggers } from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: { readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[] }
) => GameState;

type DrawPolicy =
  | { readonly kind: 'DISCARDED_COUNT'; readonly offset: number }
  | { readonly kind: 'UNTIL_HAND_SIZE'; readonly target: number }
  | { readonly kind: 'FIXED'; readonly count: number };

interface DiscardThenDrawConfig {
  readonly abilityId: string;
  readonly stepId: string;
  readonly selector: CardSelector;
  readonly minSelection: number;
  readonly maxSelection: number | 'ALL_CANDIDATES';
  readonly stepText: string;
  readonly selectionLabel?: string;
  readonly confirmSelectionLabel?: string;
  readonly skipSelectionLabel?: string;
  readonly zeroSelectionResolves: boolean;
  readonly drawPolicy: DrawPolicy;
  readonly actionStep: string;
}

const anyCard: CardSelector = () => true;
const miraCraMember: CardSelector = (card) =>
  typeIs(CardType.MEMBER)(card) && unitAliasIs('Mira-Cra Park!')(card);
const liveCard: CardSelector = typeIs(CardType.LIVE);

const CONFIGS: readonly DiscardThenDrawConfig[] = [
  {
    abilityId: S_BP3_003_ON_ENTER_DISCARD_LIVE_DRAW_THREE_ABILITY_ID,
    stepId: 'S_BP3_003_SELECT_LIVE_TO_DISCARD',
    selector: liveCard,
    minSelection: 1,
    maxSelection: 1,
    stepText: '可以将1张手牌的LIVE卡放置入休息室；成功放置后抽3张卡。',
    selectionLabel: '选择要放置入休息室的卡',
    confirmSelectionLabel: '放置入休息室',
    skipSelectionLabel: '不发动',
    zeroSelectionResolves: false,
    drawPolicy: { kind: 'FIXED', count: 3 },
    actionStep: 'DISCARD_LIVE_DRAW_THREE',
  },
  {
    abilityId: HS_PB1_003_ON_ENTER_DISCARD_MIRACRA_MEMBERS_DRAW_PLUS_ONE_ABILITY_ID,
    stepId: 'HS_PB1_003_SELECT_MIRACRA_HAND_MEMBERS',
    selector: miraCraMember,
    minSelection: 0,
    maxSelection: 'ALL_CANDIDATES',
    stepText: '选择任意张手牌中的 Mira-Cra Park! 成员卡放置入休息室。',
    zeroSelectionResolves: true,
    drawPolicy: { kind: 'DISCARDED_COUNT', offset: 1 },
    actionStep: 'DISCARD_MIRACRA_HAND_MEMBERS_DRAW_PLUS_ONE',
  },
  {
    abilityId: HS_BP1_005_ON_ENTER_DISCARD_UP_TO_THREE_DRAW_SAME_COUNT_ABILITY_ID,
    stepId: 'HS_BP1_005_SELECT_UP_TO_THREE_HAND_CARDS',
    selector: anyCard,
    minSelection: 1,
    maxSelection: 3,
    stepText: '请选择1至3张手牌放置入休息室；每放置1张抽1张。',
    skipSelectionLabel: '不发动',
    zeroSelectionResolves: false,
    drawPolicy: { kind: 'DISCARDED_COUNT', offset: 0 },
    actionStep: 'DISCARD_UP_TO_THREE_DRAW_SAME_COUNT',
  },
  {
    abilityId: HS_PR_031_ON_ENTER_DISCARD_TWO_DRAW_TO_FIVE_ABILITY_ID,
    stepId: 'HS_PR_031_SELECT_TWO_HAND_CARDS',
    selector: anyCard,
    minSelection: 2,
    maxSelection: 2,
    stepText: '请选择2张手牌放置入休息室；之后抽至5张手牌。',
    skipSelectionLabel: '不发动',
    zeroSelectionResolves: false,
    drawPolicy: { kind: 'UNTIL_HAND_SIZE', target: 5 },
    actionStep: 'DISCARD_TWO_DRAW_TO_FIVE',
  },
];

export function registerDiscardThenDrawWorkflowHandlers(dependencies: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options) =>
      startDiscardThenDraw(game, ability, config, options.orderedResolution === true)
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
      finishDiscardThenDraw(
        game,
        input.selectedCardIds ?? [],
        config,
        dependencies.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
    );
  }
}

function startDiscardThenDraw(
  game: GameState,
  ability: PendingAbilityState,
  config: DiscardThenDrawConfig,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  const selectableCardIds = player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && config.selector(card);
  });
  const candidateBoundedMax =
    config.maxSelection === 'ALL_CANDIDATES'
      ? selectableCardIds.length
      : Math.min(config.maxSelection, selectableCardIds.length);
  const maxSelectableCards = config.zeroSelectionResolves
    ? candidateBoundedMax
    : Math.max(config.minSelection, candidateBoundedMax);

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: config.stepId,
      stepText: config.stepText,
      selectionLabel: config.selectionLabel,
      confirmSelectionLabel: config.confirmSelectionLabel,
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: config.minSelection,
      maxSelectableCards,
      canSkipSelection: config.zeroSelectionResolves ? undefined : true,
      skipSelectionLabel: config.skipSelectionLabel,
      metadata: { orderedResolution, sourceSlot: ability.sourceSlot },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, step: 'START_DISCARD_THEN_DRAW' },
  });
}

function finishDiscardThenDraw(
  game: GameState,
  selectedCardIds: readonly string[],
  config: DiscardThenDrawConfig,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const maxSelection =
    config.maxSelection === 'ALL_CANDIDATES'
      ? effect?.selectableCardIds?.length ?? 0
      : config.maxSelection;
  const isSkip = selectedCardIds.length === 0 && !config.zeroSelectionResolves;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== config.stepId ||
    !player ||
    selectedCardIds.length !== uniqueSelectedCardIds.length ||
    (!isSkip &&
      (selectedCardIds.length < config.minSelection || selectedCardIds.length > maxSelection)) ||
    uniqueSelectedCardIds.some(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) !== true || !player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  if (isSkip) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_DISCARD_THEN_DRAW',
        sourceSlot: effect.metadata?.sourceSlot,
        discardedCardIds: [],
        drawnCardIds: [],
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    { count: uniqueSelectedCardIds.length, candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) return game;

  const playerAfterDiscard = getPlayerById(discardResult.gameState, player.id);
  if (!playerAfterDiscard) return game;
  const drawCount =
    config.drawPolicy.kind === 'DISCARDED_COUNT'
      ? discardResult.discardedCardIds.length + config.drawPolicy.offset
      : config.drawPolicy.kind === 'FIXED'
        ? config.drawPolicy.count
        : Math.max(0, config.drawPolicy.target - playerAfterDiscard.hand.cardIds.length);
  const drawResult =
    drawCount === 0
      ? { gameState: discardResult.gameState, drawnCardIds: [] as readonly string[] }
      : drawCardsForPlayer(discardResult.gameState, player.id, drawCount);
  if (!drawResult) return game;

  return continuePendingCardEffects(
    addAction({ ...drawResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config.actionStep,
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardIds: discardResult.discardedCardIds,
      drawnCardIds: drawResult.drawnCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}
