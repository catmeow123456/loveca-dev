import {
  addAction,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { CARD_ABILITY_DEFINITIONS } from '../../definitions/index.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  and,
  cardNameAliasIs,
  groupAliasIs,
  or,
  typeIs,
} from '../../../effects/card-selectors.js';
import { hasStageMemberMatching } from '../../../effects/conditions.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const HS_SD1_006_SELECT_WAITING_ROOM_LIVE_STEP_ID =
  'HS_SD1_006_SELECT_HASUNOSORA_LIVE_FROM_WAITING_ROOM';

export function registerHsSd1006HimeWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsSd1HimeOnEnterActivateEnergyRecoverLive(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID,
    HS_SD1_006_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startHsSd1HimeOnEnterActivateEnergyRecoverLive(
  game: GameState,
  ability: {
    readonly id: string;
    readonly abilityId: string;
    readonly sourceCardId: string;
    readonly controllerId: string;
  },
  orderedResolution: boolean,
  continuePendingCardEffects: (game: GameState, orderedResolution: boolean) => GameState
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const relatedMemberSelector = or(
    cardNameAliasIs('大沢瑠璃乃'),
    cardNameAliasIs('百生吟子'),
    cardNameAliasIs('徒町小鈴')
  );
  const hasRelatedMember = hasStageMemberMatching(game, player.id, relatedMemberSelector, {
    excludeCardId: ability.sourceCardId,
  });

  if (!hasRelatedMember) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'CONDITION_NOT_MET',
      }),
      orderedResolution
    );
  }

  const relatedMemberCardIds = getStageMemberCardIdsMatching(
    game,
    player.id,
    relatedMemberSelector
  ).filter((cardId) => cardId !== ability.sourceCardId);

  const waitingEnergyCount = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  ).length;
  const activationCount = Math.min(1, waitingEnergyCount);
  const orientationChange = activateWaitingEnergyCardsForPlayer(game, player.id, activationCount);
  if (!orientationChange) {
    return game;
  }

  let state = addAction(orientationChange.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'ACTIVATE_ENERGY',
    relatedMemberCardIds,
    activatedEnergyCardIds: orientationChange.activatedEnergyCardIds,
    previousOrientations: orientationChange.previousOrientations,
    nextOrientation: orientationChange.nextOrientation,
  });
  state = {
    ...state,
    pendingAbilities: state.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  const selectableCardIds = selectWaitingRoomCardIds(
    state,
    player.id,
    and(typeIs(CardType.LIVE), groupAliasIs('蓮ノ空'))
  );

  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_WAITING_ROOM_LIVE_TARGET',
        relatedMemberCardIds,
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...state,
      activeEffect: createWaitingRoomToHandEffectState({
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getCardAbilityEffectText(HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID),
        stepId: HS_SD1_006_SELECT_WAITING_ROOM_LIVE_STEP_ID,
        stepText: '请选择自己的休息室中1张『莲之空』的LIVE卡加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        canSkipSelection: false,
        metadata: {
          orderedResolution,
          relatedMemberCardIds,
          activatedEnergyCardIds: orientationChange.activatedEnergyCardIds,
        },
        zoneSelection: createWaitingRoomToHandSelectionConfig({
          minCount: 1,
          maxCount: 1,
          optional: false,
        }),
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_WAITING_ROOM_LIVE',
      relatedMemberCardIds,
      selectableCardIds,
    }
  );
}

function getCardAbilityEffectText(abilityId: string): string {
  const effectText = CARD_ABILITY_DEFINITIONS.find(
    (ability) => ability.abilityId === abilityId
  )?.effectText;
  if (!effectText || effectText.trim().length === 0) {
    throw new Error(`Missing card ability effect text for abilityId: ${abilityId}`);
  }
  return effectText;
}
