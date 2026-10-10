import { describe, expect, it } from 'vitest';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import {
  addAction,
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { createLeaveStageEvent } from '../../src/domain/events/game-events';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { HS_BP8_005_NO_OTHER_DOLLCHESTRA_SEND_SELF_ABILITY_ID as ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { enqueueStateTriggeredCardEffects } from '../../src/application/card-effects/runtime/state-trigger-observers';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import {
  playMemberFromZoneToEmptySlot,
  playMemberFromZoneToStageSlotWithReplacement,
} from '../../src/application/card-effects/runtime/play-member-to-stage';
import { resolvePendingAbilityStarterWithRegistry } from '../../src/application/card-effects/runtime/starter-registry';
import { getAbilitySourceLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import { getMemberPlayRestrictionReason } from '../../src/application/effects/member-play-restrictions';
import { queryNormalMemberPlay } from '../../src/application/normal-member-play';
import { createGameSession } from '../../src/application/game-session';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createPlayMemberAction } from '../../src/application/actions';
import { GameService } from '../../src/application/game-service';
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

const P1 = 'p1';
const P2 = 'p2';
const SOURCE = 'kosuzu';
const PARTNER = 'partner';

function member(cardCode: string, name: string, unitName?: string): MemberCardData {
  return { cardCode, name, unitName, cardType: CardType.MEMBER, cost: 0, blade: 1, hearts: [] };
}

function setup(
  options: {
    sourceInHand?: boolean;
    partner?: 'own' | 'opponent' | 'wrong-unit' | 'second-kosuzu';
    rarity?: string;
  } = {}
): GameState {
  const source = createCardInstance(
    member(`PL!HS-bp8-005-${options.rarity ?? 'P'}`, '徒町小鈴', '「DOLLCHESTRA」'),
    P1,
    SOURCE
  );
  const partner = createCardInstance(
    member(
      options.partner === 'second-kosuzu' ? 'PL!HS-bp8-005-UNSEEN' : 'TEST-partner',
      options.partner === 'wrong-unit' ? 'DOLLCHESTRA member name' : '村野さやか',
      options.partner === 'wrong-unit' ? 'みらくらぱーく！' : 'DOLLCHESTRA'
    ),
    options.partner === 'opponent' ? P2 : P1,
    PARTNER
  );
  const deckCard = createCardInstance(member('TEST-deck', 'deck card'), P1, 'deck-card');
  let state = registerCards(createGameState('hs-bp8-005', P1, 'P1', P2, 'P2'), [
    source,
    partner,
    deckCard,
  ]);
  state = { ...state, currentPhase: GamePhase.MAIN_PHASE, currentSubPhase: SubPhase.NONE };
  state = updatePlayer(state, P1, (player) => ({
    ...player,
    mainDeck: addCardToZone(player.mainDeck, deckCard.instanceId),
    hand: options.sourceInHand ? addCardToZone(player.hand, SOURCE) : player.hand,
    memberSlots: options.sourceInHand
      ? player.memberSlots
      : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, SOURCE, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
  }));
  if (options.partner) {
    state = updatePlayer(state, options.partner === 'opponent' ? P2 : P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, PARTNER, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
    }));
  }
  return state;
}

function resolve(state: GameState): GameState {
  return resolvePendingCardEffects(state).gameState;
}

function placeWaitingPartnerBack(state: GameState): GameState {
  return playMemberFromZoneToStageSlotWithReplacement(state, P1, {
    cardId: PARTNER,
    sourceZone: ZoneType.WAITING_ROOM,
    toSlot: SlotPosition.LEFT,
  })!.gameState;
}

