import { describe, expect, it } from 'vitest';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createMoveMemberToSlotCommand,
  createTapMemberCommand,
} from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { enqueueTriggeredCardEffects } from '../../src/application/card-effect-runner';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { S_BP3_001_ACTIVATED_WAIT_OWN_MEMBER_GRANT_PLAYER_SCORE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { createCardInstance, createHeartIcon, type MemberCardData } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { CardType, FaceState, GamePhase, HeartColor, OrientationState, SlotPosition, SubPhase } from '../../src/shared/types/enums';

const P1 = 'p1', P2 = 'p2';
const member = (cardCode: string): MemberCardData => ({ cardCode, name: cardCode, groupNames: ['Aqours'], cardType: CardType.MEMBER, cost: 1, blade: 1, hearts: [createHeartIcon(HeartColor.PINK, 1)] });

function setup(targetCardCode = 'target') {
  const session = createGameSession(); session.createGame('s-bp3-001', P1, 'P1', P2, 'P2');
  const source = createCardInstance(member('PL!S-bp3-001-P'), P1, 'source');
  const target = createCardInstance(member(targetCardCode), P1, 'target');
  let game = registerCards(session.state!, [source, target]);
  game = updatePlayer(game, P1, (player) => ({ ...player, memberSlots: placeCardInSlot(placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }), SlotPosition.LEFT, target.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }) }));
  (session as unknown as { authorityState: GameState }).authorityState = { ...game, currentPhase: GamePhase.MAIN_PHASE, currentSubPhase: SubPhase.NONE, activePlayerIndex: 0 };
  return { session, source, target };
}

