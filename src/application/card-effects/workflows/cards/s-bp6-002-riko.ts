import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addCardToZone } from '../../../../domain/entities/zone.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, ZoneType } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import {
  S_BP6_002_AUTO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING_TOP_BOTTOM_ABILITY_ID,
  S_BP6_002_LIVE_START_AQOURS_LIVE_ZONE_REQUIREMENT_GAIN_ALL_HEART_ABILITY_ID,
} from '../../ability-ids.js';

const AQOURS = 'Aqours';
const TOP_OPTION_ID = 'top';
const BOTTOM_OPTION_ID = 'bottom';
const BP6_002_SELECT_LIVE_STEP_ID = 'S_BP6_002_SELECT_AQOURS_LIVE_FROM_WAITING_ROOM';
const BP6_002_SELECT_DESTINATION_STEP_ID = 'S_BP6_002_SELECT_AQOURS_LIVE_TOP_BOTTOM';

const REQUIREMENT_COLORS: readonly HeartColor[] = [
  HeartColor.RED,
  HeartColor.GREEN,
  HeartColor.BLUE,
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type DeckDestination = typeof TOP_OPTION_ID | typeof BOTTOM_OPTION_ID;

export function registerSFutureWaterFinalWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    S_BP6_002_AUTO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING_TOP_BOTTOM_ABILITY_ID,
    (game, ability, options, context) =>
      startBp6002AqoursLiveFromLiveZoneToWaitingTopBottom(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP6_002_AUTO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING_TOP_BOTTOM_ABILITY_ID,
    BP6_002_SELECT_LIVE_STEP_ID,
    (game, input, context) =>
      finishBp6002SelectWaitingRoomLive(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP6_002_AUTO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING_TOP_BOTTOM_ABILITY_ID,
    BP6_002_SELECT_DESTINATION_STEP_ID,
    (game, input, context) =>
      finishBp6002PlaceWaitingRoomLiveTopBottom(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );

  registerManualConfirmablePendingAbilityStarterHandler(
    S_BP6_002_LIVE_START_AQOURS_LIVE_ZONE_REQUIREMENT_GAIN_ALL_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      resolveBp6002LiveStartAqoursRequirementGainAllHeart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getBp6002LiveStartConfirmationConfig
  );
}

function getBp6002LiveStartConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getBp6002LiveStartContext(game, ability.controllerId);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（LIVE区Aqours：${
      context.allAqoursLive ? '已满足' : '未满足'
    }，[赤ハート][緑ハート][青ハート]必要数合计 ${context.requirementTotal}，${
      context.conditionMet ? '满足条件' : '未满足条件'
    }）`,
  };
}

function startBp6002AqoursLiveFromLiveZoneToWaitingTopBottom(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const eligibleCardIds = getEligibleMovedAqoursLiveCardIds(game, player.id, ability);
  if (eligibleCardIds.length === 0) {
    return skipPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'NO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING',
      }
    );
  }

  const stateAfterUseRecord = recordAbilityUseForContext(game, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });

  return startPendingActiveEffect(stateAfterUseRecord, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: BP6_002_SELECT_LIVE_STEP_ID,
      stepText: '可以从因此进入休息室的『Aqours』LIVE卡中选择1张，放置到卡组顶或卡组底。',
      awaitingPlayerId: player.id,
      selectableCardIds: eligibleCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '选择要放回卡组的 Aqours LIVE',
      confirmSelectionLabel: '选择',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_AQOURS_LIVE_FROM_WAITING_ROOM',
      selectableCardIds: eligibleCardIds,
    },
  });
}

function finishBp6002SelectWaitingRoomLive(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      S_BP6_002_AUTO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING_TOP_BOTTOM_ABILITY_ID ||
    effect.stepId !== BP6_002_SELECT_LIVE_STEP_ID
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
        step: 'DECLINE_AQOURS_LIVE_TOP_BOTTOM',
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  if (effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  return startBp6002DestinationSelection(
    game,
    {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
    },
    player.id,
    selectedCardId,
    effect.metadata?.orderedResolution === true,
    {
      step: 'SELECT_AQOURS_LIVE_FROM_WAITING_ROOM',
      selectedCardId,
    }
  );
}

function finishBp6002PlaceWaitingRoomLiveTopBottom(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      S_BP6_002_AUTO_AQOURS_LIVE_FROM_LIVE_ZONE_TO_WAITING_TOP_BOTTOM_ABILITY_ID ||
    effect.stepId !== BP6_002_SELECT_DESTINATION_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (selectedOptionId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_AQOURS_LIVE_TOP_BOTTOM',
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  const selectedCardId =
    typeof effect.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
  if (!selectedCardId || !isDeckDestination(selectedOptionId)) {
    return game;
  }

  const moveResult = placeWaitingRoomLiveOnMainDeck(
    game,
    player.id,
    selectedCardId,
    selectedOptionId
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PLACE_AQOURS_LIVE_TO_DECK_TOP_BOTTOM',
      selectedCardId,
      destination: selectedOptionId,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function resolveBp6002LiveStartAqoursRequirementGainAllHeart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const { liveCardIds, requirementTotal, conditionMet } = getBp6002LiveStartContext(
    game,
    player.id
  );

  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  if (conditionMet) {
    const heartResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      hearts: [{ color: HeartColor.RAINBOW, count: 2 }],
    });
    if (heartResult) {
      state = heartResult.gameState;
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet
        ? 'AQOURS_LIVE_ZONE_REQUIREMENT_GAIN_ALL_HEART'
        : 'NO_AQOURS_LIVE_ZONE_REQUIREMENT',
      liveCardIds,
      requirementTotal,
      gainedHearts: conditionMet ? [{ color: HeartColor.RAINBOW, count: 2 }] : [],
    }),
    orderedResolution
  );
}

function getBp6002LiveStartContext(
  game: GameState,
  playerId: string
): {
  readonly liveCardIds: readonly string[];
  readonly allAqoursLive: boolean;
  readonly requirementTotal: number;
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, playerId);
  const liveCardIds = player?.liveZone.cardIds ?? [];
  const allAqoursLive =
    liveCardIds.length > 0 &&
    liveCardIds.every((cardId) => {
      const card = getCardById(game, cardId);
      return (
        card !== null &&
        card.ownerId === playerId &&
        isLiveCardData(card.data) &&
        groupAliasIs(AQOURS)(card)
      );
    });
  const requirementTotal = allAqoursLive
    ? liveCardIds.reduce((total, cardId) => {
        const card = getCardById(game, cardId);
        return card && isLiveCardData(card.data)
          ? total + sumRequirementColors(card.data.requirements.colorRequirements)
          : total;
      }, 0)
    : 0;
  return {
    liveCardIds,
    allAqoursLive,
    requirementTotal,
    conditionMet: allAqoursLive && requirementTotal >= 12,
  };
}

function startBp6002DestinationSelection(
  game: GameState,
  ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'>,
  playerId: string,
  selectedCardId: string,
  orderedResolution: boolean,
  actionPayload: Readonly<Record<string, unknown>>
): GameState {
  return startPendingActiveEffect(game, {
    ability,
    playerId,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: BP6_002_SELECT_DESTINATION_STEP_ID,
      stepText: '请选择将该『Aqours』LIVE卡放置到卡组顶或卡组底。也可以选择不发动。',
      awaitingPlayerId: playerId,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          { id: TOP_OPTION_ID, text: '将该『Aqours』LIVE卡放置到卡组顶。' },
          { id: BOTTOM_OPTION_ID, text: '将该『Aqours』LIVE卡放置到卡组底。' },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      selectionLabel: '选择放置位置',
      confirmSelectionLabel: '放置',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution, selectedCardId },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      ...actionPayload,
    },
  });
}

function getEligibleMovedAqoursLiveCardIds(
  game: GameState,
  playerId: string,
  ability: PendingAbilityState
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (
    !player ||
    ability.metadata?.fromZone !== ZoneType.LIVE_ZONE ||
    ability.metadata?.toZone !== ZoneType.WAITING_ROOM
  ) {
    return [];
  }

  const movedCardIds = Array.isArray(ability.metadata.movedCardIds)
    ? ability.metadata.movedCardIds.filter((cardId): cardId is string => typeof cardId === 'string')
    : [];
  return movedCardIds.filter((cardId) => isWaitingRoomAqoursLive(game, player.id, cardId));
}

function isWaitingRoomAqoursLive(game: GameState, playerId: string, cardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  return (
    !!player &&
    !!card &&
    card.ownerId === player.id &&
    player.waitingRoom.cardIds.includes(cardId) &&
    isLiveCardData(card.data) &&
    groupAliasIs(AQOURS)(card)
  );
}

function placeWaitingRoomLiveOnMainDeck(
  game: GameState,
  playerId: string,
  cardId: string,
  destination: DeckDestination
): { readonly gameState: GameState } | null {
  if (!isWaitingRoomAqoursLive(game, playerId, cardId)) {
    return null;
  }
  return {
    gameState: updatePlayer(game, playerId, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((candidate) => candidate !== cardId),
      },
      mainDeck:
        destination === TOP_OPTION_ID
          ? {
              ...player.mainDeck,
              cardIds: [cardId, ...player.mainDeck.cardIds],
            }
          : addCardToZone(player.mainDeck, cardId),
    })),
  };
}

function sumRequirementColors(colorRequirements: ReadonlyMap<HeartColor, number>): number {
  return REQUIREMENT_COLORS.reduce(
    (total, color) => total + (colorRequirements.get(color) ?? 0),
    0
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

function isDeckDestination(optionId: string | null): optionId is DeckDestination {
  return optionId === TOP_OPTION_ID || optionId === BOTTOM_OPTION_ID;
}
