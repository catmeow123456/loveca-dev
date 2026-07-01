import { isMemberCardData, type CardInstance } from '../../../../domain/entities/card.js';
import {
  addAction,
  emitGameEvent,
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
} from '../../../../domain/entities/game.js';
import { createEnterWaitingRoomEvent } from '../../../../domain/events/game-events.js';
import { addCardToZone } from '../../../../domain/entities/zone.js';
import { CardType, HeartColor, TriggerCondition, ZoneType } from '../../../../shared/types/enums.js';
import {
  BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID,
  HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID,
  HS_BP2_013_LEAVE_STAGE_LOOK_TOP_LIVE_ABILITY_ID,
  S_BP6_005_ON_ENTER_LOOK_TOP_THREE_COLOR_MEMBER_ABILITY_ID,
  SP_BP2_002_ON_ENTER_LOOK_HIGH_COST_CARD_ABILITY_ID,
  UMI_ON_ENTER_ABILITY_ID,
} from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import {
  and,
  costGte,
  groupAliasIs,
  groupIs,
  hasNoAbilityOrContinuousAbility,
  memberHasHeartColor,
  typeIs,
} from '../../../effects/card-selectors.js';
import { clearInspectionCards, inspectTopCards } from '../../../effects/look-top.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
export type LookTopSelectSelectionValidator = (
  game: GameState,
  selectedCardIds: readonly string[]
) => boolean;

export type LookTopSelectCountRule =
  | {
      readonly exactCount: number;
      readonly minCount?: never;
      readonly maxCount?: never;
    }
  | {
      readonly exactCount?: never;
      readonly minCount: number;
      readonly maxCount: number;
    };

export interface LookTopSelectToHandWorkflowConfig {
  readonly effectText: string;
  readonly topCount: number;
  readonly selector: (card: CardInstance) => boolean;
  readonly countRule: LookTopSelectCountRule;
  readonly revealSelectedBeforeHand: boolean;
  readonly selectStepId: string;
  readonly revealStepId?: string;
  readonly selectStepText: string;
  readonly noTargetStepText: string;
  readonly revealStepText?: string;
  readonly selectionLabel?: string;
  readonly confirmSelectionLabel?: string;
  readonly skipSelectionLabel?: string;
  readonly startActionStep?: string;
  readonly startActionPayload?: Readonly<Record<string, unknown>>;
  readonly revealActionStep?: string;
  readonly finishActionStep?: string;
  readonly noCardsMode?: 'finish' | 'open-selection';
  readonly selectionRequiredWhenHasTargets?: boolean;
  readonly includeInspectedCardIdsInFinishAction?: boolean;
  readonly clampExactCountToInspectedCount?: boolean;
  readonly enqueueWaitingRoomTriggersForRemainder?: boolean;
}

export interface LookTopSelectToHandWorkflowOptions {
  readonly orderedResolution?: boolean;
  readonly continuePendingCardEffects: ContinuePendingCardEffects;
  readonly enqueueTriggeredCardEffects?: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}

export interface LookTopSelectToHandAbilityContext {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly controllerId: string;
}

interface LookTopSelectToHandMetadata {
  readonly sourceZone?: ZoneType;
  readonly orderedResolution: boolean;
  readonly revealSelectedBeforeHand: boolean;
  readonly revealStepId?: string;
  readonly revealStepText?: string;
  readonly revealActionStep?: string;
  readonly finishActionStep: string;
  readonly countRule: LookTopSelectCountRule;
  readonly candidateCardIds: readonly string[];
  readonly includeInspectedCardIdsInFinishAction?: boolean;
  readonly enqueueWaitingRoomTriggersForRemainder?: boolean;
  readonly selectedCardIds?: readonly string[];
}

interface RegisteredLookTopSelectToHandWorkflowConfig extends Omit<
  LookTopSelectToHandWorkflowConfig,
  'effectText'
> {
  readonly abilityId: string;
}

