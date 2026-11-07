import { projectPlayerViewState } from '../../src/online/projector';
import { createGameSession } from '../../src/application/game-session';
import {
  createConfirmEffectStepCommand,
  createAutoAdvancePublicCardSelectionCommand,
} from '../../src/application/game-commands';
import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  type CardInstance,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  addAction,
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createEnterLiveZoneEvent,
  createEnterStageEvent,
  createLiveStartEvent,
  createLiveSuccessEvent,
  createEnterWaitingRoomEvent,
} from '../../src/domain/events/game-events';
import {
  addLiveModifier,
  getLiveCardScoreModifier,
  getMemberEffectiveBladeCount,
  getMemberEffectiveHeartIcons,
  removeStageMemberBoundLiveModifiers,
} from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
  enqueueTriggeredCardEffects,
} from '../../src/application/card-effect-runner';
import * as IDs from '../../src/application/card-effects/ability-ids';
import { countOpponentStageMembersWithDifferentName } from '../../src/application/effects/opponent-different-name-members';
import {
  createNovember07DraftCard,
  getNovember07LiveData,
} from '../helpers/november-07-draft-effects';

const P1 = 'p1',
  P2 = 'p2';
const FRIENDSHIP = IDs.PL_BP8_019_LIVE_START_TURN_LIVE_ENTRY_AT_MOST_ONE_GAIN_SCORE_ABILITY_ID;
const DEEP = IDs.HS_AD2_004_LIVE_START_GREEN_BLUE_MEMBERS_GAIN_SCORE_ABILITY_ID;
const LIBRARY = IDs.HS_BP8_019_LIVE_START_CERISE_DECK_THIRTY_FIVE_GAIN_SCORE_ABILITY_ID;
const RECYCLE = IDs.HS_BP8_019_LIVE_START_PAY_ENERGY_RECYCLE_LOW_COST_MEMBERS_ABILITY_ID;
const SUNNY =
  IDs.PL_BP8_024_LIVE_START_TARGET_MUSE_GAIN_BLADE_PER_DIFFERENT_OPPONENT_NAME_ABILITY_ID;
