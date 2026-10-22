import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForSourceMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { HS_BP8_012_ON_ENTER_SHUFFLE_WAITING_MEMBERS_BOTTOM_CERISE_GAIN_HEART_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { shuffleWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';

export function registerHsBp8012GinkoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    resolve(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
}

function resolve(
  game: GameState,
  ability: PendingAbilityState,
  ordered: boolean,
  next: (game: GameState, ordered: boolean) => GameState
): GameState {
  const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, ability);
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const memberIds = player.waitingRoom.cardIds.filter((id) => {
    const card = getCardById(game, id);
    return card !== null && card.ownerId === player.id && typeIs(CardType.MEMBER)(card);
  });
  const moved = shuffleWaitingRoomCardsToDeckBottomAndEnqueueTriggers(game, player.id, memberIds, {
    kind: 'CARD_EFFECT',
    playerId: player.id,
    sourceCardId: ability.sourceCardId,
    abilityId: ABILITY_ID,
    pendingAbilityId: ability.id,
  });
  if (!moved) return game;
  const ceriseCount = moved.movedCardIds.filter((id) => {
    const card = getCardById(moved.gameState, id);
    return card !== null && unitAliasIs('スリーズブーケ')(card);
  }).length;
  const reward =
    ceriseCount >= 3 &&
    isCurrentStageMemberAbilitySource(moved.gameState, { ...ability, sourceLifecycleId })
      ? addHeartLiveModifierForSourceMember(moved.gameState, {
          playerId: player.id,
          sourceCardId: ability.sourceCardId,
          abilityId: ABILITY_ID,
          hearts: [{ color: HeartColor.GREEN, count: 2 }],
        })
      : null;
  const state = reward?.gameState ?? moved.gameState;
  return next(
    addAction(
      {
        ...state,
        pendingAbilities: state.pendingAbilities.filter((item) => item.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: ability.id,
        abilityId: ABILITY_ID,
        sourceCardId: ability.sourceCardId,
        step: 'SHUFFLE_WAITING_MEMBERS_BOTTOM_GAIN_HEART',
        movedCardIds: moved.movedCardIds,
        ceriseCount,
        greenHeartBonus: reward ? 2 : 0,
      }
    ),
    ordered
  );
}
