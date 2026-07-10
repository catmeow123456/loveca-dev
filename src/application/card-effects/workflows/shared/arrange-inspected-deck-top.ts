import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { ZoneType } from '../../../../shared/types/enums.js';
import {
  BP6_016_LIVE_SUCCESS_LOOK_TOP_THREE_ARRANGE_ALL_TO_TOP_ABILITY_ID,
  HS_BP6_028_LIVE_SUCCESS_REMAINING_HEART_LOOK_TOP_TWO_ABILITY_ID,
  HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID,
  HS_PB1_013_LIVE_START_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
  HS_PB1_024_ON_ENTER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
  PL_S_PB1_008_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
  PL_N_BP1_002_ON_ENTER_LOOK_TOP_THREE_ARRANGE_TO_TOP_ABILITY_ID,
  START_DASH_LIVE_SUCCESS_ABILITY_ID,
} from '../../ability-ids.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveInspectedCardsToDeckTopRestToWaitingRoomAndEnqueueTriggers } from '../../runtime/inspection-waiting-room-triggers.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
  maybeStartManualPendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import { countStageMembers } from '../../../effects/conditions.js';
import { inspectTopCards } from '../../../effects/look-top.js';
import { getRemainingHeartTotalCount } from '../../../effects/remaining-hearts.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';

const START_DASH_ARRANGE_STEP_ID = 'START_DASH_ARRANGE_TOP_DECK';
const HS_BP6_001_ARRANGE_STEP_ID = 'HS_BP6_001_ARRANGE_STAGE_PLUS_TWO_TOP_DECK';
const PL_S_PB1_008_CHOOSE_TARGET_PLAYER_STEP_ID = 'PL_S_PB1_008_CHOOSE_TARGET_PLAYER';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type InspectedCardDestination = 'MAIN_DECK_TOP' | 'WAITING_ROOM';
type ArrangeInspectedDeckTopSourceActionLabel = '登场' | 'LIVE开始' | 'LIVE成功';

interface ArrangeInspectedDeckTopPublicSummaryContext {
  readonly effectKind: 'ARRANGE_INSPECTED_DECK_TOP';
  readonly sourceActionLabel: ArrangeInspectedDeckTopSourceActionLabel;
  readonly sourceOrientationCost?: 'WAITING';
  readonly inspectSourceZone: ZoneType.MAIN_DECK;
  readonly requestedInspectCount: number;
  readonly discardedCostCardIds: readonly string[];
}

interface RegisteredArrangeInspectedDeckTopConfig {
  readonly abilityId: string;
  readonly inspectCount: number | ((game: GameState, playerId: string) => number);
  readonly sourceActionLabel: ArrangeInspectedDeckTopSourceActionLabel;
  readonly stepId: string;
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly selectMin: number;
  readonly selectMax: number;
  readonly requireAllInspected?: boolean;
  readonly requireSourceOnOwnStage?: boolean;
  readonly targetPlayerSelection?: {
    readonly stepId: string;
    readonly stepText: string;
  };
  readonly selectedDestination?: InspectedCardDestination;
  readonly unselectedDestination?: InspectedCardDestination;
  readonly condition?: (
    game: GameState,
    playerId: string
  ) => {
    readonly met: boolean;
    readonly stepText: string;
    readonly payload?: Readonly<Record<string, unknown>>;
  };
}

export interface ArrangeInspectedDeckTopConfig {
  readonly ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'>;
  readonly playerId: string;
  readonly deckOwnerId?: string;
  readonly effectText: string;
  readonly inspectCount: number;
  readonly stepId: string;
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly selectMin: number;
  readonly selectMax: number;
  readonly requestedInspectCount?: number;
  readonly sourceActionLabel?: ArrangeInspectedDeckTopSourceActionLabel;
  readonly sourceOrientationCost?: 'WAITING';
  readonly discardedCostCardIds?: readonly string[];
  readonly selectedDestination: InspectedCardDestination;
  readonly unselectedDestination: InspectedCardDestination;
  readonly requireAllInspected?: boolean;
  readonly requireSourceOnOwnStage?: boolean;
  readonly targetPlayerSelection?: RegisteredArrangeInspectedDeckTopConfig['targetPlayerSelection'];
  readonly condition?: RegisteredArrangeInspectedDeckTopConfig['condition'];
  readonly orderedResolution: boolean;
  readonly starterOptions?: PendingAbilityStarterOptions;
}