const UMI_SELECT_STEP_ID = 'UMI_SELECT_MUSE_LIVE';
const UMI_REVEAL_STEP_ID = 'UMI_REVEAL_SELECTED_LIVE';
const SP_BP2_002_SELECT_HIGH_COST_CARD_STEP_ID = 'SP_BP2_002_SELECT_HIGH_COST_CARD';
const SP_BP2_002_REVEAL_SELECTED_STEP_ID = 'SP_BP2_002_REVEAL_SELECTED_HIGH_COST_CARD';
const BP6_002_SELECT_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_STEP_ID =
  'BP6_002_SELECT_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD';
const BP6_002_REVEAL_SELECTED_STEP_ID =
  'BP6_002_REVEAL_SELECTED_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD';
const HS_BP2_012_SELECT_MEMBER_STEP_ID = 'HS_BP2_012_SELECT_MEMBER_FROM_TOP_FIVE';
const HS_BP2_012_REVEAL_SELECTED_STEP_ID = 'HS_BP2_012_REVEAL_SELECTED_MEMBER';
const HS_BP2_013_SELECT_LIVE_STEP_ID = 'HS_BP2_013_SELECT_LIVE_FROM_TOP_FIVE';
const HS_BP2_013_REVEAL_SELECTED_STEP_ID = 'HS_BP2_013_REVEAL_SELECTED_LIVE';
const S_BP6_005_SELECT_THREE_COLOR_MEMBER_STEP_ID =
  'S_BP6_005_SELECT_THREE_COLOR_MEMBER_FROM_TOP_TWO';
const S_BP6_005_REVEAL_THREE_COLOR_MEMBER_STEP_ID = 'S_BP6_005_REVEAL_SELECTED_THREE_COLOR_MEMBER';

