import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartRequirement,
  type CardInstance,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
import { queryNormalMemberPlay } from '../../src/application/normal-member-play';
import { PL_PB2_012_SPECIAL_PLAY_MODE } from '../../src/application/effects/special-member-play';
import {
  PL_BP8_003_ACTIVATED_WAIT_DISCARD_LOOK_TOP_TWO_ABILITY_ID,
  PL_BP8_003_CONTINUOUS_MUSE_WAITING_RELAY_COST_PLUS_ONE_ABILITY_ID,
  PL_PR_023_AUTO_TURN_THREE_MEMBER_WAITED_GAIN_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  createActivateAbilityCommand,
  createBeginSpecialMemberPlayCommand,
  createConfirmSpecialMemberPlayCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createPublicObjectId } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const ABILITY = PL_BP8_003_ACTIVATED_WAIT_DISCARD_LOOK_TOP_TWO_ABILITY_ID;
const CONTINUOUS = PL_BP8_003_CONTINUOUS_MUSE_WAITING_RELAY_COST_PLUS_ONE_ABILITY_ID;
const CONTINUOUS_TEXT =
  '【常时】存在于自己的舞台的『μ’s』的成员，获得『【常时】待机状态的此成员与『μ’s』的成员换手登场时减少的值，变为此成员的费用加１。』。';
const ACTIVATED_TEXT =
  '【起动】【１回合１次】将此成员变为待机状态，将１张手牌放置入休息室：检视自己的卡组顶的２张卡片。将其中的１张卡片加入手牌，其余的放置入休息室。';

function member(id: string, cardCode = id, options: Partial<MemberCardData> = {}): CardInstance {
  return createCardInstance(
    {
      cardCode,
      name: cardCode,
      cardType: CardType.MEMBER,
      cost: 4,
      blade: 1,
      hearts: [],
      groupNames: ['μ’s'],
      ...options,
    },
    P1,
    id
  );
}

function setup(
  options: {
    sourceCode?: string;
    orientation?: OrientationState;
    emptyHand?: boolean;
    deck?: readonly CardInstance[];
    observer?: boolean;
    relay?: boolean;
    phase?: GamePhase;
    activePlayerIndex?: 0 | 1;
  } = {}
) {
  const source = member('kotori', options.sourceCode ?? 'PL!-bp8-003-SEC', {
    name: '南琴梨（南小鸟）',
  });
  const discard = member('discard');
  const target = member('target', 'any-group-member', { groupNames: ['Aqours'] });
  const liveData: LiveCardData = {
    cardCode: 'any-live',
    name: 'LIVE',
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({}),
  };
  const live = createCardInstance(liveData, P1, 'live');
  const bottom = member('bottom');
  const observer = member('observer', 'PL!-PR-023-PR', { name: '绚濑绘里', cost: 11 });
  const outgoing = member('outgoing');
  const incoming = member('incoming', 'test-incoming', { cost: 10 });
  const energy = Array.from({ length: 12 }, (_, index) =>
    createCardInstance(
      { cardCode: `E-${index}`, name: 'Energy', cardType: CardType.ENERGY },
      P1,
      `energy-${index}`
    )
  );
  const deck = options.deck ?? [target, live, bottom];
  let game = registerCards(
    {
      ...createGameState('bp8-003-kotori', P1, 'P1', P2, 'P2'),
      currentPhase: options.phase ?? GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: options.activePlayerIndex ?? 0,
      waitingPlayerId: null,
    },
    [source, discard, ...deck, observer, outgoing, incoming, ...energy]
  );
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: {
      ...player.hand,
      cardIds: options.emptyHand ? [] : [options.relay ? 'incoming' : 'discard'],
    },
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    energyZone: {
      ...player.energyZone,
      cardIds: energy.map((card) => card.instanceId),
      cardStates: new Map(
        energy.map((card) => [
          card.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
        ])
      ),
    },
    memberSlots: placeCardInSlot(
      player.memberSlots,
      options.relay ? SlotPosition.LEFT : SlotPosition.CENTER,
      'kotori',
      { orientation: options.orientation ?? OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
  }));
  if (options.relay)
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'outgoing', {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
    }));
  if (options.observer)
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'observer', {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
  const session = createGameSession();
  session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
  return { session, source, discard, target, live, bottom };
}

