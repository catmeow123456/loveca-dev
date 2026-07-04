import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addCardToZone,
  getAllMemberCardIds,
  removeCardFromZone,
} from '../../../../domain/entities/zone.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, ZoneType } from '../../../../shared/types/enums.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { normalizeCardName } from '../../../effects/card-selectors.js';
import { finishSkippedActiveEffect } from '../../runtime/active-effect.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import {
  PL_N_BP4_010_LIVE_START_MATCHING_NIJIGASAKI_LIVE_GAIN_GREEN_HEART_ABILITY_ID,
  PL_N_BP4_010_ON_ENTER_EXCHANGE_NIJIGASAKI_SUCCESS_LIVE_ABILITY_ID,
} from '../../ability-ids.js';

const SELECT_SUCCESS_LIVE_STEP_ID = 'PL_N_BP4_010_SELECT_SUCCESS_NIJIGASAKI_LIVE';
const SELECT_WAITING_LIVE_STEP_ID = 'PL_N_BP4_010_SELECT_WAITING_NIJIGASAKI_LIVE';
const SELECT_LIVE_ZONE_LIVE_STEP_ID = 'PL_N_BP4_010_SELECT_LIVE_ZONE_NIJIGASAKI_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type PendingAbilityRef = Pick<
  PendingAbilityState,
  'id' | 'abilityId' | 'sourceCardId' | 'controllerId'
>;