const ARRANGE_INSPECTED_DECK_TOP_WORKFLOWS: readonly RegisteredArrangeInspectedDeckTopConfig[] = [
  {
    abilityId: START_DASH_LIVE_SUCCESS_ABILITY_ID,
    inspectCount: 3,
    sourceActionLabel: 'LIVE成功',
    stepId: START_DASH_ARRANGE_STEP_ID,
    stepText: '请选择要留在卡组顶的卡牌。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
    selectionLabel: '按卡组顶从上到下的顺序选择卡牌',
    selectMin: 0,
    selectMax: 3,
  },
  {
    abilityId: BP6_016_LIVE_SUCCESS_LOOK_TOP_THREE_ARRANGE_ALL_TO_TOP_ABILITY_ID,
    inspectCount: 3,
    sourceActionLabel: 'LIVE成功',
    stepId: 'BP6_016_ARRANGE_TOP_THREE_ALL',
    stepText: '请按卡组顶从上到下的顺序排列检视的卡牌。数字1会成为卡组最上方的卡。',
    selectionLabel: '按卡组顶从上到下的顺序选择全部卡牌',
    selectMin: 0,
    selectMax: 3,
    requireAllInspected: true,
    selectedDestination: 'MAIN_DECK_TOP',
    unselectedDestination: 'MAIN_DECK_TOP',
  },
  {
    abilityId: PL_N_BP1_002_ON_ENTER_LOOK_TOP_THREE_ARRANGE_TO_TOP_ABILITY_ID,
    inspectCount: 3,
    sourceActionLabel: '登场',
    stepId: 'PL_N_BP1_002_ARRANGE_TOP_THREE',
    stepText: '请选择要留在卡组顶的卡牌。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
    selectionLabel: '按卡组顶从上到下的顺序选择卡牌',
    selectMin: 0,
    selectMax: 3,
  },
  {
    abilityId: HS_BP6_028_LIVE_SUCCESS_REMAINING_HEART_LOOK_TOP_TWO_ABILITY_ID,
    inspectCount: 2,
    sourceActionLabel: 'LIVE成功',
    stepId: 'HS_BP6_028_ARRANGE_TOP_TWO',
    stepText: '请选择要留在卡组顶的卡牌。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
    selectionLabel: '按卡组顶从上到下的顺序选择卡牌',
    selectMin: 0,
    selectMax: 2,
    condition: (game, playerId) => {
      const remainingHeartTotalCount = getRemainingHeartTotalCount(game, playerId);
      return {
        met: remainingHeartTotalCount >= 1,
        stepText:
          remainingHeartTotalCount >= 1
            ? `当前余剩Heart ${remainingHeartTotalCount}个，满足条件。`
            : '当前没有余剩Heart。确认后不检视卡组。',
        payload: { remainingHeartTotalCount },
      };
    },
  },
  {
    abilityId: HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID,
    inspectCount: (game, playerId) => countStageMembers(game, playerId) + 2,
    sourceActionLabel: '登场',
    stepId: HS_BP6_001_ARRANGE_STEP_ID,
    stepText: '请选择1张放回卡组顶。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
    selectionLabel: '选择1张放回卡组顶',
    selectMin: 1,
    selectMax: 1,
  },
  {
    abilityId: HS_PB1_013_LIVE_START_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
    inspectCount: 2,
    sourceActionLabel: 'LIVE开始',
    stepId: 'HS_PB1_013_ARRANGE_TOP_TWO',
    stepText: '请选择要留在卡组顶的卡牌。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
    selectionLabel: '按卡组顶从上到下的顺序选择卡牌',
    selectMin: 0,
    selectMax: 2,
  },
  {
    abilityId: HS_PB1_024_ON_ENTER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
    inspectCount: 2,
    sourceActionLabel: '登场',
    stepId: 'HS_PB1_024_ARRANGE_TOP_TWO',
    stepText: '请选择要留在卡组顶的卡牌。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
    selectionLabel: '按卡组顶从上到下的顺序选择卡牌',
    selectMin: 0,
    selectMax: 2,
  },
  {
    abilityId: PL_S_PB1_008_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
    inspectCount: 2,
    sourceActionLabel: 'LIVE开始',
    stepId: 'PL_S_PB1_008_ARRANGE_TARGET_TOP_TWO',
    stepText:
      '请选择要留在该玩家卡组顶的卡牌。数字1会成为卡组最上方的卡，未选择的卡牌将放置入该玩家的休息室。',
    selectionLabel: '按卡组顶从上到下的顺序选择卡牌',
    selectMin: 0,
    selectMax: 2,
    requireSourceOnOwnStage: true,
    targetPlayerSelection: {
      stepId: PL_S_PB1_008_CHOOSE_TARGET_PLAYER_STEP_ID,
      stepText: '请选择要查看卡组顶的玩家。',
    },
  },
];

export function registerArrangeInspectedDeckTopWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of ARRANGE_INSPECTED_DECK_TOP_WORKFLOWS) {
    if (config.targetPlayerSelection) {
      registerActiveEffectStepHandler(
        config.abilityId,
        config.targetPlayerSelection.stepId,
        (game, input, context) =>
          finishArrangeInspectedDeckTopTargetPlayerSelection(
            game,
            input.selectedOptionId ?? null,
            config,
            context.continuePendingCardEffects
          )
      );
    }
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) => {
      const requestedInspectCount =
        typeof config.inspectCount === 'number'
          ? config.inspectCount
          : config.inspectCount(game, ability.controllerId);
      return startArrangeInspectedDeckTopWorkflow(
        game,
        {
          ability,
          playerId: ability.controllerId,
          effectText: getAbilityEffectText(config.abilityId),
          inspectCount: requestedInspectCount,
          requestedInspectCount,
          sourceActionLabel: config.sourceActionLabel,
          stepId: config.stepId,
          stepText: config.stepText,
          selectionLabel: config.selectionLabel,
          selectMin: config.selectMin,
          selectMax: config.selectMax,
          selectedDestination: config.selectedDestination ?? 'MAIN_DECK_TOP',
          unselectedDestination: config.unselectedDestination ?? 'WAITING_ROOM',
          requireAllInspected: config.requireAllInspected,
          requireSourceOnOwnStage: config.requireSourceOnOwnStage,
          targetPlayerSelection: config.targetPlayerSelection,
          condition: config.condition,
          orderedResolution: options.orderedResolution === true,
          starterOptions: options,
        },
        context.continuePendingCardEffects
      );
    });
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
      finishArrangeInspectedDeckTopWorkflow(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
  }
}

