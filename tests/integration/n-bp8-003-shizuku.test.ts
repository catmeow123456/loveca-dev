import { describe, expect, it } from 'vitest';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import {
  N_BP8_003_LIVE_SUCCESS_LOOK_TOP_FIVE_NO_BLADE_HEART_NIJIGASAKI_MEMBER_ABILITY_ID as ABILITY,
  N_PR_026_LIVE_SUCCESS_DELEGATE_MEMBER_BELOW_LIVE_SUCCESS_ABILITIES_ABILITY_ID as RINA,
} from '../../src/application/card-effects/ability-ids';
import { createCardInstance } from '../../src/domain/entities/card';
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createLiveSuccessEvent } from '../../src/domain/events/game-events';
import { addMemberBelowMember, removeMemberBelowMember } from '../../src/domain/entities/zone';
import {
  CardType,
  BladeHeartEffect,
  HeartColor,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import { createOctober31DraftCard } from '../helpers/october-31-draft-effects';
import {
  P1,
  P2,
  choose,
  gameWith,
  stage,
  start,
  syntheticMember,
  syntheticLive,
} from '../helpers/edelnote-effect-fixture';

function setup() {
  const source = createOctober31DraftCard('PL!N-bp8-003', P1, 'source');
  const cards = [
    syntheticMember('valid', { groupNames: ['虹ヶ咲'] }),
    syntheticMember('heart', {
      groupNames: ['虹咲'],
      bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RED }],
    }),
    syntheticMember('draw', {
      groupNames: ['虹咲'],
      bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
    }),
    syntheticMember('other', { groupNames: ['Liella!'] }),
    syntheticLive('live'),
  ];
  return updatePlayer(stage(gameWith([source, ...cards]), 'source'), P1, (p) => ({
    ...p,
    mainDeck: { ...p.mainDeck, cardIds: cards.map((c) => c.instanceId) },
  }));
}
function success(game: GameState) {
  const event = createLiveSuccessEvent(P1, ['song'], 1);
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(emitGameEvent(game, event), [TriggerCondition.ON_LIVE_SUCCESS], {
      liveSuccessEvents: [event],
    })
  ).gameState;
}
function finishSelection(game: GameState, card?: string) {
  const revealed = choose(game, card);
  return revealed.activeEffect?.stepId === 'COMMON_PUBLIC_REVEAL_DWELL'
    ? confirmActiveEffectStep(revealed, P1, revealed.activeEffect.id)
    : revealed;
}

