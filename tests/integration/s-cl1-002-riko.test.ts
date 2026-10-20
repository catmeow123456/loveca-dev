import { describe, expect, it } from 'vitest';
import { S_CL1_002_LIVE_SUCCESS_BOTTOM_UP_TO_THREE_AQOURS_CHEER_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { updatePlayer } from '../../src/domain/entities/game';
import { TriggerCondition } from '../../src/shared/types/enums';
import {
  choose,
  chooseMany,
  gameWithCards,
  live,
  member,
  P1,
  P2,
  start,
} from '../helpers/card-effect-zone-fixture';

function setup() {
  const cards = [
    member('riko', { cardCode: 'PL!S-cl1-002-CL', groupNames: ['Aqours'] }),
    member('a', { groupNames: ['Aqours'] }),
    live('b', { groupNames: ['Aqours'] }),
    member('c', { groupNames: ['Aqours'] }),
    live('d', { groupNames: ['Aqours'] }),
    member('other'),
    member('opponent', { groupNames: ['Aqours'] }, P2),
    live('stale', { groupNames: ['Aqours'] }),
    live('old'),
  ];
  let game = updatePlayer(gameWithCards(cards), P1, (p) => ({
    ...p,
    mainDeck: { ...p.mainDeck, cardIds: ['old'] },
  }));
  game = {
    ...game,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: ['a', 'b', 'c', 'd', 'other', 'opponent'],
      revealedCardIds: ['a', 'b', 'c', 'd', 'other', 'opponent'],
    },
    liveResolution: {
      ...game.liveResolution,
      firstPlayerCheerCardIds: ['a', 'b', 'c', 'd', 'other', 'opponent', 'stale'],
    },
  };
  return start(game, ABILITY, 'riko', TriggerCondition.ON_LIVE_SUCCESS);
}
describe('PL!S-cl1-002 费用9「樱内梨子」', () => {
  it.each([0, 1, 2, 3])(
    'moves up to three Aqours cards of any type in chosen order (%i)',
    (count) => {
      const game = setup();
      expect(game.activeEffect).toMatchObject({
        selectableCardIds: ['a', 'b', 'c', 'd'],
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: 3,
        confirmSelectionLabel: '按此顺序放置于卡组底',
        skipSelectionLabel: '不放置',
      });
      const ids = ['c', 'b', 'a'].slice(0, count);
      let done = chooseMany(game, ids);
      if (count) {
        expect(done.activeEffect).toMatchObject({
          revealedCardIds: ids,
          publicCardSelectionOrdered: true,
        });
        expect(done.players[0].mainDeck.cardIds).toEqual(['old']);
        done = choose(done);
      }
      expect(done.players[0].mainDeck.cardIds).toEqual(['old', ...ids]);
      expect(ids.every((id) => !done.resolutionZone.cardIds.includes(id))).toBe(true);
      expect(done.activeEffect).toBeNull();
      expect(done.pendingAbilities).toEqual([]);
    }
  );
  it('rejects duplicates, four cards, non-Aqours, opponent and historical-only targets', () => {
    const game = setup();
    for (const ids of [['a', 'a'], ['a', 'b', 'c', 'd'], ['other'], ['opponent'], ['stale']])
      expect(chooseMany(game, ids)).toBe(game);
  });
  it('moves none if a displayed card loses revealed status', () => {
    const reveal = chooseMany(setup(), ['c', 'b', 'a']);
    const stale = {
      ...reveal,
      resolutionZone: {
        ...reveal.resolutionZone,
        revealedCardIds: ['a', 'c', 'd', 'other', 'opponent'],
      },
    };
    const done = choose(stale);
    expect(done.players[0].mainDeck.cardIds).toEqual(['old']);
    expect(done.resolutionZone.cardIds).toContain('a');
    expect(done.resolutionZone.cardIds).toContain('c');
  });
});
