import {
  addAction,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { LL_PR_004_LIVE_START_OPPONENT_ANSWER_BRANCH_ABILITY_ID } from '../../ability-ids.js';
import {
  addBladeLiveModifiersForTargetMembers,
  drawCardsForEachPlayer,
} from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ABILITY_ID = LL_PR_004_LIVE_START_OPPONENT_ANSWER_BRANCH_ABILITY_ID;

export const LL_PR_004_ANSWER_STEP_ID = 'LL_PR_004_ANSWER_WHAT_DO_YOU_LIKE';
export const LL_PR_004_DISCARD_HAND_STEP_ID = 'LL_PR_004_DISCARD_OWN_HAND';

export const LL_PR_004_CHOCOLATE_MINT_OPTION_ID = 'chocolate_mint';
export const LL_PR_004_STRAWBERRY_FLAVOR_OPTION_ID = 'strawberry_flavor';
export const LL_PR_004_COOKIE_AND_CREAM_OPTION_ID = 'cookie_and_cream';
export const LL_PR_004_YOU_OPTION_ID = 'you';
export const LL_PR_004_OTHER_OPTION_ID = 'other';

const ANSWER_OPTIONS = [
  { id: LL_PR_004_CHOCOLATE_MINT_OPTION_ID, label: '薄荷巧克力' },
  { id: LL_PR_004_STRAWBERRY_FLAVOR_OPTION_ID, label: '草莓味' },
  { id: LL_PR_004_COOKIE_AND_CREAM_OPTION_ID, label: '曲奇奶油' },
  { id: LL_PR_004_YOU_OPTION_ID, label: '你' },
  { id: LL_PR_004_OTHER_OPTION_ID, label: '其他' },
] as const;

const FLAVOR_OPTION_IDS = new Set<string>([
  LL_PR_004_CHOCOLATE_MINT_OPTION_ID,
  LL_PR_004_STRAWBERRY_FLAVOR_OPTION_ID,
  LL_PR_004_COOKIE_AND_CREAM_OPTION_ID,
]);

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface DiscardMetadata extends Readonly<Record<string, unknown>> {
  readonly orderedResolution: boolean;
  readonly selectedAnswerOptionId: string;
  readonly selectedAnswerLabel: string;
  readonly completedPlayerIds: readonly string[];
  readonly discardedCardIdsByPlayer: Readonly<Record<string, readonly string[]>>;
}

export function registerLlPr004AiScreamWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startLlPr004LiveStart(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, LL_PR_004_ANSWER_STEP_ID, (game, input, context) =>
    finishLlPr004Answer(game, input.selectedOptionId ?? null, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    LL_PR_004_DISCARD_HAND_STEP_ID,
    (game, input, context) =>
      finishLlPr004Discard(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startLlPr004LiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = getOpponent(game, ability.controllerId);
  if (!player || !opponent || !player.liveZone.cardIds.includes(ability.sourceCardId)) {
    return consumePendingNoop(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_LIVE_NOT_IN_LIVE_ZONE'
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: opponent.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: LL_PR_004_ANSWER_STEP_ID,
      stepText: '请选择对“喜欢什么？”的回答。',
      awaitingPlayerId: opponent.id,
      effectChoice: {
        mode: 'SINGLE',
        options: ANSWER_OPTIONS.map((option) => ({
          id: option.id,
          text: option.label,
        })),
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      selectionLabel: '选择回答',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        solitaireOpponentEffectChoiceOptionId: LL_PR_004_OTHER_OPTION_ID,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_OPPONENT_ANSWER',
      opponentPlayerId: opponent.id,
      selectableOptionIds: ANSWER_OPTIONS.map((option) => option.id),
    },
  });
}

function finishLlPr004Answer(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getActiveEffectForStep(game, LL_PR_004_ANSWER_STEP_ID);
  const selectedOption = ANSWER_OPTIONS.find((option) => option.id === selectedOptionId);
  if (!effect || !selectedOption) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const opponent = getOpponent(game, effect.controllerId);
  if (!player || !opponent) {
    return game;
  }

  const orderedResolution = effect.metadata?.orderedResolution === true;
  const stateAfterAnswer = addAction(
    { ...game, activeEffect: null },
    'RESOLVE_ABILITY',
    opponent.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'OPPONENT_ANSWER',
      opponentPlayerId: opponent.id,
      selectedAnswerOptionId: selectedOption.id,
      selectedAnswerLabel: selectedOption.label,
    }
  );

  if (FLAVOR_OPTION_IDS.has(selectedOption.id)) {
    return continueEachPlayerDiscard(
      stateAfterAnswer,
      effect,
      {
        orderedResolution,
        selectedAnswerOptionId: selectedOption.id,
        selectedAnswerLabel: selectedOption.label,
        completedPlayerIds: [],
        discardedCardIdsByPlayer: {},
      },
      continuePendingCardEffects
    );
  }

  if (selectedOption.id === LL_PR_004_YOU_OPTION_ID) {
    return resolveEachPlayerDraw(
      stateAfterAnswer,
      effect,
      selectedOption.id,
      selectedOption.label,
      orderedResolution,
      continuePendingCardEffects
    );
  }

  return resolveAllStageMembersGainBlade(
    stateAfterAnswer,
    effect,
    selectedOption.id,
    selectedOption.label,
    orderedResolution,
    continuePendingCardEffects
  );
}

function finishLlPr004Discard(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getActiveEffectForStep(game, LL_PR_004_DISCARD_HAND_STEP_ID);
  const metadata = effect ? getDiscardMetadata(effect.metadata) : null;
  if (!effect || !metadata || selectedCardId === null) {
    return game;
  }
  const discardPlayerId = effect.awaitingPlayerId;
  const discardPlayer = discardPlayerId ? getPlayerById(game, discardPlayerId) : null;
  if (
    !discardPlayer ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !discardPlayer.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    discardPlayer.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const nextMetadata: DiscardMetadata = {
    ...metadata,
    completedPlayerIds: [...metadata.completedPlayerIds, discardPlayer.id],
    discardedCardIdsByPlayer: {
      ...metadata.discardedCardIdsByPlayer,
      [discardPlayer.id]: discardResult.discardedCardIds,
    },
  };
  const stateAfterDiscard = addAction(
    { ...discardResult.gameState, activeEffect: null },
    'RESOLVE_ABILITY',
    discardPlayer.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_OWN_HAND',
      selectedAnswerOptionId: metadata.selectedAnswerOptionId,
      discardedPlayerId: discardPlayer.id,
      discardedCardIds: discardResult.discardedCardIds,
      enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
    }
  );

  return continueEachPlayerDiscard(
    stateAfterDiscard,
    effect,
    nextMetadata,
    continuePendingCardEffects
  );
}

function continueEachPlayerDiscard(
  game: GameState,
  ability: Pick<
    PendingAbilityState | ActiveEffectState,
    'id' | 'abilityId' | 'sourceCardId' | 'controllerId'
  >,
  metadata: DiscardMetadata,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = getOpponent(game, ability.controllerId);
  if (!player || !opponent) {
    return game;
  }

  const completedPlayerIds = new Set(metadata.completedPlayerIds);
  const discardedCardIdsByPlayer = { ...metadata.discardedCardIdsByPlayer };
  for (const discardPlayer of [player, opponent]) {
    if (completedPlayerIds.has(discardPlayer.id)) {
      continue;
    }
    if (discardPlayer.hand.cardIds.length > 0) {
      return {
        ...game,
        activeEffect: {
          id: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          controllerId: ability.controllerId,
          effectText: getAbilityEffectText(ability.abilityId),
          stepId: LL_PR_004_DISCARD_HAND_STEP_ID,
          stepText: '请选择自己要放置入休息室的1张手牌。',
          awaitingPlayerId: discardPlayer.id,
          selectableCardIds: discardPlayer.hand.cardIds,
          selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
          selectableCardMode: 'SINGLE',
          selectionLabel: '选择要放置入休息室的手牌',
          confirmSelectionLabel: '放置入休息室',
          canSkipSelection: false,
          metadata: {
            ...metadata,
            completedPlayerIds: [...completedPlayerIds],
            discardedCardIdsByPlayer,
          },
        },
      };
    }

    completedPlayerIds.add(discardPlayer.id);
    discardedCardIdsByPlayer[discardPlayer.id] = [];
  }

  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'EACH_PLAYER_DISCARD_HAND',
      selectedAnswerOptionId: metadata.selectedAnswerOptionId,
      selectedAnswerLabel: metadata.selectedAnswerLabel,
      discardedCardIdsByPlayer,
    }),
    metadata.orderedResolution
  );
}