describe('PL!HS-bp8-005 cost 0 Kosuzu play restriction', () => {
  it.each(['P', 'R', 'UNSEEN'])(
    'covers all rarities, rejects an empty own stage (%s)',
    (rarity) => {
      const state = setup({ sourceInHand: true, rarity });
      expect(
        queryNormalMemberPlay(state, {
          playerId: P1,
          cardId: SOURCE,
          targetSlot: SlotPosition.CENTER,
        }).ok
      ).toBe(false);
      expect(state.players[0].hand.cardIds).toEqual([SOURCE]);
    }
  );

  it.each(['opponent', 'wrong-unit'] as const)(
    'does not count %s or card-name text as own unit identity',
    (partner) => {
      const state = setup({ sourceInHand: true, partner });
      expect(getMemberPlayRestrictionReason(state, P1, SOURCE)).not.toBeNull();
    }
  );

  it('counts a WAITING member with structured DOLLCHESTRA identity', () => {
    const state = setup({ sourceInHand: true, partner: 'own' });
    const result = queryNormalMemberPlay(state, {
      playerId: P1,
      cardId: SOURCE,
      targetSlot: SlotPosition.CENTER,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.actualEnergyCost).toBe(0);
  });

  it('rejects the authoritative command and the underlying rules play action without a partner', () => {
    const state = setup({ sourceInHand: true });
    const session = createGameSession();
    session.createGame('hs-bp8-005-command', P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = state;
    const result = session.executeCommand(
      createPlayMemberToSlotCommand(P1, SOURCE, SlotPosition.CENTER)
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('无法打出此卡');
    expect(session.state?.players[0].hand.cardIds).toEqual([SOURCE]);
    expect(
      new GameService().processAction(
        state,
        createPlayMemberAction(P1, SOURCE, SlotPosition.CENTER)
      ).success
    ).toBe(false);
  });

  it('allows a zero-cost command over the only DOLLCHESTRA slot, then self-sends without relay', () => {
    const state = setup({ sourceInHand: true, partner: 'own' });
    const session = createGameSession();
    session.createGame('hs-bp8-005-overwrite', P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = state;
    const result = session.executeCommand(
      createPlayMemberToSlotCommand(P1, SOURCE, SlotPosition.LEFT)
    );
    expect(result.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([PARTNER, SOURCE])
    );
    expect(
      session.state?.actionHistory.find((action) => action.type === 'PLAY_MEMBER')?.payload.isRelay
    ).toBe(false);
    expect(
      session.state?.eventLog.some((record) => record.event.eventType === TriggerCondition.ON_RELAY)
    ).toBe(false);
  });

  it('allows card-effect direct placement, and the automatic ability then sends the lone member', () => {
    const state = setup({ sourceInHand: true });
    const placed = playMemberFromZoneToEmptySlot(state, P1, {
      cardId: SOURCE,
      sourceZone: ZoneType.HAND,
      toSlot: SlotPosition.CENTER,
    });
    expect(placed).not.toBeNull();
    expect(resolve(placed!.gameState).players[0].waitingRoom.cardIds).toContain(SOURCE);
  });
});

describe('PL!HS-bp8-005 state-triggered mandatory self-send', () => {
  it('does not append observer audit actions to stage events with no registered source', () => {
    let state = setup({ sourceInHand: true, partner: 'own' });
    state = emitGameEvent(
      state,
      createLeaveStageEvent('unrelated-source', SlotPosition.RIGHT, ZoneType.WAITING_ROOM, P1, P1)
    );
    expect(enqueueStateTriggeredCardEffects(state)).toBe(state);
  });
  it('captures once, remains pending, and moves through leave-stage and waiting-room events without a cost', () => {
    const before = setup();
    const pending = enqueueStateTriggeredCardEffects(before);
    expect(pending.pendingAbilities).toHaveLength(1);
    expect(pending.pendingAbilities[0]).toMatchObject({
      abilityId: ABILITY_ID,
      mandatory: true,
      sourceCardId: SOURCE,
      sourceSlot: SlotPosition.CENTER,
    });
    expect(pending.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(SOURCE);
    expect(enqueueStateTriggeredCardEffects(pending)).toBe(pending);
    const after = resolve(pending);
    expect(after.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(after.players[0].waitingRoom.cardIds).toEqual([SOURCE]);
    expect(
      after.eventLog.filter((record) => record.event.eventType === TriggerCondition.ON_LEAVE_STAGE)
    ).toHaveLength(1);
    expect(
      after.eventLog.filter(
        (record) => record.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toHaveLength(1);
    expect(after.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('two Kosuzu count each other as another DOLLCHESTRA member', () => {
    const before = setup({ partner: 'second-kosuzu' });
    expect(enqueueStateTriggeredCardEffects(before)).toBe(before);
    expect(resolve(before).players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('keeps a captured trigger when a partner returns before resolution', () => {
    const before = setup({ partner: 'own' });
    const lostPartner = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      before,
      P1,
      PARTNER,
      enqueueTriggeredCardEffects
    )!.gameState;
    const pending = enqueueStateTriggeredCardEffects(lostPartner);
    const partnerReturned = placeWaitingPartnerBack(pending);
    const after = resolve(partnerReturned);
    expect(after.players[0].waitingRoom.cardIds).toContain(SOURCE);
    expect(after.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(PARTNER);
  });

  it('observes temporary conditions inside an unrelated active effect without resolving mid-effect', () => {
    let state = setup({ partner: 'own' });
    const activeEffect = {
      id: 'other-effect',
      abilityId: 'test:other-effect',
      sourceCardId: PARTNER,
      controllerId: P1,
      effectText: '多步骤效果',
      stepId: 'STEP',
      awaitingPlayerId: P1,
    };
    state = { ...state, activeEffect };
    state = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      state,
      P1,
      PARTNER,
      enqueueTriggeredCardEffects
    )!.gameState;
    state = placeWaitingPartnerBack(state);
    state = enqueueStateTriggeredCardEffects(state);
    expect(state.activeEffect).toBe(activeEffect);
    expect(
      state.pendingAbilities.filter((ability) => ability.abilityId === ABILITY_ID)
    ).toHaveLength(1);
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(SOURCE);
    state = resolve({ ...state, activeEffect: null });
    expect(state.players[0].waitingRoom.cardIds).toContain(SOURCE);
  });

  it('does not replay snapshots suppressed while the same source is pending', () => {
    let state = enqueueStateTriggeredCardEffects(setup());
    const snapshotEvent = createLeaveStageEvent(
      PARTNER,
      SlotPosition.LEFT,
      ZoneType.WAITING_ROOM,
      P1,
      P1
    );
    state = enqueueStateTriggeredCardEffects(emitGameEvent(state, snapshotEvent));
    expect(state.pendingAbilities).toHaveLength(1);
    state = updatePlayer(state, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, PARTNER, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    // Model a completed resolution whose action did not change the satisfying condition.
    const afterPendingWasConsumed = { ...state, pendingAbilities: [] };
    expect(enqueueStateTriggeredCardEffects(afterPendingWasConsumed)).toBe(afterPendingWasConsumed);
  });

  it('checks a still-satisfying state again after the previous pending has resolved', () => {
    const pending = enqueueStateTriggeredCardEffects(setup());
    const previous = pending.pendingAbilities[0]!;
    const resolved = addAction({ ...pending, pendingAbilities: [] }, 'RESOLVE_ABILITY', P1, {
      pendingAbilityId: previous.id,
      abilityId: ABILITY_ID,
      sourceCardId: SOURCE,
    });
    const rechecked = enqueueStateTriggeredCardEffects(resolved);
    expect(rechecked.pendingAbilities).toHaveLength(1);
    expect(rechecked.pendingAbilities[0]?.id).not.toBe(previous.id);
    expect(rechecked.pendingAbilities[0]?.sourceLifecycleId).toBe(previous.sourceLifecycleId);
  });

  it('keeps old lifecycle pending from moving the same physical card after re-entry', () => {
    let state = enqueueStateTriggeredCardEffects(setup());
    const oldPending = state.pendingAbilities[0]!;
    state = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      state,
      P1,
      SOURCE,
      enqueueTriggeredCardEffects
    )!.gameState;
    state = playMemberFromZoneToStageSlotWithReplacement(state, P1, {
      cardId: SOURCE,
      sourceZone: ZoneType.WAITING_ROOM,
      toSlot: SlotPosition.RIGHT,
    })!.gameState;
    expect(getAbilitySourceLifecycleId(state, ABILITY_ID, SOURCE)).not.toBe(
      oldPending.sourceLifecycleId
    );
    const afterOld = resolvePendingAbilityStarterWithRegistry(
      state,
      oldPending,
      { skipManualConfirmation: true },
      { continuePendingCardEffects: (game) => game, delegatePendingAbility: (game) => game }
    )!;
    expect(afterOld.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(SOURCE);
    expect(afterOld.players[0].waitingRoom.cardIds).not.toContain(SOURCE);
    expect(afterOld.pendingAbilities.some((ability) => ability.id === oldPending.id)).toBe(false);
    expect(resolve(afterOld).players[0].waitingRoom.cardIds).toContain(SOURCE);
  });

  it('binds a temporary historical condition to the lifecycle that existed at that event', () => {
    let state = setup({ partner: 'own' });
    state = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      state,
      P1,
      PARTNER,
      enqueueTriggeredCardEffects
    )!.gameState;
    state = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      state,
      P1,
      SOURCE,
      enqueueTriggeredCardEffects
    )!.gameState;
    state = placeWaitingPartnerBack(state);
    state = playMemberFromZoneToStageSlotWithReplacement(state, P1, {
      cardId: SOURCE,
      sourceZone: ZoneType.WAITING_ROOM,
      toSlot: SlotPosition.CENTER,
    })!.gameState;
    const observed = enqueueStateTriggeredCardEffects(state);
    expect(observed.pendingAbilities).toHaveLength(1);
    expect(observed.pendingAbilities[0]?.sourceLifecycleId).not.toBe(
      getAbilitySourceLifecycleId(observed, ABILITY_ID, SOURCE)
    );
    expect(resolve(observed).players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(SOURCE);
  });

  it('records an explicit empty snapshot when the last member leaves stage', () => {
    const state = setup();
    const empty = updatePlayer(state, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const withEvent = emitGameEvent(
      empty,
      createLeaveStageEvent(SOURCE, SlotPosition.CENTER, ZoneType.WAITING_ROOM, P1, P1)
    );
    expect(withEvent.eventLog.at(-1)?.stageMembersAfterEvent).toEqual([]);
  });
});
