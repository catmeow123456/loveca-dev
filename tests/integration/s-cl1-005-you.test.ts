import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createLiveStartEvent } from '../../src/domain/events/game-events';
import { emitGameEvent } from '../../src/domain/entities/game';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_CL1_005_LIVE_START_LOOK_TOP_ONE_OPTIONAL_BOTTOM_ABILITY_ID as ABILITY,
  S_BP7_003_ON_ENTER_LOOK_TOP_ONE_OPTIONAL_BOTTOM_ABILITY_ID as OLD_ENTER,
  S_BP7_003_LIVE_START_LOOK_TOP_ONE_OPTIONAL_BOTTOM_ABILITY_ID as OLD_LIVE,
} from '../../src/application/card-effects/ability-ids';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { continuePublicEffectChoiceForTest } from '../helpers/public-effect-choice';

const P1 = 'p1';
const P2 = 'p2';
const SOURCE = 'you';
const TOP = 'top';
const SECOND = 'second';
const WAITING = 'waiting';

function member(cardCode: string, id: string, cost = 1) {
  const data: MemberCardData = {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
  return createCardInstance(data, P1, id);
}

function pending(abilityId = ABILITY, id = 'look'): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId: SOURCE,
    controllerId: P1,
    mandatory: true,
    timingId:
      abilityId === OLD_ENTER ? TriggerCondition.ON_ENTER_STAGE : TriggerCondition.ON_LIVE_START,
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(
  options: {
    rarity?: string;
    mainDeck?: readonly string[];
    waitingRoom?: readonly string[];
    abilityId?: string;
  } = {}
): GameState {
  const sourceCode =
    options.abilityId && options.abilityId !== ABILITY
      ? 'PL!S-bp7-003-SEC'
      : `PL!S-cl1-005-${options.rarity ?? 'CL'}`;
  let game = registerCards(createGameState('cl1-you', P1, 'P1', P2, 'P2'), [
    member(sourceCode, SOURCE, 11),
    member('top-card', TOP),
    member('second-card', SECOND),
    member('refresh-card', WAITING),
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [...(options.mainDeck ?? [TOP, SECOND])] },
    waitingRoom: { ...player.waitingRoom, cardIds: [...(options.waitingRoom ?? [])] },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, SOURCE, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return { ...game, pendingAbilities: [pending(options.abilityId)] };
}

function start(game: GameState) {
  return resolvePendingCardEffects(game).gameState;
}

function choose(game: GameState, option: string, playerId = P1) {
  return continuePublicEffectChoiceForTest(
    confirmActiveEffectStep(
      game,
      playerId,
      game.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      option
    ),
    playerId
  );
}

describe('PL!S-cl1-005 费用11「渡边曜」 private top-one optional bottom', () => {
  it.each(['CL', 'SEC'])('queues its independent LIVE_START ability for rarity %s', (rarity) => {
    const initial = { ...setup({ rarity }), pendingAbilities: [] };
    const event = createLiveStartEvent(P1, []);
    const game = enqueueTriggeredCardEffects(emitGameEvent(initial, event), [
      TriggerCondition.ON_LIVE_START,
    ]);
    expect(game.pendingAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilityId: ABILITY,
          sourceCardId: SOURCE,
          sourceSlot: SlotPosition.CENTER,
        }),
      ])
    );
    expect(start(game).activeEffect?.stepId).toBe('S_CL1_005_LOOK_TOP_ONE_OPTIONAL_BOTTOM');
  });

  it.each(['keep-top', 'place-bottom'])(
    'privately inspects before resolving %s with no card reveal or waiting event',
    (option) => {
      const waiting = start(setup());
      expect(waiting.activeEffect).toMatchObject({
        abilityId: ABILITY,
        effectText: '【LIVE开始时】检视自己的卡组顶的卡片，可以将其放置于卡组底。',
        inspectionCardIds: [TOP],
        effectChoice: {
          mode: 'SINGLE',
          options: [
            { id: 'keep-top', text: '将检视的卡保留在卡组顶。' },
            { id: 'place-bottom', text: '将检视的卡放置于卡组底。' },
          ],
          minSelections: 1,
          maxSelections: 1,
        },
        canSkipSelection: false,
      });
      expect(waiting.activeEffect?.selectableCardIds).toBeUndefined();
      expect(waiting.inspectionZone.revealedCardIds).toEqual([]);
      const own = projectPlayerViewState(waiting, P1);
      const other = projectPlayerViewState(waiting, P2);
      expect(own.activeEffect?.inspectionObjectIds).toHaveLength(1);
      expect(other.activeEffect?.inspectionObjectIds).toBeUndefined();
      const object = other.table.zones.FIRST_INSPECTION_ZONE.objectIds?.[0];
      expect(object && other.objects[object]?.surface).toBe('BACK');
      expect(object && other.objects[object]?.frontInfo).toBeUndefined();

      const done = choose(waiting, option);
      expect(done.players[0].mainDeck.cardIds).toEqual(
        option === 'keep-top' ? [TOP, SECOND] : [SECOND, TOP]
      );
      expect(done.inspectionZone.cardIds).toEqual([]);
      expect(done.inspectionZone.revealedCardIds).toEqual([]);
      expect(done.players[0].waitingRoom.cardIds).toEqual([]);
      expect(done.activeEffect).toBeNull();
      expect(done.eventLog).toEqual([]);
      expect(done.actionHistory.at(-1)?.payload.step).toBe(
        option === 'keep-top'
          ? 'KEEP_INSPECTED_CARD_AT_DECK_TOP'
          : 'PLACE_INSPECTED_CARD_AT_DECK_BOTTOM'
      );
    }
  );

  it('refreshes an empty deck and places the last inspected card around the refreshed remaining deck', () => {
    const refreshed = start(setup({ mainDeck: [], waitingRoom: [TOP, WAITING] }));
    expect(refreshed.activeEffect?.inspectionCardIds).toHaveLength(1);
    expect(refreshed.players[0].waitingRoom.cardIds).toEqual([]);
    for (const option of ['keep-top', 'place-bottom']) {
      const waiting = start(setup({ mainDeck: [TOP], waitingRoom: [WAITING, SECOND] }));
      expect(waiting.players[0].mainDeck.cardIds).toHaveLength(2);
      const done = choose(waiting, option);
      expect(new Set(done.players[0].mainDeck.cardIds)).toEqual(new Set([TOP, SECOND, WAITING]));
      expect(
        option === 'keep-top'
          ? done.players[0].mainDeck.cardIds[0]
          : done.players[0].mainDeck.cardIds.at(-1)
      ).toBe(TOP);
      expect(
        done.eventLog.some(
          ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
        )
      ).toBe(false);
    }
  });

  it('confirms an empty LIVE_START effect before completing without an empty inspection window', () => {
    const waiting = start(setup({ mainDeck: [], waitingRoom: [] }));
    expect(waiting.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(
      waiting.actionHistory.some((action) => action.payload.step === 'NO_TOP_CARD_TO_INSPECT')
    ).toBe(false);
    const done = confirmActiveEffectStep(waiting, P1, waiting.activeEffect!.id);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.actionHistory.at(-1)?.payload.step).toBe('NO_TOP_CARD_TO_INSPECT');
  });

  it('rejects forged options, wrong players and stale inspection ownership without moving cards', () => {
    const waiting = start(setup());
    expect(choose(waiting, 'forged')).toBe(waiting);
    expect(choose(waiting, 'place-bottom', P2)).toBe(waiting);
    const stale = {
      ...waiting,
      inspectionContext: { ownerPlayerId: P2, sourceZone: ZoneType.MAIN_DECK },
    };
    expect(choose(stale, 'place-bottom')).toStrictEqual(stale);
    const done = choose(waiting, 'place-bottom');
    expect(
      confirmActiveEffectStep(
        done,
        P1,
        waiting.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'place-bottom'
      )
    ).toBe(done);
  });

  it('keeps the triggered effect independent of source departure and resumes the next pending after completion', () => {
    const waiting = start(setup());
    const sourceLeft = updatePlayer(waiting, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, null),
    }));
    const withNext = { ...sourceLeft, pendingAbilities: [pending(ABILITY, 'next-inspection')] };
    const done = choose(withNext, 'keep-top');
    expect(done.activeEffect?.id).toBe('next-inspection');
    expect(done.activeEffect?.inspectionCardIds).toEqual([TOP]);
    expect(choose(done, 'place-bottom').players[0].mainDeck.cardIds).toEqual([SECOND, TOP]);
  });
});