const FRIEND = IDs.HS_BP8_022_LIVE_START_OPPONENT_DRAW_TARGET_MIRAKURA_GAIN_PINK_HEART_ABILITY_ID;
const RECOVER = IDs.HS_BP8_022_LIVE_SUCCESS_RECOVER_HASUNOSORA_LIVE_ABILITY_ID;
const face = { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE };
function member(id: string, owner = P1, patch: Partial<MemberCardData> = {}): CardInstance {
  return createCardInstance(
    {
      cardCode: `TEST-${id}`,
      name: id,
      cardType: CardType.MEMBER,
      cost: 10,
      blade: 1,
      hearts: [],
      ...patch,
    },
    owner,
    id
  );
}
function setup(code: string, own: CardInstance[] = [], opponents: CardInstance[] = []) {
  const live = createNovember07DraftCard(code, P1, 'live');
  let game = registerCards(createGameState('nov07-B', P1, 'P1', P2, 'P2'), [
    live,
    ...own,
    ...opponents,
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    liveZone: addCardToStatefulZone(p.liveZone, 'live', face),
  }));
  for (const [pid, members] of [
    [P1, own],
    [P2, opponents],
  ] as const) {
    game = updatePlayer(game, pid, (p) => {
      let slots = p.memberSlots;
      members.forEach((card, index) => {
        slots = placeCardInSlot(
          slots,
          [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index],
          card.instanceId,
          face
        );
      });
      return { ...p, memberSlots: slots };
    });
  }
  return game;
}
function pending(game: GameState, abilityId: string, sourceCardId = 'live') {
  const event = createLiveStartEvent(P1, [sourceCardId]);
  const state = emitGameEvent(game, event);
  return {
    ...state,
    pendingAbilities: [
      ...state.pendingAbilities,
      {
        id: `${abilityId}:pending`,
        abilityId,
        sourceCardId,
        controllerId: P1,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_START,
        eventIds: [event.eventId],
      },
    ],
  };
}
function run(game: GameState) {
  return resolvePendingCardEffects(game).gameState;
}
function confirm(
  game: GameState,
  id?: string | null,
  option?: string,
  ordered?: boolean,
  ids?: string[]
) {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    id,
    undefined,
    ordered,
    option,
    ids
  );
}
/** Matches the UI's existing immediate-card path: no ordered draft or card-plus-option choice. */
function expectDirectCardSubmissionWindow(game: GameState, ids: readonly string[]) {
  const effect = projectPlayerViewState(game, P1).activeEffect!;
  expect(effect.selectableObjectIds).toEqual(ids.map((id) => `obj_${id}`));
  expect(effect.selectableObjectMode).not.toBe('ORDERED_MULTI');
  expect(effect.selectableOptions ?? []).toEqual([]);
  expect(effect.effectChoice).toBeUndefined();
  expect(effect.canSkipSelection).toBe(false);
}
function submitSingleCardCommand(game: GameState, cardId: string): GameState {
  const session = createGameSession();
  session.restoreRuntimeState({
    authorityState: { ...game, isStarted: true },
    currentPublicSeq: 0,
  });
  const view = session.getPlayerViewState(P1)!.activeEffect!;
  expect(view.selectableObjectMode).not.toBe('ORDERED_MULTI');
  expect(view.selectableOptions ?? []).toEqual([]);
  expect(view.canSkipSelection).toBe(false);
  const result = session.executeCommand(
    createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, cardId)
  );
  expect(result.success, result.error).toBe(true);
  return session.state!;
}
function score(game: GameState) {
  return getLiveCardScoreModifier(game.liveResolution, 'live');
}
function deck(game: GameState, count: number) {
  const cards = Array.from({ length: count }, (_, i) => member(`deck-${i}`));
  return updatePlayer(registerCards(game, cards), P1, (p) => ({
    ...p,
    mainDeck: { ...p.mainDeck, cardIds: cards.map((c) => c.instanceId) },
  }));
}
function waiting(game: GameState, cards: CardInstance[], pid = P1) {
  return updatePlayer(registerCards(game, cards), pid, (p) => ({
    ...p,
    waitingRoom: { ...p.waitingRoom, cardIds: cards.map((c) => c.instanceId) },
  }));
}
function energy(game: GameState, special = false) {
  const cards = ['energy-a', 'energy-b'].map((id) =>
    createCardInstance({ cardCode: id, name: '能量', cardType: CardType.ENERGY }, P1, id)
  );
  let state = updatePlayer(registerCards(game, cards), P1, (p) => ({
    ...p,
    energyZone: cards.reduce((z, c) => addCardToStatefulZone(z, c.instanceId, face), p.energyZone),
  }));
  if (special)
    state = {
      ...state,
      energyActivePhaseSkips: [
        {
          energyCardId: 'energy-b',
          playerId: P1,
          sourceCardId: 'test',
          abilityId: 'test',
        },
      ],
    };
  return state;
}
function sourceReenters(game: GameState) {
  return emitGameEvent(
    game,
    createEnterLiveZoneEvent('live', ZoneType.WAITING_ROOM, P1, P1, FaceState.FACE_UP)
  );
}
function targetReenters(game: GameState, id: string) {
  return emitGameEvent(
    game,
    createEnterStageEvent(id, ZoneType.WAITING_ROOM, SlotPosition.LEFT, P1, P1)
  );
}

