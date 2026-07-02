import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import {
  CardType,
  GamePhase,
  SubPhase,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { typeIs } from '../../../effects/card-selectors.js';
import {
  inspectTopCards,
} from '../../../effects/look-top.js';
import { N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveInspectedSelectionToHandRestToWaitingRoomAndEnqueueTriggers } from '../../runtime/inspection-waiting-room-triggers.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const REVEAL_HAND_STEP_ID = 'N_PR_REVEAL_HAND_NO_LIVE_REVEAL_HAND';
const SELECT_LIVE_STEP_ID = 'N_PR_REVEAL_HAND_NO_LIVE_SELECT_TOP_LIVE';
const REVEAL_SELECTED_LIVE_STEP_ID = 'N_PR_REVEAL_HAND_NO_LIVE_REVEAL_SELECTED_LIVE';
const BASE_CARD_CODES = ['PL!N-PR-003', 'PL!N-PR-008', 'PL!N-PR-010'] as const;

interface WorkflowMetadata {
  readonly revealedHandCardIds: readonly string[];
  readonly inspectedCardIds?: readonly string[];
  readonly candidateCardIds?: readonly string[];
  readonly selectedLiveCardId?: string | null;
}

export function registerActivatedRevealHandNoLiveLookTopLiveWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(
    N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID,
    startRevealHandNoLiveLookTopLive
  );
  registerActiveEffectStepHandler(
    N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID,
    REVEAL_HAND_STEP_ID,
    (game) => resolveRevealedHand(game)
  );
  registerActiveEffectStepHandler(
    N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID,
    SELECT_LIVE_STEP_ID,
    (game, input) =>
      revealSelectedTopLive(game, input.selectedCardId ?? null, deps.enqueueTriggeredCardEffects)
  );
  registerActiveEffectStepHandler(
    N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID,
    REVEAL_SELECTED_LIVE_STEP_ID,
    (game) => finishLookTopLiveSelection(game, deps.enqueueTriggeredCardEffects)
  );
}

