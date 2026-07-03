import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addCardToZone } from '../../../../domain/entities/zone.js';
import {
  addHeartLiveModifierForMember,
  addLiveModifier,
  getMemberEffectiveBladeCount,
} from '../../../../domain/rules/live-modifiers.js';
import {
  CardType,
  HeartColor,
  SlotPosition,
  TriggerCondition,
} from '../../../../shared/types/enums.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../ability-definition-types.js';
import {
  S_BP3_025_LIVE_START_AQOURS_BLADE_SIX_THIS_LIVE_SCORE_ABILITY_ID,
  S_BP6_004_LIVE_START_RETURN_NO_LIVE_START_AQOURS_LIVE_GAIN_RED_GREEN_HEART_ABILITY_ID,
  S_BP6_019_LIVE_START_ALL_AQOURS_SCORE_DRAW_HAND_TOP_BOTTOM_ABILITY_ID,
  S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID,
  S_SD1_009_LIVE_START_REVEAL_AQOURS_HAND_TOP_BOTTOM_GAIN_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { getCardAbilityDefinitionsForCardCode } from '../../definitions/lookup.js';
import {
  revealHandCardForActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  addBladeLiveModifierForSourceMember,
  drawCardsForPlayer,
} from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { getRelayEnteredStageMemberCardIdsThisTurn } from '../../../effects/relay-entered-members.js';

const AQOURS = 'Aqours';
const TOP_OPTION_ID = 'top';
const BOTTOM_OPTION_ID = 'bottom';

const SD1_009_SELECT_HAND_STEP_ID = 'S_SD1_009_SELECT_AQOURS_HAND_TO_REVEAL';
const SD1_009_SELECT_DESTINATION_STEP_ID = 'S_SD1_009_SELECT_REVEALED_HAND_TOP_BOTTOM';
const BP3_025_SELECT_MEMBER_STEP_ID = 'S_BP3_025_SELECT_AQOURS_MEMBER_BLADE_CHECK';
const BP6_004_SELECT_LIVE_STEP_ID = 'S_BP6_004_SELECT_NO_LIVE_START_AQOURS_LIVE';
const BP6_019_SELECT_HAND_STEP_ID = 'S_BP6_019_SELECT_HAND_TOP_BOTTOM';
const BP6_020_CHOOSE_ADVENTURE_TYPE_STEP_ID = 'S_BP6_020_CHOOSE_ADVENTURE_TYPE';
const BP6_020_SELECT_RELAY_ENTERED_AQOURS_MEMBER_STEP_ID =
  'S_BP6_020_SELECT_RELAY_ENTERED_AQOURS_MEMBER';
const BP6_020_GRANT_DRAW_OPTION_ID = 'grant-live-success-draw-one';
const BP6_020_GAIN_HEART_OPTION_ID = 'relay-entered-aqours-gain-red-heart';
const BP6_020_SCORE_OPTION_ID = 'success-live-two-this-live-score';

const STAGE_SLOTS: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type DeckDestination = typeof TOP_OPTION_ID | typeof BOTTOM_OPTION_ID;

export function registerSFutureWaterBatch2LiveStartWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    S_SD1_009_LIVE_START_REVEAL_AQOURS_HAND_TOP_BOTTOM_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startSd1009RevealHandTopBottomGainBlade(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_SD1_009_LIVE_START_REVEAL_AQOURS_HAND_TOP_BOTTOM_GAIN_BLADE_ABILITY_ID,
    SD1_009_SELECT_HAND_STEP_ID,
    (game, input, context) =>
      revealSd1009HandCard(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_SD1_009_LIVE_START_REVEAL_AQOURS_HAND_TOP_BOTTOM_GAIN_BLADE_ABILITY_ID,
    SD1_009_SELECT_DESTINATION_STEP_ID,
    (game, input, context) =>
      finishSd1009MoveRevealedHandCard(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    S_BP3_025_LIVE_START_AQOURS_BLADE_SIX_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      startBp3025SelectAqoursMember(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP3_025_LIVE_START_AQOURS_BLADE_SIX_THIS_LIVE_SCORE_ABILITY_ID,
    BP3_025_SELECT_MEMBER_STEP_ID,
    (game, input, context) =>
      finishBp3025BladeCheckScore(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    S_BP6_004_LIVE_START_RETURN_NO_LIVE_START_AQOURS_LIVE_GAIN_RED_GREEN_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startBp6004SelectLiveToDeckTop(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP6_004_LIVE_START_RETURN_NO_LIVE_START_AQOURS_LIVE_GAIN_RED_GREEN_HEART_ABILITY_ID,
    BP6_004_SELECT_LIVE_STEP_ID,
    (game, input, context) =>
      finishBp6004MoveLiveGainHearts(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    S_BP6_019_LIVE_START_ALL_AQOURS_SCORE_DRAW_HAND_TOP_BOTTOM_ABILITY_ID,
    (game, ability, options, context) =>
      startBp6019AllAqoursScoreDrawPlaceHand(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP6_019_LIVE_START_ALL_AQOURS_SCORE_DRAW_HAND_TOP_BOTTOM_ABILITY_ID,
    BP6_019_SELECT_HAND_STEP_ID,
    (game, input, context) =>
      finishBp6019PlaceHandTopBottom(
        game,
        input.selectedCardId ?? null,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID,
    (game, ability, options, context) =>
      startBp6020ChooseAdventureType(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID,
    BP6_020_CHOOSE_ADVENTURE_TYPE_STEP_ID,
    (game, input, context) =>
      finishBp6020AdventureTypeChoice(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID,
    BP6_020_SELECT_RELAY_ENTERED_AQOURS_MEMBER_STEP_ID,
    (game, input, context) =>
      finishBp6020RedHeartTargetSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startSd1009RevealHandTopBottomGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card ? groupAliasIs(AQOURS)(card) : false;
  });
  if (selectableCardIds.length === 0) {
    return skipPendingAbility(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_AQOURS_HAND_CARD_TO_REVEAL',
    });
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
      stepId: SD1_009_SELECT_HAND_STEP_ID,
      stepText:
        '可以公开1张手牌中的『Aqours』卡；若如此做，将其放置到卡组顶或卡组底并获得 BLADE。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要公开的 Aqours 手牌',
      confirmSelectionLabel: '公开',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_AQOURS_HAND_TO_REVEAL',
      selectableCardIds,
    },
  });
}

function revealSd1009HandCard(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_SD1_009_LIVE_START_REVEAL_AQOURS_HAND_TOP_BOTTOM_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== SD1_009_SELECT_HAND_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (selectedCardId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_REVEAL_AQOURS_HAND',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return revealHandCardForActiveEffect(game, {
    effect,
    playerId: player.id,
    selectedCardId,
    nextStepId: SD1_009_SELECT_DESTINATION_STEP_ID,
    nextStepText: '请选择将公开的手牌放置到卡组顶或卡组底。',
    actionStep: 'REVEAL_AQOURS_HAND_CARD',
    selectableCardIds: undefined,
    selectableCardVisibility: 'PUBLIC',
    selectableOptions: [
      { id: TOP_OPTION_ID, label: '卡组顶' },
      { id: BOTTOM_OPTION_ID, label: '卡组底' },
    ],
    selectionLabel: '选择放置位置',
    confirmSelectionLabel: '放置',
    canSkipSelection: false,
    metadata: { revealedHandCardId: selectedCardId },
    actionPayload: { revealedHandCardId: selectedCardId },
  });
}

function finishSd1009MoveRevealedHandCard(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_SD1_009_LIVE_START_REVEAL_AQOURS_HAND_TOP_BOTTOM_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== SD1_009_SELECT_DESTINATION_STEP_ID ||
    !isDeckDestination(selectedOptionId)
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedCardId =
    typeof effect.metadata?.revealedHandCardId === 'string'
      ? effect.metadata.revealedHandCardId
      : null;
  if (!player || selectedCardId === null) {
    return game;
  }

  const moveResult = moveHandCardToMainDeck(game, player.id, selectedCardId, selectedOptionId);
  if (!moveResult) {
    return game;
  }
  const bladeResult = addBladeLiveModifierForSourceMember(moveResult.gameState, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: 1,
  });
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...bladeResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MOVE_REVEALED_HAND_CARD_GAIN_BLADE',
      selectedCardId,
      destination: selectedOptionId,
      bladeBonus: bladeResult.bladeBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startBp3025SelectAqoursMember(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = getStageMemberCardIds(game, player.id).filter((cardId) => {
    const card = getCardById(game, cardId);
    return card ? groupAliasIs(AQOURS)(card) : false;
  });
  if (selectableCardIds.length === 0) {
    return skipPendingAbility(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_AQOURS_STAGE_MEMBER',
    });
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
      stepId: BP3_025_SELECT_MEMBER_STEP_ID,
      stepText: '请选择自己舞台上1名『Aqours』成员；其 BLADE 大于等于6时此LIVE分数+1。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectionLabel: '选择 Aqours 成员',
      confirmSelectionLabel: '确认',
      canSkipSelection: false,
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_AQOURS_MEMBER_BLADE_CHECK',
      selectableCardIds,
    },
  });
}

function finishBp3025BladeCheckScore(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP3_025_LIVE_START_AQOURS_BLADE_SIX_THIS_LIVE_SCORE_ABILITY_ID ||
    effect.stepId !== BP3_025_SELECT_MEMBER_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const bladeCount = getMemberEffectiveBladeCount(game, player.id, selectedCardId);
  const scoreBonus = bladeCount >= 6 ? 1 : 0;
  let state: GameState = { ...game, activeEffect: null };
  if (scoreBonus > 0) {
    state = addScoreModifierAndRefresh(state, {
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      scoreBonus,
    });
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'CHECK_AQOURS_MEMBER_BLADE_SCORE',
      selectedCardId,
      bladeCount,
      scoreBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startBp6004SelectLiveToDeckTop(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  if (player.liveZone.cardIds.length < 2) {
    return skipPendingAbility(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'LIVE_ZONE_LESS_THAN_TWO',
    });
  }

  const selectableCardIds = player.liveZone.cardIds.filter((cardId) =>
    isNoLiveStartAqoursLive(game, cardId)
  );
  if (selectableCardIds.length === 0) {
    return skipPendingAbility(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_NO_LIVE_START_AQOURS_LIVE',
    });
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
      stepId: BP6_004_SELECT_LIVE_STEP_ID,
      stepText:
        '可以选择自己LIVE区中1张不持有 LIVE 开始能力的『Aqours』LIVE卡放置到卡组顶；若如此做，获得红Heart与绿Heart。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectionLabel: '选择要放置到卡组顶的 Aqours LIVE',
      confirmSelectionLabel: '放置到卡组顶',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_NO_LIVE_START_AQOURS_LIVE',
      selectableCardIds,
    },
  });
}