describe('November 07 self LIVE scores', () => {
  it.each([0, 1, 2, 3])(
    'friendship counts %i actual entry occurrences at confirmation',
    (count) => {
      let game = setup('PL!-bp8-019');
      for (let i = 0; i < count; i++)
        game = emitGameEvent(
          game,
          createEnterLiveZoneEvent(`entry-${i}`, ZoneType.HAND, P1, P1, FaceState.FACE_DOWN)
        );
      const preview = run(pending(game, FRIENDSHIP));
      expect(score(preview)).toBe(0);
      expect(preview.activeEffect?.effectText).toContain(`卡片${count}张`);
      const result = confirm(preview);
      expect(score(result)).toBe(count <= 1 ? 2 : 0);
      expect(result.liveResolution.playerScores.has(P1)).toBe(false);
    }
  );
  it('friendship rechecks the count after confirm-only opens', () => {
    let game = run(pending(setup('PL!-bp8-019'), FRIENDSHIP));
    for (let i = 0; i < 2; i++)
      game = emitGameEvent(
        game,
        createEnterLiveZoneEvent(`late-${i}`, ZoneType.HAND, P1, P1, FaceState.FACE_UP)
      );
    expect(score(confirm(game))).toBe(0);
  });
  it.each(['PL!-bp8-019', 'PL!HS-ad2-004', 'PL!HS-bp8-019'])(
    'rejects re-entered source object for %s',
    (code) => {
      let game = setup(code, [
        member('both', P1, {
          unitName: 'スリーズブーケ',
          hearts: [
            { color: HeartColor.GREEN, count: 1 },
            { color: HeartColor.BLUE, count: 1 },
          ],
        }),
      ]);
      game = deck(game, 35);
      const id = code === 'PL!-bp8-019' ? FRIENDSHIP : code === 'PL!HS-ad2-004' ? DEEP : LIBRARY;
      const result = confirm(sourceReenters(run(pending(game, id))));
      expect(score(result)).toBe(0);
    }
  );
  it('DEEPNESS requires both effective colors on each top-level member', () => {
    const own = [
      member('green', P1, { hearts: [{ color: HeartColor.GREEN, count: 2 }] }),
      member('blue', P1, { hearts: [{ color: HeartColor.BLUE, count: 2 }] }),
      member('both', P1, {
        hearts: [
          { color: HeartColor.GREEN, count: 1 },
          { color: HeartColor.BLUE, count: 1 },
        ],
      }),
    ];
    expect(score(confirm(run(pending(setup('PL!HS-ad2-004', own), DEEP))))).toBe(1);
  });
  it('DEEPNESS reads original Heart replacement plus temporary bonus and rechecks at confirmation', () => {
    let game = setup('PL!HS-ad2-004', [
      member('target', P1, { hearts: [{ color: HeartColor.PINK, count: 2 }] }),
    ]);
    game = run(pending(game, DEEP));
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: P1,
      memberCardId: 'target',
      color: HeartColor.GREEN,
      sourceCardId: 'test',
      abilityId: 'replace',
    });
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: P1,
      targetMemberCardId: 'target',
      hearts: [{ color: HeartColor.BLUE, count: 1 }],
      sourceCardId: 'test',
      abilityId: 'gain',
    });
    expect(score(confirm(game))).toBe(1);
  });
  it('DEEPNESS ignores waiting-room and lower members while a resting top-level member still holds its Heart', () => {
    const hearts = [
      { color: HeartColor.GREEN, count: 1 },
      { color: HeartColor.BLUE, count: 1 },
    ];
    let game = setup('PL!HS-ad2-004', [member('resting', P1, { hearts })]);
    game = waiting(game, [member('waiting', P1, { hearts })]);
    game = registerCards(game, [member('below', P1, { hearts })]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: {
        ...p.memberSlots,
        cardStates: new Map([
          ...p.memberSlots.cardStates,
          ['resting', { ...face, orientation: OrientationState.WAITING }],
        ]),
        memberBelow: { ...p.memberSlots.memberBelow, [SlotPosition.LEFT]: ['below'] },
      },
    }));
    expect(score(confirm(run(pending(game, DEEP))))).toBe(1);
  });
  it.each([34, 35])('library score checks %i-card boundary and structured unit', (count) => {
    const game = deck(
      setup('PL!HS-bp8-019', [member('cerise', P1, { unitName: 'Cerise Bouquet' })]),
      count
    );
    expect(score(confirm(run(pending(game, LIBRARY))))).toBe(count === 35 ? 2 : 0);
  });
  it('library score needs a current stage Cerise member', () => {
    expect(score(confirm(run(pending(deck(setup('PL!HS-bp8-019'), 35), LIBRARY))))).toBe(0);
  });
});