describe('PL!S-bp3-001 高海千歌', () => {
  it.each(['PL!S-bp3-001-P', 'PL!S-bp3-001-P＋', 'PL!S-bp3-001-R＋', 'PL!S-bp3-001-SEC'])('%s maps to the one implemented definition', (cardCode) => {
    expect(getCardAbilityDefinitionsForCardCode(cardCode).filter((definition) => definition.abilityId === ABILITY && definition.implemented)).toHaveLength(1);
  });
  it('waits one own ACTIVE member then grants that member-bound player SCORE modifier', () => {
    const { session, source, target } = setup();
    expect(session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY)).success).toBe(true);
    expect(session.state!.activeEffect).toMatchObject({ selectableCardIds: expect.arrayContaining([source.instanceId, target.instanceId]), selectionLabel: '选择要变为待机状态的成员', confirmSelectionLabel: '变为待机状态' });
    expect(session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, target.instanceId)).success).toBe(true);
    expect(session.state!.players[0].memberSlots.cardStates.get(target.instanceId)?.orientation).toBe(OrientationState.WAITING);
    expect(session.state!.liveResolution.liveModifiers).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'SCORE', playerId: P1, countDelta: 1, sourceCardId: source.instanceId, targetMemberCardId: target.instanceId, abilityId: ABILITY })]));
  });
  it('keeps the binding when its source leaves, then removes it through the standard LeaveStage runtime path when its target leaves', () => {
    const { session, source, target } = setup();
    session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY));
    session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, target.instanceId));
    const sourceLeaves = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(session.state!, P1, source.instanceId, enqueueTriggeredCardEffects)!;
    expect(sourceLeaves.gameState.liveResolution.liveModifiers).toEqual(expect.arrayContaining([expect.objectContaining({ targetMemberCardId: target.instanceId })]));
    const targetLeaves = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(sourceLeaves.gameState, P1, target.instanceId, enqueueTriggeredCardEffects)!;
    expect(targetLeaves.gameState.liveResolution.liveModifiers).toEqual([]);
    expect(targetLeaves.gameState.liveResolution.playerScoreBonuses.has(P1)).toBe(false);
    const reentered = updatePlayer(targetLeaves.gameState, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== target.instanceId),
      },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, target.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    expect(reentered.liveResolution.liveModifiers).toEqual([]);
    expect(reentered.liveResolution.playerScoreBonuses.has(P1)).toBe(false);
  });
  it('does not remove a target binding when the target changes orientation or stage slot', () => {
    const { session, source, target } = setup();
    session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY));
    session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, target.instanceId));
    expect(session.executeCommand(createTapMemberCommand(P1, target.instanceId, SlotPosition.LEFT)).success).toBe(true);
    expect(session.state!.players[0].memberSlots.cardStates.get(target.instanceId)?.orientation).toBe(OrientationState.ACTIVE);
    expect(session.state!.liveResolution.liveModifiers).toEqual(expect.arrayContaining([expect.objectContaining({ targetMemberCardId: target.instanceId })]));
    expect(session.executeCommand(createTapMemberCommand(P1, target.instanceId, SlotPosition.LEFT)).success).toBe(true);
    expect(session.state!.players[0].memberSlots.cardStates.get(target.instanceId)?.orientation).toBe(OrientationState.WAITING);
    expect(session.state!.liveResolution.liveModifiers).toEqual(expect.arrayContaining([expect.objectContaining({ targetMemberCardId: target.instanceId })]));
    const moved = session.executeCommand(createMoveMemberToSlotCommand(P1, target.instanceId, SlotPosition.LEFT, SlotPosition.RIGHT));
    expect(moved.success).toBe(true);
    expect(session.state!.liveResolution.liveModifiers).toEqual(expect.arrayContaining([expect.objectContaining({ targetMemberCardId: target.instanceId })]));
  });
  it('rejects illegal and stale targets without writing a modifier or consuming the turn use', () => {
    const { session, source, target } = setup();
    expect(session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY)).success).toBe(true);
    const effectId = session.state!.activeEffect!.id;
    expect(session.executeCommand(createConfirmEffectStepCommand(P1, effectId, 'not-a-candidate')).success).toBe(false);
    expect(session.state!.activeEffect?.id).toBe(effectId);
    expect(session.state!.liveResolution.liveModifiers).toEqual([]);

    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      session.state!,
      P1,
      (player) => ({
        ...player,
        memberSlots: {
          ...player.memberSlots,
          cardStates: new Map(player.memberSlots.cardStates).set(target.instanceId, {
            orientation: OrientationState.WAITING,
            face: FaceState.FACE_UP,
          }),
        },
      })
    );
    expect(session.executeCommand(createConfirmEffectStepCommand(P1, effectId, target.instanceId)).success).toBe(false);
    expect(session.state!.activeEffect?.id).toBe(effectId);
    expect(session.state!.liveResolution.liveModifiers).toEqual([]);
    expect(session.state!.actionHistory.some((action) => action.payload.abilityId === ABILITY && action.payload.step === 'ABILITY_USE')).toBe(false);
  });
  it('ends safely when the source leaves after the selection window opens', () => {
    const { session, source, target } = setup();
    expect(session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY)).success).toBe(true);
    const sourceLeaves = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      session.state!,
      P1,
      source.instanceId,
      enqueueTriggeredCardEffects
    )!;
    (session as unknown as { authorityState: GameState }).authorityState = sourceLeaves.gameState;
    expect(session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, target.instanceId)).success).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players[0].memberSlots.cardStates.get(target.instanceId)?.orientation).toBe(OrientationState.ACTIVE);
    expect(session.state!.liveResolution.liveModifiers).toEqual([]);
    expect(session.state!.actionHistory.some((action) => action.payload.abilityId === ABILITY && action.payload.step === 'ABILITY_USE')).toBe(false);
  });
  it('settles the modifier and ability use before resolving a state-change trigger', () => {
    const { session, source, target } = setup('PL!N-bp4-018-N');
    expect(session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY)).success).toBe(true);
    expect(session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, target.instanceId)).success).toBe(true);

    expect(session.state!.liveResolution.liveModifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ abilityId: ABILITY, targetMemberCardId: target.instanceId }),
    ]));
    const chikaResolutionIndex = session.state!.actionHistory.findIndex(
      (action) => action.payload.abilityId === ABILITY && action.payload.step === 'WAIT_OWN_MEMBER_GRANT_PLAYER_SCORE'
    );
    const chikaUseIndex = session.state!.actionHistory.findIndex(
      (action) => action.payload.abilityId === ABILITY && action.payload.step === 'ABILITY_USE'
    );
    const triggeredAbilityIndex = session.state!.actionHistory.findIndex(
      (action) => action.payload.abilityId === N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID
    );
    expect(chikaUseIndex).toBeGreaterThanOrEqual(0);
    expect(chikaResolutionIndex).toBeGreaterThan(chikaUseIndex);
    expect(triggeredAbilityIndex).toBeGreaterThan(chikaResolutionIndex);
  });
});
