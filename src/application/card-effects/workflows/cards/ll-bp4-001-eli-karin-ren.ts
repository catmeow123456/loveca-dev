import { isMemberCardData } from '../../../../domain/entities/card.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import {
  and,
  cardNameAliasIs,
  costLte,
  memberPrintedBladeLte,
  or,
  typeIs,
} from '../../../effects/card-selectors.js';
import { clearInspectionCards, inspectTopCards } from '../../../effects/look-top.js';
import { setMembersOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  LL_BP4_001_LIVE_START_LOOK_TOP_NAMED_MEMBER_WAIT_OPPONENT_ABILITY_ID,
  LL_BP4_001_ON_ENTER_LOOK_TOP_NAMED_MEMBER_WAIT_OPPONENT_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveInspectedCardsToHandRestToWaitingRoomAndEnqueueTriggers } from '../../runtime/inspection-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { withPublicRevealDwell } from '../../runtime/public-reveal-dwell.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_NAMED_MEMBER_STEP = 'LL_BP4_001_SELECT_NAMED_MEMBER_FROM_TOP_FIVE';
const RESOLVE_REVEALED_MEMBER_STEP = 'LL_BP4_001_RESOLVE_REVEALED_MEMBER';
const ABILITY_IDS = [
  LL_BP4_001_ON_ENTER_LOOK_TOP_NAMED_MEMBER_WAIT_OPPONENT_ABILITY_ID,
  LL_BP4_001_LIVE_START_LOOK_TOP_NAMED_MEMBER_WAIT_OPPONENT_ABILITY_ID,
] as const;

const namedMemberSelector = and(
  typeIs(CardType.MEMBER),
  or(cardNameAliasIs('絢瀬絵里'), cardNameAliasIs('朝香果林'), cardNameAliasIs('葉月恋'))
);

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

interface WorkflowMetadata {
  readonly orderedResolution: boolean;
  readonly candidateCardIds: readonly string[];
  readonly selectedCardId?: string;
}

export function registerLlBp4001EliKarinRenWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  for (const abilityId of ABILITY_IDS) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
      startWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(abilityId, SELECT_NAMED_MEMBER_STEP, (game, input, context) =>
      resolveSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
    registerActiveEffectStepHandler(
      abilityId,
      RESOLVE_REVEALED_MEMBER_STEP,
      (game, _input, context) =>
        resolveRevealedMember(
          game,
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        )
    );
  }
}

function startWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  if (
    isLiveStartAbility(ability.abilityId) &&
    findMemberSlot(player, ability.sourceCardId) === null
  ) {
    return consumePending(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_LEFT_STAGE_BEFORE_LIVE_START_RESOLUTION'
    );
  }

  const inspection = inspectTopCards(game, player.id, {
    count: 5,
    selectablePredicate: namedMemberSelector,
    viewerPlayerId: player.id,
  });
  if (!inspection) return game;
  if (inspection.inspectedCardIds.length === 0) {
    return consumePending(
      inspection.gameState,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'NO_CARDS_TO_INSPECT'
    );
  }

  return startPendingActiveEffect(inspection.gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_NAMED_MEMBER_STEP,
      stepText:
        inspection.selectableCardIds.length > 0
          ? '检视了卡组顶的卡片。可以公开并加入手牌1张指定成员，其余放置入休息室。'
          : '检视的卡片中没有可公开的指定成员。请将全部放置入休息室。',
      awaitingPlayerId: player.id,
      inspectionCardIds: inspection.inspectedCardIds,
      selectableCardIds: inspection.selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要公开并加入手牌的指定成员',
      confirmSelectionLabel: '公开并加入手牌',
      canSkipSelection: true,
      skipSelectionLabel: '全部放置入休息室',
      metadata: {
        orderedResolution,
        candidateCardIds: inspection.selectableCardIds,
      } satisfies WorkflowMetadata,
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'INSPECT_TOP_FIVE',
      inspectedCardIds: inspection.inspectedCardIds,
      selectableCardIds: inspection.selectableCardIds,
    },
  });
}

function resolveSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.stepId !== SELECT_NAMED_MEMBER_STEP ||
    !isWorkflowAbility(effect.abilityId)
  ) {
    return game;
  }
  const metadata = readWorkflowMetadata(effect.metadata);
  const inspectedCardIds = effect.inspectionCardIds ?? [];
  if (!metadata || !isCurrentInspectionValid(game, effect, inspectedCardIds)) return game;
  if (selectedCardId === null) {
    return finishWorkflow(
      game,
      effect,
      inspectedCardIds,
      null,
      metadata.orderedResolution,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects
    );
  }
  if (
    !metadata.candidateCardIds.includes(selectedCardId) ||
    !inspectedCardIds.includes(selectedCardId) ||
    !isCurrentNamedMember(game, selectedCardId)
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
      activeEffect: withPublicRevealDwell(
        {
          ...effect,
          stepId: RESOLVE_REVEALED_MEMBER_STEP,
          stepText:
            '已公开选中的成员。展示结束后将其加入手牌，其余放置入休息室，并将对方满足条件的成员变为待机状态。',
          revealedCardIds: [selectedCardId],
          selectableCardIds: [],
          selectableCardVisibility: undefined,
          selectionLabel: undefined,
          confirmSelectionLabel: undefined,
          canSkipSelection: false,
          skipSelectionLabel: undefined,
          metadata: {
            ...metadata,
            selectedCardId,
          } satisfies WorkflowMetadata,
        },
        [selectedCardId]
      ),
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REVEAL_SELECTED_NAMED_MEMBER',
      selectedCardId,
      revealedCardIds: [selectedCardId],
    }
  );
}