function resolveEachPlayerDraw(
  game: GameState,
  ability: Pick<ActiveEffectState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'>,
  selectedAnswerOptionId: string,
  selectedAnswerLabel: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = getOpponent(game, ability.controllerId);
  if (!player || !opponent) {
    return game;
  }
  const drawResult = drawCardsForEachPlayer(game, [player.id, opponent.id], 1);
  const state = drawResult?.gameState ?? game;

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'EACH_PLAYER_DRAW',
      selectedAnswerOptionId,
      selectedAnswerLabel,
      drawnCardIdsByPlayer: drawResult?.drawnCardIdsByPlayer ?? {},
    }),
    orderedResolution
  );
}

function resolveAllStageMembersGainBlade(
  game: GameState,
  ability: Pick<ActiveEffectState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'>,
  selectedAnswerOptionId: string,
  selectedAnswerLabel: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = getOpponent(game, ability.controllerId);
  if (!player || !opponent) {
    return game;
  }

  const targetMemberCardIdsByPlayer: Record<string, readonly string[]> = {};
  for (const targetPlayer of [player, opponent]) {
    const targetMemberCardIds = getStageMemberCardIdsMatching(
      game,
      targetPlayer.id,
      typeIs(CardType.MEMBER)
    );
    targetMemberCardIdsByPlayer[targetPlayer.id] = targetMemberCardIds;
  }
  const targets = [player, opponent].flatMap((targetPlayer) =>
    (targetMemberCardIdsByPlayer[targetPlayer.id] ?? []).map((targetMemberCardId) => ({
      playerId: targetPlayer.id,
      targetMemberCardId,
    }))
  );
  const bladeResult = addBladeLiveModifiersForTargetMembers(game, {
    targets,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    amount: 1,
  });
  const state = bladeResult?.gameState ?? game;

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'ALL_STAGE_MEMBERS_GAIN_BLADE',
      selectedAnswerOptionId,
      selectedAnswerLabel,
      bladeBonusPerMember: bladeResult?.bladeBonusPerMember ?? 0,
      targetMemberCardIdsByPlayer,
      appliedTargetMemberCardIds: bladeResult?.targetMemberCardIds ?? [],
    }),
    orderedResolution
  );
}

function consumePendingNoop(
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

function getActiveEffectForStep(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== stepId) {
    return null;
  }
  return effect;
}

function getDiscardMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined
): DiscardMetadata | null {
  if (
    !metadata ||
    typeof metadata.selectedAnswerOptionId !== 'string' ||
    typeof metadata.selectedAnswerLabel !== 'string' ||
    !Array.isArray(metadata.completedPlayerIds) ||
    !metadata.completedPlayerIds.every((playerId) => typeof playerId === 'string') ||
    !isCardIdsByPlayer(metadata.discardedCardIdsByPlayer)
  ) {
    return null;
  }
  return {
    orderedResolution: metadata.orderedResolution === true,
    selectedAnswerOptionId: metadata.selectedAnswerOptionId,
    selectedAnswerLabel: metadata.selectedAnswerLabel,
    completedPlayerIds: metadata.completedPlayerIds,
    discardedCardIdsByPlayer: metadata.discardedCardIdsByPlayer,
  };
}

function isCardIdsByPlayer(value: unknown): value is Readonly<Record<string, readonly string[]>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every(
      (cardIds) => Array.isArray(cardIds) && cardIds.every((cardId) => typeof cardId === 'string')
    )
  );
}