export function registerNBp4010ShiorikoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP4_010_ON_ENTER_EXCHANGE_NIJIGASAKI_SUCCESS_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startOnEnterExchange(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_010_ON_ENTER_EXCHANGE_NIJIGASAKI_SUCCESS_LIVE_ABILITY_ID,
    SELECT_SUCCESS_LIVE_STEP_ID,
    (game, input, context) =>
      finishSuccessLiveSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_010_ON_ENTER_EXCHANGE_NIJIGASAKI_SUCCESS_LIVE_ABILITY_ID,
    SELECT_WAITING_LIVE_STEP_ID,
    (game, input, context) =>
      finishWaitingLiveSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    PL_N_BP4_010_LIVE_START_MATCHING_NIJIGASAKI_LIVE_GAIN_GREEN_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startLiveStartGreenHeart(
        game,
        ability,
        options.orderedResolution === true,
        options,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_010_LIVE_START_MATCHING_NIJIGASAKI_LIVE_GAIN_GREEN_HEART_ABILITY_ID,
    SELECT_LIVE_ZONE_LIVE_STEP_ID,
    (game, input, context) =>
      finishLiveZoneLiveSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startOnEnterExchange(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const candidateCardIds =
    player && isSourceOnOwnStage(game, player.id, ability.sourceCardId)
      ? getNijigasakiLiveCardIdsInZone(game, player.id, ZoneType.SUCCESS_ZONE)
      : [];

  if (!player || candidateCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(consumePendingAbility(game, ability), 'RESOLVE_ABILITY', ability.controllerId, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_SUCCESS_NIJIGASAKI_LIVE',
        candidateCardIds,
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...consumePendingAbility(game, ability),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_SUCCESS_LIVE_STEP_ID,
        stepText: '可以选择自己成功LIVE卡区1张「虹ヶ咲」LIVE放置入休息室。',
        awaitingPlayerId: player.id,
        selectableCardIds: candidateCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择成功LIVE卡区的虹咲LIVE',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: { orderedResolution },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_SUCCESS_NIJIGASAKI_LIVE',
      candidateCardIds,
    }
  );
}

function finishSuccessLiveSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_010_ON_ENTER_EXCHANGE_NIJIGASAKI_SUCCESS_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_SUCCESS_LIVE_STEP_ID
  ) {
    return game;
  }
  if (selectedCardId === null) {
    return finishSkippedActiveEffect(game, continuePendingCardEffects, { step: 'DECLINE_EXCHANGE' });
  }
  if (effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (
    !player ||
    !isSourceOnOwnStage(game, player.id, effect.sourceCardId) ||
    !isNijigasakiLiveInZone(game, player.id, selectedCardId, ZoneType.SUCCESS_ZONE)
  ) {
    return game;
  }

  const stateAfterMove = moveCardBetweenOwnPublicZones(
    game,
    player.id,
    selectedCardId,
    ZoneType.SUCCESS_ZONE,
    ZoneType.WAITING_ROOM
  );
  const waitingCandidateIds = getNijigasakiLiveCardIdsInZone(
    stateAfterMove,
    player.id,
    ZoneType.WAITING_ROOM
  );
  if (waitingCandidateIds.length === 0) {
    return game;
  }

  return addAction(
    {
      ...stateAfterMove,
      activeEffect: {
        ...effect,
        stepId: SELECT_WAITING_LIVE_STEP_ID,
        stepText: '请选择自己休息室1张「虹ヶ咲」LIVE放置入成功LIVE卡区。',
        selectableCardIds: waitingCandidateIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择休息室的虹咲LIVE',
        confirmSelectionLabel: '放置入成功LIVE卡区',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          movedSuccessLiveCardId: selectedCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MOVE_SUCCESS_NIJIGASAKI_LIVE_TO_WAITING_ROOM',
      movedCardId: selectedCardId,
      waitingCandidateIds,
    }
  );
}

function finishWaitingLiveSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_010_ON_ENTER_EXCHANGE_NIJIGASAKI_SUCCESS_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_LIVE_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (
    !player ||
    !isSourceOnOwnStage(game, player.id, effect.sourceCardId) ||
    !isNijigasakiLiveInZone(game, player.id, selectedCardId, ZoneType.WAITING_ROOM)
  ) {
    return game;
  }

  const stateAfterMove = moveCardBetweenOwnPublicZones(
    game,
    player.id,
    selectedCardId,
    ZoneType.WAITING_ROOM,
    ZoneType.SUCCESS_ZONE
  );
  return continuePendingCardEffects(
    addAction({ ...stateAfterMove, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MOVE_WAITING_NIJIGASAKI_LIVE_TO_SUCCESS_ZONE',
      firstMovedCardId: effect.metadata?.movedSuccessLiveCardId,
      movedCardId: selectedCardId,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startLiveStartGreenHeart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const candidateCardIds =
    player && isSourceOnOwnStage(game, player.id, ability.sourceCardId)
      ? getNijigasakiLiveCardIdsInZone(game, player.id, ZoneType.LIVE_ZONE)
      : [];

  if (!player || candidateCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(consumePendingAbility(game, ability), 'RESOLVE_ABILITY', ability.controllerId, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_LIVE_ZONE_NIJIGASAKI_LIVE',
        candidateCardIds,
      }),
      orderedResolution
    );
  }

  if (candidateCardIds.length === 1) {
    const selectedCardId = candidateCardIds[0];
    const context = getLiveStartContext(game, player.id, ability.sourceCardId, selectedCardId);
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      effectText: `${getAbilityEffectText(ability.abilityId)}（选择「${context.selectedLiveName}」，成功LIVE卡区${context.hasMatchingSuccessLive ? '有' : '没有'}同名卡，${context.willGainHeart ? '将获得[緑ハート]' : '不会获得[緑ハート]'}。）`,
      stepText: context.willGainHeart
        ? `确认后此成员获得[緑ハート]。`
        : `确认后不获得[緑ハート]，并结算此效果。`,
    });
    if (confirmation) {
      return confirmation;
    }
    return resolveLiveStartSelection(
      game,
      ability,
      player.id,
      selectedCardId,
      orderedResolution,
      continuePendingCardEffects
    );
  }

  return addAction(
    {
      ...consumePendingAbility(game, ability),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_LIVE_ZONE_LIVE_STEP_ID,
        stepText: '请选择自己LIVE中的1张「虹ヶ咲」LIVE。',
        awaitingPlayerId: player.id,
        selectableCardIds: candidateCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择LIVE中的虹咲LIVE',
        confirmSelectionLabel: '确认',
        canSkipSelection: false,
        metadata: { orderedResolution },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_LIVE_ZONE_NIJIGASAKI_LIVE',
      candidateCardIds,
    }
  );
}

function finishLiveZoneLiveSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP4_010_LIVE_START_MATCHING_NIJIGASAKI_LIVE_GAIN_GREEN_HEART_ABILITY_ID ||
    effect.stepId !== SELECT_LIVE_ZONE_LIVE_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (
    !player ||
    !isSourceOnOwnStage(game, player.id, effect.sourceCardId) ||
    !isNijigasakiLiveInZone(game, player.id, selectedCardId, ZoneType.LIVE_ZONE)
  ) {
    return game;
  }

  return resolveLiveStartSelection(
    { ...game, activeEffect: null },
    {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
    },
    player.id,
    selectedCardId,
    effect.metadata?.orderedResolution === true,
    continuePendingCardEffects
  );
}