describe('PL!N-bp8-003 费用7「樱坂雫」private top-five family', () => {
  it('triggers from the real LIVE-success event, privately filters cards, then reveals only the selected member', () => {
    let game = success(setup());
    expect(game.activeEffect?.abilityId).toBe(ABILITY);
    expect(game.activeEffect?.selectableCardIds).toEqual(['valid']);
    for (const id of ['valid', 'heart', 'draw', 'other', 'live']) {
      expect(projectPlayerViewState(game, P1).objects[createPublicObjectId(id)].surface).toBe(
        'FRONT'
      );
      expect(projectPlayerViewState(game, P2).objects[createPublicObjectId(id)].surface).toBe(
        'BACK'
      );
    }
    expect(choose(game, 'draw')).toBe(game);
    expect(choose(game, 'other')).toBe(game);
    expect(choose(game, 'valid', undefined, ['valid', 'heart'])).toBe(game);
    game = choose(game, 'valid');
    expect(game.inspectionZone.revealedCardIds).toEqual(['valid']);
    expect(game.players[0].hand.cardIds).toEqual([]);
    expect(projectPlayerViewState(game, P2).objects[createPublicObjectId('valid')].surface).toBe(
      'FRONT'
    );
    expect(projectPlayerViewState(game, P2).objects[createPublicObjectId('heart')].surface).toBe(
      'BACK'
    );
    game = confirmActiveEffectStep(game, P1, game.activeEffect!.id);
    expect(game.players[0].hand.cardIds).toEqual(['valid']);
    expect(game.players[0].waitingRoom.cardIds).toEqual(['heart', 'draw', 'other', 'live']);
    expect(
      game.eventLog
        .filter(({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)
        .map(({ event }) => event)
    ).toEqual([
      expect.objectContaining({
        fromZone: ZoneType.MAIN_DECK,
        cardInstanceIds: ['heart', 'draw', 'other', 'live'],
      }),
    ]);
  });

  it.each(['decline', 'no-target', 'short', 'empty'] as const)(
    'keeps inspection available before %s completion',
    (mode) => {
      let initial = setup();
      const ids =
        mode === 'decline'
          ? ['valid', 'heart', 'draw', 'other', 'live']
          : mode === 'no-target'
            ? ['heart', 'draw']
            : mode === 'short'
              ? ['valid']
              : [];
      initial = updatePlayer(initial, P1, (p) => ({
        ...p,
        mainDeck: { ...p.mainDeck, cardIds: ids },
      }));
      const game = start(initial, ABILITY);
      expect(game.activeEffect?.inspectionCardIds).toEqual(ids);
      const done = choose(game);
      expect(done.players[0].waitingRoom.cardIds).toEqual(ids);
      expect(done.inspectionZone.cardIds).toEqual([]);
      expect(done.activeEffect).toBeNull();
    }
  );

  it('rejects stale selections and rechecks the card condition after public dwell', () => {
    let game = start(setup(), ABILITY);
    const stale = {
      ...game,
      inspectionZone: {
        ...game.inspectionZone,
        cardIds: game.inspectionZone.cardIds.filter((id) => id !== 'valid'),
      },
    };
    expect(choose(stale, 'valid')).toBe(stale);
    game = choose(game, 'valid');
    const card = game.cardRegistry.get('valid')!;
    game = registerCards(game, [{ ...card, data: { ...card.data, groupNames: ['Liella!'] } }]);
    const done = confirmActiveEffectStep(game, P1, game.activeEffect!.id);
    expect(done.players[0].hand.cardIds).toEqual([]);
  });

  it.each([1, 2])(
    'delegates %s real copies under N-PR026, keeps the host as source and completes each inspection',
    (copies) => {
      const host = syntheticMember('host', {
        cardCode: 'PL!N-PR-026-PR',
        cost: 15,
        groupNames: ['虹ヶ咲'],
      });
      const below = Array.from({ length: copies }, (_, i) =>
        createOctober31DraftCard('PL!N-bp8-003', P1, `below-${i}`)
      );
      const top = Array.from({ length: 12 }, (_, i) =>
        syntheticMember(`top-${i}`, { groupNames: ['虹ヶ咲'] })
      );
      let initial = stage(gameWith([host, ...below, ...top]), 'host');
      initial = updatePlayer(initial, P1, (p) => ({
        ...p,
        memberSlots: below.reduce(
          (slots, c) => addMemberBelowMember(slots, SlotPosition.CENTER, c.instanceId),
          p.memberSlots
        ),
        mainDeck: { ...p.mainDeck, cardIds: top.map((c) => c.instanceId) },
      }));
      let game = success(initial);
      expect(game.activeEffect?.abilityId).toBe(RINA);
      game = choose(game);
      // Resolve each generated invocation; pending selection itself can require choosing its id.
      let completed = 0;
      for (let guard = 0; guard < 15 && completed < copies; guard++) {
        if (!game.activeEffect && game.pendingAbilities.length)
          game = resolvePendingCardEffects(game).gameState;
        if (game.activeEffect?.abilityId === ABILITY) {
          expect(game.activeEffect.sourceCardId).toBe('host');
          game = updatePlayer(game, P1, (p) => ({
            ...p,
            memberSlots: below.reduce(
              (slots, c) => removeMemberBelowMember(slots, SlotPosition.CENTER, c.instanceId),
              p.memberSlots
            ),
          }));
          game = finishSelection(game, game.activeEffect.selectableCardIds![0]);
          completed++;
        } else if (game.activeEffect)
          game = choose(
            game,
            game.activeEffect.selectableCardIds?.[0],
            game.activeEffect.selectableOptions?.[0]?.id
          );
        else if (game.pendingChoice) break;
      }
      expect(completed).toBe(copies);
      expect(game.players[0].hand.cardIds).toHaveLength(copies);
      expect(
        game.eventLog.filter(
          ({ event }) =>
            event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
            event.fromZone === ZoneType.MAIN_DECK
        )
      ).toHaveLength(copies);
    }
  );

  it('does not delegate an already removed below copy', () => {
    const host = syntheticMember('host', {
      cardCode: 'PL!N-PR-026-PR',
      cost: 15,
      groupNames: ['虹ヶ咲'],
    });
    const below = createOctober31DraftCard('PL!N-bp8-003', P1, 'below');
    let initial = stage(gameWith([host, below]), 'host');
    initial = updatePlayer(initial, P1, (p) => ({
      ...p,
      memberSlots: addMemberBelowMember(p.memberSlots, SlotPosition.CENTER, below.instanceId),
    }));
    let game = success(initial);
    expect(game.activeEffect?.abilityId).toBe(RINA);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: removeMemberBelowMember(p.memberSlots, SlotPosition.CENTER, below.instanceId),
      waitingRoom: { ...p.waitingRoom, cardIds: [below.instanceId] },
    }));
    game = choose(game);
    expect(game.actionHistory.some((a) => a.payload.delegatedAbilityIds?.includes(ABILITY))).toBe(
      false
    );
    expect(game.activeEffect).toBeNull();
    expect(game.pendingAbilities.some((p) => p.abilityId === ABILITY)).toBe(false);
  });
});