export function startArrangeInspectedDeckTopWorkflow(
  game: GameState,
  config: ArrangeInspectedDeckTopConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, config.playerId);
  if (!player) {
    return game;
  }
  if (
    config.requireSourceOnOwnStage &&
    getSourceMemberSlot(game, player.id, config.ability.sourceCardId) === null
  ) {
    return consumeArrangePendingAsNoOp(game, config, continuePendingCardEffects, player.id, {
      step: 'SOURCE_NOT_ON_STAGE',
      inspectedCardIds: [],
    });
  }

  const condition = config.condition?.(game, player.id);
  if (condition && !condition.met) {
    const manualConfirmation = config.starterOptions
      ? maybeStartConfirmablePendingAbilityConfirmation(
          game,
          config.ability,
          config.starterOptions,
          {
            effectText: `${config.effectText}（${condition.stepText}）`,
            stepText: condition.stepText,
          }
        )
      : null;
    if (manualConfirmation) {
      return manualConfirmation;
    }
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter(
        (candidate) => candidate.id !== config.ability.id
      ),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: config.ability.id,
        abilityId: config.ability.abilityId,
        sourceCardId: config.ability.sourceCardId,
        step: 'CONDITION_NOT_MET',
        inspectedCardIds: [],
        ...(condition.payload ?? {}),
      }),
      config.orderedResolution
    );
  }

  if (config.targetPlayerSelection) {
    return addAction(
      {
        ...game,
        activeEffect: {
          id: config.ability.id,
          abilityId: config.ability.abilityId,
          sourceCardId: config.ability.sourceCardId,
          controllerId: config.ability.controllerId,
          effectText: config.effectText,
          stepId: config.targetPlayerSelection.stepId,
          stepText: config.targetPlayerSelection.stepText,
          awaitingPlayerId: player.id,
          selectableOptions: [
            { id: 'self', label: '自己' },
            { id: 'opponent', label: '对方' },
          ],
          selectionLabel: '选择要查看卡组顶的玩家',
          confirmSelectionLabel: '确定',
          metadata: {
            orderedResolution: config.orderedResolution,
          },
        },
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: config.ability.id,
        abilityId: config.ability.abilityId,
        sourceCardId: config.ability.sourceCardId,
        step: 'START_TARGET_PLAYER_SELECTION',
      }
    );
  }

  const deckOwner = getPlayerById(game, config.deckOwnerId ?? player.id);
  if (!deckOwner) {
    return game;
  }

  if (deckOwner.mainDeck.cardIds.length === 0 && deckOwner.waitingRoom.cardIds.length === 0) {
    const manualConfirmation = config.starterOptions
      ? maybeStartManualPendingAbilityConfirmation(game, config.ability, config.starterOptions)
      : null;
    if (manualConfirmation) {
      return manualConfirmation;
    }
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter(
        (candidate) => candidate.id !== config.ability.id
      ),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: config.ability.id,
        abilityId: config.ability.abilityId,
        sourceCardId: config.ability.sourceCardId,
        step: 'FINISH',
        inspectedCardIds: [],
      }),
      config.orderedResolution
    );
  }

  const inspection = inspectTopCards(game, deckOwner.id, {
    count: config.inspectCount,
    ...(deckOwner.id !== player.id ? { viewerPlayerId: player.id } : {}),
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds } = inspection;
  const minSelectableCards = config.requireAllInspected
    ? inspectedCardIds.length
    : Math.min(config.selectMin, inspectedCardIds.length);
  const maxSelectableCards = config.requireAllInspected
    ? inspectedCardIds.length
    : Math.min(config.selectMax, inspectedCardIds.length);

  const state: GameState = {
    ...gameState,
    pendingAbilities: gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== config.ability.id
    ),
    activeEffect: {
      id: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      controllerId: config.ability.controllerId,
      effectText: config.effectText,
      stepId: config.stepId,
      stepText: config.stepText,
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      selectableCardIds: inspectedCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards,
      maxSelectableCards,
      selectionLabel: config.selectionLabel,
      confirmSelectionLabel: '按此顺序放回卡组顶',
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        deckOwnerId: deckOwner.id,
        selectedDestination: config.selectedDestination,
        unselectedDestination: config.unselectedDestination,
        orderedResolution: config.orderedResolution,
        ...(config.sourceActionLabel && typeof config.requestedInspectCount === 'number'
          ? {
              publicEffectSummaryContext: {
                effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
                sourceActionLabel: config.sourceActionLabel,
                ...(config.sourceOrientationCost
                  ? { sourceOrientationCost: config.sourceOrientationCost }
                  : {}),
                inspectSourceZone: ZoneType.MAIN_DECK,
                requestedInspectCount: config.requestedInspectCount,
                discardedCostCardIds: config.discardedCostCardIds ?? [],
              },
            }
          : {}),
        ...(condition?.payload ?? {}),
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: config.ability.id,
    abilityId: config.ability.abilityId,
    sourceCardId: config.ability.sourceCardId,
    step: 'START_INSPECTION',
    inspectedCardIds,
    ...(deckOwner.id !== player.id ? { deckOwnerId: deckOwner.id } : {}),
    ...(config.sourceActionLabel && typeof config.requestedInspectCount === 'number'
      ? {
          publicEffectSummary: {
            effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
            summaryStatus: 'STARTED',
            sourceActionLabel: config.sourceActionLabel,
            ...(config.sourceOrientationCost
              ? { sourceOrientationCost: config.sourceOrientationCost }
              : {}),
            recoveredCardIds: [],
            discardedCostCardIds: config.discardedCostCardIds ?? [],
            inspectSourceZone: ZoneType.MAIN_DECK,
            requestedInspectCount: config.requestedInspectCount,
            actualInspectedCount: inspectedCardIds.length,
            selectedCardIds: [],
            waitingRoomCardIds: [],
          },
        }
      : {}),
    ...(condition?.payload ?? {}),
  });
}

