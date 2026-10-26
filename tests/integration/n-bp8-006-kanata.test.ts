import { describe, expect, it } from 'vitest';
import { N_BP8_006_ON_ENTER_DISCARD_LOOK_TOP_FIVE_NIJIGASAKI_MEMBER_ABILITY_ID as KANATA } from '../../src/application/card-effects/ability-ids';
import { createCardInstance } from '../../src/domain/entities/card';
import { registerCards, updatePlayer } from '../../src/domain/entities/game';
import { TriggerCondition, ZoneType } from '../../src/shared/types/enums';
import { getOctober26CardData } from '../helpers/october-26-card-effects';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { P1, member, setup, enter, choose, roundtrip } from '../helpers/october-26-member-workflow';

describe('PL!N-bp8-006 费用5「近江彼方」discard-look family', () => {
  it('pays before inspection and reveals only one Nijigasaki member before moving it', () => {
    let initial = setup('PL!N-bp8-006-R');
    const foreign = member('foreign', 'Aqours');
    const liveCard = createCardInstance(getOctober26CardData('PL!N-bp8-031-SECL'), P1, 'niji-live');
    initial = registerCards(initial, [foreign, liveCard]);
    initial = updatePlayer(initial, P1, (p) => ({
      ...p,
      mainDeck: { ...p.mainDeck, cardIds: ['foreign', 'niji-live', ...p.mainDeck.cardIds] },
    }));
    let game = choose(enter(initial), 'hand-0');
    expect(game.activeEffect?.abilityId).toBe(KANATA);
    expect(game.activeEffect?.inspectionCardIds).toEqual([
      'foreign',
      'niji-live',
      'deck-0',
      'deck-1',
      'deck-2',
    ]);
    expect(game.inspectionZone.revealedCardIds).toEqual([]);
    expect(game.players[0].waitingRoom.cardIds).toEqual(['hand-0']);
    expect(
      game.actionHistory.find((a) => a.type === 'PAY_COST')?.payload.discardedHandCardIds
    ).toEqual(['hand-0']);
    expect(game.activeEffect?.selectableCardIds).toEqual(['deck-0', 'deck-1', 'deck-2']);
    expect(choose(game, 'foreign')).toBe(game);
    expect(choose(game, 'niji-live')).toBe(game);
    game = choose(game, 'deck-0');
    expect(game.inspectionZone.revealedCardIds).toEqual(['deck-0']);
    expect(game.players[0].hand.cardIds).toEqual(['hand-1']);
    game = confirmActiveEffectStepThroughPublicReveal(roundtrip(game), P1, game.activeEffect!.id);
    expect(game.players[0].hand.cardIds).toEqual(['hand-1', 'deck-0']);
    expect(game.players[0].waitingRoom.cardIds).toEqual([
      'hand-0',
      'foreign',
      'niji-live',
      'deck-1',
      'deck-2',
    ]);
    const event = game.eventLog.filter(
      ({ event }) =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        event.fromZone === ZoneType.MAIN_DECK
    );
    expect(event).toHaveLength(1);
    expect(event[0].event).toMatchObject({
      cardInstanceIds: ['foreign', 'niji-live', 'deck-1', 'deck-2'],
    });
    expect(game.activeEffect).toBeNull();
  });
  it.each([0, 2])('declines or has no hand (%s) without payment or inspection', (handCount) => {
    let game = enter(setup('PL!N-bp8-006-R', handCount));
    if (game.activeEffect) game = choose(game);
    expect(game.players[0].mainDeck.cardIds).toHaveLength(10);
    expect(game.actionHistory.filter((a) => a.type === 'PAY_COST')).toEqual([]);
    expect(game.inspectionZone.cardIds).toEqual([]);
    expect(game.activeEffect).toBeNull();
  });
  it.each([false, true])(
    'paid zero-selection or no-target (%s) sends one grouped remainder and continues',
    (noTarget) => {
      let game = setup('PL!N-bp8-006-R');
      if (noTarget) {
        const foreign = Array.from({ length: 6 }, (_, i) => member(`foreign-${i}`, 'Aqours'));
        game = registerCards(game, foreign);
        game = updatePlayer(game, P1, (p) => ({
          ...p,
          mainDeck: { ...p.mainDeck, cardIds: foreign.map((c) => c.instanceId) },
        }));
      }
      game = choose(enter(game), 'hand-0');
      expect(game.activeEffect?.inspectionCardIds).toHaveLength(5);
      expect(game.activeEffect?.skipSelectionLabel).toBe('全部放置入休息室');
      game = choose(game);
      expect(game.players[0].waitingRoom.cardIds).toHaveLength(6);
      expect(game.actionHistory.filter((a) => a.type === 'PAY_COST')).toHaveLength(1);
      expect(
        game.eventLog.filter(
          ({ event }) =>
            event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
            event.fromZone === ZoneType.MAIN_DECK
        )
      ).toHaveLength(1);
      expect(game.activeEffect).toBeNull();
    }
  );
  it('refreshes a short deck after paying and rejects a stale inspection target', () => {
    let initial = setup('PL!N-bp8-006-R');
    initial = updatePlayer(initial, P1, (p) => ({
      ...p,
      mainDeck: { ...p.mainDeck, cardIds: ['deck-0', 'deck-1'] },
    }));
    let game = choose(enter(initial), 'hand-0');
    expect(game.activeEffect?.inspectionCardIds).toContain('hand-0');
    const inspected = game.activeEffect!.inspectionCardIds!;
    expect(inspected).toHaveLength(3);
    const stale = {
      ...game,
      inspectionZone: {
        ...game.inspectionZone,
        cardIds: game.inspectionZone.cardIds.filter((id) => id !== 'deck-0'),
      },
    };
    expect(choose(stale, 'deck-0')).toBe(stale);
    game = choose(game);
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].waitingRoom.cardIds).toEqual(expect.arrayContaining(inspected));
  });
});
