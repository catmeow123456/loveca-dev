import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_BP8_014_ON_ENTER_BOTTOM_TWO_NO_BLADE_HEART_MUSE_DRAW_ONE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { getAbilitySourceLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  createNovember02DraftCard,
  getNovember02MemberData,
} from '../helpers/november-02-draft-effects';

const P1 = 'p1';
const P2 = 'p2';
const BASE = 'PL!-bp8-014';

function pending(game: GameState, sourceCardId = 'source'): PendingAbilityState {
  return {
    id: `rin-pending:${sourceCardId}`,
    abilityId: ABILITY,
    sourceCardId,
    sourceLifecycleId: getAbilitySourceLifecycleId(game, ABILITY, sourceCardId),
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(
  options: { waiting?: readonly string[]; sourceInHand?: boolean; energies?: number } = {}
): GameState {
  const memberData = getNovember02MemberData(BASE);
  // A controlled negative variation tests the BLADE HEART predicate.
  const negativeMemberData: MemberCardData = {
    ...memberData,
    bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.YELLOW }],
  };
  const energies = Array.from({ length: options.energies ?? 7 }, (_, index) =>
    createCardInstance(
      { cardCode: `TEST-ENERGY-${index}`, cardType: CardType.ENERGY, name: '测试能量' },
      P1,
      `energy-${index}`
    )
  );
  const cards = [
    ...['source', 'a', 'b', 'c', 'd', 'draw', 'tail', 'next-source'].map((id) =>
      createNovember02DraftCard(BASE, P1, id)
    ),
    createNovember02DraftCard('PL!HS-ad2-001', P1, 'other-group'),
    createNovember02DraftCard('PL!-bp8-022', P1, 'muse-live'),
    createNovember02DraftCard(BASE, P2, 'opponent'),
    createCardInstance(negativeMemberData, P1, 'with-blade-heart'),
    ...energies,
  ];
  let game = registerCards(createGameState('rin-on-enter', P1, 'P1', P2, 'P2'), cards);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: options.sourceInHand ? ['source'] : [] },
    mainDeck: { ...player.mainDeck, cardIds: ['draw', 'tail'] },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: options.waiting ?? [
        'a',
        'b',
        'other-group',
        'muse-live',
        'opponent',
        'with-blade-heart',
      ],
    },
    memberSlots: options.sourceInHand
      ? player.memberSlots
      : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'source'),
    energyZone: {
      ...player.energyZone,
      cardIds: energies.map(({ instanceId }) => instanceId),
      cardStates: new Map(
        energies.map(({ instanceId }) => [
          instanceId,
          { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE },
        ])
      ),
    },
  }));
  return {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    manualOperationMode: 'RULES' as const,
    activePlayerIndex: 0,
    waitingForInput: false,
    waitingPlayerId: null,
  };
}

function start(game = setup()): GameState {
  return resolvePendingCardEffects({ ...game, pendingAbilities: [pending(game)] }).gameState;
}

function select(game: GameState, ids: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    ids.length ? undefined : null,
    undefined,
    undefined,
    undefined,
    ids.length ? ids : undefined
  );
}

function advance(game: GameState): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id);
}

function payActions(game: GameState) {
  return game.actionHistory.filter(
    (action) => action.type === 'PAY_COST' && action.payload.abilityId === ABILITY
  );
}