function finishArrangeInspectedDeckTopTargetPlayerSelection(
  game: GameState,
  selectedOptionId: string | null,
  registeredConfig: RegisteredArrangeInspectedDeckTopConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || (selectedOptionId !== 'self' && selectedOptionId !== 'opponent')) {
    return game;
  }
  const controller = getPlayerById(game, effect.controllerId);
  if (!controller) {
    return game;
  }
  const targetPlayer = selectedOptionId === 'self' ? controller : getOpponent(game, controller.id);
  if (!targetPlayer) {
    return game;
  }
  const requestedInspectCount =
    typeof registeredConfig.inspectCount === 'number'
      ? registeredConfig.inspectCount
      : registeredConfig.inspectCount(game, targetPlayer.id);

  return startArrangeInspectedDeckTopWorkflow(
    {
      ...game,
      activeEffect: null,
    },
    {
      ability: {
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
      },
      playerId: controller.id,
      deckOwnerId: targetPlayer.id,
      effectText: effect.effectText,
      inspectCount: requestedInspectCount,
      requestedInspectCount,
      sourceActionLabel: registeredConfig.sourceActionLabel,
      stepId: registeredConfig.stepId,
      stepText: registeredConfig.stepText,
      selectionLabel: registeredConfig.selectionLabel,
      selectMin: registeredConfig.selectMin,
      selectMax: registeredConfig.selectMax,
      selectedDestination: registeredConfig.selectedDestination ?? 'MAIN_DECK_TOP',
      unselectedDestination: registeredConfig.unselectedDestination ?? 'WAITING_ROOM',
      requireAllInspected: registeredConfig.requireAllInspected,
      requireSourceOnOwnStage: registeredConfig.requireSourceOnOwnStage,
      condition: registeredConfig.condition,
      orderedResolution: effect.metadata?.orderedResolution === true,
    },
    continuePendingCardEffects
  );
}