const LOOK_TOP_SELECT_TO_HAND_WORKFLOWS: readonly RegisteredLookTopSelectToHandWorkflowConfig[] = [
  {
    abilityId: UMI_ON_ENTER_ABILITY_ID,
    topCount: 5,
    selector: and(typeIs(CardType.LIVE), groupAliasIs("μ's")),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: UMI_SELECT_STEP_ID,
    revealStepId: UMI_REVEAL_STEP_ID,
    selectStepText: getAbilityEffectText(UMI_ON_ENTER_ABILITY_ID),
    noTargetStepText: getAbilityEffectText(UMI_ON_ENTER_ABILITY_ID),
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: getAbilityEffectText(UMI_ON_ENTER_ABILITY_ID),
    revealActionStep: 'REVEAL_SELECTED',
    noCardsMode: 'open-selection',
    includeInspectedCardIdsInFinishAction: true,
  },
  {
    abilityId: SP_BP2_002_ON_ENTER_LOOK_HIGH_COST_CARD_ABILITY_ID,
    topCount: 3,
    selector: costGte(11),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: SP_BP2_002_SELECT_HIGH_COST_CARD_STEP_ID,
    revealStepId: SP_BP2_002_REVEAL_SELECTED_STEP_ID,
    selectStepText: '请选择至多1张费用大于等于11的卡公开并加入手牌。也可以不加入。',
    noTargetStepText: '没有可加入手牌的费用大于等于11的卡。确认后其余卡片放置入休息室。',
    selectionLabel: '选择要公开并加入手牌的高费用卡',
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: '选择的卡片已公开。确认后加入手牌，其余卡片放置入休息室。',
    revealActionStep: 'REVEAL_SELECTED_HIGH_COST_CARD',
  },
  {
    abilityId: BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID,
    topCount: 2,
    selector: and(groupIs("μ's"), hasNoAbilityOrContinuousAbility()),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: BP6_002_SELECT_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_STEP_ID,
    revealStepId: BP6_002_REVEAL_SELECTED_STEP_ID,
    selectStepText:
      "请选择至多1张不持有能力或持有【常时】能力的『μ's』卡公开并加入手牌。也可以不加入。",
    noTargetStepText:
      "没有可加入手牌的不持有能力或持有【常时】能力的『μ's』卡。确认后其余卡片放置入休息室。",
    selectionLabel: "选择要公开并加入手牌的『μ's』卡",
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: '选择的卡片已公开。确认后加入手牌，其余卡片放置入休息室。',
    revealActionStep: 'REVEAL_SELECTED_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD',
  },
  {
    abilityId: HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID,
    topCount: 5,
    selector: (card) => isMemberCardData(card.data),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: HS_BP2_012_SELECT_MEMBER_STEP_ID,
    revealStepId: HS_BP2_012_REVEAL_SELECTED_STEP_ID,
    selectStepText: '请选择至多1张成员卡公开并加入手牌。也可以不加入。',
    noTargetStepText: '没有可加入手牌的成员卡。确认后其余卡片放置入休息室。',
    selectionLabel: '选择要公开并加入手牌的成员',
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: '选择的成员卡已公开。确认后加入手牌，其余卡片放置入休息室。',
    revealActionStep: 'REVEAL_SELECTED_MEMBER',
  },
  {
    abilityId: HS_BP2_013_LEAVE_STAGE_LOOK_TOP_LIVE_ABILITY_ID,
    topCount: 5,
    selector: typeIs(CardType.LIVE),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: HS_BP2_013_SELECT_LIVE_STEP_ID,
    revealStepId: HS_BP2_013_REVEAL_SELECTED_STEP_ID,
    selectStepText: '请选择至多1张LIVE卡公开并加入手牌。也可以不加入。',
    noTargetStepText: '没有可加入手牌的LIVE卡。确认后其余卡片放置入休息室。',
    selectionLabel: '选择要公开并加入手牌的LIVE卡',
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: '选择的LIVE卡已公开。确认后加入手牌，其余卡片放置入休息室。',
    revealActionStep: 'REVEAL_SELECTED_LIVE',
  },
  {
    abilityId: S_BP6_005_ON_ENTER_LOOK_TOP_THREE_COLOR_MEMBER_ABILITY_ID,
    topCount: 2,
    selector: and(
      typeIs(CardType.MEMBER),
      memberHasHeartColor(HeartColor.RED),
      memberHasHeartColor(HeartColor.GREEN),
      memberHasHeartColor(HeartColor.BLUE)
    ),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: S_BP6_005_SELECT_THREE_COLOR_MEMBER_STEP_ID,
    revealStepId: S_BP6_005_REVEAL_THREE_COLOR_MEMBER_STEP_ID,
    selectStepText:
      '请选择至多1张同时持有红Heart、绿Heart、蓝Heart的成员卡公开并加入手牌。也可以不加入。',
    noTargetStepText:
      '没有可加入手牌的同时持有红Heart、绿Heart、蓝Heart的成员卡。确认后其余卡片放置入休息室。',
    selectionLabel: '选择要公开并加入手牌的三色Heart成员',
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: getAbilityEffectText(S_BP6_005_ON_ENTER_LOOK_TOP_THREE_COLOR_MEMBER_ABILITY_ID),
    revealActionStep: 'REVEAL_SELECTED_THREE_COLOR_MEMBER',
  },
];

export function registerLookTopSelectToHandWorkflowHandlers(): void {
  for (const config of LOOK_TOP_SELECT_TO_HAND_WORKFLOWS) {
    const { abilityId, ...workflowConfig } = config;
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
      startLookTopSelectToHandWorkflow(
        game,
        ability,
        {
          ...workflowConfig,
          effectText: getAbilityEffectText(abilityId),
        },
        {
          orderedResolution: options.orderedResolution,
          continuePendingCardEffects: context.continuePendingCardEffects,
        }
      )
    );
    registerActiveEffectStepHandler(abilityId, config.selectStepId, (game, input, context) =>
      resolveLookTopSelectToHandSelection(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context
      )
    );
    if (config.revealStepId) {
      registerActiveEffectStepHandler(abilityId, config.revealStepId, (game, _input, context) =>
        finishRevealedLookTopSelectToHandWorkflow(game, context)
      );
    }
  }
}

