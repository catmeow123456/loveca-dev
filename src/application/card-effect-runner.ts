import { CardType, GamePhase, SlotPosition, TriggerCondition, ZoneType } from '../shared/types/enums.js';
import { isMemberCardData } from '../domain/entities/card.js';
import type { GameState, PendingAbilityState } from '../domain/entities/game.js';
import { addAction, getCardById, getPlayerById, updatePlayer } from '../domain/entities/game.js';
import { addCardToZone, drawFromTop } from '../domain/entities/zone.js';

export const ABILITY_ORDER_SELECTION_ID = 'system:select-pending-card-effect';
export const NOZOMI_ON_ENTER_ABILITY_ID = 'PL!-sd1-007-SD:on-enter-mill-five-draw-if-live';
export const UMI_ON_ENTER_ABILITY_ID = 'PL!-sd1-004-SD:on-enter-look-five-take-muse-live';
export const KARIN_LIVE_START_ABILITY_ID = 'PL!N-pb1-004-P+:live-start-reveal-top-member';
export const ELI_ACTIVATED_ABILITY_ID =
  'PL!-sd1-002-SD:activated-send-self-to-waiting-room-add-member';

const NOZOMI_EFFECT_TEXT =
  '【登场】将自己卡组顶的5张卡放置入休息室。其中有LIVE卡的场合，抽1张卡。';
const UMI_EFFECT_TEXT =
  "【登场】检视自己卡组顶的5张卡。可以将1张其中的『μ's』的LIVE卡公开并加入手牌。其余的卡片放置入休息室。";
const KARIN_EFFECT_TEXT =
  '【LIVE开始时】公开自己卡组顶的卡片。公开的卡片为费用小于等于9的成员卡的场合，将公开的卡片加入手牌，此成员进行站位变换。除此之外的场合，将公开的卡片放置入休息室。';
const ELI_EFFECT_TEXT =
  '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张成员卡加入手牌。';
const NOZOMI_REVEAL_STEP_ID = 'NOZOMI_REVEAL_TOP_FIVE';
const UMI_SELECT_STEP_ID = 'UMI_SELECT_MUSE_LIVE';
const UMI_REVEAL_STEP_ID = 'UMI_REVEAL_SELECTED_LIVE';
const KARIN_REVEAL_STEP_ID = 'KARIN_REVEAL_TOP_CARD';
const KARIN_POSITION_CHANGE_STEP_ID = 'KARIN_POSITION_CHANGE';
const ELI_SELECT_WAITING_ROOM_MEMBER_STEP_ID = 'ELI_SELECT_WAITING_ROOM_MEMBER';
const ABILITY_ORDER_SELECTION_STEP_ID = 'SELECT_NEXT_PENDING_ABILITY';

interface CardEffectRunnerResult {
  readonly gameState: GameState;
  readonly resolvedAbilityIds: readonly string[];
}

export function enqueueTriggeredCardEffects(
  game: GameState,
  triggerConditions: readonly TriggerCondition[]
): GameState {
  let state = game;

  if (triggerConditions.includes(TriggerCondition.ON_ENTER_STAGE)) {
    state = enqueueOnEnterCardEffects(state);
  }

  if (triggerConditions.includes(TriggerCondition.ON_LIVE_START)) {
    state = enqueueLiveStartCardEffects(state);
  }

  return state;
}

