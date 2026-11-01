import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP8_001_ON_ENTER_STACK_ENERGY_SELF_AND_OTHER_NIJIGASAKI_ABILITY_ID as ENTER,
  N_BP8_001_LIVE_SUCCESS_RETURN_ONE_ENERGY_BELOW_DRAW_DISCARD_ABILITY_ID as SUCCESS,
  N_BP7_001_AUTO_TURN_ONCE_ENERGY_PLACED_BELOW_PLACE_WAITING_ENERGY_ABILITY_ID as OLD_AYUMU,
  N_BP8_011_DECK_REFRESH_DRAW_TWO_DISCARD_ONE_ABILITY_ID as MIA_REFRESH,
  SP_BP5_004_AUTO_OWN_EFFECT_MOVE_OR_PLACE_ENERGY_DRAW_RED_HEART_ABILITY_ID as ENERGY_OBSERVER,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getStageMemberLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
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
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent, createLiveSuccessEvent } from '../../src/domain/events/game-events';
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

const P1 = 'player1',
  P2 = 'player2';
const ENTER_TEXT =
  '【登场】将存在于自己的能量区的能量卡，至多各１张放置于此成员和存在于自己的舞台的其他的１名『虹咲』的成员的下方。';
const SUCCESS_TEXT =
  '【LIVE成功时】可以将存在于自己的舞台的１名成员的下方的１张能量卡，以待机状态放置于自己的能量区。如此做时，抽１张卡，将１张手牌放置入休息室。';