function finishBp6004MoveLiveGainHearts(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      S_BP6_004_LIVE_START_RETURN_NO_LIVE_START_AQOURS_LIVE_GAIN_RED_GREEN_HEART_ABILITY_ID ||
    effect.stepId !== BP6_004_SELECT_LIVE_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (selectedCardId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_RETURN_LIVE_TO_DECK_TOP',
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.liveZone.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const stateAfterMove = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    liveZone: {
      ...currentPlayer.liveZone,
      cardIds: currentPlayer.liveZone.cardIds.filter((cardId) => cardId !== selectedCardId),
      cardStates: removeCardState(currentPlayer.liveZone.cardStates, selectedCardId),
    },
    mainDeck: {
      ...currentPlayer.mainDeck,
      cardIds: [selectedCardId, ...currentPlayer.mainDeck.cardIds],
    },
  }));
  const heartResult = addHeartLiveModifierForMember(stateAfterMove, {
    playerId: player.id,
    memberCardId: effect.sourceCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    hearts: [
      { color: HeartColor.RED, count: 1 },
      { color: HeartColor.GREEN, count: 1 },
    ],
  });
  if (!heartResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...heartResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RETURN_LIVE_TO_DECK_TOP_GAIN_RED_GREEN_HEART',
      selectedCardId,
      gainedHearts: [HeartColor.RED, HeartColor.GREEN],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startBp6019AllAqoursScoreDrawPlaceHand(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const stageMemberCardIds = getStageMemberCardIds(game, player.id);
  const allStageMembersAreAqours =
    stageMemberCardIds.length > 0 &&
    stageMemberCardIds.every((cardId) => {
      const card = getCardById(game, cardId);
      return card ? groupAliasIs(AQOURS)(card) : false;
    });
  if (!allStageMembersAreAqours) {
    return skipPendingAbility(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NOT_ALL_STAGE_MEMBERS_AQOURS',
      stageMemberCardIds,
    });
  }

  let state = addScoreModifierAndRefresh(game, {
    playerId: player.id,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    scoreBonus: 1,
  });
  const drawResult = drawCardsForPlayer(state, player.id, 1);
  if (drawResult) {
    state = drawResult.gameState;
  }
  const playerAfterDraw = getPlayerById(state, player.id);
  if (!playerAfterDraw) {
    return game;
  }
  const selectableCardIds = [...playerAfterDraw.hand.cardIds];

  return startPendingActiveEffect(state, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: BP6_019_SELECT_HAND_STEP_ID,
      stepText:
        selectableCardIds.length > 0
          ? '请选择1张手牌放置到卡组顶或卡组底。'
          : '没有可放置到卡组顶或底的手牌。确认后继续。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableOptions:
        selectableCardIds.length > 0
          ? [
              { id: TOP_OPTION_ID, label: '卡组顶' },
              { id: BOTTOM_OPTION_ID, label: '卡组底' },
            ]
          : undefined,
      selectionLabel: '选择要放置到卡组顶或底的手牌',
      confirmSelectionLabel: '放置',
      canSkipSelection: selectableCardIds.length === 0,
      skipSelectionLabel: selectableCardIds.length === 0 ? '确认' : undefined,
      metadata: {
        orderedResolution,
        scoreBonus: 1,
        drawnCardIds: drawResult?.drawnCardIds ?? [],
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'ALL_AQOURS_SCORE_DRAW_START_HAND_TOP_BOTTOM',
      stageMemberCardIds,
      scoreBonus: 1,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
      selectableCardIds,
    },
  });
}

