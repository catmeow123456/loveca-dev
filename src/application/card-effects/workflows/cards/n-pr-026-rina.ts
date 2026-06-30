import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, SlotPosition, TriggerCondition, ZoneType } from '../../../../shared/types/enums.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type CardAbilityDefinition,
} from '../../ability-definition-types.js';
import {
  N_PR_026_LIVE_SUCCESS_DELEGATE_MEMBER_BELOW_LIVE_SUCCESS_ABILITIES_ABILITY_ID,
  N_PR_026_ON_ENTER_STACK_LOW_COST_NIJIGASAKI_MEMBER_FROM_WAITING_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { stackMemberCardBelowSpecialMember } from '../../runtime/actions.js';
import { getDelegatableQueuedAbilityDefinitions } from '../../runtime/delegatable-definitions.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import { and, costLte, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import {
  getCardIdsInZoneMatching,
  getCardIdsMatchingSelector,
} from '../../../effects/conditions.js';

const RINA_SELECT_WAITING_MEMBER_STEP_ID = 'N_PR_026_RINA_SELECT_WAITING_MEMBER';
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNPr026RinaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    N_PR_026_ON_ENTER_STACK_LOW_COST_NIJIGASAKI_MEMBER_FROM_WAITING_ABILITY_ID,
    (game, ability, options, context) =>
      startRinaOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    N_PR_026_ON_ENTER_STACK_LOW_COST_NIJIGASAKI_MEMBER_FROM_WAITING_ABILITY_ID,
    RINA_SELECT_WAITING_MEMBER_STEP_ID,
    (game, input, context) =>
      finishRinaOnEnter(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerPendingAbilityStarterHandler(
    N_PR_026_LIVE_SUCCESS_DELEGATE_MEMBER_BELOW_LIVE_SUCCESS_ABILITIES_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options);
      if (confirmation) {
        return confirmation;
      }
      return resolveRinaLiveSuccessDelegation(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function startRinaOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;
  if (!player || sourceSlot === null) {
    return skipPendingAbility(game, ability, ability.controllerId, orderedResolution, 'SOURCE_NOT_ON_STAGE', continuePendingCardEffects);
  }
  const selectableCardIds = getLowCostNijigasakiMemberIdsInWaitingRoom(game, player.id);
  if (selectableCardIds.length === 0) {
    return skipPendingAbility(game, ability, player.id, orderedResolution, 'NO_WAITING_LOW_COST_NIJIGASAKI_MEMBER', continuePendingCardEffects);
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
      stepId: RINA_SELECT_WAITING_MEMBER_STEP_ID,
      stepText: "请选择休息室中1张费用<=9的『虹ヶ咲』成员卡放到此成员下方。",
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      canSkipSelection: false,
      selectionLabel: '选择要放到下方的成员',
      confirmSelectionLabel: '放置',
      metadata: {
        orderedResolution,
        sourceSlot,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      selectableCardIds,
      step: 'START_SELECT_WAITING_LOW_COST_NIJIGASAKI_MEMBER',
    },
  });
}

function finishRinaOnEnter(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== N_PR_026_ON_ENTER_STACK_LOW_COST_NIJIGASAKI_MEMBER_FROM_WAITING_ABILITY_ID ||
    effect.stepId !== RINA_SELECT_WAITING_MEMBER_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, effect.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return game;
  }
  const stackResult = stackMemberCardBelowSpecialMember(game, {
    playerId: player.id,
    sourceZone: ZoneType.WAITING_ROOM,
    movedCardId: selectedCardId,
    hostCardId: effect.sourceCardId,
    targetSlot: sourceSlot,
  });
  if (!stackResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...stackResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'STACK_WAITING_LOW_COST_NIJIGASAKI_MEMBER_BELOW_SOURCE',
      stackedCardId: selectedCardId,
      sourceSlot,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function resolveRinaLiveSuccessDelegation(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;
  if (!player || sourceSlot === null) {
    return skipPendingAbility(game, ability, ability.controllerId, orderedResolution, 'SOURCE_NOT_ON_STAGE', continuePendingCardEffects);
  }

  const syntheticAbilities = createRinaGrantedLiveSuccessPendingAbilities(
    game,
    ability,
    player.id,
    sourceSlot
  );
  const state = {
    ...game,
    pendingAbilities: [
      ...game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      ...syntheticAbilities,
    ],
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step:
        syntheticAbilities.length > 0
          ? 'DELEGATE_MEMBER_BELOW_LIVE_SUCCESS_ABILITIES'
          : 'NO_DELEGATABLE_MEMBER_BELOW_LIVE_SUCCESS_ABILITIES',
      syntheticPendingAbilityIds: syntheticAbilities.map((pending) => pending.id),
      delegatedAbilityIds: syntheticAbilities.map((pending) => pending.abilityId),
    }),
    orderedResolution
  );
}

function createRinaGrantedLiveSuccessPendingAbilities(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  rinaSlot: SlotPosition
): readonly PendingAbilityState[] {
  const memberBelowCardIds = getLowCostNijigasakiMemberIdsBelowRina(game, playerId, rinaSlot);
  const liveSuccessEventKey = ability.eventIds.join('|') || `live-success:${ability.id}`;
  const pendingAbilities: PendingAbilityState[] = [];
  for (const memberBelowCardId of memberBelowCardIds) {
    const card = getCardById(game, memberBelowCardId);
    if (!card) {
      continue;
    }
    const definitions = getRinaDelegatableLiveSuccessDefinitions(card.data.cardCode, rinaSlot);
    for (const definition of definitions) {
      pendingAbilities.push({
        id: `rina:${ability.sourceCardId}:${memberBelowCardId}:${definition.abilityId}:${liveSuccessEventKey}`,
        abilityId: definition.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: playerId,
        mandatory: false,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
        eventIds: ability.eventIds,
        sourceSlot: rinaSlot,
        metadata: {
          grantedByAbilityId: ability.abilityId,
          grantedFromMemberBelowCardId: memberBelowCardId,
          grantedFromCardCode: card.data.cardCode,
        },
      });
    }
  }
  return pendingAbilities;
}

function getRinaDelegatableLiveSuccessDefinitions(
  cardCode: string,
  rinaSlot: SlotPosition
): readonly CardAbilityDefinition[] {
  return getDelegatableQueuedAbilityDefinitions({
    cardCode,
    category: CardAbilityCategory.LIVE_SUCCESS,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
    sourceSlot: rinaSlot,
  }).filter(
    (definition) =>
      definition.abilityId !== N_PR_026_LIVE_SUCCESS_DELEGATE_MEMBER_BELOW_LIVE_SUCCESS_ABILITIES_ABILITY_ID
  );
}

function getLowCostNijigasakiMemberIdsInWaitingRoom(
  game: GameState,
  playerId: string
): readonly string[] {
  return getCardIdsInZoneMatching(
    game,
    playerId,
    ZoneType.WAITING_ROOM,
    and(typeIs(CardType.MEMBER), costLte(9), groupAliasIs('虹ヶ咲'))
  );
}

function getLowCostNijigasakiMemberIdsBelowRina(
  game: GameState,
  playerId: string,
  sourceSlot: SlotPosition
): readonly string[] {
  const player = getPlayerById(game, playerId);
  return getCardIdsMatchingSelector(
    game,
    player?.memberSlots.memberBelow[sourceSlot] ?? [],
    and(typeIs(CardType.MEMBER), costLte(9), groupAliasIs('虹ヶ咲'))
  );
}

function skipPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects
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
    }),
    orderedResolution
  );
}