function startRevealHandNoLiveLookTopLive(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.currentSubPhase !== SubPhase.NONE
  ) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !BASE_CARD_CODES.some((baseCardCode) =>
      cardCodeMatchesBase(sourceCard.data.cardCode, baseCardCode)
    ) ||
    sourceSlot === null ||
    !hasOtherStageMember(player, cardId)
  ) {
    return game;
  }

  const revealedHandCardIds = [...player.hand.cardIds];
  const state = recordAbilityUseForContext(game, player.id, {
    abilityId: N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID,
    sourceCardId: cardId,
  });

  return addAction(
    {
      ...state,
      activeEffect: {
        id: `${N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
        abilityId: N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID
        ),
        stepId: REVEAL_HAND_STEP_ID,
        stepText: '手牌已全部公开。确认后，若其中没有LIVE卡，则检视卡组顶至多5张。',
        awaitingPlayerId: player.id,
        revealedCardIds: revealedHandCardIds,
        metadata: {
          revealedHandCardIds,
        } satisfies WorkflowMetadata,
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID,
      sourceCardId: cardId,
      step: 'REVEAL_HAND',
      revealedHandCardIds,
    }
  );
}

function resolveRevealedHand(game: GameState): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID ||
    effect.stepId !== REVEAL_HAND_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const metadata = getWorkflowMetadata(effect.metadata);
  const revealedHandCardIds = metadata?.revealedHandCardIds ?? [];
  const liveHandCardIds = revealedHandCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && player.hand.cardIds.includes(cardId) && isLiveCardData(card.data);
  });
  if (liveHandCardIds.length > 0) {
    return addAction(
      {
        ...game,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'REVEALED_HAND_CONTAINS_LIVE_NO_EFFECT',
        revealedHandCardIds,
        liveHandCardIds,
      }
    );
  }

  const inspection = inspectTopCards(game, player.id, {
    count: 5,
    selectablePredicate: typeIs(CardType.LIVE),
  });
  if (!inspection) {
    return game;
  }

  return addAction(
    {
      ...inspection.gameState,
      activeEffect: {
        ...effect,
        stepId: SELECT_LIVE_STEP_ID,
        stepText:
          inspection.selectableCardIds.length > 0
            ? '请选择至多1张LIVE卡公开并加入手牌。也可以不加入。'
            : '没有可加入手牌的LIVE卡。确认后其余卡片放置入休息室。',
        inspectionCardIds: inspection.inspectedCardIds,
        selectableCardIds: inspection.selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要公开并加入手牌的LIVE卡',
        confirmSelectionLabel: '公开并加入手牌',
        canSkipSelection: true,
        skipSelectionLabel: inspection.selectableCardIds.length > 0 ? '不加入' : '确认',
        revealedCardIds: revealedHandCardIds,
        metadata: {
          revealedHandCardIds,
          inspectedCardIds: inspection.inspectedCardIds,
          candidateCardIds: inspection.selectableCardIds,
        } satisfies WorkflowMetadata,
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REVEALED_HAND_NO_LIVE_START_INSPECTION',
      revealedHandCardIds,
      inspectedCardIds: inspection.inspectedCardIds,
      selectableCardIds: inspection.selectableCardIds,
    }
  );
}

function revealSelectedTopLive(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_LIVE_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const metadata = getWorkflowMetadata(effect.metadata);
  if (!player || !metadata) {
    return game;
  }

  if (selectedCardId === null) {
    return finishLookTopLiveSelection(game, enqueueTriggeredCardEffects);
  }
  if (
    !metadata.candidateCardIds?.includes(selectedCardId) ||
    !metadata.inspectedCardIds?.includes(selectedCardId)
  ) {
    return game;
  }

  const revealedCardIds = game.inspectionZone.revealedCardIds.includes(selectedCardId)
    ? game.inspectionZone.revealedCardIds
    : [...game.inspectionZone.revealedCardIds, selectedCardId];

  return addAction(
    {
      ...game,
      inspectionZone: {
        ...game.inspectionZone,
        revealedCardIds,
      },
      activeEffect: {
        ...effect,
        stepId: REVEAL_SELECTED_LIVE_STEP_ID,
        stepText: '选择的LIVE卡已公开。确认后加入手牌，其余卡片放置入休息室。',
        selectableCardIds: [],
        selectionLabel: undefined,
        confirmSelectionLabel: '确认',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...metadata,
          selectedLiveCardId: selectedCardId,
        } satisfies WorkflowMetadata,
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REVEAL_SELECTED_LIVE',
      selectedCardId,
    }
  );
}

function finishLookTopLiveSelection(
  game: GameState,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID ||
    (effect.stepId !== SELECT_LIVE_STEP_ID && effect.stepId !== REVEAL_SELECTED_LIVE_STEP_ID)
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const metadata = getWorkflowMetadata(effect.metadata);
  if (!player || !metadata) {
    return game;
  }

  const inspectedCardIds = metadata.inspectedCardIds ?? effect.inspectionCardIds ?? [];
  const selectedCardId = metadata.selectedLiveCardId ?? null;
  if (selectedCardId !== null && !metadata.candidateCardIds?.includes(selectedCardId)) {
    return game;
  }

  const moveResult = moveInspectedSelectionToHandRestToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    inspectedCardIds,
    selectedCardId,
    enqueueTriggeredCardEffects
  );
  if (!moveResult) {
    return game;
  }

  return addAction(
    {
      ...moveResult.gameState,
      activeEffect: null,
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH_LOOK_TOP_LIVE_SELECTION',
      selectedCardId: moveResult.selectedCardIds[0] ?? null,
      inspectedCardIds,
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
    }
  );
}

function hasOtherStageMember(
  player: NonNullable<ReturnType<typeof getPlayerById>>,
  sourceCardId: string
): boolean {
  return Object.values(player.memberSlots.slots).some(
    (stageCardId) => stageCardId !== null && stageCardId !== sourceCardId
  );
}

function getWorkflowMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined
): WorkflowMetadata | null {
  if (!metadata) {
    return null;
  }
  return {
    revealedHandCardIds: toStringArray(metadata.revealedHandCardIds),
    inspectedCardIds: toOptionalStringArray(metadata.inspectedCardIds),
    candidateCardIds: toOptionalStringArray(metadata.candidateCardIds),
    selectedLiveCardId:
      typeof metadata.selectedLiveCardId === 'string' ? metadata.selectedLiveCardId : null,
  };
}

function toStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function toOptionalStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
}
