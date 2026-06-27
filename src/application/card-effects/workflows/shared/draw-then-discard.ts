import { addAction, getPlayerById, type GameState } from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { SlotPosition, ZoneType } from '../../../../shared/types/enums.js';
import {
  HS_BP2_015_LEAVE_STAGE_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  HS_BP6_019_LEAVE_STAGE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID,
  SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID,
  SP_PB2_036_ON_ENTER_RIGHT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  SP_PB2_037_ON_ENTER_LEFT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
} from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import { registerDrawOnePlaceHandBottomWorkflowHandlers } from './draw-one-place-hand-bottom.js';

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
  readonly continuePendingCardEffects?: ContinuePendingCardEffects;
  readonly recordAbilityUseOnStart?: boolean;
  readonly requiredSourceSlot?: SlotPosition;
  readonly requiresLeaveStageToWaitingRoom?: boolean;
}

export interface DrawThenDiscardAbilityContext {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly sourceSlot?: SlotPosition;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const DRAW_THEN_DISCARD_WORKFLOWS: readonly {
  readonly abilityId: string;
  readonly drawCount: number;
  readonly discardCount: number;
  readonly stepId: string;
  readonly recordAbilityUseOnStart?: boolean;
  readonly requiredSourceSlot?: SlotPosition;
  readonly requiresLeaveStageToWaitingRoom?: boolean;
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
    abilityId: MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
    drawCount: 2,
    discardCount: 2,
    stepId: HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID,
  },
  {
    abilityId: SP_PB2_036_ON_ENTER_RIGHT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
    drawCount: 2,
    discardCount: 2,
    stepId: HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID,
    requiredSourceSlot: SlotPosition.RIGHT,
  },
  {
    abilityId: SP_PB2_037_ON_ENTER_LEFT_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
    drawCount: 2,
    discardCount: 2,
    stepId: HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID,
    requiredSourceSlot: SlotPosition.LEFT,
  },
  {
    abilityId: HS_BP6_019_LEAVE_STAGE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
    drawCount: 2,
    discardCount: 2,
    stepId: HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID,
    requiresLeaveStageToWaitingRoom: true,
  },
  {
    abilityId: HS_BP2_015_LEAVE_STAGE_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    drawCount: 2,
    discardCount: 1,
    stepId: HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID,
    requiresLeaveStageToWaitingRoom: true,
  },
  {
    abilityId: N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID,
    drawCount: 1,
    discardCount: 1,
    stepId: N_BP4_018_SELECT_DISCARD_STEP_ID,
    recordAbilityUseOnStart: true,
  },
];

export function registerDrawThenDiscardWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerDrawOnePlaceHandBottomWorkflowHandlers();

  for (const config of DRAW_THEN_DISCARD_WORKFLOWS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startDrawThenDiscardCardsWorkflow(game, {
        ability,
        effectText: getAbilityEffectText(config.abilityId),
        drawCount: config.drawCount,
        discardCount: config.discardCount,
        stepId: config.stepId,
        orderedResolution: options.orderedResolution === true,
        continuePendingCardEffects: context.continuePendingCardEffects,
        recordAbilityUseOnStart: config.recordAbilityUseOnStart,
        requiredSourceSlot: config.requiredSourceSlot,
        requiresLeaveStageToWaitingRoom: config.requiresLeaveStageToWaitingRoom,
      })
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
      finishDrawThenDiscardCardsWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
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

  const sourceSlot =
    config.ability.sourceSlot ?? findMemberSlot(player, config.ability.sourceCardId);
  if (config.requiredSourceSlot && sourceSlot !== config.requiredSourceSlot) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter(
        (candidate) => candidate.id !== config.ability.id
      ),
    };
    const stateWithAction = addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      step: 'DRAW_DISCARD_SOURCE_SLOT_CONDITION_NOT_MET',
      sourceSlot,
      requiredSourceSlot: config.requiredSourceSlot,
    });
    return config.continuePendingCardEffects
      ? config.continuePendingCardEffects(stateWithAction, config.orderedResolution)
      : stateWithAction;
  }

  if (
    config.requiresLeaveStageToWaitingRoom &&
    config.ability.metadata?.toZone !== ZoneType.WAITING_ROOM
  ) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter(
        (candidate) => candidate.id !== config.ability.id
      ),
    };
    const stateWithAction = addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      step: 'LEAVE_STAGE_NOT_TO_WAITING_ROOM',
      sourceSlot,
      toZone: config.ability.metadata?.toZone ?? null,
    });
    return config.continuePendingCardEffects
      ? config.continuePendingCardEffects(stateWithAction, config.orderedResolution)
      : stateWithAction;
  }

  const stateBeforeDraw =
    config.recordAbilityUseOnStart === true
      ? recordAbilityUseForContext(game, player.id, {
          abilityId: config.ability.abilityId,
          sourceCardId: config.ability.sourceCardId,
        })
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
  const requiredSelectableCount = Math.min(config.discardCount, selectableCardIds.length);
  const discardCountText = requiredSelectableCount === 1 ? '1张' : `${requiredSelectableCount}张`;
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
        selectableCardMode: config.discardCount > 1 ? 'ORDERED_MULTI' : undefined,
        minSelectableCards: config.discardCount > 1 ? requiredSelectableCount : undefined,
        maxSelectableCards: config.discardCount > 1 ? requiredSelectableCount : undefined,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '请选择要放置入休息室的手牌',
        canSkipSelection: selectableCardIds.length === 0,
        skipSelectionLabel: '确认',
        metadata: {
          orderedResolution: config.orderedResolution,
          sourceSlot,
          requiredSourceSlot: config.requiredSourceSlot,
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
      sourceSlot,
      requiredSourceSlot: config.requiredSourceSlot,
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
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
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
      ? Math.min(Math.floor(effect.metadata.discardCount), selectableCardIds.length)
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

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: requiredDiscardCount,
      candidateCardIds: selectableCardIds,
    },
    enqueueTriggeredCardEffects
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