describe('SUNNY DAY SONG target blade', () => {
  it.each(['PL!-bp8-024-L', 'PL!-bp8-024-SECL'])(
    '%s uses identical all-rarity effects and preserves printed requirements',
    (code) => {
      let game = setup(
        code,
        [member('own', P1, { name: '高坂穂乃果', groupNames: ["μ's"] })],
        [
          member('same', P2, { name: '高坂穗乃果' }),
          member('different1', P2, { name: '星空凛' }),
          member('different2', P2, { name: '星空凛' }),
        ]
      );
      game = run(pending(game, SUNNY));
      expect(getMemberEffectiveBladeCount(game, P1, 'own')).toBe(1);
      expect(game.activeEffect?.selectableCardIds).toEqual(['own']);
      expectDirectCardSubmissionWindow(game, ['own']);
      game = submitSingleCardCommand(game, 'own');
      expect(game.activeEffect).toBeNull();
      expect(getMemberEffectiveBladeCount(game, P1, 'own')).toBe(3);
      const printed = getNovember07LiveData(code).requirements;
      expect(
        printed.colorRequirements.get(code.endsWith('-L') ? HeartColor.YELLOW : HeartColor.BLUE)
      ).toBe(3);
    }
  );
  it('compares structured combination names and aliases without distinct-opponent deduplication', () => {
    const game = setup(
      'PL!-bp8-024',
      [member('own', P1, { name: '高坂穂乃果＆南ことり', groupNames: ["μ's"] })],
      [
        member('same-combo', P2, { name: '南小鸟＆园田海未' }),
        member('different1', P2, { name: '星空凛' }),
        member('different2', P2, { name: '星空凛' }),
      ]
    );
    expect(countOpponentStageMembersWithDifferentName(game, P1, 'own')).toBe(2);
  });
  it('selects target, counts at completion once, allows departed source, and locks bonus', () => {
    let game = setup(
      'PL!-bp8-024',
      [
        member('own1', P1, { name: '高坂穂乃果', groupNames: ["μ's"] }),
        member('own2', P1, { name: '星空凛', groupNames: ["μ's"] }),
      ],
      [member('other', P2, { name: '南ことり' })]
    );
    game = run(pending(game, SUNNY));
    expect(game.activeEffect?.selectableCardIds).toEqual(['own1', 'own2']);
    expectDirectCardSubmissionWindow(game, ['own1', 'own2']);
    game = updatePlayer(game, P1, (p) => ({ ...p, liveZone: { ...p.liveZone, cardIds: [] } }));
    game = updatePlayer(game, P2, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'other2', face),
    }));
    game = registerCards(game, [member('other2', P2, { name: '南ことり' })]);
    game = confirm(game, 'own1');
    expect(getMemberEffectiveBladeCount(game, P1, 'own1')).toBe(3);
    game = updatePlayer(game, P2, (p) => ({
      ...p,
      memberSlots: { ...p.memberSlots, slots: { LEFT: null, CENTER: null, RIGHT: null } },
    }));
    expect(getMemberEffectiveBladeCount(game, P1, 'own1')).toBe(3);
    game = removeStageMemberBoundLiveModifiers(game, ['own1']);
    expect(getMemberEffectiveBladeCount(targetReenters(game, 'own1'), P1, 'own1')).toBe(1);
  });
  it('rejects illegal and re-entered same-ID targets without rewarding the new object', () => {
    const game = run(
      pending(
        setup(
          'PL!-bp8-024',
          [
            member('own1', P1, { groupNames: ["μ's"] }),
            member('own2', P1, { groupNames: ["μ's"] }),
          ],
          [member('opponent', P2)]
        ),
        SUNNY
      )
    );
    expect(confirm(game, 'forged')).toBe(game);
    const result = confirm(targetReenters(game, 'own1'), 'own1');
    expect(getMemberEffectiveBladeCount(result, P1, 'own1')).toBe(1);
    expect(result.activeEffect).toBeNull();
  });
  it('no valid own target or no differently named opponent completes without bonus', () => {
    const empty = run(pending(setup('PL!-bp8-024'), SUNNY));
    expect(empty.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
    expect(confirm(empty).activeEffect).toBeNull();
    const game = run(
      pending(setup('PL!-bp8-024', [member('own', P1, { groupNames: ["μ's"] })]), SUNNY)
    );
    expect(getMemberEffectiveBladeCount(confirm(game, 'own'), P1, 'own')).toBe(1);
  });
});

