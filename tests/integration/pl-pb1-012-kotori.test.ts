import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
  PL_PB1_012_ON_ENTER_ACTIVATE_PRINTEMPS_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(cardCode: string, unitName = 'Printemps'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ["μ's"],
    unitName,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function pending(id: string, abilityId: string, sourceCardId: string): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(sourceCode = 'PL!-pb1-012-R') {
  const source = createCardInstance(member(sourceCode), PLAYER1, 'source');
  const waiting = createCardInstance(member('WAITING'), PLAYER1, 'waiting');
  const active = createCardInstance(member('ACTIVE'), PLAYER1, 'active');
  const other = createCardInstance(member('OTHER', 'BiBi'), PLAYER1, 'other');
  const continuationSource = createCardInstance(member('DRAW-SOURCE'), PLAYER1, 'draw-source');
  const drawCard = createCardInstance(member('DRAW-CARD'), PLAYER1, 'draw-card');
  const opponent = createCardInstance(member('OPPONENT'), PLAYER2, 'opponent');
  let game = registerCards(createGameState('pl-pb1-012', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    waiting,
    active,
    other,
    continuationSource,
    drawCard,
    opponent,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
    memberSlots: {
      ...player.memberSlots,
      slots: {
        [SlotPosition.LEFT]: waiting.instanceId,
        [SlotPosition.CENTER]: source.instanceId,
        [SlotPosition.RIGHT]: active.instanceId,
      },
      cardStates: new Map([
        [waiting.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        [source.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        [active.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        [other.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
      ]),
    },
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponent.instanceId, {
      orientation: OrientationState.WAITING,
      face: FaceState.FACE_UP,
    }),
  }));

  return {
    game: {
      ...game,
      pendingAbilities: [
        pending('pb1-012-pending', PL_PB1_012_ON_ENTER_ACTIVATE_PRINTEMPS_MEMBER_ABILITY_ID, source.instanceId),
        pending('draw-pending', MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID, continuationSource.instanceId),
      ],
    },
    source,
    waiting,
    active,
    other,
    opponent,
    drawCard,
  };
}

function expectContinuation(game: ReturnType<typeof resolvePendingCardEffects>['gameState'], drawCardId: string) {
  expect(game.pendingAbilities).toEqual([]);
  expect(game.activeEffect).toBeNull();
  expect(game.players[0].hand.cardIds).toContain(drawCardId);
  expect(
    game.actionHistory.some(
      (action) =>
        action.payload.abilityId === MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID &&
        action.payload.step === 'ON_ENTER_DRAW_ONE' &&
        action.payload.drawnCardIds?.includes(drawCardId)
    )
  ).toBe(true);
}

function start012Pending(game: ReturnType<typeof resolvePendingCardEffects>['gameState'], sourceCardId: string) {
  const selection = resolvePendingCardEffects(game).gameState;
  return confirmActiveEffectStep(selection, PLAYER1, selection.activeEffect!.id, sourceCardId);
}

describe('PL!-pb1-012 南ことり', () => {
  it('covers R/P＋ and only offers own waiting Printemps members, including the source', () => {
    for (const sourceCode of ['PL!-pb1-012-R', 'PL!-pb1-012-P＋']) {
      const scenario = setup(sourceCode);
      const started = start012Pending(scenario.game, scenario.source.instanceId);
      expect(started.activeEffect).toMatchObject({ canSkipSelection: true });
      expect(started.activeEffect?.selectableCardIds).toEqual([
        scenario.waiting.instanceId,
        scenario.source.instanceId,
      ]);

      const resolved = confirmActiveEffectStep(
        started,
        PLAYER1,
        started.activeEffect!.id,
        scenario.waiting.instanceId
      );
      expect(resolved.players[0].memberSlots.cardStates.get(scenario.waiting.instanceId)?.orientation).toBe(
        OrientationState.ACTIVE
      );
      expect(
        resolved.eventLog.some(
          (entry) =>
            entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
            entry.event.cardInstanceId === scenario.waiting.instanceId
        )
      ).toBe(true);
      expectContinuation(resolved, scenario.drawCard.instanceId);
    }
  });

  it('skip consumes the current pending and continues without changing a member', () => {
    const scenario = setup();
    const started = start012Pending(scenario.game, scenario.source.instanceId);
    const skipped = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);

    expect(skipped.players[0].memberSlots.cardStates.get(scenario.waiting.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expectContinuation(skipped, scenario.drawCard.instanceId);
  });

  it('does not emit a member-state event for a stale target and still continues', () => {
    const scenario = setup();
    const started = start012Pending(scenario.game, scenario.source.instanceId);
    const staleGame = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    const beforeEventCount = staleGame.eventLog.filter(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
        entry.event.cardInstanceId === scenario.waiting.instanceId
    ).length;
    const stale = confirmActiveEffectStep(
      staleGame,
      PLAYER1,
      staleGame.activeEffect!.id,
      scenario.waiting.instanceId
    );

    expect(
      stale.eventLog.filter(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === scenario.waiting.instanceId
      )
    ).toHaveLength(beforeEventCount);
    expectContinuation(stale, scenario.drawCard.instanceId);
  });
});
