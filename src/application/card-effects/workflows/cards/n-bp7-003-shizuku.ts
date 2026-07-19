import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType, GamePhase, TriggerCondition, ZoneType } from '../../../../shared/types/enums.js';
import { selectDifferentNamedCards } from '../../../../shared/utils/card-identity.js';
import { and, costLte, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import {
  N_BP7_003_ACTIVATED_MILL_FIVE_STACK_MEMBER_COPY_PRINTED_HEARTS_ABILITY_ID,
  N_BP7_003_LIVE_START_DIFFERENT_MEMBER_BELOW_GAIN_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  addBladeLiveModifierForSourceMember,
  stackMemberCardBelowStageMember,
} from '../../runtime/actions.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const REVEAL_MILLED_STEP = 'N_BP7_003_REVEAL_MILLED_FIVE';
const SELECT_MEMBER_STEP = 'N_BP7_003_SELECT_WAITING_MEMBER_TO_STACK';
const MILL_COUNT = 5;
const eligibleWaitingMember = and(
  typeIs(CardType.MEMBER),
  costLte(17),
  groupAliasIs('虹ヶ咲')
);

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp7003ShizukuWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(
    N_BP7_003_ACTIVATED_MILL_FIVE_STACK_MEMBER_COPY_PRINTED_HEARTS_ABILITY_ID,
    (game, playerId, sourceCardId) =>
      startActivatedShizuku(game, playerId, sourceCardId, deps.enqueueTriggeredCardEffects)
  );
  registerActiveEffectStepHandler(
    N_BP7_003_ACTIVATED_MILL_FIVE_STACK_MEMBER_COPY_PRINTED_HEARTS_ABILITY_ID,
    REVEAL_MILLED_STEP,
    (game, _input, context) =>
      finishMillReveal(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    N_BP7_003_ACTIVATED_MILL_FIVE_STACK_MEMBER_COPY_PRINTED_HEARTS_ABILITY_ID,
    SELECT_MEMBER_STEP,
    (game, input, context) =>
      finishStackedMember(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerPendingAbilityStarterHandler(
    N_BP7_003_LIVE_START_DIFFERENT_MEMBER_BELOW_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) => {
      const count = countDifferentMembersBelow(game, ability.controllerId, ability.sourceCardId);
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: `${getAbilityEffectText(ability.abilityId)}\n（当前下方有${count}种不同名称的成员卡，实际获得${count}个[BLADE]。）`,
        stepText: '确认后结算此效果。',
      });
      return (
        confirmation ??
        resolveLiveStartBlade(
          game,
          ability,
          options.orderedResolution === true,
          context.continuePendingCardEffects
        )
      );
    }
  );
}

function startActivatedShizuku(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, sourceCardId);
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !source ||
    source.ownerId !== playerId ||
    source.data.cardCode !== 'PL!N-bp7-003-SEC' ||
    !isMemberCardData(source.data) ||
    sourceSlot === null
  ) {
    return game;
  }

  const millResult = moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    game,
    playerId,
    MILL_COUNT,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId,
        sourceCardId,
        abilityId: N_BP7_003_ACTIVATED_MILL_FIVE_STACK_MEMBER_COPY_PRINTED_HEARTS_ABILITY_ID,
      },
    }
  );
  if (!millResult || millResult.movedCardIds.length !== MILL_COUNT) return game;

  let state = recordAbilityUseForContext(millResult.gameState, playerId, {
    abilityId: N_BP7_003_ACTIVATED_MILL_FIVE_STACK_MEMBER_COPY_PRINTED_HEARTS_ABILITY_ID,
    sourceCardId,
  });
  state = recordPayCostAction(state, playerId, {
    abilityId: N_BP7_003_ACTIVATED_MILL_FIVE_STACK_MEMBER_COPY_PRINTED_HEARTS_ABILITY_ID,
    sourceCardId,
    movedCardIds: millResult.movedCardIds,
    refreshCount: millResult.refreshCount,
  });
  const effectId = `${N_BP7_003_ACTIVATED_MILL_FIVE_STACK_MEMBER_COPY_PRINTED_HEARTS_ABILITY_ID}:${sourceCardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`;
  return addAction(
    {
      ...state,
      activeEffect: {
        id: effectId,
        abilityId: N_BP7_003_ACTIVATED_MILL_FIVE_STACK_MEMBER_COPY_PRINTED_HEARTS_ABILITY_ID,
        sourceCardId,
        controllerId: playerId,
        effectText: getAbilityEffectText(
          N_BP7_003_ACTIVATED_MILL_FIVE_STACK_MEMBER_COPY_PRINTED_HEARTS_ABILITY_ID
        ),
        stepId: REVEAL_MILLED_STEP,
        stepText: `已将卡组顶合计${millResult.movedCardIds.length}张放置入休息室。${millResult.refreshCount > 0 ? '期间发生卡组更新。' : ''}`,
        awaitingPlayerId: playerId,
        revealedCardIds: [...new Set(millResult.movedCardIds)],
        confirmSelectionLabel: '确认公开结果',
        metadata: {
          sourceSlot,
          milledCardIds: millResult.movedCardIds,
          refreshCount: millResult.refreshCount,
        },
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: N_BP7_003_ACTIVATED_MILL_FIVE_STACK_MEMBER_COPY_PRINTED_HEARTS_ABILITY_ID,
      sourceCardId,
      step: 'MILL_FIVE_COST_REVEAL',
      movedCardIds: millResult.movedCardIds,
      refreshCount: millResult.refreshCount,
    }
  );
}