export function startLookTopSelectToHandWorkflow(
  game: GameState,
  ability: LookTopSelectToHandAbilityContext,
  config: LookTopSelectToHandWorkflowConfig,
  options: LookTopSelectToHandWorkflowOptions
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (player.mainDeck.cardIds.length === 0 && config.noCardsMode !== 'open-selection') {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return options.continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: config.finishActionStep ?? 'FINISH',
        inspectedCardIds: [],
      }),
      options.orderedResolution === true
    );
  }

  const inspection = inspectTopCards(game, player.id, {
    count: config.topCount,
    selectablePredicate: config.selector,
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds, selectableCardIds } = inspection;
  const configuredCountRule =
    config.selectionRequiredWhenHasTargets === true && selectableCardIds.length > 0
      ? { minCount: 1, maxCount: getMaxSelectableCount(config.countRule) }
      : config.countRule;
  const countRule =
    config.clampExactCountToInspectedCount === true &&
    'exactCount' in configuredCountRule &&
    configuredCountRule.exactCount !== undefined
      ? { exactCount: Math.min(configuredCountRule.exactCount, selectableCardIds.length) }
      : configuredCountRule;
  const shouldUseOrderedMulti = getMaxSelectableCount(countRule) > 1;
  const canSkipSelection = getMinSelectableCount(countRule) === 0;

  return addAction(
    {
      ...gameState,
      pendingAbilities: gameState.pendingAbilities.filter(
        (candidate) => candidate.id !== ability.id
      ),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: config.effectText,
        stepId: config.selectStepId,
        stepText: selectableCardIds.length > 0 ? config.selectStepText : config.noTargetStepText,
        awaitingPlayerId: player.id,
        inspectionCardIds: inspectedCardIds,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: shouldUseOrderedMulti ? 'ORDERED_MULTI' : undefined,
        minSelectableCards: shouldUseOrderedMulti ? getMinSelectableCount(countRule) : undefined,
        maxSelectableCards: shouldUseOrderedMulti ? getMaxSelectableCount(countRule) : undefined,
        selectionLabel: config.selectionLabel,
        confirmSelectionLabel: config.confirmSelectionLabel,
        canSkipSelection,
        skipSelectionLabel: canSkipSelection
          ? selectableCardIds.length > 0
            ? config.skipSelectionLabel
            : '确认'
          : undefined,
        metadata: {
          sourceZone: ZoneType.MAIN_DECK,
          orderedResolution: options.orderedResolution === true,
          revealSelectedBeforeHand: config.revealSelectedBeforeHand,
          revealStepId: config.revealStepId,
          revealStepText: config.revealStepText,
          revealActionStep: config.revealActionStep,
          finishActionStep: config.finishActionStep ?? 'FINISH',
          countRule,
          candidateCardIds: selectableCardIds,
          includeInspectedCardIdsInFinishAction: config.includeInspectedCardIdsInFinishAction,
          enqueueWaitingRoomTriggersForRemainder:
            config.enqueueWaitingRoomTriggersForRemainder === true,
        } satisfies LookTopSelectToHandMetadata,
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.startActionStep ?? 'START_INSPECTION',
      inspectedCardIds,
      selectableCardIds,
      ...config.startActionPayload,
    }
  );
}

export function resolveLookTopSelectToHandSelection(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined = undefined,
  options: Pick<
    LookTopSelectToHandWorkflowOptions,
    'continuePendingCardEffects' | 'enqueueTriggeredCardEffects'
  >,
  customSelectionValidator?: LookTopSelectSelectionValidator
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const selectedCardIdsToMove =
    selectedCardIds && selectedCardIds.length > 0
      ? selectedCardIds
      : selectedCardId !== null
        ? [selectedCardId]
        : [];
  const metadata = getLookTopSelectToHandMetadata(effect.metadata);
  if (
    !metadata ||
    !validateLookTopSelection(game, selectedCardIdsToMove, metadata, customSelectionValidator)
  ) {
    return game;
  }

  if (metadata.revealSelectedBeforeHand && selectedCardIdsToMove.length > 0) {
    return revealLookTopSelectToHandSelection(game, selectedCardIdsToMove, metadata);
  }

  return finishLookTopSelectToHandWorkflow(game, selectedCardIdsToMove, options);
}

