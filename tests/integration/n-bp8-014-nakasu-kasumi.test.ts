import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP8_014_LIVE_START_WAITING_ROOM_NO_BLADE_HEART_MEMBER_BOTTOM_GAIN_BLADE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createCardInstance } from '../../src/domain/entities/card';
import { emitGameEvent, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  createEnterStageEvent,
  createEnterWaitingRoomEvent,
  createLiveStartEvent,
} from '../../src/domain/events/game-events';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  BladeHeartEffect,
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
  createNovember07DraftCard,
  getNovember07MemberData,
} from '../helpers/november-07-draft-effects';
import {
  choose,
  chooseMany,
  gameWithCards,
  live,
  member,
  P1,
  P2,
} from '../helpers/card-effect-zone-fixture';

const TEXT =
  '【LIVE开始时】可以将存在于休息室的１张不持有BLADE HEART的成员卡放置于卡组底：LIVE结束时为止，获得[ブレード][ブレード]。';
function setup(
  waiting: readonly string[] = ['empty', 'absent', 'with-heart', 'waiting-live', 'enemy'],
  code = 'PL!N-bp8-014-N'
): GameState {
  const source = createCardInstance(
    { ...getNovember07MemberData('PL!N-bp8-014'), cardCode: code },
    P1,
    'source'
  );
  const cards = [
    source,
    member('empty', { bladeHearts: [], groupNames: ['Aqours'] }),
    member('absent', { bladeHearts: undefined }),
    member('with-heart', {
      bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RED }],
    }),
    live('waiting-live'),
    member('enemy', {}, P2),
    member('deck'),
    live('current'),
    createNovember07DraftCard('PL!N-bp8-014', P1, 'next-source'),
  ];
  let game = updatePlayer(gameWithCards(cards), P1, (p) => ({
    ...p,
    waitingRoom: { ...p.waitingRoom, cardIds: waiting },
    mainDeck: { ...p.mainDeck, cardIds: ['deck'] },
    liveZone: addCardToStatefulZone(p.liveZone, 'current', {
      face: FaceState.FACE_UP,
      orientation: OrientationState.ACTIVE,
    }),
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'source'),
  }));
  game = {
    ...game,
    manualOperationMode: 'RULES',
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  return game;
}
function start(game = setup()): GameState {
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(emitGameEvent(game, createLiveStartEvent(P1, ['current'])), [
      TriggerCondition.ON_LIVE_START,
    ])
  ).gameState;
}
function payActions(game: GameState) {
  return game.actionHistory.filter((a) => a.type === 'PAY_COST' && a.payload.abilityId === ABILITY);
}
function movementEvents(game: GameState) {
  return game.eventLog
    .map(({ event }) => event)
    .filter(
      (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
    );
}

describe('PL!N-bp8-014 费用5 中须霞', () => {
  it.each(['N', 'SEC', 'UNSEEN'])('keeps complete text and covers all rarities: %s', (rare) => {
    const definitions = getCardAbilityDefinitionsForCardCode(`PL!N-bp8-014-${rare}`);
    expect(definitions).toEqual([
      expect.objectContaining({
        abilityId: ABILITY,
        baseCardCodes: ['PL!N-bp8-014'],
        effectText: TEXT,
        category: 'LIVE_START',
        queued: true,
        implemented: true,
      }),
    ]);
    expect(definitions[0]?.cardCodes).toBeUndefined();
    expect(start(setup(undefined, `PL!N-bp8-014-${rare}`)).activeEffect?.effectText).toBe(TEXT);
  });
  it('pays one no-BLADE-HEART member as a cost only after the public selection and gains two real BLADE', () => {
    const game = start();
    expect(game.activeEffect).toMatchObject({
      selectableCardIds: ['empty', 'absent'],
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      confirmSelectionLabel: '放置于卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(game.activeEffect?.autoSubmitSingleSelection).toBe(true);
    const revealed = chooseMany(game, ['empty']);
    expect(revealed.activeEffect?.publicCardSelectionOrdered).toBe(false);
    expect(revealed.players[0].mainDeck.cardIds).toEqual(['deck']);
    expect(payActions(revealed)).toEqual([]);
    expect(getMemberEffectiveBladeCount(revealed, P1, 'source')).toBe(0);
    const done = choose(revealed);
    expect(done.players[0].mainDeck.cardIds).toEqual(['deck', 'empty']);
    expect(done.players[0].waitingRoom.cardIds).not.toContain('empty');
    expect(getMemberEffectiveBladeCount(done, P1, 'source')).toBe(2);
    expect(movementEvents(done)).toHaveLength(1);
    expect(payActions(done)).toHaveLength(1);
    expect(payActions(done)[0]?.payload).toMatchObject({
      costType: 'MOVE_WAITING_ROOM_MEMBERS_TO_DECK_BOTTOM',
      movedCardIds: ['empty'],
      waitingRoomCardsMovedToMainDeckEventId: movementEvents(done)[0]?.eventId,
    });
    expect(done.activeEffect).toBeNull();
  });
  it('projects click-to-submit and accepts the click single-card array before waiting for public display to finish', () => {
    let now = 1000;
    const session = createGameSession({ now: () => now });
    session.createGame('kasumi-rules', P1, 'P1', P2, 'P2');
    session.restoreRuntimeState({ authorityState: start(), currentPublicSeq: 0 });
    expect(session.manualOperationMode).toBe('RULES');
    const effectId = session.state!.activeEffect!.id;
    expect(session.getPlayerViewState(P1)?.activeEffect).toMatchObject({
      selectableObjectMode: 'ORDERED_MULTI',
      minSelectableObjects: 1,
      maxSelectableObjects: 1,
      autoSubmitSingleSelection: true,
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, effectId, undefined, undefined, undefined, undefined, [
          'empty',
        ])
      ).success
    ).toBe(true);
    expect(session.state!.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    expect(session.state!.activeEffect?.revealedCardIds).toEqual(['empty']);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['deck']);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain('empty');
    expect(payActions(session.state!)).toEqual([]);
    expect(getMemberEffectiveBladeCount(session.state!, P1, 'source')).toBe(0);
    const deadline = session.state!.activeEffect!.publicCardSelectionAutoAdvanceAt!;
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, effectId, deadline))
        .success
    ).toBe(false);
    now = deadline;
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, effectId, deadline))
        .success
    ).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['deck', 'empty']);
    expect(payActions(session.state!)).toHaveLength(1);
    expect(getMemberEffectiveBladeCount(session.state!, P1, 'source')).toBe(2);
    expect(session.state!.activeEffect).toBeNull();
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P1, effectId, deadline))
        .success
    ).toBe(false);
  });
  it('keeps the decline command available with click-to-submit enabled', () => {
    const session = createGameSession();
    session.createGame('kasumi-decline', P1, 'P1', P2, 'P2');
    session.restoreRuntimeState({ authorityState: start(), currentPublicSeq: 0 });
    expect(session.state!.activeEffect?.autoSubmitSingleSelection).toBe(true);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, null)
      ).success
    ).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['deck']);
    expect(payActions(session.state!)).toEqual([]);
    expect(movementEvents(session.state!)).toEqual([]);
  });
  it('declines or rejects illegal count/type/owner without paying', () => {
    const game = start();
    for (const ids of [
      ['with-heart'],
      ['waiting-live'],
      ['enemy'],
      ['empty', 'absent'],
      ['empty', 'empty'],
    ])
      expect(chooseMany(game, ids)).toBe(game);
    const done = chooseMany(game, []);
    expect(done.activeEffect).toBeNull();
    expect(payActions(done)).toEqual([]);
    expect(movementEvents(done)).toEqual([]);
  });
  it('confirms a no-target LIVE pending, then continues without a cost or reward', () => {
    const game = start(setup(['with-heart', 'waiting-live']));
    expect(game.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
    expect(game.activeEffect?.effectText).toContain('没有可选择的成员卡');
    const done = choose(game);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(payActions(done)).toEqual([]);
    expect(getMemberEffectiveBladeCount(done, P1, 'source')).toBe(0);
  });
  it.each(['left', 'reentered'])(
    'keeps a paid move without rewarding a source that has %s',
    (kind) => {
      let game = chooseMany(start(), ['empty']);
      game =
        kind === 'left'
          ? updatePlayer(game, P1, (p) => ({
              ...p,
              memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
            }))
          : emitGameEvent(
              game,
              createEnterStageEvent('source', ZoneType.HAND, SlotPosition.CENTER, P1, P1)
            );
      const done = choose(game);
      expect(done.players[0].mainDeck.cardIds).toEqual(['deck', 'empty']);
      expect(payActions(done)).toHaveLength(1);
      expect(done.liveResolution.liveModifiers.filter((m) => m.abilityId === ABILITY)).toEqual([]);
    }
  );
  it('finishes a stale public target without paying or granting BLADE', () => {
    const revealed = chooseMany(start(), ['empty']);
    const stale = updatePlayer(revealed, P1, (p) => ({
      ...p,
      waitingRoom: {
        ...p.waitingRoom,
        cardIds: p.waitingRoom.cardIds.filter((id) => id !== 'empty'),
      },
    }));
    const done = choose(stale);
    expect(done.activeEffect).toBeNull();
    expect(payActions(done)).toEqual([]);
    expect(movementEvents(done)).toEqual([]);
  });
  it('continues both ordered pending effects without inserting a second confirmation window', () => {
    const game = updatePlayer(setup(), P1, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.LEFT, 'next-source'),
    }));
    const ordered = start(game);
    expect(ordered.activeEffect?.stepId).toBe('SELECT_NEXT_PENDING_ABILITY');
    let state = confirmActiveEffectStep(
      ordered,
      P1,
      ordered.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    state = choose(chooseMany(state, ['empty']));
    expect(state.activeEffect?.abilityId).toBe(ABILITY);
    expect(state.activeEffect?.stepId).toBe(
      'N_BP8_014_SELECT_NO_BLADE_HEART_MEMBER_TO_DECK_BOTTOM'
    );
    state = choose(chooseMany(state, ['absent']));
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(payActions(state)).toHaveLength(2);
  });
  it('does not pay or reward a waiting-room card that left and reentered during public confirmation', () => {
    const revealed = chooseMany(start(), ['empty']);
    const reentered = emitGameEvent(
      revealed,
      createEnterWaitingRoomEvent(['empty'], ZoneType.HAND, P1, P1)
    );
    const done = choose(reentered);
    expect(done.players[0].waitingRoom.cardIds).toContain('empty');
    expect(done.players[0].mainDeck.cardIds).toEqual(['deck']);
    expect(payActions(done)).toEqual([]);
    expect(movementEvents(done)).toEqual([]);
    expect(getMemberEffectiveBladeCount(done, P1, 'source')).toBe(0);
    expect(done.activeEffect).toBeNull();
  });
});
