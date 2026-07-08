import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addHeartLiveModifierForMember,
  addLiveModifier,
} from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import {
  cardBelongsToGroup,
  hasAtLeastDifferentNamedCards,
} from '../../../../shared/utils/card-identity.js';
import { PL_BP5_021_LIVE_START_SUNNY_DAY_SONG_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForEachPlayer } from '../../runtime/actions.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_OWN_DISCARD_STEP_ID = 'PL_BP5_021_SELECT_OWN_HAND_CARD_TO_DISCARD';
const SELECT_OPPONENT_DISCARD_STEP_ID = 'PL_BP5_021_SELECT_OPPONENT_HAND_CARD_TO_DISCARD';
const SELECT_MUSE_MEMBER_STEP_ID = 'PL_BP5_021_SELECT_MUSE_MEMBER_GAIN_YELLOW_HEART';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface SunnyDaySongMetadata extends Readonly<Record<string, unknown>> {
  readonly orderedResolution: boolean;
  readonly drawnCardIdsByPlayer: Readonly<Record<string, readonly string[]>>;
  readonly discardedCardIdsByPlayer: Readonly<Record<string, readonly string[]>>;
}

export function registerBp5021SunnyDaySongWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_BP5_021_LIVE_START_SUNNY_DAY_SONG_ABILITY_ID,
    (game, ability, options, context) =>
      startSunnyDaySongLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP5_021_LIVE_START_SUNNY_DAY_SONG_ABILITY_ID,
    SELECT_OWN_DISCARD_STEP_ID,
    (game, input, context) =>
      finishSunnyDaySongDiscard(
        game,
        input.selectedCardId ?? null,
        SELECT_OWN_DISCARD_STEP_ID,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP5_021_LIVE_START_SUNNY_DAY_SONG_ABILITY_ID,
    SELECT_OPPONENT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishSunnyDaySongDiscard(
        game,
        input.selectedCardId ?? null,
        SELECT_OPPONENT_DISCARD_STEP_ID,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP5_021_LIVE_START_SUNNY_DAY_SONG_ABILITY_ID,
    SELECT_MUSE_MEMBER_STEP_ID,
    (game, input, context) =>
      finishSunnyDaySongMuseSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startSunnyDaySongLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = game.players.find((candidate) => candidate.id !== ability.controllerId) ?? null;
  if (!player || !opponent || !player.liveZone.cardIds.includes(ability.sourceCardId)) {
    return consumePendingWithoutEffect(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_LIVE_NOT_IN_LIVE_ZONE'
    );
  }

  const stageMemberCardIds = getOwnStageMemberCardIds(game, player.id);
  if (stageMemberCardIds.length === 0) {
    return consumePendingWithoutEffect(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_STAGE_MEMBERS'
    );
  }

  const drawResult = drawCardsForEachPlayer(game, [player.id, opponent.id], 1);
  if (!drawResult) {
    return game;
  }
  const stateAfterDraw = addAction(
    {
      ...drawResult.gameState,
      pendingAbilities: drawResult.gameState.pendingAbilities.filter(
        (candidate) => candidate.id !== ability.id
      ),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DRAW_EACH_PLAYER',
      stageMemberCardIds,
      drawnCardIdsByPlayer: drawResult.drawnCardIdsByPlayer,
    }
  );
  const metadata: SunnyDaySongMetadata = {
    orderedResolution,
    drawnCardIdsByPlayer: drawResult.drawnCardIdsByPlayer,
    discardedCardIdsByPlayer: {},
  };

  return continueAfterDrawOrDiscard(
    stateAfterDraw,
    ability,
    metadata,
    continuePendingCardEffects
  );
}

function finishSunnyDaySongDiscard(
  game: GameState,
  selectedCardId: string | null,
  stepId: typeof SELECT_OWN_DISCARD_STEP_ID | typeof SELECT_OPPONENT_DISCARD_STEP_ID,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP5_021_LIVE_START_SUNNY_DAY_SONG_ABILITY_ID ||
    effect.stepId !== stepId ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const discardPlayerId = effect.awaitingPlayerId;
  if (discardPlayerId === null) {
    return game;
  }
  const discardPlayer = getPlayerById(game, discardPlayerId);
  if (!discardPlayer || !discardPlayer.hand.cardIds.includes(selectedCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    discardPlayer.id,
    selectedCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const metadata = getSunnyDaySongMetadata(effect.metadata);
  if (!metadata) {
    return game;
  }
  const nextMetadata: SunnyDaySongMetadata = {
    ...metadata,
    discardedCardIdsByPlayer: {
      ...metadata.discardedCardIdsByPlayer,
      [discardPlayer.id]: discardResult.discardedCardIds,
    },
  };
  const stateAfterDiscard = addAction(discardResult.gameState, 'RESOLVE_ABILITY', discardPlayer.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: stepId === SELECT_OWN_DISCARD_STEP_ID ? 'DISCARD_OWN_HAND' : 'DISCARD_OPPONENT_HAND',
    discardedHandCardIds: discardResult.discardedCardIds,
  });

  return continueAfterDrawOrDiscard(
    { ...stateAfterDiscard, activeEffect: null },
    {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
    },
    nextMetadata,
    continuePendingCardEffects
  );
}

function continueAfterDrawOrDiscard(
  game: GameState,
  ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'>,
  metadata: SunnyDaySongMetadata,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = game.players.find((candidate) => candidate.id !== ability.controllerId) ?? null;
  if (!player || !opponent) {
    return game;
  }
  if (!metadata.discardedCardIdsByPlayer[player.id] && player.hand.cardIds.length > 0) {
    return openSunnyDaySongDiscardSelection(
      game,
      ability,
      metadata,
      player.id,
      SELECT_OWN_DISCARD_STEP_ID,
      '请选择自己要放置入休息室的1张手牌。'
    );
  }
  if (!metadata.discardedCardIdsByPlayer[opponent.id] && opponent.hand.cardIds.length > 0) {
    return openSunnyDaySongDiscardSelection(
      game,
      ability,
      metadata,
      opponent.id,
      SELECT_OPPONENT_DISCARD_STEP_ID,
      '请选择要放置入休息室的1张手牌。'
    );
  }

  const stageMemberCardIds = getOwnStageMemberCardIds(game, player.id);
  const museMemberCardIds = selectMuseStageMemberCardIds(game, player.id);
  if (stageMemberCardIds.length >= 2 && museMemberCardIds.length > 0) {
    return {
      ...game,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_MUSE_MEMBER_STEP_ID,
        stepText: "请选择自己舞台上1名『μ's』成员，LIVE结束时为止获得[黄ハート]。",
        awaitingPlayerId: player.id,
        selectableCardIds: museMemberCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: "请选择获得[黄ハート]的『μ's』成员",
        confirmSelectionLabel: '获得[黄ハート]',
        canSkipSelection: false,
        metadata,
      },
    };
  }

  return finishSunnyDaySongModifiers(
    game,
    ability,
    metadata,
    null,
    continuePendingCardEffects
  );
}

function openSunnyDaySongDiscardSelection(
  game: GameState,
  ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'>,
  metadata: SunnyDaySongMetadata,
  playerId: string,
  stepId: typeof SELECT_OWN_DISCARD_STEP_ID | typeof SELECT_OPPONENT_DISCARD_STEP_ID,
  stepText: string
): GameState {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return game;
  }

  return {
    ...game,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId,
      stepText,
      awaitingPlayerId: player.id,
      selectableCardIds: player.hand.cardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '请选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: false,
      metadata,
    },
  };
}

function finishSunnyDaySongMuseSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP5_021_LIVE_START_SUNNY_DAY_SONG_ABILITY_ID ||
    effect.stepId !== SELECT_MUSE_MEMBER_STEP_ID ||
    selectedCardId === null ||
    !selectMuseStageMemberCardIds(game, effect.controllerId).includes(selectedCardId)
  ) {
    return game;
  }
  const metadata = getSunnyDaySongMetadata(effect.metadata);
  if (!metadata) {
    return game;
  }

  return finishSunnyDaySongModifiers(
    { ...game, activeEffect: null },
    {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
    },
    metadata,
    selectedCardId,
    continuePendingCardEffects
  );
}

function finishSunnyDaySongModifiers(
  game: GameState,
  ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'>,
  metadata: SunnyDaySongMetadata,
  selectedMuseMemberCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  let state = game;
  const heartResult =
    selectedMuseMemberCardId !== null
      ? addHeartLiveModifierForMember(state, {
          playerId: player.id,
          memberCardId: selectedMuseMemberCardId,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
          hearts: [{ color: HeartColor.YELLOW, count: 1 }],
        })
      : null;
  if (heartResult) {
    state = heartResult.gameState;
  }

  const stageMemberCardIds = getOwnStageMemberCardIds(state, player.id);
  const hasThreeDifferentNames =
    stageMemberCardIds.length >= 3 &&
    hasAtLeastDifferentNamedCards(
      stageMemberCardIds,
      3,
      (cardId) => getCardById(state, cardId)?.data
    );
  if (hasThreeDifferentNames) {
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId: player.id,
      countDelta: 1,
      sourceCardId: ability.sourceCardId,
      liveCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    });
    state = refreshPlayerScoreDraft(state, player.id, 1);
  }

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'FINISH',
      drawnCardIdsByPlayer: metadata.drawnCardIdsByPlayer,
      discardedCardIdsByPlayer: metadata.discardedCardIdsByPlayer,
      stageMemberCardIds,
      selectedMuseMemberCardId,
      heartBonus: heartResult?.heartBonus ?? [],
      scoreBonus: hasThreeDifferentNames ? 1 : 0,
    }),
    metadata.orderedResolution
  );
}

function consumePendingWithoutEffect(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
    }),
    orderedResolution
  );
}

function getOwnStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return Object.values(player.memberSlots.slots).filter((cardId): cardId is string => {
    const card = cardId ? getCardById(game, cardId) : null;
    return card !== null && card.ownerId === player.id && isMemberCardData(card.data);
  });
}

function selectMuseStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getOwnStageMemberCardIds(game, playerId).filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && cardBelongsToGroup(card.data, "μ's");
  });
}

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreBonus: number): GameState {
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores,
    },
  };
}

function getSunnyDaySongMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined
): SunnyDaySongMetadata | null {
  if (!metadata) {
    return null;
  }
  return {
    orderedResolution: metadata.orderedResolution === true,
    drawnCardIdsByPlayer: isCardIdsByPlayer(metadata.drawnCardIdsByPlayer)
      ? metadata.drawnCardIdsByPlayer
      : {},
    discardedCardIdsByPlayer: isCardIdsByPlayer(metadata.discardedCardIdsByPlayer)
      ? metadata.discardedCardIdsByPlayer
      : {},
  };
}

function isCardIdsByPlayer(value: unknown): value is Readonly<Record<string, readonly string[]>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every(
      (cardIds) =>
        Array.isArray(cardIds) && cardIds.every((cardId) => typeof cardId === 'string')
    )
  );
}
