import { describe, expect, it } from 'vitest';
import { HS_BP8_003_ON_ENTER_BOTH_DISCARD_TO_SIX_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import { updatePlayer } from '../../src/domain/entities/game';
import { removeCardFromSlot } from '../../src/domain/entities/zone';
import { SlotPosition, TriggerCondition } from '../../src/shared/types/enums';
import {
  P1,
  P2,
  member,
  gameWith,
  stage,
  hand,
  start,
  sessionFor,
  confirm,
  setState,
} from '../helpers/modifier-workflow-fixtures';

function setup(ownCount: number, opponentCount: number, activeIndex = 0) {
  const source = member('PL!HS-bp8-003-P', 'source');
  const own = Array.from({ length: ownCount }, (_, i) => member(`OWN-${i}`, `own-${i}`));
  const opponent = Array.from({ length: opponentCount }, (_, i) =>
    member(`OTHER-${i}`, `other-${i}`, P2)
  );
  let game = stage(gameWith([source, ...own, ...opponent]), [source]);
  game = hand(hand(game, own), opponent, P2);
  game = { ...game, activePlayerIndex: activeIndex };
  return {
    source,
    own,
    opponent,
    session: sessionFor(start(game, source, ABILITY, TriggerCondition.ON_ENTER_STAGE)),
  };
}

describe('PL!HS-bp8-003 费用10「大泽瑠璃乃」', () => {
  it('collects both private selections before either hand moves or becomes public', () => {
    const { session, own, opponent } = setup(8, 7);
    expect(session.state!.activeEffect!.awaitingPlayerId).toBe(P1);
    expect(session.getPlayerViewState(P2)!.activeEffect?.selectableObjectIds).toBeUndefined();
    expect(
      confirm(
        session,
        P1,
        own.slice(0, 2).map((card) => card.instanceId)
      ).success
    ).toBe(true);
    expect(session.state!.players.map((p) => p.hand.cardIds.length)).toEqual([8, 7]);
    expect(
      session.state!.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toHaveLength(0);
    expect(session.state!.activeEffect!.awaitingPlayerId).toBe(P2);
    const waitingView = session.getPlayerViewState(P2)!;
    expect(waitingView.activeEffect?.selectableObjectIds).toHaveLength(7);
    expect(JSON.stringify(waitingView.activeEffect)).not.toContain('own-0');
    expect(session.getPlayerViewState(P1)!.activeEffect?.selectableObjectIds).toBeUndefined();
    expect(confirm(session, P2, [opponent[0]!.instanceId]).success).toBe(true);
    expect(session.state!.players.map((p) => p.hand.cardIds.length)).toEqual([6, 6]);
    expect(session.state!.players.map((p) => p.waitingRoom.cardIds)).toEqual([
      own.slice(0, 2).map((c) => c.instanceId),
      [opponent[0]!.instanceId],
    ]);
    const events = session.state!.eventLog.filter(
      (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
    );
    expect(events).toHaveLength(2);
    expect(session.state!.activeEffect).toBeNull();
  });
  it('lets the active opponent select first and rejects wrong-player, duplicate and stale choices', () => {
    const { session, opponent } = setup(8, 8, 1);
    expect(session.state!.activeEffect!.awaitingPlayerId).toBe(P2);
    expect(confirm(session, P1, ['other-0', 'other-1']).success).toBe(false);
    expect(confirm(session, P2, ['other-0', 'other-0']).success).toBe(false);
    const before = session.state!;
    setState(
      session,
      updatePlayer(before, P2, (player) => ({
        ...player,
        hand: {
          ...player.hand,
          cardIds: player.hand.cardIds.filter((id) => id !== opponent[0]!.instanceId),
        },
      }))
    );
    expect(confirm(session, P2, ['other-0', 'other-1']).success).toBe(false);
    expect(session.state!.players[0]!.hand.cardIds).toHaveLength(8);
  });
  it.each([
    [0, 6],
    [6, 6],
    [5, 0],
  ])('does not draw or open a choice for hands %i/%i', (a, b) => {
    const { session } = setup(a, b);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players.map((p) => p.hand.cardIds.length)).toEqual([a, b]);
  });
  it('does not require the source to remain on stage for the independent hand reduction', () => {
    const { session, own } = setup(7, 6);
    setState(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
      }))
    );
    expect(confirm(session, P1, [own[0]!.instanceId]).success).toBe(true);
    expect(session.state!.players[0]!.hand.cardIds).toHaveLength(6);
  });
  it.each([0, 6, 7, 8])('continuously recomputes BLADE from a hand of %i', (count) => {
    const { session, source } = setup(count, 6);
    expect(getMemberEffectiveBladeCount(session.state!, P1, source.instanceId)).toBe(
      1 + Math.max(0, 7 - count)
    );
    let game = updatePlayer(session.state!, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
    }));
    expect(getMemberEffectiveBladeCount(game, P1, source.instanceId)).toBe(8);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    expect(getMemberEffectiveBladeCount(game, P1, source.instanceId)).toBe(1);
  });
});
