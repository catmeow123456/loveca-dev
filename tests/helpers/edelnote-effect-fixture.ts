import {
  createCardInstance,
  createHeartRequirement,
  type CardInstance,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { getStageMemberLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';

export const P1 = 'p1',
  P2 = 'p2';
export function syntheticMember(
  id: string,
  options: Partial<MemberCardData> = {},
  owner = P1
): CardInstance {
  return createCardInstance(
    {
      cardCode: `SYNTHETIC-${id}`,
      name: id,
      cardType: CardType.MEMBER,
      cost: 4,
      blade: 1,
      hearts: [],
      ...options,
    },
    owner,
    id
  );
}
export function syntheticLive(id: string, color = HeartColor.PURPLE): CardInstance {
  return createCardInstance(
    {
      cardCode: `SYNTHETIC-${id}`,
      name: id,
      cardType: CardType.LIVE,
      score: 2,
      requirements: createHeartRequirement({ [color]: 1 }),
    },
    P1,
    id
  );
}
export function gameWith(cards: readonly CardInstance[]): GameState {
  return {
    ...registerCards(createGameState('edelnote-test', P1, 'P1', P2, 'P2'), [...cards]),
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
  };
}
export function stage(
  game: GameState,
  id: string,
  slot = SlotPosition.CENTER,
  playerId = P1,
  orientation = OrientationState.ACTIVE
): GameState {
  return updatePlayer(game, playerId, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, slot, id, { orientation, face: FaceState.FACE_UP }),
  }));
}
export function pending(
  game: GameState,
  abilityId: string,
  sourceCardId = 'source'
): PendingAbilityState {
  return {
    id: `pending:${abilityId}`,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    sourceLifecycleId: getStageMemberLifecycleId(game, sourceCardId),
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [],
  };
}
export function start(game: GameState, abilityId: string, sourceCardId = 'source'): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [...game.pendingAbilities, pending(game, abilityId, sourceCardId)],
  }).gameState;
}
export function choose(
  game: GameState,
  cardId?: string | null,
  optionId?: string,
  ids?: readonly string[]
): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    cardId,
    undefined,
    undefined,
    optionId,
    ids
  );
}
