import { describe, expect, it } from 'vitest';
import { addCheckTimingRuleSentinel } from '../helpers/check-timing-rule-sentinel';
import { createMovePublicCardToWaitingRoomCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { PL_PR_001_002_ON_LEAVE_STAGE_ACTIVATE_MEMBER_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState, type PendingAbilityState } from '../../src/domain/entities/game';
import { addMemberBelowMember, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { CardType, FaceState, GamePhase, HeartColor, OrientationState, SlotPosition, SubPhase, TriggerCondition, TurnType, ZoneType } from '../../src/shared/types/enums';

const P1 = 'player1'; const P2 = 'player2';
function data(code: string): MemberCardData { return { cardCode: code, name: code, groupNames: ["μ's"], cardType: CardType.MEMBER, cost: 4, blade: 1, hearts: [createHeartIcon(HeartColor.RED, 1)] }; }
function place(game: GameState, playerId: string, id: string, slot: SlotPosition, orientation: OrientationState): GameState { return updatePlayer(game, playerId, (player) => ({ ...player, memberSlots: placeCardInSlot(player.memberSlots, slot, id, { orientation, face: FaceState.FACE_UP }) })); }
function setup() {
  const cards = [createCardInstance(data('PL!-PR-001-PR'), P1, 'source'), createCardInstance(data('OWN'), P1, 'own'), createCardInstance(data('OPP'), P2, 'opponent'), createCardInstance(data('ACTIVE'), P1, 'active'), createCardInstance(data('BELOW'), P1, 'below')];
  let game = registerCards(createGameState('pr-leave', P1, 'P1', P2, 'P2'), cards);
  game = place(game, P1, 'own', SlotPosition.LEFT, OrientationState.WAITING); game = place(game, P1, 'active', SlotPosition.RIGHT, OrientationState.ACTIVE); game = place(game, P2, 'opponent', SlotPosition.CENTER, OrientationState.WAITING);
  game = updatePlayer(game, P1, (player) => ({ ...player, waitingRoom: { ...player.waitingRoom, cardIds: ['source'] }, memberSlots: addMemberBelowMember(player.memberSlots, SlotPosition.RIGHT, 'below') }));
  return game;
}
function queue(game: GameState, toZone: ZoneType = ZoneType.WAITING_ROOM): GameState { const pending: PendingAbilityState = { id: 'pending', abilityId: PL_PR_001_002_ON_LEAVE_STAGE_ACTIVATE_MEMBER_ABILITY_ID, sourceCardId: 'source', controllerId: P1, mandatory: false, timingId: TriggerCondition.ON_LEAVE_STAGE, eventIds: ['leave'], metadata: { toZone } }; return { ...game, pendingAbilities: [pending] }; }

function stateEvents(game: GameState, cardId?: string) {
  return game.eventLog.filter(
    (entry) =>
      entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
      (cardId === undefined || entry.event.cardInstanceId === cardId)
  );
}

function resolutionPayload(game: GameState, step: string) {
  return game.actionHistory.findLast(
    (action) => action.type === 'RESOLVE_ABILITY' && action.payload.step === step
  )?.payload;
}

function realSession(code: 'PL!-PR-001-PR' | 'PL!-PR-002-PR') {
  const session = createGameSession();
  const energy = (index: number): EnergyCardData => ({ cardCode: `E-${index}`, name: `E-${index}`, cardType: CardType.ENERGY });
  const deck: DeckConfig = { mainDeck: Array.from({ length: 20 }, (_, index) => data(`M-${index}`)) as AnyCardData[], energyDeck: Array.from({ length: 12 }, (_, index) => energy(index)) };
  session.createGame(`real-${code}`, P1, 'P1', P2, 'P2'); session.initializeGame(deck, deck);
  const source = createCardInstance(data(code), P1, `source-${code}`); const target = createCardInstance(data('TARGET'), P1, `target-${code}`);
  let state = registerCards(session.state!, [source, target]);
  state = place(state, P1, source.instanceId, SlotPosition.CENTER, OrientationState.ACTIVE); state = place(state, P1, target.instanceId, SlotPosition.LEFT, OrientationState.WAITING);
  (session as unknown as { authorityState: GameState }).authorityState = state;
  const mutable = session.state as unknown as { currentPhase: GamePhase; currentSubPhase: SubPhase; currentTurnType: TurnType; activePlayerIndex: number; waitingPlayerId: string | null };
  mutable.currentPhase = GamePhase.MAIN_PHASE; mutable.currentSubPhase = SubPhase.MAIN_FREE; mutable.currentTurnType = TurnType.NORMAL; mutable.activePlayerIndex = 0; mutable.waitingPlayerId = null;
  session.setManualOperationMode('FREE');
  return { session, source, target };
}

describe('PL!-PR-001/002 on-leave activate stage member', () => {
  for (const code of ['PL!-PR-001-PR', 'PL!-PR-002-PR'] as const) {
    it(`queues ${code} through the production leave-stage command`, () => {
      const { session, source, target } = realSession(code);
      const result = session.executeCommand(
        createMovePublicCardToWaitingRoomCommand(
          P1,
          source.instanceId,
          ZoneType.MEMBER_SLOT,
          SlotPosition.CENTER
        )
      );
      expect(result.success).toBe(true);
      expect(session.state?.activeEffect).toMatchObject({
        abilityId: PL_PR_001_002_ON_LEAVE_STAGE_ACTIVATE_MEMBER_ABILITY_ID,
        selectableCardIds: [target.instanceId],
      });
      expect(session.state?.players[0].waitingRoom.cardIds).toContain(source.instanceId);
    });
  }

  it('offers only both players WAITING main-stage members with exact copy', () => {
    const state = resolvePendingCardEffects(queue(setup())).gameState;
    expect(state.activeEffect).toMatchObject({
      effectText: '【自动】此成员被从舞台放置入休息室时，可以将1名成员变为活跃状态。',
      selectableCardIds: ['own', 'opponent'],
      stepText: '可以选择舞台上1名待机状态的成员变为活跃状态。',
      selectionLabel: '选择要变为活跃状态的成员',
      confirmSelectionLabel: '变为活跃状态',
      skipSelectionLabel: '不发动',
      canSkipSelection: true,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
    });
    expect(state.activeEffect?.selectableCardIds).not.toContain('active');
    expect(state.activeEffect?.selectableCardIds).not.toContain('below');
    expect(state.activeEffect?.selectableCardIds).not.toContain('source');
  });

  for (const [id, targetPlayerId] of [['own', P1], ['opponent', P2]] as const) {
    it(`activates ${id}, records its owner and emits one standard event`, () => {
      const started = resolvePendingCardEffects(queue(setup())).gameState;
      const resolved = confirmActiveEffectStep(started, P1, started.activeEffect!.id, id);
      const owner = targetPlayerId === P1 ? resolved.players[0] : resolved.players[1];
      const events = stateEvents(resolved, id);
      expect(owner.memberSlots.cardStates.get(id)?.orientation).toBe(OrientationState.ACTIVE);
      expect(events).toHaveLength(1);
      expect(events[0]?.event).toMatchObject({
        previousOrientation: OrientationState.WAITING,
        nextOrientation: OrientationState.ACTIVE,
      });
      expect(resolutionPayload(resolved, 'ACTIVATE_STAGE_MEMBER')).toMatchObject({
        targetPlayerId,
        targetCardId: id,
        previousOrientation: OrientationState.WAITING,
        nextOrientation: OrientationState.ACTIVE,
        memberStateChangedEventIds: [events[0]?.event.eventId],
      });
      expect(resolved.activeEffect).toBeNull();

      const repeated = confirmActiveEffectStep(resolved, P1, started.activeEffect!.id, id);
      expect(repeated).toBe(resolved);
      expect(stateEvents(repeated, id)).toHaveLength(1);
    });
  }

  it('accepts only explicit null as skip and keeps forged or missing input unchanged', () => {
    const started = resolvePendingCardEffects(queue(setup())).gameState;
    expect(confirmActiveEffectStep(started, P1, started.activeEffect!.id, 'active')).toBe(started);
    expect(confirmActiveEffectStep(started, P1, started.activeEffect!.id, undefined)).toBe(started);
    const skipped = confirmActiveEffectStep(started, P1, started.activeEffect!.id, null);
    expect(skipped.activeEffect).toBeNull();
    expect(skipped.players[0].memberSlots.cardStates.get('own')?.orientation).toBe(OrientationState.WAITING);
    expect(stateEvents(skipped)).toHaveLength(0);
  });
  it('consumes non-waiting-room leaves without a window', () => { const state = resolvePendingCardEffects(queue(setup(), ZoneType.HAND)).gameState; expect(state.activeEffect).toBeNull(); expect(state.pendingAbilities).toEqual([]); });
  it('consumes pending without an empty window when neither player has a WAITING target', () => { let game = setup(); game = updatePlayer(game, P1, (player) => ({ ...player, memberSlots: { ...player.memberSlots, cardStates: new Map(player.memberSlots.cardStates).set('own', { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }) } })); game = updatePlayer(game, P2, (player) => ({ ...player, memberSlots: { ...player.memberSlots, cardStates: new Map(player.memberSlots.cardStates).set('opponent', { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }) } })); const state = resolvePendingCardEffects(queue(game)).gameState; expect(state.activeEffect).toBeNull(); expect(state.pendingAbilities).toEqual([]); });
  it('clears an original target that became ACTIVE without changing another member', () => {
    const started = resolvePendingCardEffects(queue(setup())).gameState;
    const changed = updatePlayer(started, P1, (player) => ({ ...player, memberSlots: { ...player.memberSlots, cardStates: new Map(player.memberSlots.cardStates).set('own', { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }) } }));
    const resolved = confirmActiveEffectStep(changed, P1, changed.activeEffect!.id, 'own');
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[1].memberSlots.cardStates.get('opponent')?.orientation).toBe(OrientationState.WAITING);
    expect(stateEvents(resolved)).toHaveLength(0);
    expect(resolutionPayload(resolved, 'STALE_TARGET')).toMatchObject({ targetCardId: 'own' });
  });

  it('clears an original target that left the main stage without a state event', () => {
    const started = resolvePendingCardEffects(queue(setup())).gameState;
    const changed = updatePlayer(started, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
      waitingRoom: { ...player.waitingRoom, cardIds: [...player.waitingRoom.cardIds, 'own'] },
    }));
    const resolved = confirmActiveEffectStep(changed, P1, changed.activeEffect!.id, 'own');
    expect(resolved.activeEffect).toBeNull();
    expect(stateEvents(resolved)).toHaveLength(0);
    expect(resolutionPayload(resolved, 'STALE_TARGET')).toMatchObject({ targetCardId: 'own' });
  });

  it('returns through continuation only after the current state change has resolved', () => {
    const first = queue(setup()).pendingAbilities[0]!;
    const game = {
      ...setup(),
      pendingAbilities: [first, { ...first, id: 'pending-next', sourceCardId: 'source-next' }],
    };
    const selection = resolvePendingCardEffects(
      addCheckTimingRuleSentinel(game, P1, 'pr-on-leave-continuation')
    ).gameState;
    expect(selection.activeEffect?.abilityId).toBe('system:select-pending-card-effect');
    const started = confirmActiveEffectStep(
      selection,
      P1,
      selection.activeEffect!.id,
      'source'
    );
    expect(started.activeEffect).toMatchObject({ id: 'pending' });
    const continued = confirmActiveEffectStep(started, P1, started.activeEffect!.id, 'own');
    expect(stateEvents(continued, 'own')).toHaveLength(1);
    expect(resolutionPayload(continued, 'ACTIVATE_STAGE_MEMBER')).toMatchObject({
      pendingAbilityId: 'pending',
      targetCardId: 'own',
    });
    expect(continued.activeEffect).toMatchObject({
      id: 'pending-next',
      selectableCardIds: ['opponent'],
    });
  });
});
