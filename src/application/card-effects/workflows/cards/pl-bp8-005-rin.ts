import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { liveRequiresHeartColor } from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import {
  PL_BP8_005_AUTO_LEAVE_STAGE_BOTTOM_SELF_RECOVER_YELLOW_LIVE_DISCARD_ABILITY_ID,
  PL_BP8_005_LIVE_START_CHEER_HEART_COLORS_TO_YELLOW_ABILITY_ID,
} from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { registerCheerCardHeartColorReplacementWorkflowHandlers } from '../shared/cheer-card-heart-color-replacement.js';

const AUTO_ABILITY_ID =
  PL_BP8_005_AUTO_LEAVE_STAGE_BOTTOM_SELF_RECOVER_YELLOW_LIVE_DISCARD_ABILITY_ID;
const LIVE_START_ABILITY_ID = PL_BP8_005_LIVE_START_CHEER_HEART_COLORS_TO_YELLOW_ABILITY_ID;
const BASE_CARD_CODE = 'PL!-bp8-005';
const ACTIVATE_STEP_ID = 'PL_BP8_005_ACTIVATE_BOTTOM_SELF';
const SELECT_LIVE_STEP_ID = 'PL_BP8_005_SELECT_YELLOW_REQUIREMENT_LIVE';
const SELECT_DISCARD_STEP_ID = 'PL_BP8_005_SELECT_HAND_TO_DISCARD';
const yellowRequirementLive = liveRequiresHeartColor(HeartColor.YELLOW);

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp8005RinWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(AUTO_ABILITY_ID, (game, ability, options, context) =>
    startLeaveStageAuto(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(AUTO_ABILITY_ID, ACTIVATE_STEP_ID, (game, input, context) =>
    input.selectedOptionId === 'activate'
      ? bottomSelfAndContinue(game, context.continuePendingCardEffects)
      : input.selectedOptionId === null || input.selectedOptionId === undefined
        ? finishAutoEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_BOTTOM_SELF',
            movedCardIds: [],
            recoveredCardIds: [],
            discardedCardIds: [],
          })
        : game
  );
  registerActiveEffectStepHandler(AUTO_ABILITY_ID, SELECT_LIVE_STEP_ID, (game, input, context) =>
    recoverSelectedLiveAndContinue(
      game,
      input.selectedCardId ?? null,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(AUTO_ABILITY_ID, SELECT_DISCARD_STEP_ID, (game, input, context) =>
    discardSelectedHandAndFinish(
      game,
      input.selectedCardId ?? null,
      deps.enqueueTriggeredCardEffects,
      context.continuePendingCardEffects
    )
  );

  registerCheerCardHeartColorReplacementWorkflowHandlers([
    {
      abilityId: LIVE_START_ABILITY_ID,
      fromColors: [
        HeartColor.PINK,
        HeartColor.RED,
        HeartColor.GREEN,
        HeartColor.BLUE,
        HeartColor.PURPLE,
        HeartColor.RAINBOW,
      ],
      toColor: HeartColor.YELLOW,
      actionStep: 'CHEER_HEART_COLORS_TO_YELLOW',
      isSourceAvailable: (game, ability) =>
        isValidSourceOnStage(game, ability.controllerId, ability.sourceCardId),
      getConfirmationStepText: () => '确认后结算此效果。',
    },
  ]);
}

function startLeaveStageAuto(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || !isValidSourceInWaitingRoom(game, player.id, ability.sourceCardId)) {
    return consumePendingNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_NOT_IN_WAITING_ROOM'
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
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: ACTIVATE_STEP_ID,
      stepText:
        '可以将此卡放置于卡组底；如此做时，继续回收1张必要HEART包含[黄ハート]的LIVE卡并将1张手牌放置入休息室。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: 'activate', label: '发动' }],
      confirmSelectionLabel: '发动',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_BOTTOM_SELF_OPTION',
    },
  });
}

