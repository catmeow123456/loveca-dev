import {
  addAction,
  getPlayerById,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { ZoneType } from '../../../../shared/types/enums.js';
import {
  BP6_016_LIVE_SUCCESS_LOOK_TOP_THREE_ARRANGE_ALL_TO_TOP_ABILITY_ID,
  HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID,
  PL_N_BP1_002_ON_ENTER_LOOK_TOP_THREE_ARRANGE_TO_TOP_ABILITY_ID,
  START_DASH_LIVE_SUCCESS_ABILITY_ID,
} from '../../ability-ids.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartManualPendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import { countStageMembers } from '../../../effects/conditions.js';
import {
  clearInspectionCards,
  inspectTopCards,
} from '../../../effects/look-top.js';

const START_DASH_ARRANGE_STEP_ID = 'START_DASH_ARRANGE_TOP_DECK';
const HS_BP6_001_ARRANGE_STEP_ID = 'HS_BP6_001_ARRANGE_STAGE_PLUS_TWO_TOP_DECK';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type InspectedCardDestination = 'MAIN_DECK_TOP' | 'WAITING_ROOM';

interface RegisteredArrangeInspectedDeckTopConfig {
  readonly abilityId: string;
  readonly inspectCount: number | ((game: GameState, playerId: string) => number);
  readonly stepId: string;
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly selectMin: number;
  readonly selectMax: number;
  readonly requireAllInspected?: boolean;
  readonly selectedDestination?: InspectedCardDestination;
  readonly unselectedDestination?: InspectedCardDestination;
}

export interface ArrangeInspectedDeckTopConfig {
  readonly ability: Pick<
    PendingAbilityState,
    'id' | 'abilityId' | 'sourceCardId' | 'controllerId'
  >;
  readonly playerId: string;
  readonly effectText: string;
  readonly inspectCount: number;
  readonly stepId: string;
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly selectMin: number;
  readonly selectMax: number;
  readonly selectedDestination: InspectedCardDestination;
  readonly unselectedDestination: InspectedCardDestination;
  readonly requireAllInspected?: boolean;
  readonly orderedResolution: boolean;
  readonly starterOptions?: PendingAbilityStarterOptions;
}

const ARRANGE_INSPECTED_DECK_TOP_WORKFLOWS: readonly RegisteredArrangeInspectedDeckTopConfig[] = [
  {
    abilityId: START_DASH_LIVE_SUCCESS_ABILITY_ID,
    inspectCount: 3,
    stepId: START_DASH_ARRANGE_STEP_ID,
    stepText: '请选择要留在卡组顶的卡牌。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
    selectionLabel: '按卡组顶从上到下的顺序选择卡牌',
    selectMin: 0,
    selectMax: 3,
  },
  {
    abilityId: BP6_016_LIVE_SUCCESS_LOOK_TOP_THREE_ARRANGE_ALL_TO_TOP_ABILITY_ID,
    inspectCount: 3,
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
    stepId: 'PL_N_BP1_002_ARRANGE_TOP_THREE',
    stepText:
      '请选择要留在卡组顶的卡牌。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
    selectionLabel: '按卡组顶从上到下的顺序选择卡牌',
    selectMin: 0,
    selectMax: 3,
  },
  {
    abilityId: HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID,
    inspectCount: (game, playerId) => countStageMembers(game, playerId) + 2,
    stepId: HS_BP6_001_ARRANGE_STEP_ID,
    stepText: '请选择1张放回卡组顶。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
    selectionLabel: '选择1张放回卡组顶',
    selectMin: 1,
    selectMax: 1,
  },
];

export function registerArrangeInspectedDeckTopWorkflowHandlers(): void {
  for (const config of ARRANGE_INSPECTED_DECK_TOP_WORKFLOWS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startArrangeInspectedDeckTopWorkflow(
        game,
        {
          ability,
          playerId: ability.controllerId,
          effectText: getAbilityEffectText(config.abilityId),
          inspectCount:
            typeof config.inspectCount === 'number'
              ? config.inspectCount
              : config.inspectCount(game, ability.controllerId),
          stepId: config.stepId,
          stepText: config.stepText,
          selectionLabel: config.selectionLabel,
          selectMin: config.selectMin,
          selectMax: config.selectMax,
          selectedDestination: config.selectedDestination ?? 'MAIN_DECK_TOP',
          unselectedDestination: config.unselectedDestination ?? 'WAITING_ROOM',
          requireAllInspected: config.requireAllInspected,
          orderedResolution: options.orderedResolution === true,
          starterOptions: options,
        },
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
      finishArrangeInspectedDeckTopWorkflow(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects
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

  if (player.mainDeck.cardIds.length === 0) {
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

  const inspection = inspectTopCards(game, player.id, {
    count: config.inspectCount,
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
        selectedDestination: config.selectedDestination,
        unselectedDestination: config.unselectedDestination,
        orderedResolution: config.orderedResolution,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: config.ability.id,
    abilityId: config.ability.abilityId,
    sourceCardId: config.ability.sourceCardId,
    step: 'START_INSPECTION',
    inspectedCardIds,
  });
}

export function finishArrangeInspectedDeckTopWorkflow(
  game: GameState,
  selectedCardIds: readonly string[],
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
  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    mainDeck:
      deckTopCardIds.length > 0
        ? {
            ...currentPlayer.mainDeck,
            cardIds: [...deckTopCardIds, ...currentPlayer.mainDeck.cardIds],
          }
        : currentPlayer.mainDeck,
    waitingRoom:
      effect.metadata?.unselectedDestination === 'WAITING_ROOM'
        ? {
            ...currentPlayer.waitingRoom,
            cardIds: [...currentPlayer.waitingRoom.cardIds, ...unselectedCardIds],
          }
        : currentPlayer.waitingRoom,
  }));

  state = clearInspectionCards({ ...state, activeEffect: null }, inspectedCardIds);
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      selectedCardIds: uniqueSelectedCardIds,
      waitingRoomCardIds: unselectedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}
