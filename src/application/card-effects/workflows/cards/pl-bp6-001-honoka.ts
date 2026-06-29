import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, SlotPosition } from '../../../../shared/types/enums.js';
import {
  and,
  groupAliasIs,
  hasBladeHeart,
  not,
  typeIs,
} from '../../../effects/card-selectors.js';
import {
  BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID,
  BP6_001_LIVE_SUCCESS_CHEER_NO_BLADE_MUSE_MEMBER_DRAW_DISCARD_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';

const MUSE = "μ's";
const STAGE_SLOTS: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];
const BP6_001_LIVE_SUCCESS_SELECT_DISCARD_STEP_ID =
  'BP6_001_LIVE_SUCCESS_SELECT_DISCARD_AFTER_DRAW';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp6001HonokaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    BP6_001_LIVE_START_CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveHonokaLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerPendingAbilityStarterHandler(
    BP6_001_LIVE_SUCCESS_CHEER_NO_BLADE_MUSE_MEMBER_DRAW_DISCARD_ABILITY_ID,
    (game, ability, options, context) =>
      startHonokaLiveSuccessDrawDiscard(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP6_001_LIVE_SUCCESS_CHEER_NO_BLADE_MUSE_MEMBER_DRAW_DISCARD_ABILITY_ID,
    BP6_001_LIVE_SUCCESS_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishDrawThenDiscardCardsWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function resolveHonokaLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = getSourceMemberSlot(game, player.id, ability.sourceCardId);
  const ownMuseLiveCardIds =
    sourceSlot === SlotPosition.CENTER ? getOwnLiveZoneMuseLiveCardIds(game, player.id) : [];
  const conditionMet = sourceSlot === SlotPosition.CENTER && ownMuseLiveCardIds.length > 0;
  const targetMemberCardIds = conditionMet ? getOwnStageMuseMemberCardIds(game, player.id) : [];
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const appliedTargetMemberCardIds: string[] = [];

  for (const targetMemberCardId of targetMemberCardIds) {
    const bladeResult = addBladeLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: targetMemberCardId,
      abilityId: ability.abilityId,
      amount: 1,
    });
    if (!bladeResult) {
      continue;
    }
    state = bladeResult.gameState;
    appliedTargetMemberCardIds.push(targetMemberCardId);
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet
        ? 'CENTER_MUSE_LIVE_STAGE_MUSE_MEMBERS_GAIN_BLADE'
        : 'NO_CENTER_OR_MUSE_LIVE',
      sourceSlot,
      ownMuseLiveCardIds,
      targetMemberCardIds,
      appliedTargetMemberCardIds,
      bladeBonusPerMember: conditionMet ? 1 : 0,
    }),
    orderedResolution
  );
}

function startHonokaLiveSuccessDrawDiscard(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const currentCheerCardIds = getCurrentOwnCheerCardIds(game, player.id);
  const matchingCheerCardIds = getCurrentOwnRevealedCheerNoBladeMuseMemberCardIds(
    game,
    player.id
  );
  if (matchingCheerCardIds.length === 0) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_REVEALED_CHEER_NO_BLADE_MUSE_MEMBER',
        currentCheerCardIds,
        matchingCheerCardIds,
      }),
      orderedResolution
    );
  }

  return startDrawThenDiscardCardsWorkflow(game, {
    ability,
    effectText: getAbilityEffectText(
      BP6_001_LIVE_SUCCESS_CHEER_NO_BLADE_MUSE_MEMBER_DRAW_DISCARD_ABILITY_ID
    ),
    drawCount: 1,
    discardCount: 1,
    stepId: BP6_001_LIVE_SUCCESS_SELECT_DISCARD_STEP_ID,
    orderedResolution,
    continuePendingCardEffects,
  });
}

function getOwnLiveZoneMuseLiveCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.liveZone.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      !!card &&
      card.ownerId === player.id &&
      isLiveCardData(card.data) &&
      groupAliasIs(MUSE)(card)
    );
  });
}

function getOwnStageMuseMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return STAGE_SLOTS.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return cardId &&
      card &&
      card.ownerId === player.id &&
      isMemberCardData(card.data) &&
      groupAliasIs(MUSE)(card)
      ? [cardId]
      : [];
  });
}

function getCurrentOwnRevealedCheerNoBladeMuseMemberCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  const currentCheerCardIds = getCurrentOwnCheerCardIds(game, playerId);
  const resolutionCardIdSet = new Set(game.resolutionZone.cardIds);
  const revealedCardIdSet = new Set(game.resolutionZone.revealedCardIds);
  const isNoBladeMuseMember = and(
    typeIs(CardType.MEMBER),
    groupAliasIs(MUSE),
    not(hasBladeHeart())
  );
  return currentCheerCardIds.filter((cardId) => {
    if (!resolutionCardIdSet.has(cardId) || !revealedCardIdSet.has(cardId)) {
      return false;
    }
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === playerId && isNoBladeMuseMember(card);
  });
}

function getCurrentOwnCheerCardIds(game: GameState, playerId: string): readonly string[] {
  const firstPlayerId = game.players[game.firstPlayerIndex]?.id ?? null;
  return playerId === firstPlayerId
    ? game.liveResolution.firstPlayerCheerCardIds
    : game.liveResolution.secondPlayerCheerCardIds;
}