export function finishArrangeInspectedDeckTopWorkflow(
  game: GameState,
  selectedCardIds: readonly string[],
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

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const selectableCardIds = effect.selectableCardIds ?? [];
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const selectedAreValid =
    uniqueSelectedCardIds.length === selectedCardIds.length &&
    uniqueSelectedCardIds.every(
      (cardId) => inspectedCardIds.includes(cardId) && selectableCardIds.includes(cardId)
    );
  const minCount = effect.minSelectableCards ?? 0;
  const maxCount = effect.maxSelectableCards ?? inspectedCardIds.length;
  if (
    !selectedAreValid ||
    uniqueSelectedCardIds.length < minCount ||
    uniqueSelectedCardIds.length > maxCount
  ) {
    return game;
  }

  const unselectedCardIds = inspectedCardIds.filter(
    (cardId) => !uniqueSelectedCardIds.includes(cardId)
  );
  const deckTopCardIds = [
    ...(effect.metadata?.selectedDestination === 'MAIN_DECK_TOP' ? uniqueSelectedCardIds : []),
    ...(effect.metadata?.unselectedDestination === 'MAIN_DECK_TOP' ? unselectedCardIds : []),
  ];
  const waitingRoomCardIds = [
    ...(effect.metadata?.selectedDestination === 'WAITING_ROOM' ? uniqueSelectedCardIds : []),
    ...(effect.metadata?.unselectedDestination === 'WAITING_ROOM' ? unselectedCardIds : []),
  ];
  const publicEffectSummaryContext = getArrangeInspectedDeckTopPublicSummaryContext(
    effect.metadata?.publicEffectSummaryContext
  );
  const deckOwnerId =
    typeof effect.metadata?.deckOwnerId === 'string' ? effect.metadata.deckOwnerId : player.id;
  const deckOwner = getPlayerById(game, deckOwnerId);
  if (!deckOwner) {
    return game;
  }
  const moveResult = moveInspectedCardsToDeckTopRestToWaitingRoomAndEnqueueTriggers(
    { ...game, activeEffect: null },
    deckOwner.id,
    inspectedCardIds,
    deckTopCardIds,
    waitingRoomCardIds,
    enqueueTriggeredCardEffects
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(moveResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      selectedCardIds: uniqueSelectedCardIds,
      waitingRoomCardIds,
      ...(publicEffectSummaryContext
        ? {
            publicEffectSummary: {
              effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
              summaryStatus: 'COMPLETED',
              sourceActionLabel: publicEffectSummaryContext.sourceActionLabel,
              ...(publicEffectSummaryContext.sourceOrientationCost
                ? { sourceOrientationCost: publicEffectSummaryContext.sourceOrientationCost }
                : {}),
              recoveredCardIds: [],
              discardedCostCardIds: publicEffectSummaryContext.discardedCostCardIds,
              inspectSourceZone: publicEffectSummaryContext.inspectSourceZone,
              requestedInspectCount: publicEffectSummaryContext.requestedInspectCount,
              actualInspectedCount: inspectedCardIds.length,
              selectedCardIds: deckTopCardIds,
              noSelectedCards: deckTopCardIds.length === 0,
              waitingRoomCardIds,
            },
          }
        : {}),
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumeArrangePendingAsNoOp(
  game: GameState,
  config: ArrangeInspectedDeckTopConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  playerId: string,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state = {
    ...game,
    activeEffect: null,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== config.ability.id
    ),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      ...payload,
    }),
    config.orderedResolution
  );
}

function getArrangeInspectedDeckTopPublicSummaryContext(
  value: unknown
): ArrangeInspectedDeckTopPublicSummaryContext | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const context = value as Record<string, unknown>;
  if (context.effectKind !== 'ARRANGE_INSPECTED_DECK_TOP') {
    return undefined;
  }
  if (
    context.sourceActionLabel !== '登场' &&
    context.sourceActionLabel !== 'LIVE开始' &&
    context.sourceActionLabel !== 'LIVE成功'
  ) {
    return undefined;
  }
  if (context.sourceOrientationCost !== undefined && context.sourceOrientationCost !== 'WAITING') {
    return undefined;
  }
  if (context.inspectSourceZone !== ZoneType.MAIN_DECK) {
    return undefined;
  }
  if (typeof context.requestedInspectCount !== 'number') {
    return undefined;
  }
  const discardedCostCardIds = Array.isArray(context.discardedCostCardIds)
    ? context.discardedCostCardIds.filter((cardId): cardId is string => typeof cardId === 'string')
    : [];
  return {
    effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
    sourceActionLabel: context.sourceActionLabel,
    ...(context.sourceOrientationCost
      ? { sourceOrientationCost: context.sourceOrientationCost }
      : {}),
    inspectSourceZone: context.inspectSourceZone,
    requestedInspectCount: context.requestedInspectCount,
    discardedCostCardIds,
  };
}
