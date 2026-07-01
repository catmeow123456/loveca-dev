import { createHeartIcon, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addHeartLiveModifierForMember,
  addMemberCostLiveModifierForMember,
} from '../../../../domain/rules/live-modifiers.js';
import { CardType, GamePhase, HeartColor, ZoneType } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  HS_PB1_002_ACTIVATED_REVEAL_SAYAKA_MEMBER_STACK_BELOW_ABILITY_ID,
  HS_PB1_002_LIVE_START_MEMBER_BELOW_COUNT_COST_BLUE_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import { revealHandCardForActiveEffect } from '../../runtime/active-effect.js';
import { stackMemberCardBelowSpecialMember } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import { and, cardNameAliasAny, typeIs } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';

const SELECT_SAYAKA_HAND_MEMBER_STEP_ID = 'HS_PB1_002_SELECT_SAYAKA_HAND_MEMBER';
const CONFIRM_STACK_REVEALED_MEMBER_STEP_ID = 'HS_PB1_002_CONFIRM_STACK_REVEALED_MEMBER';
const MAX_COUNTED_MEMBER_BELOW = 3;
const COST_DELTA_PER_MEMBER_BELOW = 4;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsPb1002SayakaWorkflowHandlers(): void {
  registerActivatedAbilityHandler(
    HS_PB1_002_ACTIVATED_REVEAL_SAYAKA_MEMBER_STACK_BELOW_ABILITY_ID,
    (game, playerId, cardId) => startHsPb1002SayakaActivated(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(
    HS_PB1_002_ACTIVATED_REVEAL_SAYAKA_MEMBER_STACK_BELOW_ABILITY_ID,
    SELECT_SAYAKA_HAND_MEMBER_STEP_ID,
    (game, input) => revealHsPb1002SayakaHandMember(game, input.selectedCardId ?? null)
  );
  registerActiveEffectStepHandler(
    HS_PB1_002_ACTIVATED_REVEAL_SAYAKA_MEMBER_STACK_BELOW_ABILITY_ID,
    CONFIRM_STACK_REVEALED_MEMBER_STEP_ID,
    (game) => finishHsPb1002SayakaStackRevealedMember(game)
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    HS_PB1_002_LIVE_START_MEMBER_BELOW_COUNT_COST_BLUE_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      resolveHsPb1002SayakaLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    (game, ability) => {
      const player = getPlayerById(game, ability.controllerId);
      const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
      const memberBelowIds =
        player && sourceSlot !== null ? (player.memberSlots.memberBelow[sourceSlot] ?? []) : [];
      const memberBelowMemberCount = memberBelowIds.filter((cardId) => {
        const card = getCardById(game, cardId);
        return card !== null && isMemberCardData(card.data);
      }).length;
      const countedMemberBelowCount = Math.min(MAX_COUNTED_MEMBER_BELOW, memberBelowMemberCount);
      return {
        effectText: `${getAbilityEffectText(ability.abilityId)}（下方成员卡 ${memberBelowMemberCount}张，计入${countedMemberBelowCount}张，[E]+${countedMemberBelowCount * COST_DELTA_PER_MEMBER_BELOW}，[青ハート]+${countedMemberBelowCount}）`,
        stepText:
          countedMemberBelowCount > 0
            ? `此成员下方有 ${memberBelowMemberCount} 张成员卡，计入 ${countedMemberBelowCount} 张。确认后增加费用与蓝 Heart。`
            : '此成员下方没有可计入的成员卡。确认后不增加费用或蓝 Heart。',
      };
    }
  );
}

function startHsPb1002SayakaActivated(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!HS-pb1-002') ||
    sourceSlot === null
  ) {
    return game;
  }

  const selectableCardIds = getSayakaHandMemberCandidateIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return game;
  }

  const state = recordAbilityUseForContext(game, player.id, {
    abilityId: HS_PB1_002_ACTIVATED_REVEAL_SAYAKA_MEMBER_STACK_BELOW_ABILITY_ID,
    sourceCardId: cardId,
  });

  return addAction(
    {
      ...state,
      activeEffect: {
        id: `${HS_PB1_002_ACTIVATED_REVEAL_SAYAKA_MEMBER_STACK_BELOW_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
        abilityId: HS_PB1_002_ACTIVATED_REVEAL_SAYAKA_MEMBER_STACK_BELOW_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          HS_PB1_002_ACTIVATED_REVEAL_SAYAKA_MEMBER_STACK_BELOW_ABILITY_ID
        ),
        stepId: SELECT_SAYAKA_HAND_MEMBER_STEP_ID,
        stepText: '请选择手牌中1张「村野さやか」成员卡公开。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        canSkipSelection: false,
        selectionLabel: '选择要公开的同名成员',
        confirmSelectionLabel: '公开',
        metadata: {
          sourceSlot,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: HS_PB1_002_ACTIVATED_REVEAL_SAYAKA_MEMBER_STACK_BELOW_ABILITY_ID,
      sourceCardId: cardId,
      step: 'START_REVEAL_SAYAKA_HAND_MEMBER',
      selectableCardIds,
      sourceSlot,
    }
  );
}

function revealHsPb1002SayakaHandMember(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_PB1_002_ACTIVATED_REVEAL_SAYAKA_MEMBER_STACK_BELOW_ABILITY_ID ||
    effect.stepId !== SELECT_SAYAKA_HAND_MEMBER_STEP_ID ||
    selectedCardId === null
  ) {
    return game;
  }

  return revealHandCardForActiveEffect(game, {
    effect,
    playerId: effect.controllerId,
    selectedCardId,
    nextStepId: CONFIRM_STACK_REVEALED_MEMBER_STEP_ID,
    nextStepText: '已公开手牌。确认后将这张卡放置入此成员下方。',
    actionStep: 'REVEAL_SAYAKA_HAND_MEMBER',
    actionPayload: {
      revealedCardId: selectedCardId,
      sourceSlot: effect.metadata?.sourceSlot,
    },
    metadata: {
      revealedCardId: selectedCardId,
    },
  });
}

function finishHsPb1002SayakaStackRevealedMember(game: GameState): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_PB1_002_ACTIVATED_REVEAL_SAYAKA_MEMBER_STACK_BELOW_ABILITY_ID ||
    effect.stepId !== CONFIRM_STACK_REVEALED_MEMBER_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const revealedCardId =
    typeof effect.metadata?.revealedCardId === 'string' ? effect.metadata.revealedCardId : null;
  const targetSlot = player ? getSourceMemberSlot(game, player.id, effect.sourceCardId) : null;
  if (!player || revealedCardId === null || targetSlot === null) {
    return game;
  }

  const stackResult = stackMemberCardBelowSpecialMember(game, {
    playerId: player.id,
    sourceZone: ZoneType.HAND,
    movedCardId: revealedCardId,
    hostCardId: effect.sourceCardId,
    targetSlot,
  });
  if (!stackResult) {
    return game;
  }

  return addAction({ ...stackResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'STACK_REVEALED_SAYAKA_MEMBER_BELOW_SOURCE',
    revealedCardId,
    stackedCardId: stackResult.movedCardId,
    sourceZone: stackResult.sourceZone,
    sourceSlot: effect.metadata?.sourceSlot,
    targetSlot: stackResult.targetSlot,
    hostCardId: stackResult.hostCardId,
  });
}

function resolveHsPb1002SayakaLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return skipPendingAbilityWithoutActiveEffect(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      'SOURCE_NOT_ON_STAGE',
      continuePendingCardEffects
    );
  }

  const memberBelowIds = player.memberSlots.memberBelow[sourceSlot] ?? [];
  const memberBelowMemberCount = memberBelowIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isMemberCardData(card.data);
  }).length;
  const countedMemberBelowCount = Math.min(MAX_COUNTED_MEMBER_BELOW, memberBelowMemberCount);
  if (countedMemberBelowCount <= 0) {
    return skipPendingAbilityWithoutActiveEffect(
      game,
      ability,
      player.id,
      orderedResolution,
      'NO_MEMBER_BELOW',
      continuePendingCardEffects,
      {
        sourceSlot,
        memberBelowMemberCount,
        countedMemberBelowCount,
      }
    );
  }

  const heartResult = addHeartLiveModifierForMember(game, {
    playerId: player.id,
    memberCardId: ability.sourceCardId,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    hearts: [createHeartIcon(HeartColor.BLUE, countedMemberBelowCount)],
  });
  if (!heartResult) {
    return game;
  }

  const costDelta = countedMemberBelowCount * COST_DELTA_PER_MEMBER_BELOW;
  const costResult = addMemberCostLiveModifierForMember(heartResult.gameState, {
    playerId: player.id,
    memberCardId: ability.sourceCardId,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    countDelta: costDelta,
  });
  if (!costResult) {
    return game;
  }

  const state = {
    ...costResult.gameState,
    pendingAbilities: costResult.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'MEMBER_BELOW_COUNT_COST_BLUE_HEART',
      sourceSlot,
      memberBelowMemberCount,
      countedMemberBelowCount,
      costDelta,
      heartColor: HeartColor.BLUE,
      heartCount: countedMemberBelowCount,
    }),
    orderedResolution
  );
}

function skipPendingAbilityWithoutActiveEffect(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>> = {}
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
      sourceSlot: ability.sourceSlot,
      ...payload,
    }),
    orderedResolution
  );
}

function getSayakaHandMemberCandidateIds(game: GameState, playerId: string): readonly string[] {
  return getCardIdsInZoneMatching(
    game,
    playerId,
    ZoneType.HAND,
    and(typeIs(CardType.MEMBER), cardNameAliasAny(['村野さやか', '村野沙耶香']))
  );
}