describe('library optional energy recycle and independent pending order', () => {
  it('skips payment and consumes without moving cards', () => {
    const game = run(
      pending(energy(waiting(setup('PL!HS-bp8-019'), [member('low', P1, { cost: 9 })])), RECYCLE)
    );
    const result = confirm(game, null);
    expect(result.players[0].waitingRoom.cardIds).toEqual(['low']);
    expect(result.activeEffect).toBeNull();
    expect(result.players[0].energyZone.cardStates.get('energy-a')?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });
  it('pays with zero targets and no active energy cleanly finishes', () => {
    const empty = confirm(run(pending(energy(setup('PL!HS-bp8-019')), RECYCLE)), null, 'pay');
    expect(empty.players[0].energyZone.cardStates.get('energy-a')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      empty.eventLog.filter(
        (x) => x.event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      )
    ).toHaveLength(0);
    const noEnergy = run(pending(setup('PL!HS-bp8-019'), RECYCLE));
    expect(noEnergy.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
    expect(confirm(noEnergy).activeEffect).toBeNull();
  });
  it('selects special energy precisely then mixes all cost <=9 MEMBER cards in one batch event', () => {
    let game = waiting(energy(setup('PL!HS-bp8-019'), true), [
      member('nine', P1, { cost: 9 }),
      member('one', P1, { cost: 1 }),
      member('ten', P1, { cost: 10 }),
      createNovember07DraftCard('PL!HS-bp8-022', P1, 'waiting-live'),
    ]);
    game = run(pending(game, RECYCLE));
    expect(game.activeEffect).toMatchObject({
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
    });
    expect(game.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    expect(confirm(game, null, 'forged')).toBe(game);
    game = confirm(game, null, 'pay');
    expect(game.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    expectDirectCardSubmissionWindow(game, ['energy-a', 'energy-b']);
    expect(game.activeEffect?.selectableCardMode).toBe('SINGLE');
    expect(game.players[0].waitingRoom.cardIds).toEqual(['nine', 'one', 'ten', 'waiting-live']);
    expect(game.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    expect(game.players[0].energyZone.cardStates.get('energy-a')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(game.players[0].energyZone.cardStates.get('energy-b')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    const before = game;
    expect(confirm(game, 'wrong')).toBe(before);
    game = submitSingleCardCommand(game, 'energy-b');
    expect(game.activeEffect).toBeNull();
    expect(game.actionHistory.filter((action) => action.type === 'PAY_COST')).toHaveLength(1);
    expect(
      game.actionHistory.find((action) => action.type === 'PAY_COST')?.payload.energyCardIds
    ).toEqual(['energy-b']);
    expect(game.players[0].waitingRoom.cardIds).toEqual(['ten', 'waiting-live']);
    expect(new Set(game.players[0].mainDeck.cardIds)).toEqual(new Set(['nine', 'one']));
    expect(game.players[0].energyZone.cardStates.get('energy-b')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(game.players[0].energyZone.cardStates.get('energy-a')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    const events = game.eventLog.filter(
      (x) => x.event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
    );
    expect(events).toHaveLength(1);
    expect(events[0].event).toMatchObject({
      movedCardIds: expect.arrayContaining(['nine', 'one']),
      cause: { sourceCardId: 'live', abilityId: RECYCLE },
    });
  });
  it.each([true, false])(
    'keeps both LIVE_START abilities independent; recycle first=%s',
    (recycleFirst) => {
      let game = waiting(
        energy(
          deck(setup('PL!HS-bp8-019', [member('cerise', P1, { unitName: 'スリーズブーケ' })]), 34)
        ),
        [member('low', P1, { cost: 9 })]
      );
      game = pending(pending(game, RECYCLE), LIBRARY);
      game = run(game);
      expect(game.activeEffect?.stepId).toBe('SELECT_NEXT_PENDING_ABILITY');
      const first = recycleFirst ? RECYCLE : LIBRARY;
      game = confirm(game, undefined, `${first}:pending`);
      if (recycleFirst) {
        game = confirm(game, null, 'pay');
        game = confirm(game);
      } else {
        expect(game.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
        game = confirm(game);
        expect(game.activeEffect?.stepId).toBe('HS_BP8_019_PAY_ENERGY_RECYCLE');
        game = confirm(game, null, 'pay');
      }
      expect(game.pendingAbilities).toHaveLength(0);
      expect(game.activeEffect).toBeNull();
      expect(game.players[0].mainDeck.cardIds).toHaveLength(35);
      expect(score(game)).toBe(recycleFirst ? 2 : 0);
    }
  );
  it('a real LIVE_START event queues both library paragraphs independently', () => {
    const game = setup('PL!HS-bp8-019');
    const started = emitGameEvent(game, createLiveStartEvent(P1, ['live']));
    const queued = enqueueTriggeredCardEffects(started, [TriggerCondition.ON_LIVE_START]);
    expect(queued.pendingAbilities.map((p) => p.abilityId)).toEqual(
      expect.arrayContaining([RECYCLE, LIBRARY])
    );
    expect(queued.pendingAbilities).toHaveLength(2);
    expect(run(queued).activeEffect?.stepId).toBe('SELECT_NEXT_PENDING_ABILITY');
  });
  it('ordered batch bypasses confirm-only while preserving the real payment interaction', () => {
    let game = waiting(
      energy(
        deck(setup('PL!HS-bp8-019', [member('cerise', P1, { unitName: 'スリーズブーケ' })]), 34)
      ),
      [member('low', P1, { cost: 9 })]
    );
    game = run(pending(pending(game, RECYCLE), LIBRARY));
    game = confirm(game, undefined, undefined, true);
    expect(game.activeEffect?.stepId).toBe('HS_BP8_019_PAY_ENERGY_RECYCLE');
    game = confirm(game, null, 'pay');
    expect(game.activeEffect).toBeNull();
    expect(score(game)).toBe(2);
  });
});

describe('Tomodachi ni nareru basho optional draw and target', () => {
  function scenario(hasTarget = true) {
    const own = hasTarget
      ? [
          member('target', P1, { unitName: 'みらくらぱーく!', cost: 10 }),
          member('too-low', P1, { unitName: 'みらくらぱーく!', cost: 9 }),
        ]
      : [];
    let game = setup('PL!HS-bp8-022', own);
    game = registerCards(game, [member('drawn', P2)]);
    return updatePlayer(game, P2, (p) => ({
      ...p,
      mainDeck: { ...p.mainDeck, cardIds: ['drawn'] },
    }));
  }
  it('declining does not draw or reward; forged option does not advance', () => {
    const game = run(pending(scenario(), FRIEND));
    expect(game.activeEffect).toMatchObject({
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      selectableOptions: [{ id: 'draw', label: '让对方抽1张卡' }],
    });
    expect(confirm(game, null, 'forged')).toBe(game);
    const result = confirm(game, null);
    expect(result.players[1].hand.cardIds).toHaveLength(0);
    expect(result.activeEffect).toBeNull();
  });
  it('draws as an effect before mandatory selection of effective cost>=10 and gives TARGET_MEMBER heart', () => {
    let game = confirm(run(pending(scenario(), FRIEND)), null, 'draw');
    expect(game.players[1].hand.cardIds).toEqual(['drawn']);
    expect(game.activeEffect?.selectableCardIds).toEqual(['target']);
    expectDirectCardSubmissionWindow(game, ['target']);
    expect(game.activeEffect?.canSkipSelection).toBe(false);
    expect(game.actionHistory.some((a) => a.type === 'PAY_COST')).toBe(false);
    expect(confirm(game, 'too-low')).toBe(game);
    game = updatePlayer(game, P1, (p) => ({ ...p, liveZone: { ...p.liveZone, cardIds: [] } }));
    game = submitSingleCardCommand(game, 'target');
    expect(getMemberEffectiveHeartIcons(game, P1, 'target')).toContainEqual({
      color: HeartColor.PINK,
      count: 1,
    });
    expect(game.liveResolution.liveModifiers.find((m) => m.kind === 'HEART')).toMatchObject({
      target: 'TARGET_MEMBER',
      sourceCardId: 'live',
      targetMemberCardId: 'target',
    });
    expect(game.activeEffect).toBeNull();
    game = removeStageMemberBoundLiveModifiers(game, ['target']);
    expect(getMemberEffectiveHeartIcons(targetReenters(game, 'target'), P1, 'target')).toEqual([]);
  });
  it('filters and revalidates effective costs: 9+1 is eligible, 10-1 is excluded', () => {
    let game = scenario();
    game = addLiveModifier(game, {
      kind: 'MEMBER_COST',
      playerId: P1,
      memberCardId: 'too-low',
      countDelta: 1,
    });
    game = addLiveModifier(game, {
      kind: 'MEMBER_COST',
      playerId: P1,
      memberCardId: 'target',
      countDelta: -1,
    });
    game = confirm(run(pending(game, FRIEND)), null, 'draw');
    expect(game.activeEffect?.selectableCardIds).toEqual(['too-low']);
    game = addLiveModifier(game, {
      kind: 'MEMBER_COST',
      playerId: P1,
      memberCardId: 'too-low',
      countDelta: -1,
    });
    game = confirm(game, 'too-low');
    expect(getMemberEffectiveHeartIcons(game, P1, 'too-low')).toEqual([]);
    expect(game.players[1].hand.cardIds).toEqual(['drawn']);
    expect(game.activeEffect).toBeNull();
  });
  it('can draw with no target and does not roll the opponent draw back', () => {
    const game = confirm(run(pending(scenario(false), FRIEND)), null, 'draw');
    expect(game.players[1].hand.cardIds).toEqual(['drawn']);
    expect(game.activeEffect).toBeNull();
  });
  it('refreshes before drawing and records the actual draw', () => {
    let game = waiting(scenario(), [member('waiting-draw1', P2), member('waiting-draw2', P2)], P2);
    game = updatePlayer(game, P2, (p) => ({ ...p, mainDeck: { ...p.mainDeck, cardIds: [] } }));
    game = confirm(run(pending(game, FRIEND)), null, 'draw');
    expect(game.players[1].hand.cardIds).toHaveLength(1);
    expect(game.players[1].mainDeck.cardIds).toHaveLength(1);
    expect(
      game.actionHistory.some((a) => a.type === 'RULE_ACTION' && a.payload.type === 'REFRESH')
    ).toBe(true);
    expect(game.activeEffect?.selectableCardIds).toEqual(['target']);
  });
  it('the chosen draw branch still grants its reward when the opponent has no cards to draw', () => {
    let game = updatePlayer(scenario(), P2, (p) => ({
      ...p,
      mainDeck: { ...p.mainDeck, cardIds: [] },
    }));
    game = confirm(run(pending(game, FRIEND)), null, 'draw');
    expect(game.players[1].hand.cardIds).toEqual([]);
    expect(game.activeEffect?.selectableCardIds).toEqual(['target']);
    game = confirm(game, 'target');
    expect(getMemberEffectiveHeartIcons(game, P1, 'target')).toContainEqual({
      color: HeartColor.PINK,
      count: 1,
    });
  });
  it('stale same-ID target receives nothing while the completed opponent draw remains', () => {
    let game = confirm(run(pending(scenario(), FRIEND)), null, 'draw');
    game = confirm(targetReenters(game, 'target'), 'target');
    expect(game.players[1].hand.cardIds).toEqual(['drawn']);
    expect(getMemberEffectiveHeartIcons(game, P1, 'target')).toEqual([]);
    expect(game.activeEffect).toBeNull();
  });
});

describe('Tomodachi success recovery', () => {
  it('a real successful-LIVE event queues the recovery paragraph', () => {
    const game = emitGameEvent(setup('PL!HS-bp8-022'), createLiveSuccessEvent(P1, ['live'], 3));
    const queued = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_SUCCESS]);
    expect(queued.pendingAbilities.map((p) => p.abilityId)).toEqual([RECOVER]);
  });
  it('requires one Hasunosora LIVE, supports departed source and rehydrates its public selection before moving', () => {
    const eligible = createNovember07DraftCard('PL!HS-ad2-004', P1, 'eligible');
    const other = createNovember07DraftCard('PL!-bp8-019', P1, 'other');
    let game = waiting(setup('PL!HS-bp8-022'), [eligible, other, member('member')]);
    game = updatePlayer(game, P1, (p) => ({ ...p, liveZone: { ...p.liveZone, cardIds: [] } }));
    game = run(pending(game, RECOVER));
    expect(game.activeEffect?.selectableCardIds).toEqual(['eligible']);
    expectDirectCardSubmissionWindow(game, ['eligible']);
    expect(game.activeEffect?.canSkipSelection).toBe(false);
    expect(confirm(game, 'other')).toBe(game);
    let now = 10_000;
    const session = createGameSession({ now: () => now });
    session.restoreRuntimeState({
      authorityState: { ...game, isStarted: true },
      currentPublicSeq: 0,
    });
    const selection = session.executeCommand(
      createConfirmEffectStepCommand(P1, game.activeEffect!.id, 'eligible')
    );
    expect(selection.success, selection.error).toBe(true);
    expect(session.state!.activeEffect?.stepId).toBe('COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION');
    expect(session.state!.players[0].waitingRoom.cardIds).toContain('eligible');
    expect(session.state!.players[0].hand.cardIds).not.toContain('eligible');
    expect(session.state!.activeEffect?.revealedCardIds).toEqual(['eligible']);
    const deadline = session.state!.activeEffect!.publicCardSelectionAutoAdvanceAt!;
    session.restoreRuntimeState({
      authorityState: structuredClone(session.state!),
      currentPublicSeq: 0,
    });
    now = deadline;
    const auto = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(P2, session.state!.activeEffect!.id, deadline)
    );
    expect(auto.success, auto.error).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toContain('eligible');
    expect(session.state!.players[0].waitingRoom.cardIds).not.toContain('eligible');
    expect(session.state!.activeEffect).toBeNull();
  });
  it('a public selected card that leaves and re-enters the waiting room is not the old selected object', () => {
    const eligible = createNovember07DraftCard('PL!HS-ad2-004', P1, 'eligible');
    let game = run(pending(waiting(setup('PL!HS-bp8-022'), [eligible]), RECOVER));
    game = confirm(game, 'eligible');
    expect(game.activeEffect?.stepId).toBe('COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION');
    game = emitGameEvent(game, createEnterWaitingRoomEvent(['eligible'], ZoneType.HAND, P1, P1));
    game = confirm(structuredClone(game));
    expect(game.players[0].waitingRoom.cardIds).toContain('eligible');
    expect(game.players[0].hand.cardIds).not.toContain('eligible');
    expect(game.activeEffect).toBeNull();
    expect(game.actionHistory.at(-1)?.payload.step).toBe('STALE_SELECTION_NO_LONGER_ELIGIBLE');
  });
  it('no target shows confirm-only and ordered resolution completes it without another confirm', () => {
    const single = run(pending(setup('PL!HS-bp8-022'), RECOVER));
    expect(single.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
    expect(confirm(single).activeEffect).toBeNull();
    let game = setup('PL!HS-bp8-022');
    game = run(pending(pending(game, RECOVER), FRIEND));
    game = confirm(game, undefined, undefined, true);
    expect(game.activeEffect?.stepId).toBe('HS_BP8_022_OPTIONAL_OPPONENT_DRAW');
    expect(confirm(game, null).activeEffect).toBeNull();
  });
});