export function finishRevealedLookTopSelectToHandWorkflow(
  game: GameState,
  options: Pick<
    LookTopSelectToHandWorkflowOptions,
    'continuePendingCardEffects' | 'enqueueTriggeredCardEffects'
  >,
  customSelectionValidator?: LookTopSelectSelectionValidator
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const metadata = getLookTopSelectToHandMetadata(effect.metadata);
  if (
    !metadata ||
    !metadata.selectedCardIds ||
    !validateLookTopSelection(game, metadata.selectedCardIds, metadata, customSelectionValidator)
  ) {
    return game;
  }

  return finishLookTopSelectToHandWorkflow(game, metadata.selectedCardIds, options);
}

function revealLookTopSelectToHandSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  metadata: LookTopSelectToHandMetadata
): GameState {
  const effect = game.activeEffect;
  if (!effect || !metadata.revealStepId || !metadata.revealStepText) {
    return game;
  }

  const revealedCardIds = [
    ...game.inspectionZone.revealedCardIds,
    ...selectedCardIds.filter((cardId) => !game.inspectionZone.revealedCardIds.includes(cardId)),
  ];

  return addAction(
    {
      ...game,
      inspectionZone: {
        ...game.inspectionZone,
        revealedCardIds,
      },
      activeEffect: {
        ...effect,
        stepId: metadata.revealStepId,
        stepText: metadata.revealStepText,
        selectableCardIds: [],
        selectableCardVisibility: undefined,
        selectableCardMode: undefined,
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectionLabel: undefined,
        confirmSelectionLabel: undefined,
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          selectedCardIds,
          selectedCardId: selectedCardIds[0] ?? null,
        },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: metadata.revealActionStep ?? 'REVEAL_SELECTED',
      selectedCardId: selectedCardIds[0] ?? null,
      selectedCardIds,
    }
  );
}

function finishLookTopSelectToHandWorkflow(
  game: GameState,
  selectedCardIds: readonly string[],
  options: Pick<
    LookTopSelectToHandWorkflowOptions,
    'continuePendingCardEffects' | 'enqueueTriggeredCardEffects'
  >
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const metadata = getLookTopSelectToHandMetadata(effect.metadata);
  if (!player || !metadata || !validateLookTopSelection(game, selectedCardIds, metadata)) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const moveResult = moveInspectedCardsToHandRestToWaitingRoom(
    game,
    player.id,
    inspectedCardIds,
    selectedCardIds
  );
  if (!moveResult) {
    return game;
  }

  let state: GameState = { ...moveResult.gameState, activeEffect: null };
  if (
    metadata.enqueueWaitingRoomTriggersForRemainder === true &&
    moveResult.waitingRoomCardIds.length > 0 &&
    options.enqueueTriggeredCardEffects
  ) {
    const enterWaitingRoomEvent = createEnterWaitingRoomEvent(
      moveResult.waitingRoomCardIds,
      ZoneType.MAIN_DECK,
      player.id,
      player.id
    );
    state = options.enqueueTriggeredCardEffects(
      emitGameEvent(state, enterWaitingRoomEvent),
      [TriggerCondition.ON_ENTER_WAITING_ROOM],
      { enterWaitingRoomEvents: [enterWaitingRoomEvent] }
    );
  }
  const finishPayload: Record<string, unknown> = {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: metadata.finishActionStep,
    selectedCardId: moveResult.selectedCardIds[0] ?? null,
    selectedCardIds: moveResult.selectedCardIds,
    waitingRoomCardIds: moveResult.waitingRoomCardIds,
  };
  if (metadata.includeInspectedCardIdsInFinishAction === true) {
    finishPayload.inspectedCardIds = inspectedCardIds;
  }

  return options.continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, finishPayload),
    metadata.orderedResolution
  );
}

