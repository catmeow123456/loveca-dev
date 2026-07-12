import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  enqueueTriggeredCardEffects,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { PL_PB1_004_ON_ENTER_CENTER_SUCCESS_MUSE_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 15,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    groupNames: ["μ's"],
  };
}

function live(cardCode: string, groupName = "μ's", score: number | undefined = 1): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: score as number,
    requiredHearts: [],
    groupNames: [groupName],
  };
}

function setup(ownSuccessCards: Array<LiveCardData | MemberCardData>, opponentHasMuseLive = false) {
  const source = createCardInstance(member('PL!-pb1-004-R'), P1, 'umi');
  const continuationSource = createCardInstance(member('PL!HS-bp5-011'), P1, 'continuation');
  const draw = createCardInstance(member('draw'), P1, 'draw');
  const own = ownSuccessCards.map((data, index) => createCardInstance(data, P1, `own-${index}`));
  const opponent = opponentHasMuseLive
    ? [createCardInstance(live('opponent-muse'), P2, 'opponent-muse')]
    : [];
  let game = registerCards(createGameState('004', P1, 'P1', P2, 'P2'), [
    source,
    continuationSource,
    draw,
    ...own,
    ...opponent,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    successZone: own.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.successZone
    ),
    mainDeck: addCardToZone(player.mainDeck, draw.instanceId),
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.RIGHT,
      continuationSource.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
  }));
  if (opponent[0]) {
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, opponent[0].instanceId),
    }));
  }
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores: new Map([[P1, 4]]),
    },
    pendingAbilities: [
      {
        id: 'umi-pending',
        abilityId: PL_PB1_004_ON_ENTER_CENTER_SUCCESS_MUSE_SCORE_ABILITY_ID,
        sourceCardId: source.instanceId,
        sourceSlot: SlotPosition.CENTER,
        controllerId: P1,
        mandatory: true,
        timingId: TriggerCondition.ON_ENTER_STAGE,
      } satisfies PendingAbilityState,
    ],
  };
  return { game, source, draw };
}

function resolve(game: ReturnType<typeof setup>['game']) {
  const selection = resolvePendingCardEffects(game).gameState;
  return selection.activeEffect?.abilityId === 'system:select-pending-card-effect'
    ? confirmActiveEffectStep(selection, P1, selection.activeEffect.id, 'umi', undefined, true)
    : selection;
}

describe('PL!-pb1-004 園田海未', () => {
  it.each([
    { cards: [], bonus: 0 },
    { cards: [live('muse-1')], bonus: 1 },
    { cards: [live('muse-1'), live('muse-2')], bonus: 2 },
    { cards: [live('muse-1'), live('muse-2'), live('muse-3')], bonus: 2 },
  ])('uses the 0/1/2+ score tier: $bonus', ({ cards, bonus }) => {
    const state = resolve(setup(cards).game);
    expect(state.liveResolution.playerScores.get(P1)).toBe(4 + bonus);
    expect(
      state.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId === PL_PB1_004_ON_ENTER_CENTER_SUCCESS_MUSE_SCORE_ABILITY_ID
      )
    ).toHaveLength(bonus > 0 ? 1 : 0);
    expect(state.pendingAbilities).toEqual([]);
  });

  it('ignores opponent success zone, non-muse LIVE, non-LIVE and malformed no-score data', () => {
    const malformed = live('no-score');
    delete (malformed as Partial<LiveCardData>).score;
    const state = resolve(
      setup([live('aqours', 'Aqours'), member('injected-member'), malformed], true).game
    );
    expect(state.liveResolution.playerScores.get(P1)).toBe(4);
  });

  it('keeps the resolved this-LIVE modifier after the source member leaves stage', () => {
    const setupState = setup([live('muse')]);
    const resolved = resolve(setupState.game);
    const afterLeave = updatePlayer(resolved, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    expect(afterLeave.liveResolution.playerScores.get(P1)).toBe(5);
    expect(
      afterLeave.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId === PL_PB1_004_ON_ENTER_CENTER_SUCCESS_MUSE_SCORE_ABILITY_ID
      )
    ).toBe(true);
  });

  it.each([SlotPosition.LEFT, SlotPosition.RIGHT])(
    'does not enqueue when the member enters %s instead of CENTER',
    (sourceSlot) => {
      const setupState = setup([live('muse')]);
      const withoutPending = { ...setupState.game, pendingAbilities: [] };
      const event = createEnterStageEvent(
        setupState.source.instanceId,
        ZoneType.HAND,
        sourceSlot,
        P1,
        P1
      );
      const queued = enqueueTriggeredCardEffects(
        emitGameEvent(withoutPending, event),
        [TriggerCondition.ON_ENTER_STAGE],
        { enterStageEvents: [event] }
      );
      expect(
        queued.pendingAbilities.some(
          (ability) =>
            ability.abilityId === PL_PB1_004_ON_ENTER_CENTER_SUCCESS_MUSE_SCORE_ABILITY_ID
        )
      ).toBe(false);
    }
  );
});