const state = { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP };
function member(
  id: string,
  code = id,
  overrides: Partial<MemberCardData> = {},
  ownerId = P1
): CardInstance {
  return createCardInstance(
    {
      cardCode: code,
      name: id,
      cardType: CardType.MEMBER,
      cost: 2,
      blade: 2,
      hearts: [],
      groupNames: ['虹ヶ咲'],
      ...overrides,
    },
    ownerId,
    id
  );
}
function energy(id: string, ownerId = P1): CardInstance {
  return createCardInstance({ cardCode: id, name: id, cardType: CardType.ENERGY }, ownerId, id);
}
function setup(
  options: {
    energyCount?: number;
    belowCount?: number;
    selfBelowCount?: number;
    otherGroup?: string;
    extraCode?: string;
    sourceCode?: string;
    noOther?: boolean;
    special?: readonly number[];
  } = {}
): GameState {
  const source = member('ayumu', options.sourceCode ?? 'PL!N-bp8-001-SEC', { name: '上原步梦' });
  const other = member('other', 'OTHER', { groupNames: [options.otherGroup ?? '虹ヶ咲'] });
  const extra = member('extra', options.extraCode ?? 'EXTRA', { name: '上原步梦' });
  const opponent = member('opponent', 'OPPONENT', {}, P2);
  const zone = Array.from({ length: options.energyCount ?? 2 }, (_, i) => energy(`zone-${i}`));
  const below = Array.from({ length: options.belowCount ?? 0 }, (_, i) => energy(`below-${i}`));
  const selfBelow = Array.from({ length: options.selfBelowCount ?? 0 }, (_, i) =>
    energy(`self-below-${i}`)
  );
  const energyDeck = [energy('energy-deck-0'), energy('energy-deck-1')];
  const deck = [member('deck-0'), member('deck-1'), member('deck-2'), member('deck-3')];
  const waiting = [
    member('waiting-0'),
    member('waiting-1'),
    member('waiting-2'),
    member('waiting-3'),
  ];
  const hand = member('hand');
  const live = createCardInstance(
    {
      cardCode: 'LIVE',
      name: 'LIVE',
      cardType: CardType.LIVE,
      score: 1,
      requirements: createHeartRequirement({}),
    } as LiveCardData,
    P1,
    'live'
  );
  let game = registerCards(
    {
      ...createGameState('n-bp8-001-ayumu', P1, 'P1', P2, 'P2'),
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
      waitingPlayerId: null,
    },
    [
      source,
      other,
      extra,
      opponent,
      ...zone,
      ...below,
      ...selfBelow,
      ...energyDeck,
      ...deck,
      ...waiting,
      hand,
      live,
    ]
  );
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = placeCardInSlot(
      player.memberSlots,
      SlotPosition.CENTER,
      source.instanceId,
      state
    );
    if (!options.noOther)
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, other.instanceId, state);
    if (options.extraCode)
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, extra.instanceId, state);
    return {
      ...player,
      memberSlots: {
        ...memberSlots,
        energyBelow: {
          ...memberSlots.energyBelow,
          [SlotPosition.LEFT]: below.map((card) => card.instanceId),
          [SlotPosition.CENTER]: selfBelow.map((card) => card.instanceId),
        },
      },
      energyZone: zone.reduce(
        (z, card, index) =>
          addCardToStatefulZone(z, card.instanceId, {
            orientation: index % 2 === 0 ? OrientationState.ACTIVE : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
      energyDeck: { ...player.energyDeck, cardIds: energyDeck.map((card) => card.instanceId) },
      hand: { ...player.hand, cardIds: ['hand'] },
      mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId, state),
    };
  });
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [] },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, opponent.instanceId, state),
  }));
  return {
    ...game,
    energyActivePhaseSkips: (options.special ?? []).map((i) => ({
      playerId: P1,
      energyCardId: `zone-${i}`,
      sourceCardId: source.instanceId,
      abilityId: 'special-marker',
    })),
  };
}
function enqueueEnter(game: GameState): GameState {
  const event = createEnterStageEvent('ayumu', ZoneType.HAND, SlotPosition.CENTER, P1, P1);
  return enqueueTriggeredCardEffects(emitGameEvent(game, event), [TriggerCondition.ON_ENTER_STAGE]);
}
function startEnter(game: GameState): GameState {
  return resolvePendingCardEffects(enqueueEnter(game)).gameState;
}
function startSuccess(game: GameState): GameState {
  const event = createLiveSuccessEvent(P1, ['live'], 1);
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(emitGameEvent(game, event), [TriggerCondition.ON_LIVE_SUCCESS])
  ).gameState;
}
function choose(game: GameState, cardId?: string | null, optionId?: string): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, cardId, null, false, optionId);
}
function ruleChoose(game: GameState, cardId?: string | null, optionId?: string): GameState {
  const session = createGameSession();
  session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
  const result = session.executeCommand(
    createConfirmEffectStepCommand(P1, game.activeEffect!.id, cardId, null, false, optionId)
  );
  expect(result.success, result.error).toBe(true);
  return session.state!;
}
function events(game: GameState, type: TriggerCondition) {
  return game.eventLog.map((entry) => entry.event).filter((event) => event.eventType === type);
}
function reenter(game: GameState, id: string, slot: SlotPosition): GameState {
  return emitGameEvent(game, createEnterStageEvent(id, ZoneType.WAITING_ROOM, slot, P1, P1));
}