function finishMillReveal(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== REVEAL_MILLED_STEP) return game;
  const candidateCardIds = getEligibleWaitingMembers(game, effect.controllerId);
  if (candidateCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'PAID_NO_ELIGIBLE_WAITING_MEMBER',
        movedCardIds: effect.metadata?.milledCardIds,
        refreshCount: effect.metadata?.refreshCount,
      }),
      false
    );
  }
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_MEMBER_STEP,
        stepText: '请选择自己休息室中1张费用小于等于17的『虹ヶ咲』成员卡放置于此成员的下方。',
        revealedCardIds: undefined,
        selectableCardIds: candidateCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择要放置于下方的成员',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        confirmSelectionLabel: '放置于成员下方',
        canSkipSelection: false,
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH_MILL_REVEAL_SELECT_MEMBER',
      selectableCardIds: candidateCardIds,
    }
  );
}

function finishStackedMember(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.stepId !== SELECT_MEMBER_STEP ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, effect.sourceCardId)
    : null;
  const selectedCard = getCardById(game, selectedCardId);
  const stillEligible = getEligibleWaitingMembers(game, effect.controllerId).includes(selectedCardId);
  const stackResult =
    player && sourceSlot !== null && selectedCard && stillEligible
      ? stackMemberCardBelowStageMember(game, {
          playerId: player.id,
          sourceZone: ZoneType.WAITING_ROOM,
          movedCardId: selectedCardId,
          hostCardId: effect.sourceCardId,
          targetSlot: sourceSlot,
        })
      : null;
  const replacementHearts =
    stackResult && selectedCard && isMemberCardData(selectedCard.data)
      ? selectedCard.data.hearts.map((heart) => ({ ...heart }))
      : null;
  const stateWithReplacement =
    stackResult && replacementHearts
      ? addLiveModifier(stackResult.gameState, {
          kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
          playerId: effect.controllerId,
          memberCardId: effect.sourceCardId,
          hearts: replacementHearts,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        })
      : game;
  const state = addAction({ ...stateWithReplacement, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: stackResult ? 'STACK_MEMBER_AND_REPLACE_PRINTED_HEARTS' : 'PAID_TARGET_STALE',
    movedCardIds: effect.metadata?.milledCardIds,
    refreshCount: effect.metadata?.refreshCount,
    stackedCardId: stackResult?.movedCardId ?? null,
    replacementHearts,
  });
  return continuePendingCardEffects(state, false);
}

function resolveLiveStartBlade(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const count = countDifferentMembersBelow(game, ability.controllerId, ability.sourceCardId);
  const player = getPlayerById(game, ability.controllerId);
  const sourceValid = player && getSourceMemberSlot(game, player.id, ability.sourceCardId) !== null;
  const stateWithoutPending = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const bladeResult =
    sourceValid && count > 0
      ? addBladeLiveModifierForSourceMember(stateWithoutPending, {
          playerId: player.id,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
          amount: count,
        })
      : null;
  return continuePendingCardEffects(
    addAction(bladeResult?.gameState ?? stateWithoutPending, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: sourceValid ? 'GAIN_BLADE_BY_DIFFERENT_MEMBER_BELOW' : 'SOURCE_NOT_ON_STAGE',
      differentNameCount: sourceValid ? count : 0,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
    }),
    orderedResolution
  );
}

function getEligibleWaitingMembers(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return (
    player?.waitingRoom.cardIds.filter((cardId) => {
      const card = getCardById(game, cardId);
      return !!card && card.ownerId === playerId && eligibleWaitingMember(card);
    }) ?? []
  );
}

function countDifferentMembersBelow(
  game: GameState,
  playerId: string,
  sourceCardId: string
): number {
  const player = getPlayerById(game, playerId);
  const slot = player ? getSourceMemberSlot(game, playerId, sourceCardId) : null;
  if (!player || slot === null) return 0;
  const memberCardIds = (player.memberSlots.memberBelow[slot] ?? []).filter((cardId) => {
    const card = getCardById(game, cardId);
    return card?.ownerId === playerId && isMemberCardData(card.data);
  });
  return selectDifferentNamedCards(
    memberCardIds,
    (cardId) => getCardById(game, cardId)?.data ?? null,
    { minCount: 0, getSecondaryKey: (cardId) => cardId }
  ).length;
}