function bottomSelfAndContinue(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== AUTO_ABILITY_ID ||
    effect.stepId !== ACTIVATE_STEP_ID ||
    !player ||
    !isValidSourceInWaitingRoom(game, player.id, effect.sourceCardId)
  ) {
    return game;
  }

  const move = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
    game,
    player.id,
    [effect.sourceCardId],
    {
      candidateCardIds: [effect.sourceCardId],
      minCount: 1,
      maxCount: 1,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!move) {
    return game;
  }

  const stateWithMove = addAction(move.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'BOTTOM_SELF',
    movedCardIds: move.movedCardIds,
  });
  const candidates = selectWaitingRoomCardIds(stateWithMove, player.id, yellowRequirementLive);
  if (candidates.length === 0) {
    return startDiscardOrFinish(stateWithMove, effect, [], continuePendingCardEffects);
  }

  return {
    ...stateWithMove,
    activeEffect: {
      ...createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: player.id,
        effectText: effect.effectText,
        stepId: SELECT_LIVE_STEP_ID,
        stepText: '请选择休息室中1张必要HEART包含[黄ハート]的LIVE卡加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds: candidates,
        selectionLabel: '选择要加入手牌的LIVE卡',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          movedCardIds: move.movedCardIds,
        },
        zoneSelection: createWaitingRoomToHandSelectionConfig({
          minCount: 1,
          maxCount: 1,
          optional: false,
        }),
      }),
      selectableCardVisibility: 'PUBLIC',
    },
  };
}

function recoverSelectedLiveAndContinue(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== AUTO_ABILITY_ID ||
    effect.stepId !== SELECT_LIVE_STEP_ID ||
    !player ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const currentCandidates = selectWaitingRoomCardIds(game, player.id, yellowRequirementLive);
  if (!currentCandidates.includes(selectedCardId)) {
    return game;
  }
  const recovery = recoverCardsFromWaitingRoomToHandForPlayer(game, player.id, [selectedCardId], {
    candidateCardIds: effect.selectableCardIds ?? [],
    exactCount: 1,
  });
  if (!recovery) {
    return game;
  }

  return startDiscardOrFinish(
    recovery.gameState,
    effect,
    recovery.movedCardIds,
    continuePendingCardEffects
  );
}

function startDiscardOrFinish(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  recoveredCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (player.hand.cardIds.length === 0) {
    return finishAutoEffect(game, continuePendingCardEffects, {
      step: 'BOTTOM_SELF_NO_HAND_TO_DISCARD',
      movedCardIds: getStringArray(effect.metadata?.movedCardIds),
      recoveredCardIds,
      discardedCardIds: [],
    });
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_DISCARD_STEP_ID,
        stepText: '请选择1张手牌放置入休息室。',
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          recoveredCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_SELECT_HAND_TO_DISCARD',
      recoveredCardIds,
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function discardSelectedHandAndFinish(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== AUTO_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    !player ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }
  const discard = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discard) {
    return game;
  }

  return finishAutoEffect(discard.gameState, continuePendingCardEffects, {
    step: 'BOTTOM_SELF_RECOVER_YELLOW_LIVE_DISCARD',
    movedCardIds: getStringArray(effect.metadata?.movedCardIds),
    recoveredCardIds: getStringArray(effect.metadata?.recoveredCardIds),
    discardedCardIds: discard.discardedCardIds,
  });
}

function finishAutoEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== AUTO_ABILITY_ID) {
    return game;
  }
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step,
      }
    ),
    orderedResolution
  );
}

function isValidSourceInWaitingRoom(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return Boolean(
    player &&
    source &&
    source.ownerId === playerId &&
    isMemberCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, BASE_CARD_CODE) &&
    player.waitingRoom.cardIds.includes(sourceCardId)
  );
}

function isValidSourceOnStage(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return Boolean(
    player &&
    source &&
    source.ownerId === playerId &&
    isMemberCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, BASE_CARD_CODE) &&
    Object.values(player.memberSlots.slots).includes(sourceCardId)
  );
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
