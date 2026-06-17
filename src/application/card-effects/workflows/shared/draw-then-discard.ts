import {
  addAction,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import type { SlotPosition } from '../../../../shared/types/enums.js';
import {
  HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID,
  SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID,
} from '../../ability-ids.js';
import { CARD_ABILITY_DEFINITIONS } from '../../definitions/index.js';
import {
  discardHandCardsToWaitingRoomForPlayer,
  drawCardsForPlayer,
} from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';

const ABILITY_USE_STEP = 'ABILITY_USE';
const SHIKI_LEFT_SELECT_DISCARD_STEP_ID = 'SHIKI_LEFT_SELECT_DISCARD_AFTER_DRAW';
const HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID = 'HS_BP1_006_ON_ENTER_SELECT_DISCARD';
const N_BP4_018_SELECT_DISCARD_STEP_ID = 'N_BP4_018_SELECT_DISCARD';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export interface DrawThenDiscardCardsWorkflowConfig {
  readonly ability: DrawThenDiscardAbilityContext;
  readonly effectText: string;
  readonly drawCount: number;
  readonly discardCount: number;
  readonly stepId: string;
  readonly orderedResolution: boolean;
  readonly recordAbilityUseOnStart?: boolean;
}

export interface DrawThenDiscardAbilityContext {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly sourceSlot?: SlotPosition;
}

const DRAW_THEN_DISCARD_WORKFLOWS: readonly {
  readonly abilityId: string;
  readonly drawCount: number;
  readonly discardCount: number;
  readonly stepId: string;
  readonly recordAbilityUseOnStart?: boolean;
}[] = [
  {
    abilityId: SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID,
    drawCount: 2,
    discardCount: 1,
    stepId: SHIKI_LEFT_SELECT_DISCARD_STEP_ID,
  },
  {
    abilityId: HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
    drawCount: 2,
    discardCount: 1,
    stepId: HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID,
  },
  {
    abilityId: HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
    drawCount: 1,
    discardCount: 1,
    stepId: HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID,
  },
  {
    abilityId: N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID,
    drawCount: 1,
    discardCount: 1,
    stepId: N_BP4_018_SELECT_DISCARD_STEP_ID,
    recordAbilityUseOnStart: true,
  },
];

export function registerDrawThenDiscardWorkflowHandlers(): void {
  for (const config of DRAW_THEN_DISCARD_WORKFLOWS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options) =>
      startDrawThenDiscardCardsWorkflow(game, {
        ability,
        effectText: getCardAbilityEffectText(config.abilityId),
        drawCount: config.drawCount,
        discardCount: config.discardCount,
        stepId: config.stepId,
        orderedResolution: options.orderedResolution === true,
        recordAbilityUseOnStart: config.recordAbilityUseOnStart,
      })
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
      finishDrawThenDiscardCardsWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
    );
  }
}

export function startDrawThenDiscardCardsWorkflow(
  game: GameState,
  config: DrawThenDiscardCardsWorkflowConfig
): GameState {
  const player = getPlayerById(game, config.ability.controllerId);
  if (!player) {
    return game;
  }

  const stateBeforeDraw =
    config.recordAbilityUseOnStart === true
      ? recordAbilityUse(game, player.id, config.ability.abilityId, config.ability.sourceCardId)
      : game;
  const drawResult = drawCardsForPlayer(stateBeforeDraw, player.id, config.drawCount);
  if (!drawResult) {
    return game;
  }

  const playerAfterDraw = getPlayerById(drawResult.gameState, player.id);
  if (!playerAfterDraw) {
    return game;
  }

  const selectableCardIds = [...playerAfterDraw.hand.cardIds];
  const discardCountText = config.discardCount === 1 ? '1张' : `${config.discardCount}张`;
  return addAction(
    {
      ...drawResult.gameState,
      pendingAbilities: drawResult.gameState.pendingAbilities.filter(
        (candidate) => candidate.id !== config.ability.id
      ),
      activeEffect: {
        id: config.ability.id,
        abilityId: config.ability.abilityId,
        sourceCardId: config.ability.sourceCardId,
        controllerId: config.ability.controllerId,
        effectText: config.effectText,
        stepId: config.stepId,
        stepText:
          selectableCardIds.length > 0
            ? `请选择${discardCountText}手牌放置入休息室。`
            : '没有可放置入休息室的手牌。确认后继续。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '请选择要放置入休息室的手牌',
        canSkipSelection: selectableCardIds.length === 0,
        skipSelectionLabel: '确认',
        metadata: {
          orderedResolution: config.orderedResolution,
          sourceSlot: config.ability.sourceSlot,
          drawCount: config.drawCount,
          discardCount: config.discardCount,
          drawnCardIds: drawResult.drawnCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      step: 'DRAW_CARDS_START_DISCARD',
      sourceSlot: config.ability.sourceSlot,
      drawCount: config.drawCount,
      discardCount: config.discardCount,
      drawnCardIds: drawResult.drawnCardIds,
      selectableCardIds,
    }
  );
}

export function finishDrawThenDiscardCardsWorkflow(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = effect.selectableCardIds ?? [];
  const requiredDiscardCount =
    typeof effect.metadata?.discardCount === 'number' && effect.metadata.discardCount > 0
      ? Math.floor(effect.metadata.discardCount)
      : 1;
  const selectedCardIdsList =
    selectedCardIds && selectedCardIds.length > 0
      ? selectedCardIds
      : selectedCardId
        ? [selectedCardId]
        : [];

  if (selectedCardIdsList.length === 0) {
    if (selectableCardIds.length > 0) {
      return game;
    }
    const state = { ...game, activeEffect: null };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'FINISH',
        sourceSlot: effect.metadata?.sourceSlot,
        drawnCardIds: effect.metadata?.drawnCardIds,
        discardedCardId: null,
        discardedCardIds: [],
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIdsList)];
  if (
    uniqueSelectedCardIds.length !== requiredDiscardCount ||
    uniqueSelectedCardIds.length !== selectedCardIdsList.length ||
    uniqueSelectedCardIds.some(
      (cardId) => !selectableCardIds.includes(cardId) || !player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomForPlayer(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: requiredDiscardCount,
      candidateCardIds: selectableCardIds,
    }
  );
  if (!discardResult) {
    return game;
  }

  const state = {
    ...discardResult.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD',
      sourceSlot: effect.metadata?.sourceSlot,
      drawnCardIds: effect.metadata?.drawnCardIds,
      discardedCardId: discardResult.discardedCardIds[0],
      discardedCardIds: discardResult.discardedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function recordAbilityUse(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): GameState {
  return addAction(game, 'RESOLVE_ABILITY', playerId, {
    abilityId,
    sourceCardId,
    step: ABILITY_USE_STEP,
    turnCount: game.turnCount,
  });
}

function getCardAbilityEffectText(abilityId: string): string {
  const effectText = CARD_ABILITY_DEFINITIONS.find(
    (ability) => ability.abilityId === abilityId
  )?.effectText;
  if (!effectText || effectText.trim().length === 0) {
    throw new Error(`Missing card ability effect text for abilityId: ${abilityId}`);
  }
  return effectText;
}
