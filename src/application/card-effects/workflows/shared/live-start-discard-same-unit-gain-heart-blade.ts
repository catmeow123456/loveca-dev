import { createHeartIcon, type CardInstance } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import {
  HS_PR_016_LIVE_START_DISCARD_SAME_UNIT_GAIN_GREEN_HEART_BLADE_ABILITY_ID,
  HS_PR_017_LIVE_START_DISCARD_SAME_UNIT_GAIN_BLUE_HEART_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';

const SELECT_SAME_UNIT_HAND_CARDS_STEP_ID = 'HS_PR_SELECT_SAME_UNIT_HAND_CARDS';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type CardInstanceWithUnitName = CardInstance & {
  readonly data: CardInstance['data'] & { readonly unitName: string };
};

interface SameUnitHeartBladeConfig {
  readonly abilityId: string;
  readonly baseCardCode: string;
  readonly heartColor: HeartColor;
  readonly heartLabel: string;
}

const SAME_UNIT_HEART_BLADE_WORKFLOWS: readonly SameUnitHeartBladeConfig[] = [
  {
    abilityId: HS_PR_016_LIVE_START_DISCARD_SAME_UNIT_GAIN_GREEN_HEART_BLADE_ABILITY_ID,
    baseCardCode: 'PL!HS-PR-016',
    heartColor: HeartColor.GREEN,
    heartLabel: '绿色Heart',
  },
  {
    abilityId: HS_PR_017_LIVE_START_DISCARD_SAME_UNIT_GAIN_BLUE_HEART_BLADE_ABILITY_ID,
    baseCardCode: 'PL!HS-PR-017',
    heartColor: HeartColor.BLUE,
    heartLabel: '蓝色Heart',
  },
];

export function registerLiveStartDiscardSameUnitGainHeartBladeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of SAME_UNIT_HEART_BLADE_WORKFLOWS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startSameUnitHeartBladeWorkflow(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(config.abilityId, SELECT_SAME_UNIT_HAND_CARDS_STEP_ID, (
      game,
      input,
      context
    ) =>
      input.selectedCardIds
        ? finishSameUnitHeartBladeWorkflow(
            game,
            input.selectedCardIds,
            config,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
    );
  }
}

function startSameUnitHeartBladeWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  config: SameUnitHeartBladeConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = getSameUnitPairCandidateIds(game, player.hand.cardIds);
  if (selectableCardIds.length < 2) {
    return skipPendingAbilityWithoutActiveEffect(
      game,
      ability,
      player.id,
      orderedResolution,
      'NO_SAME_UNIT_HAND_PAIR',
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
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: SELECT_SAME_UNIT_HAND_CARDS_STEP_ID,
      stepText: `可以选择2张持有相同UNIT名的手牌放置入休息室，获得2个${config.heartLabel}与2个BLADE。`,
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      selectionLabel: '选择同UNIT手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
        baseCardCode: config.baseCardCode,
        heartColor: config.heartColor,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_SAME_UNIT_HAND_CARDS',
      sourceSlot: ability.sourceSlot,
      selectableCardIds,
      minSelectableCards: 2,
      maxSelectableCards: 2,
      heartColor: config.heartColor,
      heartCount: 2,
      bladeBonus: 2,
    },
  });
}

function finishSameUnitHeartBladeWorkflow(
  game: GameState,
  selectedCardIds: readonly string[],
  config: SameUnitHeartBladeConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const selectedUnitName = getSharedUnitName(game, uniqueSelectedCardIds);
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== SELECT_SAME_UNIT_HAND_CARDS_STEP_ID ||
    !player ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length !== 2 ||
    selectedUnitName === null ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true && player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: 2,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const heartBonus = createHeartIcon(config.heartColor, 2);
  const heartResult = addHeartLiveModifierForMember(
    { ...discardResult.gameState, activeEffect: null },
    {
      playerId: player.id,
      memberCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: [heartBonus],
    }
  );
  if (!heartResult) {
    return game;
  }

  const bladeResult = addBladeLiveModifierForSourceMember(heartResult.gameState, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: 2,
  });
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(bladeResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_SAME_UNIT_HAND_CARDS_GAIN_SOURCE_HEART_BLADE',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardIds: discardResult.discardedCardIds,
      discardedUnitName: selectedUnitName,
      heartBonus,
      bladeBonus: 2,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function skipPendingAbilityWithoutActiveEffect(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects
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

function getSameUnitPairCandidateIds(
  game: GameState,
  candidateCardIds: readonly string[]
): readonly string[] {
  return candidateCardIds.filter((cardId) =>
    candidateCardIds.some((otherCardId) => otherCardId !== cardId && cardUnitsMatch(game, cardId, otherCardId))
  );
}

function getSharedUnitName(game: GameState, cardIds: readonly string[]): string | null {
  const firstCardId = cardIds[0];
  const firstCard = firstCardId ? getCardById(game, firstCardId) : null;
  if (!hasUnitName(firstCard)) {
    return null;
  }

  if (!cardIds.every((cardId) => cardId === firstCardId || cardUnitsMatch(game, firstCardId, cardId))) {
    return null;
  }
  return firstCard.data.unitName;
}

function cardUnitsMatch(game: GameState, firstCardId: string, secondCardId: string): boolean {
  const firstCard = getCardById(game, firstCardId);
  const secondCard = getCardById(game, secondCardId);
  if (!hasUnitName(firstCard) || !hasUnitName(secondCard)) {
    return false;
  }

  return unitAliasIs(firstCard.data.unitName)(secondCard) || unitAliasIs(secondCard.data.unitName)(firstCard);
}

function hasUnitName(card: CardInstance | null | undefined): card is CardInstanceWithUnitName {
  return typeof card?.data.unitName === 'string' && card.data.unitName.trim().length > 0;
}
