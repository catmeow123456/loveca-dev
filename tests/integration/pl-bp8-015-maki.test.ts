import { describe, expect, it } from 'vitest';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_BP8_015_LIVE_SUCCESS_DRAW_ONE_DISCARD_ONE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { emitGameEvent, updatePlayer } from '../../src/domain/entities/game';
import { createLiveStartEvent, createLiveSuccessEvent } from '../../src/domain/events/game-events';
import { TriggerCondition, ZoneType } from '../../src/shared/types/enums';
import {
  createOctober31DraftCard,
  getOctober31DraftRow,
} from '../helpers/october-31-draft-effects';
import {
  P1,
  choose,
  gameWith,
  stage,
  start,
  syntheticMember,
} from '../helpers/edelnote-effect-fixture';

function setup() {
  const source = createOctober31DraftCard('PL!-bp8-015', P1, 'source');
  return updatePlayer(
    stage(
      gameWith([
        source,
        syntheticMember('hand'),
        syntheticMember('drawn'),
        syntheticMember('last'),
      ]),
      'source'
    ),
    P1,
    (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: ['hand'] },
      mainDeck: { ...p.mainDeck, cardIds: ['drawn', 'last'] },
    })
  );
}

describe('PL!-bp8-015 费用2「西木野真姬」authorized LIVE-success timing', () => {
  it('does not trigger at LIVE start and uses the Chinese authorized success timing and exact text', () => {
    expect(getCardAbilityDefinitionsForCardCode('PL!-bp8-015-N')[0].effectText).toBe(
      '【LIVE成功时】抽１张卡，将１张手牌放置入休息室。'
    );
    expect(getOctober31DraftRow('PL!-bp8-015').cardTextJp).toBe(
      '【ライブ開始時】カードを１枚引き、手札を１枚控え室に置く。'
    );
    let game = setup();
    const liveStart = createLiveStartEvent(P1, ['song']);
    game = emitGameEvent(game, liveStart);
    expect(
      enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_START], {
        liveStartEvents: [liveStart],
      }).pendingAbilities
    ).toEqual([]);
    const success = createLiveSuccessEvent(P1, ['song'], 1);
    game = emitGameEvent(game, success);
    game = resolvePendingCardEffects(
      enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_SUCCESS], {
        liveSuccessEvents: [success],
      })
    ).gameState;
    expect(game.activeEffect?.abilityId).toBe(ABILITY);
    expect(game.activeEffect?.effectText).toBe(getOctober31DraftRow('PL!-bp8-015').cardTextCn);
    expect(game.players[0].hand.cardIds).toEqual(['hand', 'drawn']);
    expect(choose(game)).toBe(game);
    expect(choose(game, 'last')).toBe(game);
    const done = choose(game, 'drawn');
    expect(done.players[0].hand.cardIds).toEqual(['hand']);
    expect(done.players[0].waitingRoom.cardIds).toEqual(['drawn']);
    expect(
      done.eventLog
        .filter(({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)
        .map(({ event }) => event)
    ).toEqual([expect.objectContaining({ fromZone: ZoneType.HAND, cardInstanceIds: ['drawn'] })]);
    expect(done.activeEffect).toBeNull();
  });

  it('rejects stale hand input and preserves the current discard choice', () => {
    let game = start(setup(), ABILITY);
    game = updatePlayer(game, P1, (p) => ({ ...p, hand: { ...p.hand, cardIds: ['drawn'] } }));
    expect(choose(game, 'hand')).toBe(game);
    expect(choose(game, 'drawn').activeEffect).toBeNull();
  });

  it('safely finishes an empty draw and hand without manufacturing a discard event', () => {
    const initial = updatePlayer(setup(), P1, (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: [] },
      mainDeck: { ...p.mainDeck, cardIds: [] },
    }));
    const game = start(initial, ABILITY);
    expect(game.activeEffect?.selectableCardIds).toEqual([]);
    const done = choose(game);
    expect(done.activeEffect).toBeNull();
    expect(
      done.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toEqual([]);
  });
});
