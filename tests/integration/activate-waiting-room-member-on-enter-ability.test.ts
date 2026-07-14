import { describe, expect, it } from 'vitest';
import { createCardInstance, createHeartIcon, type MemberCardData } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type PendingAbilityState } from '../../src/domain/entities/game';
import { addCardToZone } from '../../src/domain/entities/zone';
import { CardType, HeartColor, ZoneType } from '../../src/shared/types/enums';
import { delegateWaitingRoomMemberOnEnterAbility, getWaitingRoomOnEnterTarget } from '../../src/application/card-effects/workflows/shared/activate-waiting-room-member-on-enter-ability';
import { countMemberEntriesThisTurn } from '../../src/domain/rules/member-turn-state';

const member: MemberCardData = { cardCode: 'PL!N-bp3-012-R', name: '鐘 嵐珠', groupNames: ['虹ヶ咲学園スクールアイドル同好会'], unitName: 'R3BIRTH', cardType: CardType.MEMBER, cost: 4, blade: 1, hearts: [createHeartIcon(HeartColor.PURPLE, 1)] };

describe('activate waiting-room member ON_ENTER ability', () => {
  it('keeps the member in waiting room and delegates with no source slot or enter-stage event', () => {
    const target = createCardInstance(member, 'p1', 'target');
    let game = registerCards(createGameState('delegation', 'p1', 'P1', 'p2', 'P2'), [target]);
    game = updatePlayer(game, 'p1', (p) => ({ ...p, waitingRoom: addCardToZone(p.waitingRoom, target.instanceId) }));
    let delegated: PendingAbilityState | null = null;
    const result = delegateWaitingRoomMemberOnEnterAbility(game, { controllerId: 'p1', parentAbilityId: 'parent', parentSourceCardId: 'host', parentEffectId: 'effect', targetCardId: target.instanceId, delegatedAbilityId: 'PL!N-bp3-012:on-enter-discard-look-top-nijigasaki-card', orderedResolution: false }, (state, ability) => { delegated = ability; return state; });
    expect(getWaitingRoomOnEnterTarget(result, 'p1', target.instanceId)).not.toBeNull();
    expect(delegated?.sourceCardId).toBe(target.instanceId);
    expect(delegated?.sourceSlot).toBeUndefined();
    expect(delegated?.metadata).toMatchObject({ delegatedOnEnterFromWaitingRoom: true, originalSourceZone: ZoneType.WAITING_ROOM, delegatedBySourceCardId: 'host' });
    expect(result.eventLog).toEqual([]);
    expect(result.players[0].movedToStageThisTurn).not.toContain(target.instanceId);
    expect(countMemberEntriesThisTurn(result, 'p1')).toBe(0);
  });
});