function finishBp6019PlaceHandTopBottom(
  game: GameState,
  selectedCardId: string | null,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP6_019_LIVE_START_ALL_AQOURS_SCORE_DRAW_HAND_TOP_BOTTOM_ABILITY_ID ||
    effect.stepId !== BP6_019_SELECT_HAND_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = effect.selectableCardIds ?? [];
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_HAND_CARD_TO_TOP_BOTTOM',
        scoreBonus: effect.metadata?.scoreBonus,
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  if (
    selectedCardId === null ||
    !selectableCardIds.includes(selectedCardId) ||
    !isDeckDestination(selectedOptionId)
  ) {
    return game;
  }
  const moveResult = moveHandCardToMainDeck(game, player.id, selectedCardId, selectedOptionId);
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PLACE_HAND_CARD_TO_DECK_TOP_BOTTOM',
      selectedCardId,
      destination: selectedOptionId,
      scoreBonus: effect.metadata?.scoreBonus,
      drawnCardIds: effect.metadata?.drawnCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startBp6020ChooseAdventureType(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableOptions = [
    {
      id: BP6_020_GRANT_DRAW_OPTION_ID,
      label: '获得「LIVE成功时抽1张」',
    },
    {
      id: BP6_020_GAIN_HEART_OPTION_ID,
      label: '本回合换手登场的 Aqours 成员获得[赤ハート]',
    },
    {
      id: BP6_020_SCORE_OPTION_ID,
      label: '成功LIVE区2张以上时此LIVE分数+1',
    },
  ];

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: BP6_020_CHOOSE_ADVENTURE_TYPE_STEP_ID,
      stepText: '请选择「冒险Type A, B, C!!」的1个效果。',
      awaitingPlayerId: player.id,
      selectableOptions,
      confirmSelectionLabel: '选择',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_CHOOSE_ADVENTURE_TYPE',
      selectableOptionIds: selectableOptions.map((option) => option.id),
    },
  });
}

