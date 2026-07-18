import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_SD1_001_ON_ENTER_DRAW_PER_SIX_ENERGY_ABILITY_ID,
  SP_SD1_002_ON_ENTER_PLAY_LOW_COST_LIELLA_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const EFFECT_TEXT =
  '【登场】可以从手牌将1张费用小于等于4的『Liella!』的成员卡登场到舞台。\n\n（也可以因此效果登场至已经存在成员的区域。但是，无法登场至此回合登场至舞台的成员所在的区域。）';

function member(
  cardCode: string,
  options: {
    readonly cost?: number;
    readonly groupNames?: readonly string[];
    readonly name?: string;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function pending(sourceCardId: string, sourceSlot = SlotPosition.CENTER): PendingAbilityState {
  return {
    id: 'sp-sd1-002-pending',
    abilityId: SP_SD1_002_ON_ENTER_PLAY_LOW_COST_LIELLA_MEMBER_ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-source'],
    sourceSlot,
  };
}

function setup(
  options: {
    readonly hand?: readonly ReturnType<typeof createCardInstance>[];
    readonly occupied?: readonly {
      readonly slot: SlotPosition;
      readonly card: ReturnType<typeof createCardInstance>;
    }[];
    readonly movedToStageThisTurn?: readonly string[];
    readonly positionMovedThisTurn?: readonly string[];
    readonly sourceOnStage?: boolean;
    readonly extraCards?: readonly ReturnType<typeof createCardInstance>[];
  } = {}
) {
  const source = createCardInstance(
    member('PL!SP-sd1-002-SD', { cost: 11, name: '唐 可可' }),
    P1,
    'keke-source'
  );
  const hand = options.hand ?? [createCardInstance(member('LIELLA-TARGET'), P1, 'target')];
  const occupied = options.occupied ?? [];
  const cards = [
    source,
    ...hand,
    ...occupied.map((entry) => entry.card),
    ...(options.extraCards ?? []),
  ];
  let game = registerCards(createGameState('sp-sd1-002', P1, 'P1', P2, 'P2'), cards);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    if (options.sourceOnStage !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    for (const entry of occupied) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.card.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
      memberSlots,
      movedToStageThisTurn:
        options.movedToStageThisTurn ??
        (options.sourceOnStage === false ? [] : [source.instanceId]),
      positionMovedThisTurn: options.positionMovedThisTurn ?? [],
    };
  });
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  return { game, source, hand, occupied };
}

function start(game: GameState, sourceCardId = 'keke-source') {
  return resolvePendingCardEffects({ ...game, pendingAbilities: [pending(sourceCardId)] })
    .gameState;
}

function chooseCard(game: GameState, cardId: string | null, playerId = P1) {
  return confirmActiveEffectStep(game, playerId, game.activeEffect!.id, cardId);
}

function chooseSlot(game: GameState, slot: SlotPosition, playerId = P1) {
  return confirmActiveEffectStep(game, playerId, game.activeEffect!.id, undefined, slot);
}

