import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  getPlayerById,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  createActivateAbilityCommand,
  createPlayMemberToSlotCommand,
  GameCommandType,
  createAutoAdvancePublicCardSelectionCommand,
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import {
  N_BP8_009_ACTIVATED_BOTTOM_HAND_DRAW_TWO_ABILITY_ID as ACTIVATE_ID,
  N_BP8_009_LIVE_START_MILL_BOTTOM_REPLACE_LIVE_ABILITY_ID as LIVE_ID,
  N_BP8_030_AUTO_FROM_WAITING_ROOM_REDUCE_REQUIREMENT_ABILITY_ID as STAY_AUTO_ID,
} from '../../src/application/card-effects/ability-ids';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { resolvePendingAbilityStarterWithRegistry } from '../../src/application/card-effects/runtime/starter-registry';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

import { getRinaLiveSwapSource } from '../../client/src/lib/rinaLiveSwap';
import { supportsRinaSec } from '../../client/src/components/game/card-entrance/rina-sec/rinaSecTimeline';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';

const P1 = 'p1';
const P2 = 'p2';
const SOURCE = 'rina';
const ACTIVATE_TEXT = '【起动】【１回合１次】将１张手牌放置于卡组底，抽２张卡。';
const LIVE_TEXT =
  '【LIVE开始时】可以将卡组底的卡片放置入休息室：因此放置入休息室的卡片是LIVE卡的场合，将存在于自己的LIVE卡区的１张分数小于等于２的『虹咲』的LIVE卡放置于卡组顶。如此做时，从自己的休息室将１张LIVE卡正面放置于LIVE卡区。';
function member(id: string, ownerId = P1, code = id) {
  const data: MemberCardData = {
    cardCode: code,
    name: code.startsWith('PL!N-bp8-009') ? '天王寺璃奈' : id,
    cardType: CardType.MEMBER,
    cost: code.startsWith('PL!N-bp8-009') ? 15 : 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    groupNames: ['虹ヶ咲'],
  };
  return createCardInstance(data, ownerId, id);
}
function live(id: string, score = 2, groupNames: readonly string[] = ['虹ヶ咲'], code = id) {
  const data: LiveCardData = {
    cardCode: code,
    name: code === 'PL!N-bp8-030-L' ? 'Stay' : id,
    cardType: CardType.LIVE,
    score,
    groupNames,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 6 }),
  };
  return createCardInstance(data, P1, id);
}
function setup(
  options: {
    deck?: ReturnType<typeof createCardInstance>[];
    hand?: ReturnType<typeof createCardInstance>[];
    lives?: ReturnType<typeof createCardInstance>[];
    waiting?: ReturnType<typeof createCardInstance>[];
    sourceCode?: string;
  } = {}
) {
  const deck = options.deck ?? [member('top'), member('middle'), live('bottom')];
  const hand = options.hand ?? [];
  const lives = options.lives ?? [live('old-live')];
  const waiting = options.waiting ?? [];
  let game = registerCards(createGameState('rina-bp8', P1, 'P1', P2, 'P2'), [
    member(SOURCE, P1, options.sourceCode ?? 'PL!N-bp8-009-SEC'),
    member('opponent', P2),
    ...deck,
    ...hand,
    ...lives,
    ...waiting,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: waiting.map((card) => card.instanceId) },
    liveZone: lives.reduce(
      (zone, card) => addCardToStatefulZone(zone, card.instanceId, { face: FaceState.FACE_UP }),
      player.liveZone
    ),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, SOURCE, {
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: ['opponent'] },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'opponent', {
      face: FaceState.FACE_UP,
    }),
  }));
  return {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    activePlayerIndex: 0,
    liveResolution: { ...game.liveResolution, performingPlayerId: P1 },
  };
}
function attach(state: GameState, cardEntrance?: 'LOCAL' | 'REMOTE') {
  let now = 10_000;
  const session = createGameSession({ now: () => now, cardEntrance });
  const initial = session.createGame('rina-session', P1, 'P1', P2, 'P2');
  if (cardEntrance)
    state = {
      ...state,
      entranceRuntime: { ...initial.entranceRuntime!, seenSequence: state.eventSequence },
    };
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return {
    session,
    setNow: (value: number) => {
      now = value;
    },
  };
}
function startLive(state = setup(), cardEntrance?: 'LOCAL' | 'REMOTE') {
  const result = new GameService().executeCheckTiming(state, [TriggerCondition.ON_LIVE_START]);
  expect(result.success, result.error).toBe(true);
  expect(result.gameState.activeEffect?.abilityId).toBe(LIVE_ID);
  return attach(result.gameState, cardEntrance);
}
type Session = ReturnType<typeof createGameSession>;
function choose(session: Session, cardId?: string | null, optionId?: string) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      session.state!.activeEffect!.id,
      cardId,
      undefined,
      undefined,
      optionId
    )
  );
  expect(result.success, result.error).toBe(true);
  return result;
}
function pay(session: Session) {
  choose(session, undefined, 'PLACE_BOTTOM_CARD_IN_WAITING_ROOM');
  expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
}
function advanceReveal(session: Session, setNow: (value: number) => void) {
  const effect = session.state!.activeEffect!;
  const deadline = effect.publicRevealAutoAdvanceAt!;
  setNow(deadline);
  const result = session.executeCommand(
    createAutoAdvancePublicRevealCommand(P2, effect.id, deadline, effect.publicRevealGeneration!)
  );
  expect(result.success, result.error).toBe(true);
}
function advanceSelection(session: Session, setNow: (value: number) => void) {
  const effect = session.state!.activeEffect!;
  const deadline = effect.publicCardSelectionAutoAdvanceAt!;
  setNow(deadline);
  const result = session.executeCommand(
    createAutoAdvancePublicCardSelectionCommand(P2, effect.id, deadline)
  );
  expect(result.success, result.error).toBe(true);
}
function replaceAuthority(session: Session, state: GameState) {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}

