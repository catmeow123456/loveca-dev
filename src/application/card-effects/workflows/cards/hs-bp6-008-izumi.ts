import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs, type CardSelector } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import {
  HS_BP6_008_LIVE_START_LOW_SCORE_LIVE_ACTIVATE_SELF_ABILITY_ID,
  HS_BP6_008_ON_ENTER_WAIT_SELF_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID,
} from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const SELECT_LOW_SCORE_HASUNOSORA_LIVE_STEP_ID = 'HS_BP6_008_SELECT_LOW_SCORE_HASUNOSORA_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerHsBp6008IzumiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP6_008_ON_ENTER_WAIT_SELF_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveHsBp6008IzumiOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP6_008_ON_ENTER_WAIT_SELF_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID,
    SELECT_LOW_SCORE_HASUNOSORA_LIVE_STEP_ID,
    (game, input, context) =>
      finishHsBp6008IzumiRecoverLive(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    HS_BP6_008_LIVE_START_LOW_SCORE_LIVE_ACTIVATE_SELF_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: buildHsBp6008LiveStartEffectText(game, ability),
      });
      if (confirmation) {
        return confirmation;
      }
      return resolveHsBp6008IzumiLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      );
    }
  );
}

function resolveHsBp6008IzumiOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot =
    ability.sourceSlot ?? getSourceMemberSlot(game, player.id, ability.sourceCardId);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  const waitResult = setMemberOrientation(
    state,
    player.id,
    ability.sourceCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      pendingAbilityId: ability.id,
    }
  );
  if (!waitResult) {
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SOURCE_NOT_ON_STAGE_NO_OP',
        sourceSlot,
      }),
      orderedResolution
    );
  }

  state = addAction(waitResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'WAIT_SELF_BEFORE_RECOVER_LOW_SCORE_HASUNOSORA_LIVE',
    sourceSlot,
    previousOrientation: waitResult.previousOrientation,
    nextOrientation: waitResult.nextOrientation,
  });

  const selectableCardIds = selectWaitingRoomCardIds(state, player.id, lowScoreHasunosoraLive(4));
  if (selectableCardIds.length === 0) {
    const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
      game,
      { ...waitResult, gameState: state },
      enqueueTriggeredCardEffects,
      {
        prepareGameStateBeforeEnqueue: (stateBeforeEnqueue) => ({
          ...stateBeforeEnqueue,
          activeEffect: null,
        }),
      }
    );
    return continuePendingCardEffects(
      addAction(stateWithMemberStateTriggers.gameState, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_LOW_SCORE_HASUNOSORA_LIVE_TO_RECOVER',
        sourceSlot,
      }),
      orderedResolution
    );
  }

  const stateWithRecoverStep = {
    ...state,
    activeEffect: createWaitingRoomToHandEffectState({
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_LOW_SCORE_HASUNOSORA_LIVE_STEP_ID,
      stepText: '请选择自己休息室中1张分数4以下的『莲之空』LIVE卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      canSkipSelection: false,
      metadata: {
        sourceSlot,
        orderedResolution,
      },
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };

  return enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    { ...waitResult, gameState: stateWithRecoverStep },
    enqueueTriggeredCardEffects
  ).gameState;
}

function finishHsBp6008IzumiRecoverLive(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_BP6_008_ON_ENTER_WAIT_SELF_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_LOW_SCORE_HASUNOSORA_LIVE_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...recoveryResult.gameState,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'RECOVER_LOW_SCORE_HASUNOSORA_LIVE',
        sourceSlot: effect.metadata?.sourceSlot,
        selectedCardId: recoveryResult.movedCardIds[0] ?? null,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function resolveHsBp6008IzumiLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot =
    ability.sourceSlot ?? getSourceMemberSlot(game, player.id, ability.sourceCardId);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const matchingLiveCardIds = getLowScoreLiveCardIdsInLiveZone(state, player.id, 2);
  if (matchingLiveCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'LOW_SCORE_LIVE_CONDITION_NOT_MET',
        sourceSlot,
        matchingLiveCardIds,
        lowScoreLiveCount: 0,
      }),
      orderedResolution
    );
  }

  const activeResult = setMemberOrientation(
    state,
    player.id,
    ability.sourceCardId,
    OrientationState.ACTIVE,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      pendingAbilityId: ability.id,
    }
  );
  if (!activeResult) {
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SOURCE_NOT_ON_STAGE_NO_OP',
        sourceSlot,
        matchingLiveCardIds,
      }),
      orderedResolution
    );
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    state,
    activeResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateBeforeEnqueue, result) =>
        addAction(stateBeforeEnqueue, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'LOW_SCORE_LIVE_ACTIVATE_SELF',
          sourceSlot,
          matchingLiveCardIds,
          lowScoreLiveCount: matchingLiveCardIds.length,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
        }),
    }
  );

  return continuePendingCardEffects(stateWithMemberStateTriggers.gameState, orderedResolution);
}

function buildHsBp6008LiveStartEffectText(game: GameState, ability: PendingAbilityState): string {
  const player = getPlayerById(game, ability.controllerId);
  const matchingLiveCardIds = player ? getLowScoreLiveCardIdsInLiveZone(game, player.id, 2) : [];
  const sourceOrientation = player?.memberSlots.cardStates.get(ability.sourceCardId)?.orientation;
  const orientationText = formatOrientation(sourceOrientation);
  const resultText =
    matchingLiveCardIds.length === 0
      ? '条件未满足，确认后不会变为活跃状态'
      : sourceOrientation === OrientationState.ACTIVE
        ? '条件满足，来源已是活跃状态，确认后保持活跃'
        : '条件满足，确认后会变为活跃状态';

  return `${getAbilityEffectText(ability.abilityId)}（当前LIVE中分数2以下LIVE ${matchingLiveCardIds.length}张，来源当前${orientationText}；${resultText}。）`;
}

function getLowScoreLiveCardIdsInLiveZone(
  game: GameState,
  playerId: string,
  maxScore: number
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.liveZone.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isLiveCardData(card.data) && card.data.score <= maxScore;
  });
}

function lowScoreHasunosoraLive(maxScore: number): CardSelector {
  return and(typeIs(CardType.LIVE), groupAliasIs('蓮ノ空'), (card) => {
    return isLiveCardData(card.data) && card.data.score <= maxScore;
  });
}

function formatOrientation(orientation: OrientationState | undefined): string {
  if (orientation === OrientationState.ACTIVE) {
    return '活跃状态';
  }
  if (orientation === OrientationState.WAITING) {
    return '待机状态';
  }
  return '未知状态';
}
