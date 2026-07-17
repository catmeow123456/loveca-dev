import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, emitGameEvent, registerCards } from '../../src/domain/entities/game';
import {
  createEnterWaitingRoomEvent,
  createTurnStartEvent,
} from '../../src/domain/events/game-events';
import { selectNoBladeHeartMemberCardIdsMovedFromLiveZoneToWaitingThisTurn } from '../../src/domain/rules/member-turn-state';
import { BladeHeartEffect, CardType, HeartColor, ZoneType } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function member(code: string, hasBladeHeart = false): MemberCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    bladeHearts: hasBladeHeart ? [{ effect: BladeHeartEffect.DRAW }] : [],
  };
}

function live(code: string): LiveCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function energy(code: string): EnergyCardData {
  return { cardCode: code, name: code, cardType: CardType.ENERGY };
}

describe('no-BLADE-HEART member LIVE-to-waiting turn query', () => {
  it('selects own qualifying MEMBER from a batch, supports legacy single ids, and de-duplicates stably', () => {
    const blocked = createCardInstance(member('BLOCKED', true), P1, 'blocked');
    const qualifying = createCardInstance(member('QUALIFYING'), P1, 'qualifying');
    let game = registerCards(createGameState('query-batch', P1, 'P1', P2, 'P2'), [
      blocked,
      qualifying,
    ]);
    game = emitGameEvent(
      game,
      createEnterWaitingRoomEvent(
        [blocked.instanceId, qualifying.instanceId],
        ZoneType.LIVE_ZONE,
        P1,
        P1
      )
    );
    const legacy = {
      ...createEnterWaitingRoomEvent([qualifying.instanceId], ZoneType.LIVE_ZONE, P1, P1),
      cardInstanceIds: undefined,
    };
    game = emitGameEvent(game, legacy);

    expect(selectNoBladeHeartMemberCardIdsMovedFromLiveZoneToWaitingThisTurn(game, P1)).toEqual([
      qualifying.instanceId,
    ]);
  });

  it('ignores prior-turn, opponent, wrong-source, LIVE, ENERGY, and any printed BLADE HEART', () => {
    const prior = createCardInstance(member('PRIOR'), P1, 'prior');
    const opponent = createCardInstance(member('OPPONENT'), P2, 'opponent');
    const wrongZone = createCardInstance(member('WRONG-ZONE'), P1, 'wrong-zone');
    const blocked = createCardInstance(member('BLOCKED', true), P1, 'blocked');
    const liveCard = createCardInstance(live('LIVE'), P1, 'live');
    const energyCard = createCardInstance(energy('ENERGY'), P1, 'energy');
    let game = registerCards(createGameState('query-negative', P1, 'P1', P2, 'P2'), [
      prior,
      opponent,
      wrongZone,
      blocked,
      liveCard,
      energyCard,
    ]);
    game = emitGameEvent(
      game,
      createEnterWaitingRoomEvent([prior.instanceId], ZoneType.LIVE_ZONE, P1, P1)
    );
    game = emitGameEvent(game, createTurnStartEvent(2, P1));
    game = emitGameEvent(
      game,
      createEnterWaitingRoomEvent([opponent.instanceId], ZoneType.LIVE_ZONE, P2, P2)
    );
    for (const fromZone of [
      ZoneType.HAND,
      ZoneType.MEMBER_SLOT,
      ZoneType.MAIN_DECK,
      ZoneType.SUCCESS_ZONE,
    ]) {
      game = emitGameEvent(
        game,
        createEnterWaitingRoomEvent([wrongZone.instanceId], fromZone, P1, P1)
      );
    }
    game = emitGameEvent(
      game,
      createEnterWaitingRoomEvent(
        [blocked.instanceId, liveCard.instanceId, energyCard.instanceId],
        ZoneType.LIVE_ZONE,
        P1,
        P1
      )
    );

    expect(selectNoBladeHeartMemberCardIdsMovedFromLiveZoneToWaitingThisTurn(game, P1)).toEqual([]);
  });

  it('keeps the event fact after the qualifying card leaves the waiting room', () => {
    const qualifying = createCardInstance(member('QUALIFYING'), P1, 'qualifying');
    let game = registerCards(createGameState('query-persistent', P1, 'P1', P2, 'P2'), [qualifying]);
    game = emitGameEvent(
      game,
      createEnterWaitingRoomEvent([qualifying.instanceId], ZoneType.LIVE_ZONE, P1, P1)
    );

    expect(selectNoBladeHeartMemberCardIdsMovedFromLiveZoneToWaitingThisTurn(game, P1)).toEqual([
      qualifying.instanceId,
    ]);
  });
});