function resolveLiveStartSelection(
  game: GameState,
  ability: PendingAbilityRef,
  playerId: string,
  selectedCardId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const stateWithoutPending = consumePendingAbility(game, ability);
  const context = getLiveStartContext(
    stateWithoutPending,
    playerId,
    ability.sourceCardId,
    selectedCardId
  );
  const heartResult =
    context.willGainHeart && isSourceOnOwnStage(stateWithoutPending, playerId, ability.sourceCardId)
      ? addHeartLiveModifierForMember(stateWithoutPending, {
          playerId,
          memberCardId: ability.sourceCardId,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
          hearts: [{ color: HeartColor.GREEN, count: 1 }],
        })
      : null;
  const stateAfterHeart = heartResult?.gameState ?? stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterHeart, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: context.willGainHeart ? 'MATCHING_SUCCESS_LIVE_GAIN_GREEN_HEART' : 'NO_MATCHING_SUCCESS_LIVE',
      selectedLiveCardId: selectedCardId,
      selectedLiveName: context.selectedLiveName,
      hasMatchingSuccessLive: context.hasMatchingSuccessLive,
      gainedHearts: context.willGainHeart ? [{ color: HeartColor.GREEN, count: 1 }] : [],
    }),
    orderedResolution
  );
}

function getLiveStartContext(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  selectedCardId: string
): {
  readonly selectedLiveName: string;
  readonly hasMatchingSuccessLive: boolean;
  readonly willGainHeart: boolean;
} {
  const selectedCard = getCardById(game, selectedCardId);
  const selectedLiveName = selectedCard?.data.name ?? '';
  const normalizedSelectedName = normalizeCardName(selectedLiveName);
  const player = getPlayerById(game, playerId);
  const hasMatchingSuccessLive =
    player?.successZone.cardIds.some((cardId) => {
      const card = getCardById(game, cardId);
      return card !== null && normalizeCardName(card.data.name) === normalizedSelectedName;
    }) ?? false;
  const willGainHeart =
    normalizedSelectedName.length > 0 &&
    hasMatchingSuccessLive &&
    isSourceOnOwnStage(game, playerId, sourceCardId);
  return { selectedLiveName, hasMatchingSuccessLive, willGainHeart };
}

function getNijigasakiLiveCardIdsInZone(
  game: GameState,
  playerId: string,
  zoneType: ZoneType.LIVE_ZONE | ZoneType.SUCCESS_ZONE | ZoneType.WAITING_ROOM
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  const cardIds =
    zoneType === ZoneType.LIVE_ZONE
      ? player.liveZone.cardIds
      : zoneType === ZoneType.SUCCESS_ZONE
        ? player.successZone.cardIds
        : player.waitingRoom.cardIds;
  return cardIds.filter((cardId) => isNijigasakiLiveInZone(game, playerId, cardId, zoneType));
}

function isNijigasakiLiveInZone(
  game: GameState,
  playerId: string,
  cardId: string,
  zoneType: ZoneType.LIVE_ZONE | ZoneType.SUCCESS_ZONE | ZoneType.WAITING_ROOM
): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  if (!player || !card || !isLiveCardData(card.data) || !cardBelongsToGroup(card.data, '虹ヶ咲')) {
    return false;
  }
  const zoneCardIds =
    zoneType === ZoneType.LIVE_ZONE
      ? player.liveZone.cardIds
      : zoneType === ZoneType.SUCCESS_ZONE
        ? player.successZone.cardIds
        : player.waitingRoom.cardIds;
  return zoneCardIds.includes(cardId);
}

function isSourceOnOwnStage(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  return player ? getAllMemberCardIds(player.memberSlots).includes(sourceCardId) : false;
}

function moveCardBetweenOwnPublicZones(
  game: GameState,
  playerId: string,
  cardId: string,
  fromZone: ZoneType.SUCCESS_ZONE | ZoneType.WAITING_ROOM,
  toZone: ZoneType.SUCCESS_ZONE | ZoneType.WAITING_ROOM
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    successZone:
      fromZone === ZoneType.SUCCESS_ZONE
        ? removeCardFromZone(player.successZone, cardId)
        : toZone === ZoneType.SUCCESS_ZONE
          ? addCardToZone(player.successZone, cardId)
          : player.successZone,
    waitingRoom:
      fromZone === ZoneType.WAITING_ROOM
        ? removeCardFromZone(player.waitingRoom, cardId)
        : toZone === ZoneType.WAITING_ROOM
          ? addCardToZone(player.waitingRoom, cardId)
          : player.waitingRoom,
  }));
}

function consumePendingAbility(game: GameState, ability: PendingAbilityRef): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
}