type Scenario = ReturnType<typeof setup>;
function replaceState(s: Scenario, authorityState: GameState) {
  s.session.restoreRuntimeState({
    authorityState,
    currentPublicSeq: s.session.getCurrentPublicEventSeq(),
  });
}
function activate(s: Scenario) {
  const result = s.session.executeCommand(createActivateAbilityCommand(P1, 'kotori', ABILITY));
  expect(result.success, result.error).toBe(true);
}
function confirm(s: Scenario, cardId?: string | null) {
  const result = s.session.executeCommand(
    createConfirmEffectStepCommand(P1, s.session.state!.activeEffect!.id, cardId)
  );
  expect(result.success, result.error).toBe(true);
}
function abilityUses(game: GameState) {
  return game.actionHistory.filter(
    (action) => action.payload.step === 'ABILITY_USE' && action.payload.abilityId === ABILITY
  );
}
function inspectionEvents(game: GameState) {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event) =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        event.fromZone === ZoneType.MAIN_DECK
    );
}
function reactivateSource(game: GameState): GameState {
  return updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'kotori', {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

describe('PL!-bp8-003 费用4「南小鸟」', () => {
  it.each(['SEC', 'R', 'UNSEEN'])(
    'registers two complete independent definitions for %s',
    (rarity) => {
      const definitions = getCardAbilityDefinitionsForCardCode(`PL!-bp8-003-${rarity}`);
      expect(definitions).toHaveLength(2);
      expect(definitions.find((definition) => definition.abilityId === CONTINUOUS)).toMatchObject({
        baseCardCodes: ['PL!-bp8-003'],
        category: CardAbilityCategory.CONTINUOUS,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        queued: false,
        implemented: true,
        effectText: CONTINUOUS_TEXT,
      });
      expect(definitions.find((definition) => definition.abilityId === ABILITY)).toMatchObject({
        baseCardCodes: ['PL!-bp8-003'],
        category: CardAbilityCategory.ACTIVATED,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        queued: false,
        implemented: true,
        requiredSourceOrientation: OrientationState.ACTIVE,
        perTurnLimit: 1,
        effectText: ACTIVATED_TEXT,
        activatedUi: { text: ACTIVATED_TEXT },
      });
      expect(definitions.every((definition) => definition.cardCodes === undefined)).toBe(true);
    }
  );

  it('declines activation without waiting, discarding or consuming the per-turn use', () => {
    const s = setup();
    activate(s);
    expect(s.session.state?.activeEffect).toMatchObject({
      effectText: ACTIVATED_TEXT,
      selectableCardIds: ['discard'],
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    confirm(s, null);
    expect(s.session.state?.activeEffect).toBeNull();
    expect(s.session.state?.players[0].memberSlots.cardStates.get('kotori')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(s.session.state?.players[0].hand.cardIds).toEqual(['discard']);
    expect(abilityUses(s.session.state!)).toEqual([]);
    expect(s.session.state?.eventLog).toEqual([]);
    activate(s);
  });

  it.each([
    { emptyHand: true },
    { orientation: OrientationState.WAITING },
    { sourceCode: 'PL!-bp8-004-SEC' },
    { phase: GamePhase.ENERGY_PHASE },
    { activePlayerIndex: 1 as const },
  ])('rejects an illegal or unpaid activation atomically: %o', (options) => {
    const s = setup(options);
    const before = s.session.state;
    expect(
      s.session.executeCommand(createActivateAbilityCommand(P1, 'kotori', ABILITY)).success
    ).toBe(false);
    expect(s.session.state).toBe(before);
  });

  it('rejects illegal and stale hand choices before either cost is paid', () => {
    const s = setup();
    activate(s);
    const started = s.session.state!;
    expect(
      s.session.executeCommand(
        createConfirmEffectStepCommand(P1, started.activeEffect!.id, 'target')
      ).success
    ).toBe(false);
    expect(s.session.state).toBe(started);
    replaceState(
      s,
      updatePlayer(started, P1, (player) => ({ ...player, hand: { ...player.hand, cardIds: [] } }))
    );
    expect(
      s.session.executeCommand(
        createConfirmEffectStepCommand(P1, started.activeEffect!.id, 'discard')
      ).success
    ).toBe(false);
    expect(s.session.state?.players[0].memberSlots.cardStates.get('kotori')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(abilityUses(s.session.state!)).toEqual([]);
    expect(s.session.state?.eventLog).toEqual([]);
  });

  it.each(['leave', 'wait', 'reenter'] as const)(
    'abandons an unpaid stale source without touching its new object: %s',
    (change) => {
      const s = setup();
      activate(s);
      let game = s.session.state!;
      if (change === 'leave')
        game = updatePlayer(game, P1, (player) => ({
          ...player,
          memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        }));
      if (change === 'wait')
        game = updatePlayer(game, P1, (player) => ({
          ...player,
          memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'kotori', {
            orientation: OrientationState.WAITING,
            face: FaceState.FACE_UP,
          }),
        }));
      if (change === 'reenter')
        game = emitGameEvent(
          reactivateSource(game),
          createEnterStageEvent('kotori', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
        );
      replaceState(s, game);
      confirm(s, 'discard');
      expect(s.session.state?.activeEffect).toBeNull();
      expect(s.session.state?.players[0].hand.cardIds).toEqual(['discard']);
      expect(abilityUses(s.session.state!)).toEqual([]);
      if (change === 'reenter')
        expect(s.session.state?.players[0].memberSlots.cardStates.get('kotori')?.orientation).toBe(
          OrientationState.ACTIVE
        );
    }
  );

  it.each(['target', 'live'])(
    'pays both costs, privately inspects exactly two and must take one arbitrary %s',
    (selectedId) => {
      const s = setup({ observer: true, sourceCode: 'PL!-bp8-003-UNSEEN' });
      activate(s);
      confirm(s, 'discard');
      const paid = s.session.state!;
      expect(paid.players[0].memberSlots.cardStates.get('kotori')?.orientation).toBe(
        OrientationState.WAITING
      );
      expect(paid.players[0].waitingRoom.cardIds).toEqual(['discard']);
      expect(paid.players[0].mainDeck.cardIds).toEqual(['bottom']);
      expect(paid.activeEffect).toMatchObject({
        effectText: ACTIVATED_TEXT,
        inspectionCardIds: ['target', 'live'],
        selectableCardIds: ['target', 'live'],
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
      });
      expect(paid.inspectionZone.revealedCardIds).toEqual([]);
      expect(abilityUses(paid)).toHaveLength(1);
      expect(
        paid.eventLog
          .map((entry) => entry.event)
          .filter((event) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)
      ).toEqual([
        expect.objectContaining({
          cardInstanceId: 'kotori',
          previousOrientation: OrientationState.ACTIVE,
          nextOrientation: OrientationState.WAITING,
        }),
      ]);
      expect(
        paid.eventLog
          .map((entry) => entry.event)
          .filter((event) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM)
      ).toEqual([
        expect.objectContaining({
          cardInstanceIds: ['discard'],
          fromZone: ZoneType.HAND,
          toZone: ZoneType.WAITING_ROOM,
        }),
      ]);
      expect(
        paid.pendingAbilities.some(
          (ability) =>
            ability.abilityId === PL_PR_023_AUTO_TURN_THREE_MEMBER_WAITED_GAIN_BLADE_ABILITY_ID
        )
      ).toBe(true);
      for (const playerId of [P1, P2]) {
        const view = s.session.getPlayerViewState(playerId)!;
        for (const id of ['target', 'live'])
          expect(view.objects[createPublicObjectId(id)]?.surface).toBe(
            playerId === P1 ? 'FRONT' : 'BACK'
          );
      }
      expect(
        s.session.executeCommand(createConfirmEffectStepCommand(P1, paid.activeEffect!.id, null))
          .success
      ).toBe(false);
      expect(s.session.state).toBe(paid);
      confirm(s, selectedId);
      const done = s.session.state!;
      const restId = selectedId === 'target' ? 'live' : 'target';
      expect(done.activeEffect).toBeNull();
      expect(done.players[0].hand.cardIds).toEqual([selectedId]);
      expect(done.players[0].waitingRoom.cardIds).toEqual(['discard', restId]);
      expect(done.inspectionZone.cardIds).toEqual([]);
      expect(inspectionEvents(done)).toEqual([
        expect.objectContaining({
          cardInstanceIds: [restId],
          fromZone: ZoneType.MAIN_DECK,
          toZone: ZoneType.WAITING_ROOM,
        }),
      ]);
      expect(done.pendingAbilities).toEqual([]);
      const finish = done.actionHistory.findIndex(
        (action) => action.payload.abilityId === ABILITY && action.payload.step === 'FINISH'
      );
      const observer = done.actionHistory.findIndex(
        (action) => action.payload.step === 'MEMBER_WAITED_GAIN_ONE_BLADE'
      );
      expect(observer).toBeGreaterThan(finish);
      expect(
        s.session.getPlayerViewState(P2)?.objects[createPublicObjectId(selectedId)]
      ).toBeUndefined();
    }
  );

  it('rejects a stale inspected target without refunding paid costs or taking another card', () => {
    const s = setup();
    activate(s);
    confirm(s, 'discard');
    const paid = s.session.state!;
    replaceState(s, { ...paid, inspectionZone: { ...paid.inspectionZone, cardIds: ['live'] } });
    const before = s.session.state;
    expect(
      s.session.executeCommand(createConfirmEffectStepCommand(P1, paid.activeEffect!.id, 'target'))
        .success
    ).toBe(false);
    expect(s.session.state).toBe(before);
    expect(s.session.state?.players[0].memberSlots.cardStates.get('kotori')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(s.session.state?.players[0].waitingRoom.cardIds).toEqual(['discard']);
    expect(abilityUses(s.session.state!)).toHaveLength(1);
    confirm(s, 'live');
  });

  it('keeps payment and per-turn consumption when inspection disappears before a stale selection', () => {
    const s = setup();
    activate(s);
    confirm(s, 'discard');
    const paid = s.session.state!;
    replaceState(s, { ...paid, inspectionZone: { ...paid.inspectionZone, cardIds: [] } });
    expect(
      s.session.executeCommand(createConfirmEffectStepCommand(P1, paid.activeEffect!.id, 'target'))
        .success
    ).toBe(false);
    expect(s.session.state?.players[0].memberSlots.cardStates.get('kotori')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(s.session.state?.players[0].waitingRoom.cardIds).toEqual(['discard']);
    expect(abilityUses(s.session.state!)).toHaveLength(1);
  });

  it('uses ordinary deck refresh after payment and never refunds its orientation or turn use', () => {
    const s = setup({ deck: [] });
    activate(s);
    confirm(s, 'discard');
    expect(s.session.state?.activeEffect?.inspectionCardIds).toEqual(['discard']);
    expect(s.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(abilityUses(s.session.state!)).toHaveLength(1);
    confirm(s, 'discard');
    expect(s.session.state?.players[0].hand.cardIds).toEqual(['discard']);
    expect(s.session.state?.players[0].memberSlots.cardStates.get('kotori')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(s.session.state?.activeEffect).toBeNull();
  });

  it('uses one turn allowance per lifecycle, preserving it across orientation and resetting on next turn or re-entry', () => {
    const s = setup();
    const initialTurn = s.session.state!.turnCount;
    activate(s);
    confirm(s, 'discard');
    confirm(s, 'target');
    replaceState(s, reactivateSource(s.session.state!));
    expect(
      s.session.executeCommand(createActivateAbilityCommand(P1, 'kotori', ABILITY)).success
    ).toBe(false);
    replaceState(s, { ...s.session.state!, turnCount: s.session.state!.turnCount + 1 });
    activate(s);
    confirm(s, null);
    replaceState(s, { ...s.session.state!, turnCount: initialTurn });
    replaceState(
      s,
      emitGameEvent(
        reactivateSource(s.session.state!),
        createEnterStageEvent('kotori', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
      )
    );
    activate(s);
    confirm(s, 'target');
    const inspected = s.session.state!.activeEffect!.selectableCardIds!;
    confirm(s, inspected[0]);
    const uses = abilityUses(s.session.state!);
    expect(uses).toHaveLength(2);
    expect(uses[0]?.payload.sourceLifecycleId).not.toBe(uses[1]?.payload.sourceLifecycleId);
  });

  it.each([4, -2, 7])(
    'plays through RULES with effective cost %s, changed reduction and unchanged entry provenance',
    (effectiveCost) => {
      const s = setup({ relay: true });
      const game = s.session.state!;
      replaceState(s, {
        ...game,
        liveResolution: {
          ...game.liveResolution,
          liveModifiers: [
            {
              kind: 'MEMBER_COST_SET',
              playerId: P1,
              memberCardId: 'outgoing',
              sourceCardId: 'outgoing',
              abilityId: 'test:effective-cost',
              setTo: effectiveCost,
            },
          ],
        },
      });
      expect(getMemberEffectiveCost(s.session.state!, P1, 'outgoing')).toBe(effectiveCost);
      const query = queryNormalMemberPlay(s.session.state!, {
        playerId: P1,
        cardId: 'incoming',
        targetSlot: SlotPosition.CENTER,
        relayMode: 'SINGLE',
      });
      expect(query.ok).toBe(true);
      if (!query.ok) throw new Error(query.reason);
      expect(query.plan).toMatchObject({
        relayDiscount: effectiveCost + 1,
        actualEnergyCost: 9 - effectiveCost,
      });
      const result = s.session.executeCommand(
        createPlayMemberToSlotCommand(P1, 'incoming', SlotPosition.CENTER, { relayMode: 'SINGLE' })
      );
      expect(result.success, result.error).toBe(true);
      const done = s.session.state!;
      expect(done.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe('incoming');
      expect(done.players[0].waitingRoom.cardIds).toContain('outgoing');
      expect(
        [...done.players[0].energyZone.cardStates.values()].filter(
          (state) => state.orientation === OrientationState.WAITING
        )
      ).toHaveLength(9 - effectiveCost);
      expect(
        done.eventLog
          .map((entry) => entry.event)
          .find(
            (event) =>
              event.eventType === TriggerCondition.ON_ENTER_STAGE &&
              event.cardInstanceId === 'incoming'
          )
      ).toMatchObject({
        replacedMemberEffectiveCost: effectiveCost,
        relayReplacements: [{ cardId: 'outgoing', slot: SlotPosition.CENTER, effectiveCost }],
      });
    }
  );

  it('removes the granted reduction dynamically when its last source leaves the stage', () => {
    const s = setup({ relay: true });
    const input = {
      playerId: P1,
      cardId: 'incoming',
      targetSlot: SlotPosition.CENTER,
      relayMode: 'SINGLE' as const,
    };
    const before = queryNormalMemberPlay(s.session.state!, input);
    expect(before.ok && before.plan.actualEnergyCost).toBe(5);
    replaceState(
      s,
      updatePlayer(s.session.state!, P1, (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
        waitingRoom: { ...player.waitingRoom, cardIds: ['kotori'] },
      }))
    );
    const after = queryNormalMemberPlay(s.session.state!, input);
    expect(after.ok && after.plan.actualEnergyCost).toBe(6);
  });

  it.each(['active', 'outgoing-group', 'incoming-group'] as const)(
    'does not grant the reduction through real RULES play when %s fails',
    (condition) => {
      const s = setup({ relay: true });
      let game = registerCards(s.session.state!, [
        member('outgoing', 'outgoing', {
          groupNames: condition === 'outgoing-group' ? ['Aqours'] : ['μ’s'],
        }),
        member('incoming', 'incoming', {
          cost: 10,
          groupNames: condition === 'incoming-group' ? ['Liella!'] : ['μ’s'],
        }),
      ]);
      if (condition === 'active')
        game = updatePlayer(game, P1, (player) => ({
          ...player,
          memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'outgoing', {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        }));
      replaceState(s, game);
      const result = s.session.executeCommand(
        createPlayMemberToSlotCommand(P1, 'incoming', SlotPosition.CENTER, { relayMode: 'SINGLE' })
      );
      expect(result.success, result.error).toBe(true);
      expect(
        [...s.session.state!.players[0].energyZone.cardStates.values()].filter(
          (state) => state.orientation === OrientationState.WAITING
        )
      ).toHaveLength(6);
    }
  );

  it('uses the replacement for both members during a real double-relay play', () => {
    const s = setup({ relay: true });
    let game = registerCards(s.session.state!, [
      member('incoming', 'PL!-pb2-000-UNSEEN', { cost: 15 }),
      member('second-outgoing', 'second-outgoing', { cost: 3 }),
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, 'second-outgoing', {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
    }));
    replaceState(s, game);
    const result = s.session.executeCommand(
      createPlayMemberToSlotCommand(P1, 'incoming', SlotPosition.CENTER, {
        relayMode: 'DOUBLE',
        relayReplacementSlots: [SlotPosition.CENTER, SlotPosition.RIGHT],
      })
    );
    expect(result.success, result.error).toBe(true);
    const done = s.session.state!;
    expect(
      [...done.players[0].energyZone.cardStates.values()].filter(
        (state) => state.orientation === OrientationState.WAITING
      )
    ).toHaveLength(6);
    expect(done.players[0].waitingRoom.cardIds).toEqual(['outgoing', 'second-outgoing']);
    expect(
      done.eventLog
        .map((entry) => entry.event)
        .find(
          (event) =>
            event.eventType === TriggerCondition.ON_ENTER_STAGE &&
            event.cardInstanceId === 'incoming'
        )
    ).toMatchObject({
      relayReplacements: [
        { cardId: 'outgoing', effectiveCost: 4 },
        { cardId: 'second-outgoing', effectiveCost: 3 },
      ],
    });
  });

  it.each(['RULES', 'FREE'] as const)(
    'keeps special-play reduction accurate in %s and preserves FREE energy exemption',
    (mode) => {
      const s = setup({ relay: true });
      let game = registerCards(s.session.state!, [
        member('kotori', 'PL!-bp8-003-SEC', { name: '南ことり', unitName: 'Printemps' }),
        member('outgoing', 'outgoing', { name: '小泉花陽', unitName: 'Printemps' }),
        member('incoming', 'PL!-pb2-012-P+', { name: '南ことり', cost: 13, unitName: 'Printemps' }),
      ]);
      game = updatePlayer(game, P1, (player) => ({
        ...player,
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'outgoing', {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      }));
      replaceState(s, { ...game, manualOperationMode: mode });
      const begin = s.session.executeCommand(
        createBeginSpecialMemberPlayCommand(
          P1,
          'incoming',
          SlotPosition.CENTER,
          PL_PB2_012_SPECIAL_PLAY_MODE
        )
      );
      expect(begin.success, begin.error).toBe(true);
      const play = s.session.executeCommand(
        createConfirmSpecialMemberPlayCommand(P1, s.session.state!.pendingSpecialMemberPlay!.id, [
          'kotori',
          'outgoing',
        ])
      );
      expect(play.success, play.error).toBe(true);
      const done = s.session.state!;
      expect(done.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe('incoming');
      expect(done.players[0].memberSlots.cardStates.get('kotori')?.orientation).toBe(
        OrientationState.WAITING
      );
      expect(
        [...done.players[0].energyZone.cardStates.values()].filter(
          (state) => state.orientation === OrientationState.WAITING
        )
      ).toHaveLength(mode === 'FREE' ? 0 : 6);
      expect(
        done.actionHistory.find(
          (action) =>
            action.type === 'SPECIAL_MEMBER_PLAY' &&
            action.payload.step === 'WAIT_TWO_PRINTEMPS_AND_PLAY'
        )?.payload
      ).toMatchObject({
        relayDiscount: 5,
        relayReplacements: [{ cardId: 'outgoing', effectiveCost: 4 }],
        paidEnergyCount: mode === 'FREE' ? 0 : 6,
      });
    }
  );
});