function bottomEvents(game: GameState) {
  return game.eventLog
    .map(({ event }) => event)
    .filter(
      (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
    );
}

describe('PL!-bp8-014 费用7「星空凛」', () => {
  it.each([6, 7])(
    'pays the real printed entrance cost through RULES with %i active energy',
    (count) => {
      const session = createGameSession({ cardEntrance: 'LOCAL' });
      session.createGame('rin-rules', P1, 'P1', P2, 'P2');
      (session as unknown as { authorityState: GameState }).authorityState = setup({
        sourceInHand: true,
        energies: count,
      });
      expect(session.manualOperationMode).toBe('RULES');
      const before = session.state!;
      const played = session.executeCommand(
        createPlayMemberToSlotCommand(P1, 'source', SlotPosition.CENTER, { relayMode: 'NONE' })
      );
      expect(played.success).toBe(count === 7);
      if (count === 6) {
        expect(session.state!.players).toEqual(before.players);
        expect(session.state!.eventLog).toEqual(before.eventLog);
        return;
      }
      const entrance = session.state!.entranceRuntime?.pending;
      if (entrance) {
        expect(
          session.executeCommand({
            type: GameCommandType.ACK_CARD_ENTRANCE,
            playerId: P1,
            entranceId: entrance.id,
            timestamp: Date.now(),
          }).success
        ).toBe(true);
      }
      expect(session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe('source');
      expect(session.state!.players[0].hand.cardIds).toEqual([]);
      expect(
        [...session.state!.players[0].energyZone.cardStates.values()].filter(
          ({ orientation }) => orientation === OrientationState.WAITING
        )
      ).toHaveLength(7);
      expect(session.state!.activeEffect).toMatchObject({
        abilityId: ABILITY,
        selectableCardIds: ['a', 'b'],
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 2,
        maxSelectableCards: 2,
        canSkipSelection: true,
      });
      const done = advance(select(session.state!, ['b', 'a']));
      expect(done.players[0].hand.cardIds).toEqual(['draw']);
      expect(done.players[0].mainDeck.cardIds).toEqual(['tail', 'b', 'a']);
      expect(payActions(done)).toHaveLength(1);
      expect(bottomEvents(done)).toHaveLength(1);
      expect(bottomEvents(done)[0]).toMatchObject({
        movedCardIds: ['b', 'a'],
        destination: { kind: 'BOTTOM' },
        cause: { sourceCardId: 'source', abilityId: ABILITY },
      });
      expect(payActions(done)[0].payload).toMatchObject({
        movedCardIds: ['b', 'a'],
        waitingRoomCardsMovedToMainDeckEventId: bottomEvents(done)[0].eventId,
      });
      expect(done.activeEffect).toBeNull();
      expect(done.pendingAbilities).toEqual([]);
    }
  );

  it('declines without a public window, payment, movement or draw; insufficient candidates finish safely', () => {
    const opened = start();
    const skipped = select(opened, []);
    expect(skipped.activeEffect).toBeNull();
    expect(skipped.players[0].hand.cardIds).toEqual([]);
    expect(skipped.players[0].waitingRoom.cardIds).toEqual(opened.players[0].waitingRoom.cardIds);
    expect(payActions(skipped)).toEqual([]);
    expect(bottomEvents(skipped)).toEqual([]);
    const insufficient = start(setup({ waiting: ['a', 'other-group', 'muse-live'] }));
    expect(insufficient.activeEffect).toBeNull();
    expect(insufficient.pendingAbilities).toEqual([]);
    expect(insufficient.players[0].hand.cardIds).toEqual([]);
    expect(payActions(insufficient)).toEqual([]);
  });

  it('rejects wrong count, duplicate, wrong type, group, owner, BLADE HEART and mixed inputs', () => {
    const opened = start();
    for (const ids of [
      ['a'],
      ['a', 'a'],
      ['a', 'b', 'c'],
      ['a', 'muse-live'],
      ['a', 'other-group'],
      ['a', 'opponent'],
      ['a', 'with-blade-heart'],
      ['a', 'missing'],
    ]) {
      expect(select(opened, ids)).toBe(opened);
    }
    expect(
      confirmActiveEffectStep(
        opened,
        P1,
        opened.activeEffect!.id,
        'a',
        undefined,
        undefined,
        undefined,
        ['a', 'b']
      )
    ).toBe(opened);
    expect(payActions(opened)).toEqual([]);
    expect(bottomEvents(opened)).toEqual([]);
  });

  it('publicly displays the selected order before paying, rejects early/repeated advances and moves only once', () => {
    let now = 1000;
    const session = createGameSession({ now: () => now });
    session.createGame('rin-public-payment', P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = start();
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          ['b', 'a']
        )
      ).success
    ).toBe(true);
    const reveal = session.state!.activeEffect!;
    expect(reveal.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    expect(reveal.revealedCardIds).toEqual(['b', 'a']);
    expect(reveal.publicCardSelectionOrdered).toBe(true);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain('a');
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
    expect(payActions(session.state!)).toEqual([]);
    for (const player of [P1, P2]) {
      const view = projectPlayerViewState(session.state!, player);
      expect(view.objects[createPublicObjectId('a')].surface).toBe('FRONT');
      expect(view.objects[createPublicObjectId('b')].surface).toBe('FRONT');
    }
    const deadline = reveal.publicCardSelectionAutoAdvanceAt!;
    expect(deadline).toBe(3300);
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, deadline))
        .success
    ).toBe(false);
    now = deadline;
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, deadline))
        .success
    ).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual(['draw']);
    expect(payActions(session.state!)).toHaveLength(1);
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P1, reveal.id, deadline))
        .success
    ).toBe(false);
    expect(bottomEvents(session.state!)).toHaveLength(1);
  });

  it('revalidates the whole selected batch at deadline without partial payment or draw', () => {
    const reveal = select(start(), ['a', 'b']);
    const stale = updatePlayer(reveal, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => id !== 'b'),
      },
      hand: { ...player.hand, cardIds: ['b'] },
    }));
    const done = advance(stale);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].waitingRoom.cardIds).toContain('a');
    expect(done.players[0].mainDeck.cardIds).toEqual(['draw', 'tail']);
    expect(done.players[0].hand.cardIds).toEqual(['b']);
    expect(payActions(done)).toEqual([]);
    expect(bottomEvents(done)).toEqual([]);
  });

  it.each(['before-selection', 'during-reveal', 'reentered'] as const)(
    'keeps independent payment and draw legal after the source is %s',
    (change) => {
      let game = setup();
      const ability = pending(game);
      if (change === 'before-selection') {
        game = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
          game,
          P1,
          'source',
          enqueueTriggeredCardEffects
        )!.gameState;
        game = resolvePendingCardEffects({ ...game, pendingAbilities: [ability] }).gameState;
      } else {
        game = select(start(game), ['a', 'b']);
        game = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
          game,
          P1,
          'source',
          enqueueTriggeredCardEffects
        )!.gameState;
        if (change === 'reentered') {
          game = updatePlayer(game, P1, (player) => ({
            ...player,
            waitingRoom: {
              ...player.waitingRoom,
              cardIds: player.waitingRoom.cardIds.filter((id) => id !== 'source'),
            },
            memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'source'),
          }));
          game = emitGameEvent(
            game,
            createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
          );
          expect(getAbilitySourceLifecycleId(game, ABILITY, 'source')).not.toBe(
            ability.sourceLifecycleId
          );
        }
      }
      const done = advance(change === 'before-selection' ? select(game, ['a', 'b']) : game);
      expect(done.players[0].hand.cardIds).toEqual(['draw']);
      expect(done.players[0].mainDeck.cardIds).toEqual(['tail', 'a', 'b']);
      expect(payActions(done)).toHaveLength(1);
    }
  );

  it('pays into an empty deck before drawing the first card in the chosen order', () => {
    const opened = updatePlayer(start(setup({ waiting: ['a', 'b'] })), P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [] },
    }));
    const done = advance(select(opened, ['b', 'a']));
    expect(done.players[0].hand.cardIds).toEqual(['b']);
    expect(done.players[0].mainDeck.cardIds).toEqual(['a']);
    expect(payActions(done)[0].payload.movedCardIds).toEqual(['b', 'a']);
  });

  it('finishes the whole draw before returning to the live pending pool', () => {
    const base = setup({ waiting: ['a', 'b', 'c', 'd'] });
    const opened = start(base);
    const nextAbility = pending(base, 'next-source');
    const reveal = select({ ...opened, pendingAbilities: [nextAbility] }, ['a', 'b']);
    expect(reveal.pendingAbilities).toEqual([nextAbility]);
    expect(reveal.players[0].hand.cardIds).toEqual([]);
    const done = advance(reveal);
    expect(done.players[0].hand.cardIds).toEqual(['draw']);
    expect(done.activeEffect).toMatchObject({
      id: nextAbility.id,
      selectableCardIds: ['c', 'd'],
    });
    const finishIndex = done.actionHistory.findIndex(
      (action) => action.payload.step === 'BOTTOM_TWO_MEMBERS_DRAW_ONE'
    );
    const nextIndex = done.actionHistory.findIndex(
      (action) =>
        action.payload.pendingAbilityId === nextAbility.id &&
        action.payload.step === 'START_SELECT_TWO_NO_BLADE_HEART_MUSE_MEMBERS'
    );
    expect(finishIndex).toBeLessThan(nextIndex);
    expect(select(done, []).activeEffect).toBeNull();
  });

  it('waives only the printed payment for a free delegated invocation and draws without candidates', () => {
    const base = setup({ waiting: [] });
    const ability = {
      ...pending(base, 'other-group'),
      onEnterInvocation: {
        definitionSourceCardCode: 'PL!-bp8-014-N',
        waiveActivationCosts: true,
        grantId: 'rin-test-grant',
      },
    };
    const done = resolvePendingCardEffects({ ...base, pendingAbilities: [ability] }).gameState;
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].hand.cardIds).toEqual(['draw']);
    expect(done.players[0].mainDeck.cardIds).toEqual(['tail']);
    expect(payActions(done)).toEqual([]);
    expect(bottomEvents(done)).toEqual([]);
  });
});
