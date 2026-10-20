import { describe, expect, it } from 'vitest';
import { S_CL1_007_LIVE_START_DISCARD_CHEER_FROM_BOTTOM_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { revealCheerCardsFromMainDeck } from '../../src/application/effects/cheer';
import { clearPreviousStageMemberInstanceState } from '../../src/application/effects/member-state';
import { GameService } from '../../src/application/game-service';
import { updatePlayer } from '../../src/domain/entities/game';
import { getCheerDeckEdgeForPlayer } from '../../src/domain/rules/cheer-direction';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  FaceState,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { choose, gameWithCards, member, P1, P2, start } from '../helpers/card-effect-zone-fixture';

function setup(hasHand = true) {
  return updatePlayer(
    gameWithCards([
      member('hanamaru', { cardCode: 'PL!S-cl1-007-CL' }),
      member('hand'),
      member('top'),
      member('middle'),
      member('bottom'),
    ]),
    P1,
    (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'hanamaru', {
        face: FaceState.FACE_UP,
        orientation: OrientationState.ACTIVE,
      }),
      hand: { ...p.hand, cardIds: hasHand ? ['hand'] : [] },
      mainDeck: { ...p.mainDeck, cardIds: ['top', 'middle', 'bottom'] },
    })
  );
}
describe('PL!S-cl1-007 费用5「国木田花丸」', () => {
  it('discards once, queues the hand movement and changes only its controller cheer direction', () => {
    const begun = start(setup(), ABILITY, 'hanamaru');
    expect(choose(begun, 'bottom')).toBe(begun);
    const done = choose(begun, 'hand');
    expect(done.players[0].waitingRoom.cardIds).toEqual(['hand']);
    expect(
      done.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toHaveLength(1);
    expect(getCheerDeckEdgeForPlayer(done, P1)).toBe('BOTTOM');
    expect(getCheerDeckEdgeForPlayer(done, P2)).toBe('TOP');
    expect(
      done.actionHistory.filter(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === ABILITY
      )
    ).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          discardedCardIds: ['hand'],
          enterWaitingRoomEventId: expect.any(String),
        }),
      }),
    ]);
    expect(done.liveResolution.liveModifiers).toContainEqual({
      kind: 'CHEER_DIRECTION',
      playerId: P1,
      deckEdge: 'BOTTOM',
      sourceCardId: 'hanamaru',
      abilityId: ABILITY,
    });
    const normal = revealCheerCardsFromMainDeck(done, P1, 1);
    expect(normal.cheerCardIds).toEqual(['bottom']);
    const additional = revealCheerCardsFromMainDeck(normal.gameState, P1, 1, { additional: true });
    expect(additional.cheerCardIds).toEqual(['middle']);
    expect(additional.cheerEvent).toMatchObject({ additional: true, deckEdge: 'BOTTOM' });
  });
  it('declines or has no payment without recording a temporary effect', () => {
    const declined = choose(start(setup(), ABILITY, 'hanamaru'), null);
    expect(declined.players[0].hand.cardIds).toEqual(['hand']);
    expect(getCheerDeckEdgeForPlayer(declined, P1)).toBe('TOP');
    expect(declined.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    const empty = start(setup(false), ABILITY, 'hanamaru');
    expect(empty.activeEffect).toBeNull();
    expect(empty.liveResolution.liveModifiers).toEqual([]);
  });
  it('retains the paid effect without its source and clears it during actual LIVE finalization', () => {
    const done = choose(start(setup(), ABILITY, 'hanamaru'), 'hand');
    const sourceGone = updatePlayer(
      clearPreviousStageMemberInstanceState(done, P1, 'hanamaru'),
      P1,
      (p) => ({
        ...p,
        memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
      })
    );
    expect(getCheerDeckEdgeForPlayer(sourceGone, P1)).toBe('BOTTOM');
    const result = new GameService().finalizeLiveResult({
      ...sourceGone,
      currentSubPhase: SubPhase.RESULT_TURN_END,
    });
    expect(result.success).toBe(true);
    expect(getCheerDeckEdgeForPlayer(result.gameState, P1)).toBe('TOP');
    expect(result.gameState.liveResolution.liveModifiers).toEqual([]);
  });
  it('continues from the refreshed bottom and still applies to reroll replacement batches', () => {
    const done = choose(start(setup(), ABILITY, 'hanamaru'), 'hand');
    const short = updatePlayer(done, P1, (p) => ({
      ...p,
      mainDeck: { ...p.mainDeck, cardIds: ['bottom'] },
    }));
    const result = revealCheerCardsFromMainDeck(short, P1, 2, { replaceCurrentCheerCards: true });
    expect(result.cheerCardIds[0]).toBe('bottom');
    expect(result.cheerCardIds).toHaveLength(2);
    expect(result.cheerEvent.deckEdge).toBe('BOTTOM');
  });
});