describe('PL!N-bp8-001 费用2「上原步梦」', () => {
  it.each(['N', 'R', 'P', 'P+', 'SEC', 'SEC+', 'P3'])(
    'covers %s by base code with exact paragraphs and real trigger definitions',
    (rare) => {
      const definitions = getCardAbilityDefinitionsForCardCode(`PL!N-bp8-001-${rare}`);
      expect(definitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            abilityId: ENTER,
            baseCardCodes: ['PL!N-bp8-001'],
            category: CardAbilityCategory.ON_ENTER,
            sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
            triggerCondition: TriggerCondition.ON_ENTER_STAGE,
            queued: true,
            implemented: true,
            effectText: ENTER_TEXT,
          }),
          expect.objectContaining({
            abilityId: SUCCESS,
            baseCardCodes: ['PL!N-bp8-001'],
            category: CardAbilityCategory.LIVE_SUCCESS,
            sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
            triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
            queued: true,
            implemented: true,
            effectText: SUCCESS_TEXT,
          }),
        ])
      );
      const game = startEnter(setup({ sourceCode: `PL!N-bp8-001-${rare}`, energyCount: 1 }));
      expect(
        choose(game, null, 'SELF_ONLY').players[0].memberSlots.energyBelow[SlotPosition.CENTER]
      ).toEqual(['zone-0']);
      const success = startSuccess(setup({ sourceCode: `PL!N-bp8-001-${rare}`, belowCount: 1 }));
      const discard = choose(choose(success, 'other'), 'below-0');
      expect(discard.players[0].energyZone.cardIds).toContain('below-0');
      expect(choose(discard, 'hand').activeEffect).toBeNull();
    }
  );
  it('runs the real RULES play command, then allocation without a synthetic self-card selection', () => {
    let game = setup({ energyCount: 4 });
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [...player.hand.cardIds, 'ayumu'] },
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      energyZone: {
        ...player.energyZone,
        cardStates: new Map(player.energyZone.cardIds.map((id) => [id, state])),
      },
    }));
    const session = createGameSession();
    session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
    const result = session.executeCommand(
      createPlayMemberToSlotCommand(P1, 'ayumu', SlotPosition.CENTER)
    );
    expect(result.success, result.error).toBe(true);
    game = session.state!;
    expect(game.activeEffect?.abilityId).toBe(ENTER);
    expect(game.activeEffect?.selectableCardIds).toBeUndefined();
    expect(game.activeEffect?.canSkipSelection).toBe(true);
    expect(game.activeEffect?.skipSelectionLabel).toBe('不放置');
    expect(game.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    const done = ruleChoose(game, null, 'SELF_AND_OTHER');
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toHaveLength(1);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toHaveLength(1);
    expect(done.players[0].energyZone.cardIds).toHaveLength(2);
    expect(events(done, TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER)).toHaveLength(2);
    expect(events(done, TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER)).toEqual([
      expect.objectContaining({
        targetMemberCardId: 'ayumu',
        energyCardIds: ['zone-0'],
        cause: expect.objectContaining({ abilityId: ENTER, sourceCardId: 'ayumu' }),
      }),
      expect.objectContaining({
        targetMemberCardId: 'other',
        energyCardIds: ['zone-1'],
        cause: expect.objectContaining({ abilityId: ENTER, sourceCardId: 'ayumu' }),
      }),
    ]);
    expect(
      done.actionHistory.filter(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === ENTER
      )
    ).toEqual([]);
  });
  it.each([
    ['SELF_AND_OTHER', 1, 1],
    ['SELF_ONLY', 1, 0],
    ['OTHER_ONLY', 0, 1],
    [null, 0, 0],
  ] as const)(
    'resolves allocation %s with independent 0..1 limits',
    (option, selfCount, otherCount) => {
      const initial = startEnter(setup());
      const done = choose(initial, null, option ?? undefined);
      expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toHaveLength(selfCount);
      expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toHaveLength(otherCount);
      expect(done.players[0].energyZone.cardIds).toHaveLength(2 - selfCount - otherCount);
      expect(done.activeEffect).toBeNull();
    }
  );
  it('filters zero/one-energy allocations, non-Nijigasaki and opposing targets', () => {
    expect(startEnter(setup({ energyCount: 0 })).activeEffect).toBeNull();
    const one = startEnter(setup({ energyCount: 1 }));
    expect(one.activeEffect?.selectableOptions?.map((item) => item.id)).toEqual([
      'SELF_ONLY',
      'OTHER_ONLY',
    ]);
    expect(choose(one, null, 'SELF_AND_OTHER')).toBe(one);
    expect(choose(one, 'opponent')).toBe(one);
    const nonNiji = startEnter(setup({ otherGroup: 'Aqours' }));
    expect(nonNiji.activeEffect?.selectableOptions?.map((item) => item.id)).toEqual(['SELF_ONLY']);
    expect(
      choose(nonNiji, null, 'SELF_ONLY').players[0].memberSlots.energyBelow[SlotPosition.CENTER]
    ).toEqual(['zone-1']);
    const noOther = startEnter(setup({ noOther: true }));
    expect(noOther.activeEffect?.selectableOptions?.map((item) => item.id)).toEqual(['SELF_ONLY']);
  });
  it('asks for another target only when several exist and accepts another same-name member', () => {
    const started = startEnter(setup({ extraCode: 'SAME-NAME-OTHER' }));
    const target = choose(started, null, 'SELF_AND_OTHER');
    expect(target.activeEffect?.selectableCardIds).toEqual(['other', 'extra']);
    expect(target.players[0].energyZone.cardIds).toHaveLength(2);
    expect(choose(target, 'ayumu')).toBe(target);
    expect(choose(target, 'opponent')).toBe(target);
    const done = choose(target, 'extra');
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual(['zone-1']);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.RIGHT]).toEqual(['zone-0']);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([]);
  });
  it('collects exact special-energy selections for each destination and commits both atomically', () => {
    const initial = startEnter(setup({ energyCount: 3, special: [0, 2] }));
    const selfSelection = choose(initial, null, 'SELF_AND_OTHER');
    expect(selfSelection.activeEffect?.stepText).toContain('此成员「上原步梦」');
    expect(selfSelection.players[0].energyZone.cardIds).toHaveLength(3);
    expect(choose(selfSelection, 'missing')).toBe(selfSelection);
    const otherSelection = choose(selfSelection, 'zone-2');
    expect(otherSelection.activeEffect?.stepText).toContain('所选其他成员「other」');
    expect(otherSelection.activeEffect?.selectableCardIds).not.toContain('zone-2');
    expect(otherSelection.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(events(otherSelection, TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER)).toEqual([]);
    expect(choose(otherSelection, 'zone-2')).toBe(otherSelection);
    const done = choose(otherSelection, 'zone-0');
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual(['zone-2']);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual(['zone-0']);
    expect(done.players[0].energyZone.cardIds).toEqual(['zone-1']);
    expect(done.energyActivePhaseSkips).toEqual([]);
    expect(events(done, TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER)).toHaveLength(2);
    expect(
      choose({ ...done, activeEffect: otherSelection.activeEffect }, 'zone-0').players[0].energyZone
        .cardIds
    ).toEqual(['zone-1']);
  });
  it('never transfers a stale self reservation to the other destination or a re-entered source', () => {
    let selection = choose(
      startEnter(setup({ energyCount: 3, special: [0, 2] })),
      null,
      'SELF_AND_OTHER'
    );
    selection = choose(selection, 'zone-2');
    const reentered = reenter(selection, 'ayumu', SlotPosition.CENTER);
    expect(getStageMemberLifecycleId(reentered, 'ayumu')).not.toBe(
      selection.activeEffect?.sourceLifecycleId
    );
    const done = choose(reentered, 'zone-0');
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual(['zone-0']);
    expect(done.players[0].energyZone.cardIds).toEqual(['zone-1', 'zone-2']);
    expect(done.energyActivePhaseSkips?.map((marker) => marker.energyCardId)).toEqual(['zone-2']);
  });
  it('discards a stale destination before its energy choice and keeps the other destination independent', () => {
    const first = choose(
      startEnter(setup({ energyCount: 3, special: [0, 2] })),
      null,
      'SELF_AND_OTHER'
    );
    const selfReentered = reenter(first, 'ayumu', SlotPosition.CENTER);
    const otherSelection = choose(selfReentered, 'zone-2');
    expect(otherSelection.activeEffect?.stepText).toContain('所选其他成员');
    expect(otherSelection.players[0].energyZone.cardIds).toHaveLength(3);
    const onlyOther = choose(otherSelection, 'zone-0');
    expect(onlyOther.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(onlyOther.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual(['zone-0']);
    const second = choose(first, 'zone-2');
    const otherReentered = reenter(second, 'other', SlotPosition.LEFT);
    const onlySelf = choose(otherReentered, 'zone-0');
    expect(onlySelf.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual(['zone-2']);
    expect(onlySelf.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([]);
    expect(events(onlySelf, TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER)).toHaveLength(1);
  });
  it('still offers another member when the captured source has left or re-entered before resolution', () => {
    const queued = enqueueEnter(setup());
    const stale = reenter(queued, 'ayumu', SlotPosition.CENTER);
    const started = resolvePendingCardEffects(stale).gameState;
    expect(started.activeEffect?.selectableOptions?.map((item) => item.id)).toEqual(['OTHER_ONLY']);
    const done = choose(started, null, 'OTHER_ONLY');
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual(['zone-1']);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      queued,
      P1,
      'ayumu',
      enqueueTriggeredCardEffects
    )!.gameState;
    const afterLeave = resolvePendingCardEffects(left).gameState;
    expect(afterLeave.activeEffect?.selectableOptions?.map((item) => item.id)).toEqual([
      'OTHER_ONLY',
    ]);
    expect(
      choose(afterLeave, null, 'OTHER_ONLY').players[0].memberSlots.energyBelow[SlotPosition.LEFT]
    ).toEqual(['zone-1']);
  });
  it('keeps self placement independent of other targets disappearing before selection', () => {
    const target = choose(startEnter(setup({ extraCode: 'ANOTHER-NIJI' })), null, 'SELF_AND_OTHER');
    const stale = updatePlayer(target, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
        SlotPosition.RIGHT
      ),
    }));
    const done = choose(stale, 'other');
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual(['zone-1']);
    expect(done.players[0].energyZone.cardIds).toEqual(['zone-0']);
  });
  it('does not partially place when reserved energy disappears or resources shrink during selection', () => {
    const started = choose(
      startEnter(setup({ energyCount: 3, special: [0, 2] })),
      null,
      'SELF_AND_OTHER'
    );
    const selectedSelf = choose(started, 'zone-2');
    const stale = updatePlayer(selectedSelf, P1, (player) => ({
      ...player,
      energyZone: { ...player.energyZone, cardIds: ['zone-0', 'zone-1'] },
    }));
    const done = choose(stale, 'zone-0');
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([]);
    expect(events(done, TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER)).toEqual([]);
    const zero = updatePlayer(started, P1, (player) => ({
      ...player,
      energyZone: { ...player.energyZone, cardIds: [] },
    }));
    expect(choose(zero, 'zone-0').activeEffect).toBeNull();
  });
  it('queues old bp7 Ayumu once and resolves it after the complete two-placement effect', () => {
    const started = startEnter(setup({ extraCode: 'PL!N-bp7-001-P' }));
    const target = choose(started, null, 'SELF_AND_OTHER');
    const done = choose(target, 'other');
    expect(events(done, TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER)).toHaveLength(2);
    const trigger = done.actionHistory.filter(
      (action) => action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === OLD_AYUMU
    );
    expect(trigger).toHaveLength(1);
    const finishIndex = done.actionHistory.findIndex(
      (action) =>
        action.payload.abilityId === ENTER && action.payload.step === 'STACK_ENERGY_BELOW_MEMBERS'
    );
    const oldResolveIndex = done.actionHistory.findIndex(
      (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === OLD_AYUMU
    );
    expect(oldResolveIndex).toBeGreaterThan(finishIndex);
    expect(done.players[0].energyZone.cardIds).toEqual(['energy-deck-0']);
    expect(done.players[0].energyZone.cardStates.get('energy-deck-0')?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('LIVE success selects exactly one energy under any own top-level member, then draws/discards through RULES', () => {
    const started = startSuccess(
      setup({
        belowCount: 3,
        selfBelowCount: 1,
        otherGroup: 'Aqours',
        energyCount: 1,
        special: [0],
      })
    );
    expect(started.activeEffect?.abilityId).toBe(SUCCESS);
    expect(started.activeEffect?.selectableCardIds).toEqual(['other', 'ayumu']);
    const selected = ruleChoose(started, 'other');
    expect(selected.activeEffect?.selectableCardIds).toEqual(['below-0', 'below-1', 'below-2']);
    const discard = ruleChoose(selected, 'below-1');
    expect(discard.activeEffect?.stepId).toBe('N_BP8_001_DISCARD_AFTER_RETURN_ENERGY');
    expect(discard.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([
      'below-0',
      'below-2',
    ]);
    expect(discard.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      'self-below-0',
    ]);
    expect(discard.players[0].energyZone.cardIds).toEqual(['zone-0', 'below-1']);
    expect(discard.players[0].energyZone.cardStates.get('below-1')).toEqual({
      orientation: OrientationState.WAITING,
      face: FaceState.FACE_UP,
    });
    expect(discard.energyActivePhaseSkips).toEqual(started.energyActivePhaseSkips);
    expect(discard.players[0].hand.cardIds).toEqual(['hand', 'deck-0']);
    const done = ruleChoose(discard, 'deck-0');
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].waitingRoom.cardIds).toEqual(['deck-0']);
    expect(events(done, TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT)).toEqual([
      expect.objectContaining({
        placedEnergyCardIds: ['below-1'],
        orientation: OrientationState.WAITING,
        cause: expect.objectContaining({ abilityId: SUCCESS, sourceCardId: 'ayumu' }),
      }),
    ]);
    expect(events(done, TriggerCondition.ON_ENTER_WAITING_ROOM)).toEqual([
      expect.objectContaining({
        cardInstanceIds: ['deck-0'],
        fromZone: ZoneType.HAND,
        toZone: ZoneType.WAITING_ROOM,
      }),
    ]);
    expect(
      done.actionHistory.filter(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === SUCCESS
      )
    ).toEqual([]);
    const duplicate = choose({ ...done, activeEffect: selected.activeEffect }, 'below-1');
    expect(duplicate.players[0].hand.cardIds).toEqual(done.players[0].hand.cardIds);
    expect(events(duplicate, TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT)).toHaveLength(1);
  });
  it('LIVE success skips/no-target never draw and invalid or stale energy cannot move or draw', () => {
    const initial = startSuccess(setup({ belowCount: 2 }));
    const declined = choose(initial);
    expect(declined.players[0].hand.cardIds).toEqual(['hand']);
    expect(events(declined, TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT)).toEqual([]);
    const target = choose(initial, 'other');
    expect(choose(target, 'zone-0')).toBe(target);
    const skipped = choose(target);
    expect(skipped.players[0].hand.cardIds).toEqual(['hand']);
    const staleEnergy = updatePlayer(target, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        energyBelow: { ...player.memberSlots.energyBelow, [SlotPosition.LEFT]: ['below-1'] },
      },
    }));
    const done = choose(staleEnergy, 'below-0');
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].hand.cardIds).toEqual(['hand']);
    expect(events(done, TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT)).toEqual([]);
    let noTarget = startSuccess(setup());
    expect(noTarget.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    noTarget = choose(noTarget);
    expect(noTarget.activeEffect).toBeNull();
    expect(noTarget.players[0].hand.cardIds).toEqual(['hand']);
  });
  it('LIVE success excludes opponents and members below the stage from target selection', () => {
    let game = setup({ belowCount: 2 });
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(player.memberSlots, SlotPosition.CENTER, 'extra'),
    }));
    const started = startSuccess(game);
    expect(started.activeEffect?.selectableCardIds).toEqual(['other']);
    expect(choose(started, 'opponent')).toBe(started);
    expect(choose(started, 'extra')).toBe(started);
  });
  it('LIVE success rejects re-entered target and allows a same-lifecycle slot move', () => {
    const target = choose(startSuccess(setup({ belowCount: 2 })), 'other');
    const stale = choose(reenter(target, 'other', SlotPosition.LEFT), 'below-0');
    expect(stale.players[0].hand.cardIds).toEqual(['hand']);
    expect(events(stale, TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT)).toEqual([]);
    const moved = updatePlayer(target, P1, (player) => {
      const memberSlots = placeCardInSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
        SlotPosition.RIGHT,
        'other',
        state
      );
      return {
        ...player,
        memberSlots: {
          ...memberSlots,
          energyBelow: { ...memberSlots.energyBelow, [SlotPosition.RIGHT]: ['below-0', 'below-1'] },
        },
      };
    });
    const discard = choose(moved, 'below-1');
    expect(discard.players[0].energyZone.cardIds).toContain('below-1');
    expect(discard.players[0].memberSlots.energyBelow[SlotPosition.RIGHT]).toEqual(['below-0']);
  });
  it('LIVE success continues its independent move/draw after the source leaves', () => {
    let game = startSuccess(setup({ belowCount: 1 }));
    game = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      game,
      P1,
      'ayumu',
      enqueueTriggeredCardEffects
    )!.gameState;
    const discard = choose(choose(game, 'other'), 'below-0');
    expect(discard.players[0].energyZone.cardIds).toContain('below-0');
    expect(discard.players[0].hand.cardIds).toEqual(['hand', 'deck-0']);
    expect(discard.players[0].waitingRoom.cardIds).toContain('ayumu');
    expect(choose(discard, 'hand').activeEffect).toBeNull();
  });
  it('energy-placement observers stay pending until the required discard finishes', () => {
    const started = startSuccess(setup({ belowCount: 1, extraCode: 'PL!SP-bp5-004-P' }));
    const discard = choose(choose(started, 'other'), 'below-0');
    expect(discard.activeEffect?.abilityId).toBe(SUCCESS);
    expect(discard.pendingAbilities.some((ability) => ability.abilityId === ENERGY_OBSERVER)).toBe(
      true
    );
    expect(discard.players[0].hand.cardIds).toEqual(['hand', 'deck-0']);
    const continued = choose(discard, 'hand');
    expect(continued.activeEffect).toBeNull();
    expect(continued.players[0].hand.cardIds).toEqual(['deck-0', 'deck-1']);
    const discardIndex = continued.actionHistory.findIndex(
      (action) =>
        action.payload.abilityId === SUCCESS && action.payload.step === 'DISCARD_HAND_CARD'
    );
    const observerIndex = continued.actionHistory.findIndex(
      (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === ENERGY_OBSERVER
    );
    expect(observerIndex).toBeGreaterThan(discardIndex);
    expect(continued.players[0].waitingRoom.cardIds).toEqual(['hand']);
  });
  it('draw refresh and discard events retain continuation without inserting refresh abilities mid-effect', () => {
    let started = startSuccess(setup({ belowCount: 1 }));
    started = updatePlayer(started, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: ['waiting-0', 'waiting-1', 'waiting-2', 'waiting-3'],
      },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, 'extra', state),
    }));
    started = registerCards(started, [member('extra', 'PL!N-bp8-011-P')]);
    const discard = choose(choose(started, 'other'), 'below-0');
    expect(discard.activeEffect?.abilityId).toBe(SUCCESS);
    expect(events(discard, TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK)).toHaveLength(
      1
    );
    const drawn = discard.players[0].hand.cardIds.find((id) => id.startsWith('waiting-'))!;
    expect(drawn).toBeDefined();
    const continued = choose(discard, drawn);
    expect(events(continued, TriggerCondition.ON_ENTER_WAITING_ROOM)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cardInstanceIds: [drawn], fromZone: ZoneType.HAND }),
      ])
    );
    expect(continued.activeEffect?.abilityId).toBe(MIA_REFRESH);
    expect(continued.players[0].waitingRoom.cardIds).toContain(drawn);
  });
});
