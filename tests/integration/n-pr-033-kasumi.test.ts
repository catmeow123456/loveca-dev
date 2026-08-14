import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent, type EnterStageEvent } from '../../src/domain/events/game-events';
import {
  addCardsToZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
  N_PR_033_AUTO_TURN_ONCE_WAITING_ROOM_MEMBER_ENTER_DRAW_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { playMemberFromZoneToEmptySlot } from '../../src/application/card-effects/runtime/play-member-to-stage';
import { playMembersFromWaitingRoomToEmptySlots } from '../../src/application/effects/member-state';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const ABILITY_ID = N_PR_033_AUTO_TURN_ONCE_WAITING_ROOM_MEMBER_ENTER_DRAW_ONE_ABILITY_ID;
const DRAW_STEP = 'DRAW_ONE_AFTER_OWN_WAITING_ROOM_MEMBER_ENTER';

function member(cardCode: string, name = cardCode, cost = 4): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: { colorRequirements: new Map(), totalRequired: 0 },
  };
}

function abilityActions(game: GameState, step?: string) {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === ABILITY_ID &&
      (step === undefined || action.payload.step === step)
  );
}

function enterFromWaitingRoom(
  game: GameState,
  playerId: string,
  cardId: string,
  slot: SlotPosition
): { readonly game: GameState; readonly event: EnterStageEvent } {
  const played = playMembersFromWaitingRoomToEmptySlots(game, playerId, [{ cardId, toSlot: slot }]);
  expect(played).not.toBeNull();
  const event = played!.gameState.eventLog.at(-1)?.event;
  expect(event?.eventType).toBe(TriggerCondition.ON_ENTER_STAGE);
  expect(event).toMatchObject({
    cardInstanceId: cardId,
    controllerId: playerId,
    fromZone: ZoneType.WAITING_ROOM,
  });
  return { game: played!.gameState, event: event as EnterStageEvent };
}

function enqueueEnterEvent(game: GameState, event: EnterStageEvent): GameState {
  return enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE], {
    enterStageEvents: [event],
  });
}

function resolveAllPending(game: GameState): GameState {
  let state = resolvePendingCardEffects(game).gameState;
  if (state.activeEffect?.abilityId === ABILITY_ORDER_SELECTION_ID) {
    state = confirmActiveEffectStep(state, P1, state.activeEffect.id, null, null, true);
  }
  return state;
}

function setup(
  options: {
    readonly sourceOnStage?: boolean;
    readonly waitingMembers?: readonly { readonly id: string; readonly ownerId?: string }[];
    readonly handMembers?: readonly string[];
    readonly drawCardIds?: readonly string[];
    readonly waitingDrawCardIds?: readonly string[];
  } = {}
): { readonly game: GameState; readonly sourceId: string } {
  const sourceOnStage = options.sourceOnStage ?? true;
  const source = createCardInstance(member('PL!N-PR-033-PR', '中须霞', 9), P1, 'kasumi-source');
  const waitingMembers = (options.waitingMembers ?? []).map(({ id, ownerId }) =>
    createCardInstance(member(`WAITING-${id}`), ownerId ?? P1, id)
  );
  const handMembers = (options.handMembers ?? []).map((id) =>
    createCardInstance(member(`HAND-${id}`), P1, id)
  );
  const drawCards = (options.drawCardIds ?? []).map((id) =>
    createCardInstance(member(`DRAW-${id}`), P1, id)
  );
  const waitingDrawCards = (options.waitingDrawCardIds ?? []).map((id) =>
    createCardInstance(member(`REFRESH-${id}`), P1, id)
  );
  let game = registerCards(createGameState('n-pr-033-kasumi', P1, 'P1', P2, 'P2'), [
    source,
    ...waitingMembers,
    ...handMembers,
    ...drawCards,
    ...waitingDrawCards,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: sourceOnStage
      ? placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        })
      : player.memberSlots,
    waitingRoom: addCardsToZone(player.waitingRoom, [
      ...waitingMembers.filter((card) => card.ownerId === P1).map((card) => card.instanceId),
      ...waitingDrawCards.map((card) => card.instanceId),
      ...(sourceOnStage ? [] : [source.instanceId]),
    ]),
    hand: addCardsToZone(
      player.hand,
      handMembers.map((card) => card.instanceId)
    ),
    mainDeck: addCardsToZone(
      player.mainDeck,
      drawCards.map((card) => card.instanceId)
    ),
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    waitingRoom: addCardsToZone(
      player.waitingRoom,
      waitingMembers.filter((card) => card.ownerId === P2).map((card) => card.instanceId)
    ),
  }));
  return { game, sourceId: source.instanceId };
}