function finishBp6020AdventureTypeChoice(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID ||
    effect.stepId !== BP6_020_CHOOSE_ADVENTURE_TYPE_STEP_ID ||
    selectedOptionId === null ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  if (selectedOptionId === BP6_020_GRANT_DRAW_OPTION_ID) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'GRANT_LIVE_SUCCESS_DRAW_ONE',
        grantedTurnCount: game.turnCount,
        sourceLiveCardId: effect.sourceCardId,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (selectedOptionId === BP6_020_GAIN_HEART_OPTION_ID) {
    const relayEnteredAqoursMemberCardIds = getRelayEnteredStageMemberCardIdsThisTurn(
      game,
      player.id,
      groupAliasIs(AQOURS)
    );
    if (relayEnteredAqoursMemberCardIds.length === 0) {
      return continuePendingCardEffects(
        addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'NO_RELAY_ENTERED_AQOURS_MEMBER_FOR_RED_HEART',
          selectedOptionId,
          relayEnteredAqoursMemberCardIds,
        }),
        effect.metadata?.orderedResolution === true
      );
    }

    return addAction(
      {
        ...game,
        activeEffect: {
          ...effect,
          stepId: BP6_020_SELECT_RELAY_ENTERED_AQOURS_MEMBER_STEP_ID,
          stepText: '选择本回合换手登场的1名 Aqours 成员获得[赤ハート]。',
          selectableCardIds: relayEnteredAqoursMemberCardIds,
          selectableOptions: undefined,
          selectionLabel: '选择本回合换手登场的 Aqours 成员',
          confirmSelectionLabel: '赋予[赤ハート]',
          canSkipSelection: false,
          metadata: {
            ...effect.metadata,
            selectedOptionId,
          },
        },
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'START_SELECT_RELAY_ENTERED_AQOURS_MEMBER_FOR_RED_HEART',
        relayEnteredAqoursMemberCardIds,
      }
    );
  }

  if (selectedOptionId !== BP6_020_SCORE_OPTION_ID) {
    return game;
  }

  const successLiveCount = player.successZone.cardIds.length;
  const scoreBonus = successLiveCount >= 2 ? 1 : 0;
  let state: GameState = { ...game, activeEffect: null };
  if (scoreBonus > 0) {
    state = addScoreModifierAndRefresh(state, {
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      scoreBonus,
    });
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: scoreBonus > 0 ? 'SUCCESS_LIVE_TWO_THIS_LIVE_SCORE' : 'NO_SUCCESS_LIVE_TWO',
      successLiveCount,
      scoreBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishBp6020RedHeartTargetSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID ||
    effect.stepId !== BP6_020_SELECT_RELAY_ENTERED_AQOURS_MEMBER_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const relayEnteredAqoursMemberCardIds = getRelayEnteredStageMemberCardIdsThisTurn(
    game,
    player.id,
    groupAliasIs(AQOURS)
  );
  if (!relayEnteredAqoursMemberCardIds.includes(selectedCardId)) {
    return game;
  }

  const heartResult = addHeartLiveModifierForMember(game, {
    playerId: player.id,
    memberCardId: selectedCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    hearts: [{ color: HeartColor.RED, count: 1 }],
  });
  if (!heartResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...heartResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RELAY_ENTERED_AQOURS_MEMBER_GAIN_RED_HEART',
      selectedCardId,
      gainedHearts: [HeartColor.RED],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function skipPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function moveHandCardToMainDeck(
  game: GameState,
  playerId: string,
  cardId: string,
  destination: DeckDestination
): { readonly gameState: GameState } | null {
  const player = getPlayerById(game, playerId);
  if (!player || !player.hand.cardIds.includes(cardId)) {
    return null;
  }
  return {
    gameState: updatePlayer(game, playerId, (currentPlayer) => ({
      ...currentPlayer,
      hand: {
        ...currentPlayer.hand,
        cardIds: currentPlayer.hand.cardIds.filter((candidate) => candidate !== cardId),
      },
      mainDeck:
        destination === TOP_OPTION_ID
          ? {
              ...currentPlayer.mainDeck,
              cardIds: [cardId, ...currentPlayer.mainDeck.cardIds],
            }
          : addCardToZone(currentPlayer.mainDeck, cardId),
    })),
  };
}

function addScoreModifierAndRefresh(
  game: GameState,
  options: {
    readonly playerId: string;
    readonly sourceCardId: string;
    readonly abilityId: string;
    readonly scoreBonus: number;
  }
): GameState {
  const modifier: Extract<LiveModifierState, { readonly kind: 'SCORE' }> = {
    kind: 'SCORE',
    playerId: options.playerId,
    countDelta: options.scoreBonus,
    liveCardId: options.sourceCardId,
    sourceCardId: options.sourceCardId,
    abilityId: options.abilityId,
  };
  return refreshPlayerScoreDraft(
    addLiveModifier(game, modifier),
    options.playerId,
    options.scoreBonus
  );
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

function getStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return STAGE_SLOTS.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return cardId && card && card.ownerId === player.id && isMemberCardData(card.data)
      ? [cardId]
      : [];
  });
}

function isNoLiveStartAqoursLive(game: GameState, cardId: string): boolean {
  const card = getCardById(game, cardId);
  return (
    !!card &&
    isLiveCardData(card.data) &&
    card.data.cardType === CardType.LIVE &&
    groupAliasIs(AQOURS)(card) &&
    !hasLiveStartAbility(card.data.cardCode)
  );
}

function hasLiveStartAbility(cardCode: string): boolean {
  return getCardAbilityDefinitionsForCardCode(cardCode).some(
    (definition) =>
      definition.category === CardAbilityCategory.LIVE_START &&
      definition.sourceZone === CardAbilitySourceZone.LIVE_CARD &&
      definition.triggerCondition === TriggerCondition.ON_LIVE_START &&
      definition.queued &&
      definition.implemented
  );
}

function isDeckDestination(value: string | null): value is DeckDestination {
  return value === TOP_OPTION_ID || value === BOTTOM_OPTION_ID;
}

function removeCardState<T>(
  cardStates: ReadonlyMap<string, T>,
  cardId: string
): ReadonlyMap<string, T> {
  const nextCardStates = new Map(cardStates);
  nextCardStates.delete(cardId);
  return nextCardStates;
}