describe('PL!SP-sd1-002-SD 唐 可可 queued on-enter workflow', () => {
  it('registers the exact Excel text and only the real base print', () => {
    const definitions = getCardAbilityDefinitionsForCardCode('PL!SP-sd1-002-SD');
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      abilityId: SP_SD1_002_ON_ENTER_PLAY_LOW_COST_LIELLA_MEMBER_ABILITY_ID,
      baseCardCodes: ['PL!SP-sd1-002'],
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
      effectText: EFFECT_TEXT,
    });
    expect(definitions[0]?.perTurnLimit).toBeUndefined();
    expect(definitions[0]?.activatedUi).toBeUndefined();
    expect(definitions[0]?.cardCodes).toBeUndefined();
  });

  it('starts from a real free PLAY_MEMBER and locks the source instance, slot, and timing', () => {
    const target = createCardInstance(member('LIELLA-TARGET'), P1, 'real-target');
    const scenario = setup({ hand: [target], sourceOnStage: false });
    const game = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [scenario.source.instanceId, target.instanceId] },
    }));
    const session = createGameSession();
    session.createGame('real-sp-sd1-002', P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = game;

    const result = session.executeCommand(
      createPlayMemberToSlotCommand(P1, scenario.source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );
    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: SP_SD1_002_ON_ENTER_PLAY_LOW_COST_LIELLA_MEMBER_ABILITY_ID,
      sourceCardId: scenario.source.instanceId,
      controllerId: P1,
      effectText: EFFECT_TEXT,
      selectableCardIds: [target.instanceId],
    });
    expect(session.state?.activeEffect?.metadata?.sourceSlot).toBe(SlotPosition.CENTER);
    expect(session.state?.activeEffect?.metadata?.eventIds).toHaveLength(1);
  });

  it('continues after the queued source leaves, and its now-empty former slot is legal', () => {
    const scenario = setup({ sourceOnStage: false });
    const started = start(scenario.game);
    expect(started.activeEffect?.selectableCardIds).toEqual([scenario.hand[0]!.instanceId]);
    const slots = chooseCard(started, scenario.hand[0]!.instanceId).activeEffect?.selectableSlots;
    expect(slots).toEqual([SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT]);
  });

  it('filters by owner, MEMBER, printed cost, Liella identity, and keeps hand candidates private', () => {
    const accepted = createCardInstance(member('ACCEPTED', { cost: 4 }), P1, 'accepted');
    const tooHigh = createCardInstance(member('TOO-HIGH', { cost: 5 }), P1, 'too-high');
    const wrongGroup = createCardInstance(
      member('WRONG-GROUP', { cost: 2, groupNames: ['Aqours'] }),
      P1,
      'wrong-group'
    );
    const liellaLive = createCardInstance(live('LIELLA-LIVE'), P1, 'liella-live');
    const wrongOwner = createCardInstance(member('WRONG-OWNER'), P2, 'wrong-owner');
    const scenario = setup({ hand: [accepted, tooHigh, wrongGroup, liellaLive, wrongOwner] });
    const started = start(scenario.game);
    expect(started.activeEffect?.selectableCardIds).toEqual([accepted.instanceId]);
    expect(started.activeEffect).toMatchObject({
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      stepText: '可以从自己的手牌选择1张费用小于等于4的『Liella!』成员卡登场到舞台。',
      selectionLabel: '选择要登场的成员',
      confirmSelectionLabel: '选择登场区域',
      skipSelectionLabel: '不登场',
    });
    const opponentProjection = JSON.stringify(projectPlayerViewState(started, P2));
    expect(opponentProjection).not.toContain(accepted.instanceId);
  });

  it('consumes a pending without opening an empty window when no target-slot pair exists', () => {
    const invalid = createCardInstance(member('COST-FIVE', { cost: 5 }), P1, 'invalid');
    const resolved = start(setup({ hand: [invalid] }).game);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload.step).toBe('NO_LEGAL_HAND_MEMBER_AND_SLOT');
  });

  it('declines without changing hand, stage, waiting room, events, or creating cost payment', () => {
    const scenario = setup();
    const started = start(scenario.game);
    const snapshot = {
      hand: started.players[0].hand.cardIds,
      slots: started.players[0].memberSlots.slots,
      waiting: started.players[0].waitingRoom.cardIds,
      events: started.eventLog.length,
    };
    const declined = chooseCard(started, null);
    expect(declined.players[0].hand.cardIds).toEqual(snapshot.hand);
    expect(declined.players[0].memberSlots.slots).toEqual(snapshot.slots);
    expect(declined.players[0].waitingRoom.cardIds).toEqual(snapshot.waiting);
    expect(declined.eventLog).toHaveLength(snapshot.events);
    expect(declined.pendingCostPayment).toBeNull();
    expect(declined.activeEffect).toBeNull();
  });

  it('plays to an empty slot for free as ACTIVE and enqueues the new member on-enter only after the parent resolution', () => {
    const target = createCardInstance(
      member('PL!SP-sd1-001-SD', { cost: 4 }),
      P1,
      'on-enter-target'
    );
    const scenario = setup({ hand: [target] });
    const selected = chooseCard(start(scenario.game), target.instanceId);
    expect(selected.activeEffect).toMatchObject({
      stepText: '请选择该成员要登场的区域。',
      selectionLabel: '选择登场区域',
      confirmSelectionLabel: '登场',
      canSkipSelection: false,
    });
    const done = chooseSlot(selected, SlotPosition.LEFT);
    expect(done.players[0].hand.cardIds).not.toContain(target.instanceId);
    expect(done.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(target.instanceId);
    expect(done.players[0].memberSlots.cardStates.get(target.instanceId)).toMatchObject({
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    expect(done.players[0].movedToStageThisTurn).toContain(target.instanceId);
    expect(done.pendingCostPayment).toBeNull();
    expect(done.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    const enterEvent = done.eventLog.find(
      ({ event }) =>
        event.eventType === TriggerCondition.ON_ENTER_STAGE &&
        event.cardInstanceId === target.instanceId
    )?.event;
    expect(enterEvent).toMatchObject({ fromZone: ZoneType.HAND, toSlot: SlotPosition.LEFT });
    expect(
      done.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === SP_SD1_001_ON_ENTER_DRAW_PER_SIX_ENERGY_ABILITY_ID &&
          action.payload.sourceCardId === target.instanceId
      )
    ).toBe(true);
    const parentIndex = done.actionHistory.findIndex(
      (action) => action.payload.step === 'PLAY_LOW_COST_LIELLA_HAND_MEMBER'
    );
    const childIndex = done.actionHistory.findIndex(
      (action) =>
        action.type === 'TRIGGER_ABILITY' && action.payload.sourceCardId === target.instanceId
    );
    expect(parentIndex).toBeGreaterThanOrEqual(0);
    expect(childIndex).toBeGreaterThan(parentIndex);
  });

  it('applies current-member movedToStage restrictions, ignores position-only movement, and follows the moved member', () => {
    const left = createCardInstance(member('LEFT'), P1, 'left');
    const right = createCardInstance(member('RIGHT'), P1, 'right');
    const scenario = setup({
      occupied: [
        { slot: SlotPosition.LEFT, card: left },
        { slot: SlotPosition.RIGHT, card: right },
      ],
      movedToStageThisTurn: ['keke-source', left.instanceId],
      positionMovedThisTurn: [right.instanceId],
    });
    const slots = chooseCard(start(scenario.game), scenario.hand[0]!.instanceId).activeEffect
      ?.selectableSlots;
    expect(slots).toEqual([SlotPosition.RIGHT]);

    const moved = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.LEFT]: null,
          [SlotPosition.RIGHT]: left.instanceId,
        },
      },
    }));
    const movedSlots = chooseCard(start(moved), scenario.hand[0]!.instanceId).activeEffect
      ?.selectableSlots;
    expect(movedSlots).toEqual([SlotPosition.LEFT]);

    const leftAgain = updatePlayer(moved, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.RIGHT),
    }));
    const afterLeaveSlots = chooseCard(start(leftAgain), scenario.hand[0]!.instanceId).activeEffect
      ?.selectableSlots;
    expect(afterLeaveSlots).toEqual([SlotPosition.LEFT, SlotPosition.RIGHT]);
  });

  it('does not bypass LL-bp2-001 or the HS-bp6-006 Mira-Cra replacement restriction', () => {
    const locked = createCardInstance(member('LL-bp2-001-R+'), P1, 'locked');
    const miraOnly = createCardInstance(
      member('PL!HS-bp6-006-R', { groupNames: ['蓮ノ空女学院スクールアイドルクラブ'] }),
      P1,
      'mira-only'
    );
    const scenario = setup({
      sourceOnStage: false,
      occupied: [
        { slot: SlotPosition.LEFT, card: locked },
        { slot: SlotPosition.RIGHT, card: miraOnly },
      ],
    });
    expect(
      chooseCard(start(scenario.game), scenario.hand[0]!.instanceId).activeEffect?.selectableSlots
    ).toEqual([SlotPosition.CENTER]);
  });

  it('replaces one member with full memberBelow, energyBelow, events, effective-cost snapshot, and modifier cleanup', () => {
    const replaced = createCardInstance(member('REPLACED', { cost: 7 }), P1, 'replaced');
    const below = createCardInstance(member('BELOW'), P1, 'below');
    const attachedEnergy = createCardInstance(energy('ATTACHED-ENERGY'), P1, 'attached-energy');
    const scenario = setup({
      sourceOnStage: false,
      occupied: [{ slot: SlotPosition.LEFT, card: replaced }],
      extraCards: [below, attachedEnergy],
    });
    const prepared = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        memberBelow: { ...player.memberSlots.memberBelow, [SlotPosition.LEFT]: [below.instanceId] },
        energyBelow: {
          ...player.memberSlots.energyBelow,
          [SlotPosition.LEFT]: [attachedEnergy.instanceId],
        },
      },
    }));
    const withModifiers: GameState = {
      ...prepared,
      liveResolution: {
        ...prepared.liveResolution,
        liveModifiers: [
          {
            kind: 'HEART',
            target: 'TARGET_MEMBER',
            playerId: P1,
            targetMemberCardId: replaced.instanceId,
            hearts: [createHeartIcon(HeartColor.RED, 1)],
          },
          { kind: 'BLADE', playerId: P1, sourceCardId: replaced.instanceId, countDelta: 2 },
          {
            kind: 'SCORE',
            target: 'TARGET_MEMBER',
            playerId: P1,
            targetMemberCardId: replaced.instanceId,
            countDelta: 1,
          },
        ],
      },
    };
    const targetId = scenario.hand[0]!.instanceId;
    const done = chooseSlot(chooseCard(start(withModifiers), targetId), SlotPosition.LEFT);
    expect(done.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(targetId);
    expect(done.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([replaced.instanceId, below.instanceId])
    );
    expect(done.players[0].energyDeck.cardIds).toContain(attachedEnergy.instanceId);
    expect(done.players[0].waitingRoom.cardIds).not.toContain(attachedEnergy.instanceId);
    expect(done.liveResolution.liveModifiers).toEqual([]);
    const leave = done.eventLog.find(
      ({ event }) =>
        event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
        event.cardInstanceId === replaced.instanceId
    )?.event;
    expect(leave).toMatchObject({ replacingCardId: targetId, fromSlot: SlotPosition.LEFT });
    const waiting = done.eventLog.find(
      ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
    )?.event;
    expect(waiting?.cardInstanceIds).toEqual([replaced.instanceId, below.instanceId]);
    const enter = done.eventLog.find(
      ({ event }) =>
        event.eventType === TriggerCondition.ON_ENTER_STAGE && event.cardInstanceId === targetId
    )?.event;
    expect(enter).toMatchObject({
      replacedMemberCardId: replaced.instanceId,
      replacedMemberEffectiveCost: 7,
      relayReplacements: [
        { cardId: replaced.instanceId, slot: SlotPosition.LEFT, effectiveCost: 7 },
      ],
    });
  });

  it('atomically refreshes stale hand targets and stale slots without moving another card', () => {
    const first = createCardInstance(member('FIRST'), P1, 'first');
    const second = createCardInstance(member('SECOND'), P1, 'second');
    const scenario = setup({ hand: [first, second], sourceOnStage: false });
    const selected = chooseCard(start(scenario.game), first.instanceId);
    const staleTarget = updatePlayer(selected, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [second.instanceId] },
      waitingRoom: addCardToZone(player.waitingRoom, first.instanceId),
    }));
    const refreshedHand = chooseSlot(staleTarget, SlotPosition.LEFT);
    expect(refreshedHand.activeEffect?.selectableCardIds).toEqual([second.instanceId]);
    expect(refreshedHand.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(refreshedHand.players[0].waitingRoom.cardIds).toContain(first.instanceId);

    const selectedAgain = chooseCard(refreshedHand, second.instanceId);
    const blocker = createCardInstance(member('BLOCKER'), P1, 'blocker');
    let changed = registerCards(selectedAgain, [blocker]);
    changed = updatePlayer(changed, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, blocker.instanceId),
      movedToStageThisTurn: [...player.movedToStageThisTurn, blocker.instanceId],
    }));
    const refreshedSlots = chooseSlot(changed, SlotPosition.LEFT);
    expect(refreshedSlots.activeEffect?.selectableSlots).toEqual([
      SlotPosition.CENTER,
      SlotPosition.RIGHT,
    ]);
    expect(refreshedSlots.players[0].hand.cardIds).toContain(second.instanceId);
    expect(refreshedSlots.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(blocker.instanceId);
  });

  it('rejects forged, duplicate, wrong-player, stale-window, and non-enumerated inputs without progress', () => {
    const scenario = setup();
    const started = start(scenario.game);
    expect(chooseCard(started, 'forged')).toBe(started);
    expect(chooseCard(started, scenario.hand[0]!.instanceId, P2)).toBe(started);
    const selected = chooseCard(started, scenario.hand[0]!.instanceId);
    expect(chooseSlot(selected, 'FORGED' as SlotPosition)).toBe(selected);
    expect(
      confirmActiveEffectStep(selected, P1, 'stale-effect', undefined, SlotPosition.LEFT)
    ).toBe(selected);
    const done = chooseSlot(selected, SlotPosition.LEFT);
    expect(
      confirmActiveEffectStep(done, P1, selected.activeEffect!.id, undefined, SlotPosition.LEFT)
    ).toBe(done);
  });
});