describe('PL!N-PR-033-PR 费用9「中须霞」', () => {
  it('己方其他成员从休息室登场时通过真实 EnterStageEvent 入队并抽1', () => {
    const scenario = setup({ waitingMembers: [{ id: 'incoming' }], drawCardIds: ['draw'] });
    const entered = enterFromWaitingRoom(scenario.game, P1, 'incoming', SlotPosition.LEFT);
    const resolved = resolveAllPending(enqueueEnterEvent(entered.game, entered.event));

    expect(resolved.players[0].hand.cardIds).toContain('draw');
    expect(resolved.pendingAbilities).toEqual([]);
    expect(abilityActions(resolved, 'ABILITY_USE')).toHaveLength(1);
    expect(abilityActions(resolved, DRAW_STEP)[0]?.payload).toMatchObject({
      drawnCardIds: ['draw'],
    });
  });

  it('来源自身从己方休息室登场时也会触发', () => {
    const scenario = setup({ sourceOnStage: false, drawCardIds: ['self-draw'] });
    const entered = enterFromWaitingRoom(scenario.game, P1, scenario.sourceId, SlotPosition.CENTER);
    const queued = enqueueEnterEvent(entered.game, entered.event);

    expect(queued.pendingAbilities).toHaveLength(1);
    expect(queued.pendingAbilities[0]).toMatchObject({
      abilityId: ABILITY_ID,
      sourceCardId: scenario.sourceId,
    });
    expect(resolveAllPending(queued).players[0].hand.cardIds).toContain('self-draw');
  });

  it('手牌登场、对方成员从休息室登场和非成员事件都不触发', () => {
    const handScenario = setup({ handMembers: ['hand-entry'] });
    const handPlay = playMemberFromZoneToEmptySlot(handScenario.game, P1, {
      cardId: 'hand-entry',
      sourceZone: ZoneType.HAND,
      toSlot: SlotPosition.LEFT,
    });
    expect(handPlay).not.toBeNull();
    const handEvent = handPlay!.gameState.eventLog.at(-1)?.event as EnterStageEvent;
    expect(enqueueEnterEvent(handPlay!.gameState, handEvent).pendingAbilities).toEqual([]);

    const opponentScenario = setup({
      waitingMembers: [{ id: 'opponent-entry', ownerId: P2 }],
    });
    const opponentEntered = enterFromWaitingRoom(
      opponentScenario.game,
      P2,
      'opponent-entry',
      SlotPosition.LEFT
    );
    expect(enqueueEnterEvent(opponentEntered.game, opponentEntered.event).pendingAbilities).toEqual(
      []
    );

    const nonMemberScenario = setup();
    const nonMember = createCardInstance(live('NON-MEMBER-LIVE'), P1, 'non-member');
    let withNonMember = registerCards(nonMemberScenario.game, [nonMember]);
    const nonMemberEvent = createEnterStageEvent(
      nonMember.instanceId,
      ZoneType.WAITING_ROOM,
      SlotPosition.LEFT,
      P1,
      P1
    );
    withNonMember = emitGameEvent(withNonMember, nonMemberEvent);
    expect(enqueueEnterEvent(withNonMember, nonMemberEvent).pendingAbilities).toEqual([]);
  });

  it('同一事件去重，同回合第二次不入队，下回合恢复', () => {
    const scenario = setup({
      waitingMembers: [{ id: 'first' }, { id: 'second' }, { id: 'third' }],
      drawCardIds: ['draw-1', 'draw-2'],
    });
    const first = enterFromWaitingRoom(scenario.game, P1, 'first', SlotPosition.LEFT);
    let game = enqueueEnterEvent(first.game, first.event);
    game = enqueueEnterEvent(game, first.event);
    expect(game.pendingAbilities).toHaveLength(1);
    game = resolveAllPending(game);

    const second = enterFromWaitingRoom(game, P1, 'second', SlotPosition.RIGHT);
    game = enqueueEnterEvent(second.game, second.event);
    expect(game.pendingAbilities).toEqual([]);
    expect(abilityActions(game, 'ABILITY_USE')).toHaveLength(1);

    game = {
      ...updatePlayer(game, P1, (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.RIGHT),
      })),
      turnCount: game.turnCount + 1,
    };
    const third = enterFromWaitingRoom(game, P1, 'third', SlotPosition.RIGHT);
    game = resolveAllPending(enqueueEnterEvent(third.game, third.event));
    expect(abilityActions(game, 'ABILITY_USE')).toHaveLength(2);
  });

  it('入队后来源离场仍结算抽牌', () => {
    const scenario = setup({ waitingMembers: [{ id: 'incoming' }], drawCardIds: ['draw'] });
    const entered = enterFromWaitingRoom(scenario.game, P1, 'incoming', SlotPosition.LEFT);
    const queued = enqueueEnterEvent(entered.game, entered.event);
    const withoutSource = updatePlayer(queued, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const resolved = resolveAllPending(withoutSource);

    expect(resolved.players[0].hand.cardIds).toContain('draw');
    expect(abilityActions(resolved, 'ABILITY_USE')).toHaveLength(1);
  });

  it('空主卡组时从休息室 refresh 后继续抽1', () => {
    const scenario = setup({
      waitingMembers: [{ id: 'incoming' }],
      waitingDrawCardIds: ['refresh-draw'],
    });
    const entered = enterFromWaitingRoom(scenario.game, P1, 'incoming', SlotPosition.LEFT);
    const resolved = resolveAllPending(enqueueEnterEvent(entered.game, entered.event));

    expect(resolved.players[0].hand.cardIds).toContain('refresh-draw');
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.affectedPlayerId === P1
      )
    ).toBe(true);
  });

  it('无牌可抽仍消费 pending、记录使用并继续实时 pending 池', () => {
    const scenario = setup({ waitingMembers: [{ id: 'incoming' }] });
    const continuationSource = createCardInstance(
      member('TEST-CONTINUATION-SOURCE'),
      P1,
      'continuation-source'
    );
    let game = registerCards(scenario.game, [continuationSource]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.RIGHT,
        continuationSource.instanceId
      ),
    }));
    const entered = enterFromWaitingRoom(game, P1, 'incoming', SlotPosition.LEFT);
    const queued = enqueueEnterEvent(entered.game, entered.event);
    const continuation: PendingAbilityState = {
      id: 'continuation-pending',
      abilityId: MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
      sourceCardId: continuationSource.instanceId,
      controllerId: P1,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: [],
      sourceSlot: SlotPosition.RIGHT,
    };
    const resolved = resolveAllPending({
      ...queued,
      pendingAbilities: [...queued.pendingAbilities, continuation],
    });

    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(abilityActions(resolved, 'ABILITY_USE')).toHaveLength(1);
    expect(abilityActions(resolved, DRAW_STEP)[0]?.payload).toMatchObject({ drawnCardIds: [] });
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID
      )
    ).toBe(true);
  });
});