function enqueueOnEnterCardEffects(game: GameState): GameState {
  const action = [...game.actionHistory]
    .reverse()
    .find((candidate) => candidate.type === 'PLAY_MEMBER');
  const sourceCardId = typeof action?.payload.cardId === 'string' ? action.payload.cardId : null;
  if (!action || !sourceCardId) {
    return game;
  }

  const sourceCard = getCardById(game, sourceCardId);
  if (!sourceCard) {
    return game;
  }

  const abilityId = getOnEnterAbilityId(sourceCard.data.cardCode);
  if (!abilityId) {
    return game;
  }

  const pendingAbilityId = `${abilityId}:${action.sequence}`;
  if (hasAbilityInstance(game, pendingAbilityId)) {
    return game;
  }

  const pendingAbility: PendingAbilityState = {
    id: pendingAbilityId,
    abilityId,
    sourceCardId,
    controllerId: action.playerId ?? sourceCard.ownerId,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`action:${action.sequence}`],
  };

  return addAction(
    {
      ...game,
      pendingAbilities: [...game.pendingAbilities, pendingAbility],
    },
    'TRIGGER_ABILITY',
    pendingAbility.controllerId,
    {
      pendingAbilityId,
      abilityId: pendingAbility.abilityId,
      sourceCardId,
      timingId: pendingAbility.timingId,
    }
  );
}

