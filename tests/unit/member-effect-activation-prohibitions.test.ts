import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  addMemberEffectActivationProhibitionUntilTurnEnd,
  clearExpiredMemberEffectActivationProhibitions,
  isMemberEffectActivationProhibited,
} from '../../src/domain/rules/member-effect-activation-prohibitions';
import { setMemberOrientation, setMembersOrientation } from '../../src/application/effects/member-state';
import { CardType, FaceState, HeartColor, OrientationState, SlotPosition } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const cause = { kind: 'CARD_EFFECT' as const, playerId: P1, sourceCardId: 'nico', abilityId: '009', pendingAbilityId: 'pending' };

function member(code: string): MemberCardData {
  return { cardCode: code, name: code, cardType: CardType.MEMBER, cost: 1, blade: 1, hearts: [createHeartIcon(HeartColor.PINK, 1)] };
}

function setup() {
  const a = createCardInstance(member('A'), P1, 'a');
  const b = createCardInstance(member('B'), P1, 'b');
  let game = registerCards(createGameState('prohibition', P1, 'P1', P2, 'P2'), [a, b]);
  game = { ...game, turnCount: 3 };
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(placeCardInSlot(player.memberSlots, SlotPosition.LEFT, a.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }), SlotPosition.RIGHT, b.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }),
  }));
  return { game, a, b };
}

describe('member effect activation prohibitions', () => {
  it('adds a deduplicated current-turn marker affecting both players and ignores source leaving play', () => {
    let game = setup().game;
    const options = { affectedPlayerIds: [P1, P2], sourceCardId: 'nico', abilityId: '009' };
    game = addMemberEffectActivationProhibitionUntilTurnEnd(game, options);
    game = addMemberEffectActivationProhibitionUntilTurnEnd(game, options);
    expect(game.memberEffectActivationProhibitions).toHaveLength(1);
    expect(isMemberEffectActivationProhibited(game, P1)).toBe(true);
    expect(isMemberEffectActivationProhibited(game, P2)).toBe(true);
  });

  it('is exact-turn safe and clears expired markers', () => {
    const marked = addMemberEffectActivationProhibitionUntilTurnEnd(setup().game, { affectedPlayerIds: [P1, P2], sourceCardId: 'nico', abilityId: '009' });
    const nextTurn = { ...marked, turnCount: marked.turnCount + 1 };
    expect(isMemberEffectActivationProhibited(nextTurn, P1)).toBe(false);
    expect(clearExpiredMemberEffectActivationProhibitions(nextTurn).memberEffectActivationProhibitions).toEqual([]);
  });

  it('blocks CARD_EFFECT single and batch WAITING to ACTIVE with honest results and no events', () => {
    const scenario = setup();
    const game = addMemberEffectActivationProhibitionUntilTurnEnd(scenario.game, { affectedPlayerIds: [P1], sourceCardId: 'nico', abilityId: '009' });
    const single = setMemberOrientation(game, P1, scenario.a.instanceId, OrientationState.ACTIVE, cause)!;
    expect(single).toMatchObject({ changed: false, blockedByEffectActivationProhibition: true, previousOrientation: OrientationState.WAITING, nextOrientation: OrientationState.WAITING });
    expect(single.gameState.eventLog).toEqual(game.eventLog);
    const batch = setMembersOrientation(game, P1, [scenario.a.instanceId, scenario.b.instanceId], OrientationState.ACTIVE, cause)!;
    expect(batch.updatedMemberCardIds).toEqual([]);
    expect(batch.blockedMemberCardIds).toEqual([scenario.a.instanceId, scenario.b.instanceId]);
    expect(batch.gameState.eventLog).toEqual(game.eventLog);
  });

  it('allows RULE_ACTION and PLAYER_ACTION transitions', () => {
    const scenario = setup();
    const game = addMemberEffectActivationProhibitionUntilTurnEnd(scenario.game, { affectedPlayerIds: [P1], sourceCardId: 'nico', abilityId: '009' });
    const rule = setMemberOrientation(game, P1, scenario.a.instanceId, OrientationState.ACTIVE, { kind: 'RULE_ACTION', playerId: P1 })!;
    expect(rule.changed).toBe(true);
    const player = setMemberOrientation(game, P1, scenario.b.instanceId, OrientationState.ACTIVE, { kind: 'PLAYER_ACTION', playerId: P1 })!;
    expect(player.changed).toBe(true);
  });
});