function moveInspectedCardsToHandRestToWaitingRoom(
  game: GameState,
  playerId: string,
  inspectedCardIds: readonly string[],
  selectedCardIds: readonly string[]
): {
  readonly gameState: GameState;
  readonly selectedCardIds: readonly string[];
  readonly waitingRoomCardIds: readonly string[];
} | null {
  const player = getPlayerById(game, playerId);
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !player ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    selectedCardIds.some((cardId) => !inspectedCardIds.includes(cardId))
  ) {
    return null;
  }

  const waitingRoomCardIds = inspectedCardIds.filter((cardId) => !selectedCardIds.includes(cardId));
  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand: selectedCardIds.reduce((hand, cardId) => addCardToZone(hand, cardId), currentPlayer.hand),
    waitingRoom: {
      ...currentPlayer.waitingRoom,
      cardIds: [...currentPlayer.waitingRoom.cardIds, ...waitingRoomCardIds],
    },
  }));
  state = clearInspectionCards(state, inspectedCardIds);

  return {
    gameState: state,
    selectedCardIds,
    waitingRoomCardIds,
  };
}

function validateLookTopSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  metadata: LookTopSelectToHandMetadata,
  customSelectionValidator?: LookTopSelectSelectionValidator
): boolean {
  const effect = game.activeEffect;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (!effect || uniqueSelectedCardIds.length !== selectedCardIds.length) {
    return false;
  }
  if (selectedCardIds.some((cardId) => !metadata.candidateCardIds.includes(cardId))) {
    return false;
  }
  if (selectedCardIds.some((cardId) => !effect.inspectionCardIds?.includes(cardId))) {
    return false;
  }

  if ('exactCount' in metadata.countRule && metadata.countRule.exactCount !== undefined) {
    return (
      selectedCardIds.length === metadata.countRule.exactCount &&
      (customSelectionValidator?.(game, selectedCardIds) ?? true)
    );
  }

  return (
    selectedCardIds.length >= metadata.countRule.minCount &&
    selectedCardIds.length <= metadata.countRule.maxCount &&
    (customSelectionValidator?.(game, selectedCardIds) ?? true)
  );
}

function getLookTopSelectToHandMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined
): LookTopSelectToHandMetadata | null {
  const countRule = metadata?.countRule;
  if (!countRule || typeof countRule !== 'object') {
    return null;
  }
  const candidate = countRule as Record<string, unknown>;
  const exactCount = candidate.exactCount;
  const minCount = candidate.minCount;
  const maxCount = candidate.maxCount;
  const parsedCountRule =
    typeof exactCount === 'number'
      ? { exactCount }
      : typeof minCount === 'number' && typeof maxCount === 'number'
        ? { minCount, maxCount }
        : null;
  if (!parsedCountRule) {
    return null;
  }

  return {
    orderedResolution: metadata?.orderedResolution === true,
    revealSelectedBeforeHand: metadata?.revealSelectedBeforeHand === true,
    revealStepId: typeof metadata?.revealStepId === 'string' ? metadata.revealStepId : undefined,
    revealStepText:
      typeof metadata?.revealStepText === 'string' ? metadata.revealStepText : undefined,
    revealActionStep:
      typeof metadata?.revealActionStep === 'string' ? metadata.revealActionStep : undefined,
    finishActionStep:
      typeof metadata?.finishActionStep === 'string' ? metadata.finishActionStep : 'FINISH',
    countRule: parsedCountRule,
    candidateCardIds: Array.isArray(metadata?.candidateCardIds)
      ? metadata.candidateCardIds.filter((value): value is string => typeof value === 'string')
      : [],
    includeInspectedCardIdsInFinishAction: metadata?.includeInspectedCardIdsInFinishAction === true,
    enqueueWaitingRoomTriggersForRemainder:
      metadata?.enqueueWaitingRoomTriggersForRemainder === true,
    selectedCardIds: Array.isArray(metadata?.selectedCardIds)
      ? metadata.selectedCardIds.filter((value): value is string => typeof value === 'string')
      : undefined,
  };
}

function getMinSelectableCount(countRule: LookTopSelectCountRule): number {
  return 'exactCount' in countRule && countRule.exactCount !== undefined
    ? countRule.exactCount
    : countRule.minCount;
}

function getMaxSelectableCount(countRule: LookTopSelectCountRule): number {
  return 'exactCount' in countRule && countRule.exactCount !== undefined
    ? countRule.exactCount
    : countRule.maxCount;
}
