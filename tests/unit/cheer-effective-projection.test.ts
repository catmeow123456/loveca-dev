import { PL_BP8_023_LIVE_START_LOW_COST_NO_BLADE_HEART_GAIN_ORANGE_ABILITY_ID as SNOW } from '../../src/application/card-effects/ability-ids';
import { hasSnowHalationIgnition } from '../../client/src/lib/snowHalation';
import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  type BladeHearts,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  addLiveModifier,
  getCheerCardEffectiveBladeHearts,
} from '../../src/domain/rules/live-modifiers';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  BladeHeartEffect as B,
  CardType,
  HeartColor as H,
  SlotPosition,
} from '../../src/shared/types/enums';

function member(id: string, owner = 'p1', bladeHearts?: BladeHearts) {
  const data: MemberCardData = {
    cardCode: `TEST-${id}`,
    name: id,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [{ color: H.ORANGE, count: 2 }],
    bladeHearts,
  };
  return createCardInstance(data, owner, id);
}
function setup(): GameState {
  const cards = [
    member('plain'),
    member('printed', 'p1', [{ effect: B.HEART, heartColor: H.RED }]),
    member('private'),
    member('hidden-resolution'),
    member('moved'),
    member('stage'),
    member('opponent', 'p2'),
  ];
  let game = registerCards(createGameState('effective-projection', 'p1', 'P1', 'p2', 'P2'), cards);
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['private', 'moved'] },
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'stage'),
  }));
  game = {
    ...game,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: ['plain', 'printed', 'hidden-resolution', 'opponent'],
      revealedCardIds: ['plain', 'printed', 'opponent'],
    },
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      firstPlayerCheerCardIds: ['plain', 'printed', 'hidden-resolution', 'moved'],
      secondPlayerCheerCardIds: ['opponent'],
    },
  };
  return addLiveModifier(game, {
    kind: 'CHEER_CARD_BLADE_HEART_GRANT',
    playerId: 'p1',
    maxMemberCost: 4,
    heartColor: H.ORANGE,
    abilityId: SNOW,
    sourceCardId: 'private',
  });
}
describe('effective publicly revealed cheer marker projection', () => {
  it('projects effective grants only for current revealed owner cards, identically to both players', () => {
    const game = setup();
    const expected = {
      obj_plain: [{ effect: B.HEART, heartColor: H.ORANGE }],
      obj_printed: [{ effect: B.HEART, heartColor: H.RED }],
      obj_opponent: [],
    };
    for (const playerId of ['p1', 'p2']) {
      const view = projectPlayerViewState(game, playerId);
      expect(view.match.liveResult?.effectiveCheerBladeHearts).toEqual(expected);
      expect(view.match.liveResult?.cheerBladeHeartGrantAbilityIds).toEqual({ obj_plain: SNOW });
      expect(
        hasSnowHalationIgnition(
          view.match.liveResult?.cheerBladeHeartGrantAbilityIds?.obj_plain,
          H.ORANGE
        )
      ).toBe(true);
      expect(view.objects.obj_stage.frontInfo?.hearts).toEqual([{ color: H.ORANGE, count: 2 }]);
      expect(view.objects.obj_plain.frontInfo?.bladeHearts).toBeUndefined();
    }
    expect(getCheerCardEffectiveBladeHearts(game, 'p1', 'plain')).toEqual(expected.obj_plain);
  });
  it('uses the same grant-then-replacement order as the rules query without replacing printed card information', () => {
    const game = addLiveModifier(setup(), {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: 'p1',
      fromColors: [H.ORANGE, H.RED],
      toColor: H.PURPLE,
    });
    const view = projectPlayerViewState(game, 'p2');
    expect(view.match.liveResult?.cheerBladeHeartGrantAbilityIds).toEqual({ obj_plain: SNOW });
    expect(hasSnowHalationIgnition(SNOW, H.PURPLE)).toBe(false);
    expect(view.match.liveResult?.effectiveCheerBladeHearts.obj_plain).toEqual([
      { effect: B.HEART, heartColor: H.PURPLE },
    ]);
    expect(view.match.liveResult?.effectiveCheerBladeHearts.obj_printed).toEqual(
      getCheerCardEffectiveBladeHearts(game, 'p1', 'printed')
    );
    expect(view.objects.obj_printed.frontInfo?.bladeHearts).toEqual([
      { effect: B.HEART, heartColor: H.RED },
    ]);
  });
  it('does not confuse native orange or another actual grant with Snow halation', () => {
    const printed = member('native', 'p1', [{ effect: B.HEART, heartColor: H.ORANGE }]);
    let game = registerCards(setup(), [printed]);
    game = {
      ...game,
      resolutionZone: {
        ...game.resolutionZone,
        cardIds: [...game.resolutionZone.cardIds, 'native'],
        revealedCardIds: [...game.resolutionZone.revealedCardIds, 'native'],
      },
      liveResolution: {
        ...game.liveResolution,
        firstPlayerCheerCardIds: [...game.liveResolution.firstPlayerCheerCardIds, 'native'],
      },
    };
    game = addLiveModifier(game, {
      kind: 'CHEER_CARD_BLADE_HEART_GRANT',
      playerId: 'p1',
      maxMemberCost: 4,
      heartColor: H.ORANGE,
      abilityId: 'different-grant',
    });
    const view = projectPlayerViewState(game, 'p2');
    expect(view.match.liveResult?.effectiveCheerBladeHearts.obj_native).toEqual([
      { effect: B.HEART, heartColor: H.ORANGE },
    ]);
    expect(view.match.liveResult?.cheerBladeHeartGrantAbilityIds).toEqual({
      obj_plain: 'different-grant',
    });
    expect(hasSnowHalationIgnition(undefined, H.ORANGE)).toBe(false);
    expect(hasSnowHalationIgnition('different-grant', H.ORANGE)).toBe(false);
  });
});