describe('cost 15 PL!N-bp8-009 Rina', () => {
  it('removes an unpayable pending cost without refreshing to provide the cost', () => {
    const ability = {
      id: 'empty-cost-pending',
      abilityId: LIVE_ID,
      sourceCardId: SOURCE,
      controllerId: P1,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_START,
      eventIds: [],
    };
    const state = {
      ...setup({ deck: [], waiting: [live('waiting')] }),
      pendingAbilities: [ability],
    };
    let continued = false;
    const result = resolvePendingAbilityStarterWithRegistry(
      state,
      ability,
      {},
      {
        continuePendingCardEffects: (game) => {
          continued = true;
          return game;
        },
        delegatePendingAbility: (game) => game,
      }
    );
    expect(continued).toBe(true);
    expect(result?.pendingAbilities).toEqual([]);
    expect(result?.activeEffect).toBeNull();
    expect(result?.players[0].mainDeck.cardIds).toEqual([]);
    expect(result?.players[0].waitingRoom.cardIds).toEqual(['waiting']);
  });

  it('draws from a short deck through normal refresh and does not replay the activated choice', () => {
    const { session } = attach(
      setup({ deck: [member('top')], hand: [member('hand')], waiting: [member('refresh')] })
    );
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, SOURCE, ACTIVATE_ID)).success
    ).toBe(true);
    const effectId = session.state!.activeEffect!.id;
    choose(session, 'hand');
    expect(session.state?.players[0].hand.cardIds).toEqual(['top', 'hand']);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(['refresh']);
    const before = session.state;
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, effectId, 'hand')).success
    ).toBe(false);
    expect(session.state).toBe(before);
  });
  it('allows empty hand, draws two, and consumes the turn limit without a hand cost', () => {
    const { session } = attach(setup());
    const result = session.executeCommand(createActivateAbilityCommand(P1, SOURCE, ACTIVATE_ID));
    expect(result.success, result.error).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual(['top', 'middle']);
    expect(
      session.state?.actionHistory.filter((action) => action.payload.step === 'ABILITY_USE')
    ).toHaveLength(1);
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      effectText: ACTIVATE_TEXT,
      bottomedCardId: null,
    });
    const before = session.state;
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, SOURCE, ACTIVATE_ID)).success
    ).toBe(false);
    expect(session.state).toBe(before);
  });

  it('selects only existing owned hand cards privately, then bottoms one and draws two after the source leaves', () => {
    const { session } = attach(setup({ hand: [member('hand'), member('foreign-hand', P2)] }));
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, SOURCE, ACTIVATE_ID)).success
    ).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(['hand']);
    expect(session.state?.activeEffect?.effectText).toBe(ACTIVATE_TEXT);
    expect(
      projectPlayerViewState(session.state!, P2).activeEffect?.selectableObjectIds
    ).toBeUndefined();
    const before = session.state!;
    expect(confirmActiveEffectStep(before, P1, before.activeEffect!.id, 'foreign-hand')).toBe(
      before
    );
    replaceAuthority(
      session,
      updatePlayer(before, P1, (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      }))
    );
    choose(session, 'hand');
    expect(session.state?.players[0].hand.cardIds).toEqual(['foreign-hand', 'top', 'middle']);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(['bottom', 'hand']);
    expect(session.state?.activeEffect).toBeNull();
  });

  it('does not draw on a stale hand selection; explicitly confirms the impossible effect before drawing', () => {
    const { session } = attach(setup({ hand: [member('hand')] }));
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, SOURCE, ACTIVATE_ID)).success
    ).toBe(true);
    replaceAuthority(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: [] },
      }))
    );
    const before = session.state!;
    expect(confirmActiveEffectStep(before, P1, before.activeEffect!.id, 'invalid')).toBe(before);
    choose(session, 'hand');
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.activeEffect?.stepId).toBe('N_BP8_009_NO_HAND_CONTINUE_DRAW_TWO');
    choose(session);
    expect(session.state?.players[0].hand.cardIds).toEqual(['top', 'middle']);
  });

  it('offers the optional exact cost without exposing the hidden bottom or requiring downstream targets', () => {
    const { session } = startLive(setup({ lives: [] }));
    expect(session.state?.activeEffect?.effectText).toBe(LIVE_TEXT);
    expect(
      projectPlayerViewState(session.state!, P2).activeEffect?.revealedObjectIds
    ).toBeUndefined();
    choose(session, null);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(['top', 'middle', 'bottom']);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.activeEffect).toBeNull();
  });

  it.each([false, true])(
    'retains payment and dwells even when no replacement can happen (bottomLive=%s)',
    (bottomLive) => {
      const { session, setNow } = startLive(
        setup({ deck: [member('top'), bottomLive ? live('bottom') : member('bottom')], lives: [] })
      );
      pay(session);
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual(['bottom']);
      expect(session.state?.eventLog.at(-1)?.event).toMatchObject({
        eventType: TriggerCondition.ON_ENTER_WAITING_ROOM,
        cardInstanceIds: ['bottom'],
        cause: {
          kind: 'CARD_EFFECT',
          playerId: P1,
          sourceCardId: SOURCE,
          abilityId: LIVE_ID,
          pendingAbilityId: session.state!.activeEffect!.id,
        },
      });
      advanceReveal(session, setNow);
      expect(session.state?.activeEffect).toBeNull();
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual(['bottom']);
    }
  );

  it('uses current card score and group aliases while ignoring player total score', () => {
    let state = setup({
      lives: [
        live('printed-four', 4, ['虹ヶ咲学園スクールアイドル同好会']),
        live('printed-one', 1),
        live('wrong-group', 1, ['Aqours']),
      ],
    });
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId: P1,
      liveCardId: 'printed-four',
      countDelta: -2,
    });
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId: P1,
      liveCardId: 'printed-one',
      countDelta: 2,
    });
    state = addLiveModifier(state, { kind: 'SCORE', playerId: P1, countDelta: 99 });
    const { session, setNow } = startLive(state);
    pay(session);
    advanceReveal(session, setNow);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(['printed-four']);
  });

  it('refreshes stale LIVE candidates when the score threshold changes without repaying the bottom cost', () => {
    const { session, setNow } = startLive(
      setup({ lives: [live('old-live', 2), live('new-live', 3)] })
    );
    pay(session);
    advanceReveal(session, setNow);
    let state = addLiveModifier(session.state!, {
      kind: 'SCORE',
      playerId: P1,
      liveCardId: 'old-live',
      countDelta: 1,
    });
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId: P1,
      liveCardId: 'new-live',
      countDelta: -1,
    });
    replaceAuthority(session, state);
    choose(session, 'old-live');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(['new-live']);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(['top', 'middle']);
    expect(
      session.state?.actionHistory.filter((action) => action.type === 'PAY_COST')
    ).toHaveLength(1);
    choose(session, 'new-live');
    expect(session.state?.players[0].mainDeck.cardIds[0]).toBe('new-live');
  });

  it('finishes an impossible LIVE selection and rejects unrelated stale IDs', () => {
    const { session, setNow } = startLive();
    pay(session);
    advanceReveal(session, setNow);
    replaceAuthority(
      session,
      addLiveModifier(session.state!, {
        kind: 'SCORE',
        playerId: P1,
        liveCardId: 'old-live',
        countDelta: 1,
      })
    );
    const before = session.state!;
    expect(confirmActiveEffectStep(before, P1, before.activeEffect!.id, 'invalid')).toBe(before);
    choose(session, 'old-live');
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(['bottom']);
  });

  it('keeps the paid LIVE fact after refresh and keeps a completed return when no waiting LIVE remains', () => {
    const { session, setNow } = startLive(
      setup({ deck: [live('bottom')], waiting: [member('refresh-filler')] })
    );
    pay(session);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.activeEffect?.revealedCardIds).toEqual(['bottom']);
    advanceReveal(session, setNow);
    choose(session, 'old-live');
    expect(session.state?.players[0].mainDeck.cardIds[0]).toBe('old-live');
    expect(session.state?.activeEffect).toBeNull();
  });

  it('rejects mixed WR inputs before opening public selection and recovers stale selections after the deadline', () => {
    const { session, setNow } = startLive(setup({ waiting: [live('other-waiting')] }));
    pay(session);
    advanceReveal(session, setNow);
    choose(session, 'old-live');
    const before = session.state!;
    expect(
      confirmActiveEffectStep(
        before,
        P1,
        before.activeEffect!.id,
        'bottom',
        undefined,
        undefined,
        undefined,
        undefined,
        1
      )
    ).toBe(before);
    choose(session, 'bottom');
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    replaceAuthority(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        waitingRoom: { ...player.waitingRoom, cardIds: ['other-waiting'] },
      }))
    );
    advanceSelection(session, setNow);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(['other-waiting']);
    expect(session.state?.players[0].liveZone.cardIds).toEqual([]);
    choose(session, 'other-waiting');
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    advanceSelection(session, setNow);
    expect(session.state?.players[0].liveZone.cardIds).toEqual(['other-waiting']);
  });

  it('refreshes a stale waiting selection before the public window without moving or repaying', () => {
    const { session, setNow } = startLive();
    pay(session);
    advanceReveal(session, setNow);
    choose(session, 'old-live');
    let state = registerCards(session.state!, [live('new-waiting')]);
    state = updatePlayer(state, P1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: ['new-waiting'] },
    }));
    replaceAuthority(session, state);
    choose(session, 'bottom');
    expect(session.state?.activeEffect?.stepId).toBe('N_BP8_009_SELECT_WAITING_LIVE');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(['new-waiting']);
    expect(session.state?.players[0].liveZone.cardIds).toEqual([]);
    expect(
      session.state?.actionHistory.filter((action) => action.type === 'PAY_COST')
    ).toHaveLength(1);
    choose(session, 'new-waiting');
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    advanceSelection(session, setNow);
    expect(session.state?.players[0].liveZone.cardIds).toEqual(['new-waiting']);
  });

  it('uses real timed command paths for Rina → Stay and resolves the new AUTO only after placement', () => {
    const { session, setNow } = startLive(
      setup({ waiting: [live('stay', 6, ['虹ヶ咲'], 'PL!N-bp8-030-L')] })
    );
    replaceAuthority(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      }))
    );
    pay(session);
    const revealed = session.state!.activeEffect!;
    setNow(revealed.publicRevealAutoAdvanceAt! - 1);
    expect(
      session.executeCommand(
        createAutoAdvancePublicRevealCommand(
          P2,
          revealed.id,
          revealed.publicRevealAutoAdvanceAt!,
          revealed.publicRevealGeneration!
        )
      ).success
    ).toBe(false);
    expect(session.state?.players[0].liveZone.cardIds).toEqual(['old-live']);
    advanceReveal(session, setNow);
    choose(session, 'old-live');
    choose(session, 'stay');
    const selected = session.state!.activeEffect!;
    expect(selected.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    for (const pid of [P1, P2])
      expect(projectPlayerViewState(session.state!, pid).activeEffect?.revealedObjectIds).toEqual([
        createPublicObjectId('stay'),
      ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain('stay');
    expect(
      session.state?.pendingAbilities.some((ability) => ability.abilityId === STAY_AUTO_ID)
    ).toBe(false);
    setNow(selected.publicCardSelectionAutoAdvanceAt! - 1);
    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(
          P2,
          selected.id,
          selected.publicCardSelectionAutoAdvanceAt!
        )
      ).success
    ).toBe(false);
    advanceSelection(session, setNow);
    expect(session.state?.players[0].liveZone.cardStates.get('stay')?.face).toBe(FaceState.FACE_UP);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'REQUIREMENT',
        liveCardId: 'stay',
        abilityId: STAY_AUTO_ID,
        modifiers: [{ color: HeartColor.RAINBOW, countDelta: -3 }],
      })
    );
    expect(
      session.state?.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_LIVE_ZONE
      )
    ).toHaveLength(1);
    expect(
      session.state?.eventLog.find(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_LIVE_ZONE
      )?.event
    ).toMatchObject({
      fromZone: ZoneType.WAITING_ROOM,
      toZone: ZoneType.LIVE_ZONE,
      face: FaceState.FACE_UP,
    });
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.payload.abilityId === LIVE_ID && action.payload.step === 'CHOOSE_BOTTOM_COST'
      )
    ).toHaveLength(1);
    expect(getPlayerById(session.state!, P1)?.mainDeck.cardIds[0]).toBe('old-live');
  });

  it('shares one ordering pool between an old pending AUTO and the newly placed Stay AUTO', () => {
    const { session, setNow } = startLive(
      setup({
        lives: [live('old-live'), live('old-stay', 6, ['虹ヶ咲'], 'PL!N-bp8-030-L')],
        waiting: [live('new-stay', 6, ['虹ヶ咲'], 'PL!N-bp8-030-L')],
      })
    );
    pay(session);
    advanceReveal(session, setNow);
    choose(session, 'old-live');
    choose(session, 'new-stay');
    replaceAuthority(session, {
      ...session.state!,
      pendingAbilities: [
        {
          id: 'old-stay-pending',
          abilityId: STAY_AUTO_ID,
          sourceCardId: 'old-stay',
          controllerId: P1,
          mandatory: true,
          timingId: TriggerCondition.ON_ENTER_LIVE_ZONE,
          eventIds: [],
        },
      ],
    });
    advanceSelection(session, setNow);
    expect(session.state?.activeEffect?.stepId).toBe('SELECT_NEXT_PENDING_ABILITY');
    expect(session.state?.pendingAbilities.map((ability) => ability.sourceCardId)).toEqual([
      'old-stay',
      'new-stay',
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(['old-stay', 'new-stay']);
    choose(session, 'new-stay');
    expect(
      session.state?.actionHistory
        .filter(
          (action) => action.payload.step === 'REDUCE_SOURCE_LIVE_REQUIREMENT_FROM_WAITING_ROOM'
        )
        .map((action) => action.payload.sourceCardId)
    ).toEqual(['new-stay', 'old-stay']);
    expect(session.state?.pendingAbilities).toEqual([]);
  });
});

