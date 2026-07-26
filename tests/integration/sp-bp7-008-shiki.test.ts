import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameEventLogEntry,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import type { MemberSlotMovedEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  activateCardAbility,
  CardAbilitySourceZone,
  confirmActiveEffectStep,
  getActivatedAbilityUiConfigs,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID,
  SP_BP7_008_AUTO_ON_MOVE_ACTIVATE_SELF_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { isActivatedAbilityUiConfigAvailableForOrientation } from '../../src/application/card-effects/runtime/activated-ability-availability';
import { GameService } from '../../src/application/game-service';
import {
  createActivateAbilityCommand,
  createMoveMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { moveMemberBetweenSlots } from '../../src/application/effects/member-state';
import { moveCardUniversal } from '../../src/application/action-handlers/zone-operations';
import { createPublicObjectId } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: cardCode.includes('bp7-008') ? 11 : 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
}

function setup(
  options: {
    readonly orientation?: OrientationState;
    readonly includeSwapTarget?: boolean;
    readonly sourceId?: string;
  } = {}
) {
  const source = createCardInstance(member('PL!SP-bp7-008-P'), P1, options.sourceId ?? 'shiki');
  const other = createCardInstance(member('PL!SP-test-other'), P1, 'other');
  const drawOne = createCardInstance(member('PL!SP-test-draw-one'), P1, 'draw-one');
  const drawTwo = createCardInstance(member('PL!SP-test-draw-two'), P1, 'draw-two');
  let game = registerCards(createGameState('sp-bp7-008-shiki', P1, 'P1', P2, 'P2'), [
    source,
    other,
    drawOne,
    drawTwo,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [drawOne.instanceId, drawTwo.instanceId] },
    memberSlots: options.includeSwapTarget
      ? placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, source.instanceId, {
            orientation: options.orientation ?? OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
          SlotPosition.RIGHT,
          other.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
        )
      : placeCardInSlot(player.memberSlots, SlotPosition.LEFT, source.instanceId, {
          orientation: options.orientation ?? OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
  }));
  return {
    game: { ...game, currentPhase: GamePhase.MAIN_PHASE },
    source,
    other,
    drawOne,
    drawTwo,
  };
}

function player(game: GameState) {
  return game.players.find((candidate) => candidate.id === P1)!;
}

function moveAndCheck(game: GameState, cardId: string, toSlot: SlotPosition): GameState {
  const moved = moveMemberBetweenSlots(game, P1, cardId, toSlot);
  expect(moved).not.toBeNull();
  const timing = new GameService().executeCheckTiming(moved!.gameState, [
    TriggerCondition.ON_MEMBER_SLOT_MOVED,
  ]);
  expect(timing.success).toBe(true);
  return timing.gameState;
}

function pending(id: string, sourceCardId: string, sourceSlot: SlotPosition): PendingAbilityState {
  return {
    id,
    abilityId: SP_BP7_008_AUTO_ON_MOVE_ACTIVATE_SELF_ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_MEMBER_SLOT_MOVED,
    eventIds: [`event-${id}`],
    sourceSlot,
    metadata: {
      fromSlot: sourceSlot,
      toSlot: sourceSlot === SlotPosition.LEFT ? SlotPosition.CENTER : SlotPosition.LEFT,
      orientationAtMove: OrientationState.WAITING,
    },
  };
}

describe('PL!SP-bp7-008 若菜四季', () => {
  it('classifies both base-scoped abilities for known and unknown rarities', () => {
    for (const cardCode of ['PL!SP-bp7-008-P', 'PL!SP-bp7-008-FOIL']) {
      expect(
        getCardAbilityDefinitionsForCardCode(cardCode).map((definition) => definition.abilityId)
      ).toEqual([
        SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID,
        SP_BP7_008_AUTO_ON_MOVE_ACTIVATE_SELF_ABILITY_ID,
      ]);
    }
    expect(getCardAbilityDefinitionsForCardCode('PL!SP-bp7-008-P')[0]).toMatchObject({
      requiredSourceOrientation: OrientationState.ACTIVE,
      queued: false,
    });
    expect(
      getCardAbilityDefinitionsForCardCode('PL!SP-bp7-008-P')[0]?.perTurnLimit
    ).toBeUndefined();
    expect(getCardAbilityDefinitionsForCardCode('PL!SP-bp7-008-P')[1]).toMatchObject({
      requiredSourceOrientationAtTrigger: OrientationState.WAITING,
      queued: true,
    });
  });

  it('pays WAIT, emits state change, records cost/use, and draws one without a turn limit', () => {
    const scenario = setup();
    const resolved = activateCardAbility(
      scenario.game,
      P1,
      scenario.source.instanceId,
      SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID
    );

    expect(
      player(resolved).memberSlots.cardStates.get(scenario.source.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(player(resolved).hand.cardIds).toEqual([scenario.drawOne.instanceId]);
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === scenario.source.instanceId &&
          entry.event.previousOrientation === OrientationState.ACTIVE &&
          entry.event.nextOrientation === OrientationState.WAITING
      )
    ).toBe(true);
    const payIndex = resolved.actionHistory.findIndex((action) => action.type === 'PAY_COST');
    const useIndex = resolved.actionHistory.findIndex(
      (action) => action.type === 'RESOLVE_ABILITY' && action.payload.step === 'ABILITY_USE'
    );
    const finishIndex = resolved.actionHistory.findIndex(
      (action) => action.type === 'RESOLVE_ABILITY' && action.payload.step === 'WAIT_SELF_DRAW_ONE'
    );
    expect(payIndex).toBeGreaterThanOrEqual(0);
    expect(useIndex).toBeGreaterThan(payIndex);
    expect(finishIndex).toBeGreaterThan(useIndex);
  });

  it('server and projected/local UI availability reject WAITING while ACTIVE remains available', () => {
    const active = setup();
    const activeConfigs = getActivatedAbilityUiConfigs(
      active.source.data.cardCode,
      CardAbilitySourceZone.STAGE_MEMBER,
      { game: active.game, playerId: P1, sourceCardId: active.source.instanceId }
    );
    expect(activeConfigs.map((config) => config.abilityId)).toEqual([
      SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID,
    ]);
    expect(activeConfigs[0]?.text).toBe('【起动】将此成员变为待机状态：抽1张卡。');
    expect(activeConfigs[0]?.requiredSourceOrientation).toBe(OrientationState.ACTIVE);
    expect(
      isActivatedAbilityUiConfigAvailableForOrientation(activeConfigs[0]!, OrientationState.ACTIVE)
    ).toBe(true);
    expect(
      isActivatedAbilityUiConfigAvailableForOrientation(activeConfigs[0]!, OrientationState.WAITING)
    ).toBe(false);

    const activeSession = createGameSession();
    activeSession.createGame('sp-bp7-008-active-session', P1, 'P1', P2, 'P2');
    (activeSession as unknown as { authorityState: GameState }).authorityState = active.game;
    const activeObjectId = createPublicObjectId(active.source.instanceId);
    expect(
      activeSession.getPlayerViewState(P1).objects[activeObjectId]?.activatedAbilityUiConfigs?.[0]
        ?.text
    ).toBe('【起动】将此成员变为待机状态：抽1张卡。');

    const waiting = setup({ orientation: OrientationState.WAITING });
    expect(
      getActivatedAbilityUiConfigs(
        waiting.source.data.cardCode,
        CardAbilitySourceZone.STAGE_MEMBER,
        { game: waiting.game, playerId: P1, sourceCardId: waiting.source.instanceId }
      )
    ).toEqual([]);

    const session = createGameSession();
    session.createGame('sp-bp7-008-session', P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = waiting.game;
    const objectId = createPublicObjectId(waiting.source.instanceId);
    expect(
      session.getPlayerViewState(P1).objects[objectId]?.activatedAbilityUiConfigs
    ).toBeUndefined();
    const rejected = session.executeCommand(
      createActivateAbilityCommand(
        P1,
        waiting.source.instanceId,
        SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID
      )
    );
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain('当前状态不满足发动条件');
  });

  it('rejects direct activation by a non-active player', () => {
    const scenario = setup();
    const opponentTurn = { ...scenario.game, activePlayerIndex: 1 };
    expect(
      activateCardAbility(
        opponentTurn,
        P1,
        scenario.source.instanceId,
        SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID
      )
    ).toBe(opponentTurn);
  });

  it('captures WAITING at manual movement, queues the AUTO, and activates before allowing reuse', () => {
    const scenario = setup({ orientation: OrientationState.WAITING });
    const session = createGameSession();
    session.createGame('sp-bp7-008-manual-move', P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = scenario.game;
    session.setManualOperationMode('FREE');
    const moved = session.executeCommand(
      createMoveMemberToSlotCommand(
        P1,
        scenario.source.instanceId,
        SlotPosition.LEFT,
        SlotPosition.CENTER
      )
    );
    expect(moved.success).toBe(true);
    const resolved = session.state!;
    const movedEvent = resolved.eventLog.find(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
        entry.event.cardInstanceId === scenario.source.instanceId
    )?.event;
    expect(movedEvent).toMatchObject({ orientationAtMove: OrientationState.WAITING });
    expect(
      player(resolved).memberSlots.cardStates.get(scenario.source.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === scenario.source.instanceId &&
          entry.event.previousOrientation === OrientationState.WAITING &&
          entry.event.nextOrientation === OrientationState.ACTIVE
      )
    ).toBe(true);

    const activatedAgain = activateCardAbility(
      resolved,
      P1,
      scenario.source.instanceId,
      SP_BP7_008_ACTIVATED_WAIT_SELF_DRAW_ONE_ABILITY_ID
    );
    expect(
      player(activatedAgain).memberSlots.cardStates.get(scenario.source.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(player(activatedAgain).hand.cardIds).toEqual([scenario.drawOne.instanceId]);
  });

  it('preserves WAITING through direct MEMBER_SLOT movement before the AUTO resolves', () => {
    const scenario = setup({ orientation: OrientationState.WAITING });
    const moved = moveCardUniversal(
      scenario.game,
      P1,
      scenario.source.instanceId,
      ZoneType.MEMBER_SLOT,
      ZoneType.MEMBER_SLOT,
      {
        sourceSlot: SlotPosition.LEFT,
        targetSlot: SlotPosition.CENTER,
      }
    );
    expect(player(moved).memberSlots.cardStates.get(scenario.source.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      moved.eventLog.find(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
          entry.event.cardInstanceId === scenario.source.instanceId
      )?.event
    ).toMatchObject({
      fromSlot: SlotPosition.LEFT,
      toSlot: SlotPosition.CENTER,
      orientationAtMove: OrientationState.WAITING,
    });

    const checked = new GameService().executeCheckTiming(moved, [
      TriggerCondition.ON_MEMBER_SLOT_MOVED,
    ]);
    expect(checked.success).toBe(true);
    expect(
      player(checked.gameState).memberSlots.cardStates.get(scenario.source.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('triggers for the WAITING swapped side, but ACTIVE movement does not queue it', () => {
    const waiting = setup({
      orientation: OrientationState.WAITING,
      includeSwapTarget: true,
    });
    const swappedBeforeTiming = moveCardUniversal(
      waiting.game,
      P1,
      waiting.other.instanceId,
      ZoneType.MEMBER_SLOT,
      ZoneType.MEMBER_SLOT,
      {
        sourceSlot: SlotPosition.RIGHT,
        targetSlot: SlotPosition.LEFT,
      }
    );
    expect(
      player(swappedBeforeTiming).memberSlots.cardStates.get(waiting.source.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      player(swappedBeforeTiming).memberSlots.cardStates.get(waiting.other.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      swappedBeforeTiming.eventLog
        .filter(
          (
            entry
          ): entry is GameEventLogEntry & {
            readonly event: MemberSlotMovedEvent;
          } => entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
        )
        .map((entry) => ({
          cardInstanceId: entry.event.cardInstanceId,
          orientationAtMove: entry.event.orientationAtMove,
        }))
    ).toEqual([
      {
        cardInstanceId: waiting.other.instanceId,
        orientationAtMove: OrientationState.ACTIVE,
      },
      {
        cardInstanceId: waiting.source.instanceId,
        orientationAtMove: OrientationState.WAITING,
      },
    ]);
    const swapTiming = new GameService().executeCheckTiming(swappedBeforeTiming, [
      TriggerCondition.ON_MEMBER_SLOT_MOVED,
    ]);
    expect(swapTiming.success).toBe(true);
    const swapped = swapTiming.gameState;
    expect(player(swapped).memberSlots.slots[SlotPosition.RIGHT]).toBe(waiting.source.instanceId);
    expect(player(swapped).memberSlots.cardStates.get(waiting.source.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );

    const active = setup();
    const movedActive = moveAndCheck(active.game, active.source.instanceId, SlotPosition.CENTER);
    expect(
      movedActive.actionHistory.some(
        (action) => action.payload.abilityId === SP_BP7_008_AUTO_ON_MOVE_ACTIVATE_SELF_ABILITY_ID
      )
    ).toBe(false);
    expect(
      player(movedActive).memberSlots.cardStates.get(active.source.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      moveMemberBetweenSlots(movedActive, P1, active.source.instanceId, SlotPosition.CENTER)
    ).toBeNull();
  });

  it('does not treat leaving or entering the stage as a member-slot movement', () => {
    const scenario = setup({ orientation: OrientationState.WAITING });
    const left = moveCardUniversal(
      scenario.game,
      P1,
      scenario.source.instanceId,
      ZoneType.MEMBER_SLOT,
      ZoneType.WAITING_ROOM,
      { sourceSlot: SlotPosition.LEFT }
    );
    const reentered = moveCardUniversal(
      left,
      P1,
      scenario.source.instanceId,
      ZoneType.WAITING_ROOM,
      ZoneType.MEMBER_SLOT,
      { targetSlot: SlotPosition.CENTER }
    );
    const checked = new GameService().executeCheckTiming(reentered, [
      TriggerCondition.ON_LEAVE_STAGE,
      TriggerCondition.ON_ENTER_STAGE,
      TriggerCondition.ON_MEMBER_SLOT_MOVED,
    ]);
    expect(checked.success).toBe(true);
    expect(
      checked.gameState.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
      )
    ).toEqual([]);
    expect(
      checked.gameState.actionHistory.some(
        (action) => action.payload.abilityId === SP_BP7_008_AUTO_ON_MOVE_ACTIVATE_SELF_ABILITY_ID
      )
    ).toBe(false);
  });

  it('uses confirm-only for manual ordering, bypasses it for ordered resolution, and continues after stale no-op', () => {
    const first = setup({
      orientation: OrientationState.WAITING,
      includeSwapTarget: true,
      sourceId: 'shiki-first',
    });
    const second = createCardInstance(member('PL!SP-bp7-008-ALT'), P1, 'shiki-second');
    let pair = registerCards(first.game, [second]);
    pair = updatePlayer(pair, P1, (current) => ({
      ...current,
      memberSlots: placeCardInSlot(current.memberSlots, SlotPosition.RIGHT, second.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
    }));
    pair = {
      ...pair,
      pendingAbilities: [
        pending('first', first.source.instanceId, SlotPosition.LEFT),
        pending('second', second.instanceId, SlotPosition.RIGHT),
      ],
    };

    const order = resolvePendingCardEffects(pair).gameState;
    const confirmation = confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      undefined,
      undefined,
      false,
      'first'
    );
    expect(confirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    const afterConfirm = confirmActiveEffectStep(confirmation, P1, confirmation.activeEffect!.id);
    expect(
      player(afterConfirm).memberSlots.cardStates.get(first.source.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);

    const orderedSetup = {
      ...pair,
      pendingAbilities: [
        pending('stale-first', first.source.instanceId, SlotPosition.LEFT),
        pending('ordered-second', second.instanceId, SlotPosition.RIGHT),
      ],
    };
    const stale = updatePlayer(orderedSetup, P1, (current) => ({
      ...current,
      memberSlots: removeCardFromSlot(current.memberSlots, SlotPosition.LEFT),
    }));
    const orderedWindow = resolvePendingCardEffects(stale).gameState;
    const ordered = confirmActiveEffectStep(
      orderedWindow,
      P1,
      orderedWindow.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
    expect(player(ordered).memberSlots.cardStates.get(second.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      ordered.actionHistory.some(
        (action) => action.payload.step === 'NO_OP_SOURCE_NOT_WAITING_ON_STAGE'
      )
    ).toBe(true);
  });
});