describe('existing Kanan binary inspection checkpoint input', () => {
  it.each([ABILITY, OLD_LIVE])(
    '%s confirms single and manually chosen empty effects but automatically finishes ordered effects',
    (abilityId) => {
      const initial = setup({ abilityId, mainDeck: [], waitingRoom: [] });
      const single = start(initial);
      expect(single.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
      expect(confirmActiveEffectStep(single, P1, single.activeEffect!.id).activeEffect).toBeNull();
      const two = {
        ...initial,
        pendingAbilities: [pending(abilityId, 'one'), pending(abilityId, 'two')],
      };
      const order = start(two);
      expect(order.activeEffect?.canResolveInOrder).toBe(true);
      const ordered = confirmActiveEffectStep(
        order,
        P1,
        order.activeEffect!.id,
        undefined,
        undefined,
        true
      );
      expect(ordered.activeEffect).toBeNull();
      expect(ordered.pendingAbilities).toEqual([]);
      const manual = confirmActiveEffectStep(
        order,
        P1,
        order.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'one'
      );
      expect(manual.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
      expect(
        manual.actionHistory.some((action) => action.payload.step === 'NO_TOP_CARD_TO_INSPECT')
      ).toBe(false);
    }
  );

  for (const abilityId of [OLD_ENTER, OLD_LIVE]) {
    it.each(['keep-top', 'place-bottom'])(
      `${abilityId} resumes a checkpoint with option %s and no destination metadata`,
      (option) => {
        // Explicitly retain the old checkpoint shape, rather than obtaining it from the new starter.
        let game = setup({ abilityId, mainDeck: [SECOND] });
        game = {
          ...game,
          pendingAbilities: [],
          inspectionZone: { ...game.inspectionZone, cardIds: [TOP], revealedCardIds: [] },
          inspectionContext: { ownerPlayerId: P1, sourceZone: ZoneType.MAIN_DECK },
          activeEffect: {
            id: 'old-checkpoint',
            abilityId,
            sourceCardId: SOURCE,
            controllerId: P1,
            effectText: '旧果南能力全文',
            stepId: 'S_BP7_003_LOOK_TOP_ONE_OPTIONAL_BOTTOM',
            stepText: '查看卡组顶1张卡。可以将其放置于卡组底。',
            awaitingPlayerId: P1,
            inspectionCardIds: [TOP],
            effectChoice: {
              mode: 'SINGLE',
              minSelections: 1,
              maxSelections: 1,
              publicConfirmation: true,
              options: [
                { id: 'keep-top', text: '将检视的卡保留在卡组顶。' },
                { id: 'place-bottom', text: '将检视的卡放置于卡组底。' },
              ],
            },
            confirmSelectionLabel: '确定',
            canSkipSelection: false,
            metadata: { orderedResolution: false, sourceSlot: SlotPosition.CENTER },
          },
        };
        expect(game.activeEffect?.metadata).not.toHaveProperty('selectedDestination');
        const done = choose(game, option);
        expect(done.activeEffect).toBeNull();
        expect(done.players[0].mainDeck.cardIds).toEqual(
          option === 'keep-top' ? [TOP, SECOND] : [SECOND, TOP]
        );
        expect(done.players[0].waitingRoom.cardIds).toEqual([]);
        expect(done.eventLog).toEqual([]);
      }
    );
  }
});