describe('Rina public presentation barriers', () => {
  const ack = (
    session: Session,
    playerId = P1,
    entranceId = session.state!.entranceRuntime!.pending!.id
  ) =>
    session.executeCommand({
      type: GameCommandType.ACK_CARD_ENTRANCE,
      playerId,
      entranceId,
      timestamp: 0,
    });
  const prints = ['PL!N-bp8-009', 'PL!N-bp8-009-R', 'PL!N-bp8-009-P', 'PL!N-bp8-009-SEC'];
  it.each(prints)(
    '%s enters through the shared barrier and plays both LIVE phases',
    (sourceCode) => {
      let game = setup({ sourceCode });
      const energy = Array.from({ length: 15 }, (_, i) =>
        createCardInstance(
          { cardType: CardType.ENERGY, cardCode: `E${i}`, name: 'energy' },
          P1,
          `E${i}`
        )
      );
      game = registerCards(game, energy);
      game = updatePlayer(game, P1, (p) => ({
        ...p,
        hand: { ...p.hand, cardIds: [SOURCE] },
        memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
        energyZone: energy.reduce(
          (zone, e) => addCardToStatefulZone(zone, e.instanceId),
          p.energyZone
        ),
      }));
      const entered = attach(game, 'LOCAL');
      expect(
        entered.session.executeCommand(
          createPlayMemberToSlotCommand(P1, SOURCE, SlotPosition.CENTER)
        ).success
      ).toBe(true);
      expect(entered.session.state!.entranceRuntime!.pending!.cardIds).toEqual([SOURCE]);
      expect(supportsRinaSec(sourceCode)).toBe(true);
      expect(ack(entered.session).success).toBe(true);
      const { session, setNow } = startLive(setup({ sourceCode }), 'REMOTE');
      pay(session);
      advanceReveal(session, setNow);
      choose(session, 'old-live');
      const old = session.state!.entranceRuntime!.pending!;
      expect(old.rinaLiveSwap).toMatchObject({
        phase: 'RETURN',
        liveCardId: 'old-live',
        liveIndex: 0,
      });
      expect(session.state!.players[0].mainDeck.cardIds[0]).toBe('old-live');
      const first = session.getPlayerViewState(P1)!,
        second = session.getPlayerViewState(P2)!;
      expect(first.match.entrance).toEqual(second.match.entrance);
      expect(getRinaLiveSwapSource(first, (code) => code)).toMatchObject({
        side: 'self',
        imagePath: 'old-live',
      });
      expect(getRinaLiveSwapSource(second, (code) => code)).toMatchObject({ side: 'opponent' });
      // Only the formerly public face is copied. The hidden deck identity remains hidden.
      expect(second.objects.obj_top?.frontInfo).toBeUndefined();
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'bottom')
        ).success
      ).toBe(false);
      expect(ack(session).success).toBe(true);
      expect(session.state!.entranceRuntime!.pending!.waitingPlayerIds).toEqual([P2]);
      expect(ack(session, P2).success).toBe(true);
      choose(session, 'bottom');
      advanceSelection(session, setNow);
      const next = session.state!.entranceRuntime!.pending!;
      expect(next.id).not.toBe(old.id);
      expect(getRinaLiveSwapSource(session.getPlayerViewState(P2)!, (code) => code)?.phase).toBe(
        'PLACE'
      );
      expect(next.rinaLiveSwap).toMatchObject({
        phase: 'PLACE',
        liveCardId: 'bottom',
        liveIndex: 0,
      });
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.players[0].liveZone.cardIds).toEqual(['bottom']);
      expect(ack(session, P1, old.id).success).toBe(false);
      expect(ack(session).success).toBe(true);
      expect(ack(session, P2).success).toBe(true);
      expect(session.state!.entranceRuntime!.pending).toBeNull();
      expect(session.state!.entranceRuntime!.resumePendingEffects).toBeUndefined();
      expect(session.state!.actionHistory.filter((a) => a.type === 'PAY_COST')).toHaveLength(1);
    }
  );

  it('defers the new LIVE AUTO, restores it exactly once after checkpoint timeout, and never replays the completed wait', () => {
    const { session, setNow } = startLive(
      setup({ waiting: [live('stay', 6, ['虹ヶ咲'], 'PL!N-bp8-030-L')] }),
      'REMOTE'
    );
    pay(session);
    advanceReveal(session, setNow);
    choose(session, 'old-live');
    ack(session);
    ack(session, P2);
    choose(session, 'stay');
    advanceSelection(session, setNow);
    const wait = session.state!.entranceRuntime!.pending!;
    expect(
      session.state!.liveResolution.liveModifiers.some((m) => m.abilityId === STAY_AUTO_ID)
    ).toBe(false);
    expect(session.state!.entranceRuntime!.resumePendingEffects).toBe(false);
    expect(ack(session).success).toBe(true);
    expect(
      session.state!.liveResolution.liveModifiers.some((m) => m.abilityId === STAY_AUTO_ID)
    ).toBe(false);
    const serialized = rehydrateAuthorityGameState(
      serializeReplayPayload(session.state!, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
    );
    const restored = createGameSession({ cardEntrance: 'REMOTE', now: () => wait.deadlineAt });
    restored.restoreRuntimeState({
      authorityState: serialized,
      currentPublicSeq: session.getCurrentPublicEventSeq(),
    });
    expect(restored.expireCardEntrance()).toBe(true);
    expect(restored.state!.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({ abilityId: STAY_AUTO_ID, liveCardId: 'stay' })
    );
    expect(restored.expireCardEntrance()).toBe(false);
    expect(ack(restored, P1, wait.id).success).toBe(false);
    expect(
      restored.state!.actionHistory.filter(
        (a) => a.payload.step === 'REDUCE_SOURCE_LIVE_REQUIREMENT_FROM_WAITING_ROOM'
      )
    ).toHaveLength(1);
    restored.restoreRuntimeState({
      authorityState: restored.state!,
      currentPublicSeq: restored.getCurrentPublicEventSeq(),
    });
    expect(restored.getPlayerViewState(P1)!.match.entrance).toBeUndefined();
  });

  it('lets a departed source resolve the rule without a board animation and excludes other Rina cards', () => {
    expect(supportsRinaSec('PL!N-bp1-009-SEC')).toBe(false);
    const { session, setNow } = startLive(setup(), 'LOCAL');
    replaceAuthority(
      session,
      updatePlayer(session.state!, P1, (p) => ({
        ...p,
        memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
      }))
    );
    pay(session);
    advanceReveal(session, setNow);
    choose(session, 'old-live');
    expect(session.state!.entranceRuntime!.pending).toBeNull();
    choose(session, 'bottom');
    advanceSelection(session, setNow);
    expect(session.state!.entranceRuntime!.pending).toBeNull();
    expect(session.state!.players[0].liveZone.cardIds).toEqual(['bottom']);
  });

  it('a non-LIVE bottom cost and an invalid selection do not create a presentation', () => {
    const invalid = startLive(setup(), 'LOCAL');
    pay(invalid.session);
    advanceReveal(invalid.session, invalid.setNow);
    expect(
      invalid.session.executeCommand(
        createConfirmEffectStepCommand(P1, invalid.session.state!.activeEffect!.id, 'not-a-live')
      ).success
    ).toBe(false);
    expect(invalid.session.state!.entranceRuntime!.pending).toBeNull();
    const f = startLive(setup({ deck: [member('top'), member('bottom')] }), 'LOCAL');
    pay(f.session);
    advanceReveal(f.session, f.setNow);
    expect(f.session.state!.entranceRuntime!.pending).toBeNull();
    expect(f.session.state!.players[0].liveZone.cardIds).toEqual(['old-live']);
  });

  it('uses the actual old and new LIVE indices when other LIVE cards remain', () => {
    const f = startLive(setup({ lives: [live('other', 3), live('old-live')] }), 'LOCAL');
    pay(f.session);
    advanceReveal(f.session, f.setNow);
    choose(f.session, 'old-live');
    expect(f.session.state!.entranceRuntime!.pending!.rinaLiveSwap!.liveIndex).toBe(1);
    ack(f.session);
    choose(f.session, 'bottom');
    advanceSelection(f.session, f.setNow);
    expect(f.session.state!.entranceRuntime!.pending!.rinaLiveSwap!.liveIndex).toBe(1);
    expect(f.session.state!.players[0].liveZone.cardIds).toEqual(['other', 'bottom']);
  });
});