function resolveRevealedMember(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.stepId !== RESOLVE_REVEALED_MEMBER_STEP ||
    !isWorkflowAbility(effect.abilityId)
  ) {
    return game;
  }
  const metadata = readWorkflowMetadata(effect.metadata);
  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const selectedCardId = metadata?.selectedCardId ?? null;
  if (!metadata || !selectedCardId || !metadata.candidateCardIds.includes(selectedCardId)) {
    return game;
  }
  if (
    !isCurrentInspectionValid(game, effect, inspectedCardIds) ||
    !isCurrentNamedMember(game, selectedCardId)
  ) {
    if (game.inspectionContext?.ownerPlayerId !== effect.controllerId) return game;
    const currentInspectedCardIds = inspectedCardIds.filter((cardId) =>
      game.inspectionZone.cardIds.includes(cardId)
    );
    const staleInspectedCardIds = inspectedCardIds.filter(
      (cardId) => !currentInspectedCardIds.includes(cardId)
    );
    return finishWorkflow(
      clearInspectionCards(game, staleInspectedCardIds),
      effect,
      currentInspectedCardIds,
      null,
      metadata.orderedResolution,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects
    );
  }

  return finishWorkflow(
    game,
    effect,
    inspectedCardIds,
    selectedCardId,
    metadata.orderedResolution,
    continuePendingCardEffects,
    enqueueTriggeredCardEffects
  );
}

function finishWorkflow(
  game: GameState,
  effect: ActiveEffectState,
  inspectedCardIds: readonly string[],
  selectedCardId: string | null,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const selectedCard = selectedCardId ? getCardById(game, selectedCardId) : null;
  if (
    !player ||
    !opponent ||
    (selectedCardId !== null &&
      (!selectedCard || !isMemberCardData(selectedCard.data) || !namedMemberSelector(selectedCard)))
  ) {
    return game;
  }

  const revealedPrintedCost =
    selectedCard && isMemberCardData(selectedCard.data) ? selectedCard.data.cost : null;
  const moveResult = moveInspectedCardsToHandRestToWaitingRoomAndEnqueueTriggers(
    { ...game, activeEffect: null },
    player.id,
    inspectedCardIds,
    selectedCardId === null ? [] : [selectedCardId],
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!moveResult) return game;

  const targetCardIds =
    revealedPrintedCost === null
      ? []
      : getStageMemberCardIdsMatching(
          moveResult.gameState,
          opponent.id,
          and(typeIs(CardType.MEMBER), costLte(revealedPrintedCost), memberPrintedBladeLte(3))
        );
  const orientationResult = setMembersOrientation(
    moveResult.gameState,
    opponent.id,
    targetCardIds,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!orientationResult) return game;

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    moveResult.gameState,
    orientationResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, memberStateChangedEvents) =>
        addAction(state, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'FINISH_LOOK_TOP_AND_WAIT_OPPONENT_MEMBERS',
          inspectedCardIds,
          selectedCardId,
          selectedCardIds: moveResult.selectedCardIds,
          waitingRoomCardIds: moveResult.waitingRoomCardIds,
          revealedPrintedCost,
          targetMemberCardIds: targetCardIds,
          waitedMemberCardIds: result.updatedMemberCardIds,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  return continuePendingCardEffects(stateWithMemberStateTriggers.gameState, orderedResolution);
}

function isCurrentInspectionValid(
  game: GameState,
  effect: ActiveEffectState,
  inspectedCardIds: readonly string[]
): boolean {
  return (
    inspectedCardIds.length > 0 &&
    new Set(inspectedCardIds).size === inspectedCardIds.length &&
    game.inspectionContext?.ownerPlayerId === effect.controllerId &&
    inspectedCardIds.every((cardId) => game.inspectionZone.cardIds.includes(cardId))
  );
}

function isCurrentNamedMember(game: GameState, cardId: string): boolean {
  const card = getCardById(game, cardId);
  return card !== null && namedMemberSelector(card);
}

function readWorkflowMetadata(metadata: ActiveEffectState['metadata']): WorkflowMetadata | null {
  if (!metadata || typeof metadata.orderedResolution !== 'boolean') return null;
  if (
    !Array.isArray(metadata.candidateCardIds) ||
    !metadata.candidateCardIds.every((cardId) => typeof cardId === 'string')
  ) {
    return null;
  }
  if (metadata.selectedCardId !== undefined && typeof metadata.selectedCardId !== 'string') {
    return null;
  }
  return metadata as unknown as WorkflowMetadata;
}

function consumePending(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
    }),
    orderedResolution
  );
}

function isWorkflowAbility(abilityId: string): boolean {
  return ABILITY_IDS.some((candidate) => candidate === abilityId);
}

function isLiveStartAbility(abilityId: string): boolean {
  return abilityId === LL_BP4_001_LIVE_START_LOOK_TOP_NAMED_MEMBER_WAIT_OPPONENT_ABILITY_ID;
}