function enqueueLiveStartCardEffects(game: GameState): GameState {
  const performingPlayerId = game.liveResolution.performingPlayerId ?? game.players[game.activePlayerIndex]?.id;
  const player = performingPlayerId ? getPlayerById(game, performingPlayerId) : null;
  if (!player) {
    return game;
  }

  let state = game;
  for (const sourceCardId of Object.values(player.memberSlots.slots)) {
    if (!sourceCardId) {
      continue;
    }

    const sourceCard = getCardById(state, sourceCardId);
    const abilityId =
      sourceCard?.data.cardCode === 'PL!N-pb1-004-P+' ? KARIN_LIVE_START_ABILITY_ID : null;
    if (!sourceCard || !abilityId) {
      continue;
    }

    const pendingAbilityId = `${abilityId}:${sourceCardId}:turn-${state.turnCount}:live-${performingPlayerId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId,
      controllerId: sourceCard.ownerId,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_START,
      eventIds: [`live-start:${state.turnCount}:${performingPlayerId}`],
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId,
        timingId: pendingAbility.timingId,
      }
    );
  }

  return state;
}

function hasAbilityInstance(game: GameState, pendingAbilityId: string): boolean {
  const alreadyPending = game.pendingAbilities.some((ability) => ability.id === pendingAbilityId);
  const alreadyActive = game.activeEffect?.id === pendingAbilityId;
  const alreadyResolved = game.actionHistory.some(
    (historyAction) =>
      historyAction.type === 'RESOLVE_ABILITY' &&
      historyAction.payload.pendingAbilityId === pendingAbilityId
  );
  return alreadyPending || alreadyActive || alreadyResolved;
}

export function resolvePendingCardEffects(game: GameState): CardEffectRunnerResult {
  if (game.activeEffect) {
    return {
      gameState: game,
      resolvedAbilityIds: [],
    };
  }

  const pendingAbilities = getSupportedPendingAbilities(game);
  const ability = pendingAbilities[0];
  if (!ability) {
    return {
      gameState: game,
      resolvedAbilityIds: [],
    };
  }

  const sameTimingAbilities = pendingAbilities.filter(
    (candidate) =>
      candidate.controllerId === ability.controllerId && candidate.timingId === ability.timingId
  );
  if (sameTimingAbilities.length > 1) {
    return {
      gameState: startAbilityOrderSelection(game, sameTimingAbilities),
      resolvedAbilityIds: sameTimingAbilities.map((candidate) => candidate.id),
    };
  }

  return {
    gameState: startPendingAbilityEffect(game, ability),
    resolvedAbilityIds: [ability.id],
  };
}

export function confirmActiveEffectStep(
  game: GameState,
  playerId: string,
  effectId: string,
  selectedCardId?: string | null,
  selectedSlot?: SlotPosition | null,
  resolveInOrder?: boolean
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  if (effect.id !== effectId || effect.awaitingPlayerId !== playerId) {
    return game;
  }
  if (effect.abilityId === ABILITY_ORDER_SELECTION_ID) {
    return selectPendingAbilityOrder(game, selectedCardId, resolveInOrder === true);
  }

  if (effect.abilityId === NOZOMI_ON_ENTER_ABILITY_ID && effect.stepId === NOZOMI_REVEAL_STEP_ID) {
    return finishNozomiOnEnter(game);
  }

  if (effect.abilityId === UMI_ON_ENTER_ABILITY_ID && effect.stepId === UMI_SELECT_STEP_ID) {
    return selectedCardId ? revealUmiSelectedLive(game, selectedCardId) : finishUmiOnEnter(game, null);
  }

  if (effect.abilityId === UMI_ON_ENTER_ABILITY_ID && effect.stepId === UMI_REVEAL_STEP_ID) {
    const selectedCardIdFromMetadata =
      typeof effect.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
    return finishUmiOnEnter(game, selectedCardIdFromMetadata);
  }

  if (
    effect.abilityId === KARIN_LIVE_START_ABILITY_ID &&
    effect.stepId === KARIN_REVEAL_STEP_ID
  ) {
    return finishKarinLiveStart(game);
  }

  if (
    effect.abilityId === KARIN_LIVE_START_ABILITY_ID &&
    effect.stepId === KARIN_POSITION_CHANGE_STEP_ID
  ) {
    return finishKarinPositionChange(game, selectedSlot ?? null);
  }

  if (
    effect.abilityId === ELI_ACTIVATED_ABILITY_ID &&
    effect.stepId === ELI_SELECT_WAITING_ROOM_MEMBER_STEP_ID
  ) {
    return finishEliActivatedEffect(game, selectedCardId ?? null);
  }

  return game;
}

export function activateCardAbility(
  game: GameState,
  playerId: string,
  cardId: string,
  abilityId: string
): GameState {
  if (abilityId !== ELI_ACTIVATED_ABILITY_ID) {
    return game;
  }

  return startEliActivatedEffect(game, playerId, cardId);
}

function getSupportedPendingAbilities(game: GameState): readonly PendingAbilityState[] {
  return game.pendingAbilities.filter((candidate) =>
    [NOZOMI_ON_ENTER_ABILITY_ID, UMI_ON_ENTER_ABILITY_ID, KARIN_LIVE_START_ABILITY_ID].includes(
      candidate.abilityId
    )
  );
}

function startAbilityOrderSelection(
  game: GameState,
  abilities: readonly PendingAbilityState[]
): GameState {
  const firstAbility = abilities[0];
  return {
    ...game,
    activeEffect: {
      id: `${ABILITY_ORDER_SELECTION_ID}:${firstAbility.timingId}:${firstAbility.controllerId}`,
      abilityId: ABILITY_ORDER_SELECTION_ID,
      sourceCardId: firstAbility.sourceCardId,
      controllerId: firstAbility.controllerId,
      effectText: '请选择下一个要发动的效果。也可以选择“顺序发动”，按当前队列顺序依次处理。',
      stepId: ABILITY_ORDER_SELECTION_STEP_ID,
      stepText: '选择下一个 LIVE 开始时效果',
      awaitingPlayerId: firstAbility.controllerId,
      selectableCardIds: abilities.map((ability) => ability.sourceCardId),
      canResolveInOrder: true,
      metadata: {
        pendingAbilityIds: abilities.map((ability) => ability.id),
      },
    },
  };
}

function selectPendingAbilityOrder(
  game: GameState,
  selectedCardId: string | null | undefined,
  resolveInOrder: boolean
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ORDER_SELECTION_ID) {
    return game;
  }

  const pendingAbilityIds = Array.isArray(effect.metadata?.pendingAbilityIds)
    ? effect.metadata.pendingAbilityIds.filter((id): id is string => typeof id === 'string')
    : [];
  const candidates = game.pendingAbilities.filter((ability) => pendingAbilityIds.includes(ability.id));
  const selectedAbility = resolveInOrder
    ? candidates[0]
    : candidates.find((ability) => ability.sourceCardId === selectedCardId);

  if (!selectedAbility) {
    return game;
  }

  return startPendingAbilityEffect(
    {
      ...game,
      activeEffect: null,
    },
    selectedAbility,
    { orderedResolution: resolveInOrder }
  );
}

function continuePendingCardEffects(game: GameState, orderedResolution: boolean): GameState {
  if (game.activeEffect) {
    return game;
  }

  const pendingAbilities = getSupportedPendingAbilities(game);
  if (pendingAbilities.length === 0) {
    return game;
  }

  if (orderedResolution) {
    return startPendingAbilityEffect(game, pendingAbilities[0], { orderedResolution: true });
  }

  return resolvePendingCardEffects(game).gameState;
}

function isOrderedResolutionEffect(game: GameState): boolean {
  return game.activeEffect?.metadata?.orderedResolution === true;
}

function startPendingAbilityEffect(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  switch (ability.abilityId) {
    case NOZOMI_ON_ENTER_ABILITY_ID:
      return startNozomiOnEnterInspection(game, ability, options);
    case UMI_ON_ENTER_ABILITY_ID:
      return startUmiOnEnterInspection(game, ability, options);
    case KARIN_LIVE_START_ABILITY_ID:
      return startKarinLiveStartInspection(game, ability, options);
    default:
      return game;
  }
}

function getOnEnterAbilityId(cardCode: string | undefined): string | null {
  switch (cardCode) {
    case 'PL!-sd1-007-SD':
      return NOZOMI_ON_ENTER_ABILITY_ID;
    case 'PL!-sd1-004-SD':
      return UMI_ON_ENTER_ABILITY_ID;
    default:
      return null;
  }
}

function startNozomiOnEnterInspection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = player.mainDeck.cardIds.slice(0, 5);
  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    mainDeck: {
      ...currentPlayer.mainDeck,
      cardIds: currentPlayer.mainDeck.cardIds.slice(inspectedCardIds.length),
    },
  }));

  state = {
    ...state,
    pendingAbilities: state.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    inspectionZone: {
      ...state.inspectionZone,
      cardIds: [...state.inspectionZone.cardIds, ...inspectedCardIds],
      revealedCardIds: [...state.inspectionZone.revealedCardIds, ...inspectedCardIds],
    },
    inspectionContext: {
      ownerPlayerId: player.id,
      sourceZone: ZoneType.MAIN_DECK,
    },
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: NOZOMI_EFFECT_TEXT,
      stepId: NOZOMI_REVEAL_STEP_ID,
      stepText: '卡组顶5张已公开。确认后将这些牌放入休息室，并在其中有LIVE卡时抽1张。',
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution: options.orderedResolution === true,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'START_INSPECTION',
    inspectedCardIds,
  });
}

function startUmiOnEnterInspection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = player.mainDeck.cardIds.slice(0, 5);
  const selectableCardIds = inspectedCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card?.data.cardType === CardType.LIVE;
  });

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    mainDeck: {
      ...currentPlayer.mainDeck,
      cardIds: currentPlayer.mainDeck.cardIds.slice(inspectedCardIds.length),
    },
  }));

  state = {
    ...state,
    pendingAbilities: state.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    inspectionZone: {
      ...state.inspectionZone,
      cardIds: [...state.inspectionZone.cardIds, ...inspectedCardIds],
    },
    inspectionContext: {
      ownerPlayerId: player.id,
      sourceZone: ZoneType.MAIN_DECK,
    },
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: UMI_EFFECT_TEXT,
      stepId: UMI_SELECT_STEP_ID,
      stepText: UMI_EFFECT_TEXT,
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      selectableCardIds,
      canSkipSelection: true,
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution: options.orderedResolution === true,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'START_INSPECTION',
    inspectedCardIds,
    selectableCardIds,
  });
}

function startKarinLiveStartInspection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = player.mainDeck.cardIds.slice(0, 1);
  if (inspectedCardIds.length === 0) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'FINISH',
      inspectedCardIds,
      destination: null,
    }), options.orderedResolution === true);
  }

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    mainDeck: {
      ...currentPlayer.mainDeck,
      cardIds: currentPlayer.mainDeck.cardIds.slice(inspectedCardIds.length),
    },
  }));

  state = {
    ...state,
    pendingAbilities: state.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    inspectionZone: {
      ...state.inspectionZone,
      cardIds: [...state.inspectionZone.cardIds, ...inspectedCardIds],
      revealedCardIds: [...state.inspectionZone.revealedCardIds, ...inspectedCardIds],
    },
    inspectionContext: {
      ownerPlayerId: player.id,
      sourceZone: ZoneType.MAIN_DECK,
    },
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: KARIN_EFFECT_TEXT,
      stepId: KARIN_REVEAL_STEP_ID,
      stepText: '卡组顶1张已公开。确认后费用9以下成员加入手牌；否则放入休息室。',
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution: options.orderedResolution === true,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'START_INSPECTION',
    inspectedCardIds,
  });
}

function finishNozomiOnEnter(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const hasMilledLiveCard = inspectedCardIds.some(
    (cardId) => getCardById(game, cardId)?.data.cardType === CardType.LIVE
  );
  let drawnCardId: string | null = null;

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    waitingRoom: {
      ...currentPlayer.waitingRoom,
      cardIds: [...currentPlayer.waitingRoom.cardIds, ...inspectedCardIds],
    },
  }));

  state = {
    ...state,
    inspectionZone: {
      ...state.inspectionZone,
      cardIds: state.inspectionZone.cardIds.filter((cardId) => !inspectedCardIds.includes(cardId)),
      revealedCardIds: state.inspectionZone.revealedCardIds.filter(
        (cardId) => !inspectedCardIds.includes(cardId)
      ),
    },
  };

  if (hasMilledLiveCard) {
    state = updatePlayer(state, player.id, (currentPlayer) => {
      const drawResult = drawFromTop(currentPlayer.mainDeck);
      drawnCardId = drawResult.cardId;
      return {
        ...currentPlayer,
        mainDeck: drawResult.zone,
        hand: drawResult.cardId
          ? addCardToZone(currentPlayer.hand, drawResult.cardId)
          : currentPlayer.hand,
      };
    });
  }

  state = {
    ...state,
    inspectionContext: state.inspectionZone.cardIds.length > 0 ? state.inspectionContext : null,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      milledCardIds: inspectedCardIds,
      hasMilledLiveCard,
      drawnCardId,
    }),
    isOrderedResolutionEffect(game)
  );
}

function revealUmiSelectedLive(game: GameState, selectedCardId: string): GameState {
  const effect = game.activeEffect;
  if (!effect || !effect.inspectionCardIds?.includes(selectedCardId)) {
    return game;
  }
  if (!effect.selectableCardIds?.includes(selectedCardId)) {
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
        stepId: UMI_REVEAL_STEP_ID,
        stepText: UMI_EFFECT_TEXT,
        selectableCardIds: [],
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          selectedCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REVEAL_SELECTED',
      selectedCardId,
    }
  );
}

function finishUmiOnEnter(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const selectedIsValid =
    selectedCardId !== null &&
    inspectedCardIds.includes(selectedCardId) &&
    getCardById(game, selectedCardId)?.data.cardType === CardType.LIVE;
  const cardToHandId = selectedIsValid ? selectedCardId : null;
  const cardsToWaitingRoom = inspectedCardIds.filter((cardId) => cardId !== cardToHandId);

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand: cardToHandId ? addCardToZone(currentPlayer.hand, cardToHandId) : currentPlayer.hand,
    waitingRoom: {
      ...currentPlayer.waitingRoom,
      cardIds: [...currentPlayer.waitingRoom.cardIds, ...cardsToWaitingRoom],
    },
  }));

  state = {
    ...state,
    inspectionZone: {
      ...state.inspectionZone,
      cardIds: state.inspectionZone.cardIds.filter((cardId) => !inspectedCardIds.includes(cardId)),
      revealedCardIds: state.inspectionZone.revealedCardIds.filter(
        (cardId) => !inspectedCardIds.includes(cardId)
      ),
    },
    inspectionContext: null,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      inspectedCardIds,
      selectedCardId: cardToHandId,
      waitingRoomCardIds: cardsToWaitingRoom,
    }),
    isOrderedResolutionEffect(game)
  );
}

function finishKarinLiveStart(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const revealedCardId = inspectedCardIds[0] ?? null;
  const revealedCard = revealedCardId ? getCardById(game, revealedCardId) : null;
  const shouldAddToHand =
    revealedCard !== null && isMemberCardData(revealedCard.data) && revealedCard.data.cost <= 9;
  const destination = shouldAddToHand ? ZoneType.HAND : ZoneType.WAITING_ROOM;
  const orderedResolution = isOrderedResolutionEffect(game);

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand:
      shouldAddToHand && revealedCardId
        ? addCardToZone(currentPlayer.hand, revealedCardId)
        : currentPlayer.hand,
    waitingRoom:
      !shouldAddToHand && revealedCardId
        ? addCardToZone(currentPlayer.waitingRoom, revealedCardId)
        : currentPlayer.waitingRoom,
  }));

  state = {
    ...state,
    inspectionZone: {
      ...state.inspectionZone,
      cardIds: state.inspectionZone.cardIds.filter((cardId) => !inspectedCardIds.includes(cardId)),
      revealedCardIds: state.inspectionZone.revealedCardIds.filter(
        (cardId) => !inspectedCardIds.includes(cardId)
      ),
    },
    inspectionContext: null,
    activeEffect: null,
  };

  state = addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'REVEAL_FINISH',
    inspectedCardIds,
    revealedCardId,
    destination,
  });

  if (!shouldAddToHand) {
    return continuePendingCardEffects(state, orderedResolution);
  }

  const sourceSlot = findMemberSlot(player, effect.sourceCardId);
  if (!sourceSlot) {
    return continuePendingCardEffects(state, orderedResolution);
  }

  return {
    ...state,
    activeEffect: {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
      effectText: KARIN_EFFECT_TEXT,
      stepId: KARIN_POSITION_CHANGE_STEP_ID,
      stepText: '公开的卡片已加入手牌。请选择朝香果林要移动到的成员区。',
      awaitingPlayerId: player.id,
      selectableSlots: Object.values(SlotPosition).filter((slot) => slot !== sourceSlot),
      metadata: {
        orderedResolution,
        sourceSlot,
      },
    },
  };
}

function finishKarinPositionChange(game: GameState, selectedSlot: SlotPosition | null): GameState {
  const effect = game.activeEffect;
  if (!effect || !selectedSlot) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = findMemberSlot(player, effect.sourceCardId);
  if (!sourceSlot || sourceSlot === selectedSlot) {
    return game;
  }

  const orderedResolution = isOrderedResolutionEffect(game);
  const targetCardId = player.memberSlots.slots[selectedSlot] ?? null;
  let state = updatePlayer(game, player.id, (currentPlayer) => {
    const sourceEnergyBelow = currentPlayer.memberSlots.energyBelow[sourceSlot] ?? [];
    const targetEnergyBelow = currentPlayer.memberSlots.energyBelow[selectedSlot] ?? [];
    const sourceMemberBelow = currentPlayer.memberSlots.memberBelow[sourceSlot] ?? [];
    const targetMemberBelow = currentPlayer.memberSlots.memberBelow[selectedSlot] ?? [];

    return {
      ...currentPlayer,
      memberSlots: {
        ...currentPlayer.memberSlots,
        slots: {
          ...currentPlayer.memberSlots.slots,
          [sourceSlot]: targetCardId,
          [selectedSlot]: effect.sourceCardId,
        },
        energyBelow: {
          ...currentPlayer.memberSlots.energyBelow,
          [sourceSlot]: [...targetEnergyBelow],
          [selectedSlot]: [...sourceEnergyBelow],
        },
        memberBelow: {
          ...currentPlayer.memberSlots.memberBelow,
          [sourceSlot]: [...targetMemberBelow],
          [selectedSlot]: [...sourceMemberBelow],
        },
      },
    };
  });

  state = {
    ...state,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'POSITION_CHANGE',
      fromSlot: sourceSlot,
      toSlot: selectedSlot,
      swappedCardId: targetCardId,
    }),
    orderedResolution
  );
}

function startEliActivatedEffect(game: GameState, playerId: string, cardId: string): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  if (activePlayerId !== playerId) {
    return game;
  }

  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  if (!player || !sourceCard || sourceCard.ownerId !== playerId) {
    return game;
  }
  if (sourceCard.data.cardCode !== 'PL!-sd1-002-SD' || !isMemberCardData(sourceCard.data)) {
    return game;
  }

  const sourceSlot = findMemberSlot(player, cardId);
  if (!sourceSlot) {
    return game;
  }

  const energyBelowCardIds = player.memberSlots.energyBelow[sourceSlot] ?? [];
  const memberBelowCardIds = player.memberSlots.memberBelow[sourceSlot] ?? [];
  const movedToWaitingRoomCardIds = [cardId, ...energyBelowCardIds, ...memberBelowCardIds];

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    waitingRoom: {
      ...currentPlayer.waitingRoom,
      cardIds: [...currentPlayer.waitingRoom.cardIds, ...movedToWaitingRoomCardIds],
    },
    memberSlots: {
      ...currentPlayer.memberSlots,
      slots: {
        ...currentPlayer.memberSlots.slots,
        [sourceSlot]: null,
      },
      energyBelow: {
        ...currentPlayer.memberSlots.energyBelow,
        [sourceSlot]: [],
      },
      memberBelow: {
        ...currentPlayer.memberSlots.memberBelow,
        [sourceSlot]: [],
      },
    },
  }));

  const nextPlayer = getPlayerById(state, player.id);
  const selectableCardIds =
    nextPlayer?.waitingRoom.cardIds.filter((waitingRoomCardId) => {
      const waitingRoomCard = getCardById(state, waitingRoomCardId);
      return waitingRoomCard !== undefined && isMemberCardData(waitingRoomCard.data);
    }) ?? [];

  state = {
    ...state,
    activeEffect: {
      id: `${ELI_ACTIVATED_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: ELI_ACTIVATED_ABILITY_ID,
      sourceCardId: cardId,
      controllerId: player.id,
      effectText: ELI_EFFECT_TEXT,
      stepId: ELI_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
      stepText: ELI_EFFECT_TEXT,
      awaitingPlayerId: player.id,
      selectableCardIds,
      canSkipSelection: true,
      metadata: {
        sourceSlot,
        movedToWaitingRoomCardIds,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: ELI_ACTIVATED_ABILITY_ID,
    sourceCardId: cardId,
    step: 'PAY_COST',
    fromSlot: sourceSlot,
    movedToWaitingRoomCardIds,
    selectableCardIds,
  });
}

function finishEliActivatedEffect(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const selectedCard = selectedCardId ? getCardById(game, selectedCardId) : null;
  const selectedIsValid =
    selectedCardId !== null &&
    effect.selectableCardIds?.includes(selectedCardId) === true &&
    player.waitingRoom.cardIds.includes(selectedCardId) &&
    selectedCard !== null &&
    isMemberCardData(selectedCard.data);
  const cardToHandId = selectedIsValid ? selectedCardId : null;

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    waitingRoom: cardToHandId
      ? {
          ...currentPlayer.waitingRoom,
          cardIds: currentPlayer.waitingRoom.cardIds.filter((cardId) => cardId !== cardToHandId),
        }
      : currentPlayer.waitingRoom,
    hand: cardToHandId ? addCardToZone(currentPlayer.hand, cardToHandId) : currentPlayer.hand,
  }));

  state = {
    ...state,
    activeEffect: null,
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'FINISH',
    selectedCardId: cardToHandId,
  });
}

function findMemberSlot(
  player: { memberSlots: { slots: Readonly<Record<SlotPosition, string | null>> } },
  cardId: string
): SlotPosition | null {
  for (const slot of Object.values(SlotPosition)) {
    if (player.memberSlots.slots[slot] === cardId) {
      return slot;
    }
  }
  return null;
}
