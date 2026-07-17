import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromStatefulZone } from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import { S_BP3_008_ACTIVATED_SELF_SACRIFICE_RECOVER_AQOURS_LIVE_ACTIVATE_ENERGY_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
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
} from '../../src/shared/types/enums';
const P1 = 'p1',
  P2 = 'p2';
const member = (code: string): MemberCardData => ({
  cardCode: code,
  name: '小原鞠莉',
  groupNames: ['Aqours'],
  cardType: CardType.MEMBER,
  cost: 4,
  blade: 1,
  hearts: [createHeartIcon(HeartColor.PINK, 1)],
});
const live = (score: number, group = 'Aqours'): LiveCardData => ({
  cardCode: `live-${score}-${group}`,
  name: 'LIVE',
  groupNames: [group],
  cardType: CardType.LIVE,
  score,
  requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
});
const energy = (i: number): EnergyCardData => ({
  cardCode: `e-${i}`,
  name: `e-${i}`,
  cardType: CardType.ENERGY,
});
function authority(s: ReturnType<typeof createGameSession>, g: GameState) {
  (s as unknown as { authorityState: GameState }).authorityState = g;
}
function setup(score = 6, group = 'Aqours', energyCount = 4) {
  const session = createGameSession();
  session.createGame('s-bp3-008', P1, 'P1', P2, 'P2');
  const source = createCardInstance(member('PL!S-bp3-008-P'), P1, 'source');
  const target = createCardInstance(live(score, group), P1, 'target');
  const energies = Array.from({ length: energyCount }, (_, i) =>
    createCardInstance(energy(i), P1, `e-${i}`)
  );
  let game = registerCards(session.state!, [source, target, ...energies]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: [] },
    waitingRoom: { ...p.waitingRoom, cardIds: [target.instanceId] },
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    energyZone: {
      ...p.energyZone,
      cardIds: energies.map((e) => e.instanceId),
      cardStates: new Map(
        energies.map((e) => [
          e.instanceId,
          { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
        ])
      ),
    },
  }));
  authority(session, {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
  });
  return { session, source, target, energies };
}
describe('PL!S-bp3-008 小原鞠莉', () => {
  it.each(['PL!S-bp3-008-P', 'PL!S-bp3-008-R'])('%s shares one implemented definition', (code) =>
    expect(
      getCardAbilityDefinitionsForCardCode(code).filter((d) => d.abilityId === ABILITY)
    ).toHaveLength(1)
  );
  it.each([
    { score: 6, group: 'Aqours', active: 4 },
    { score: 5, group: 'Aqours', active: 0 },
    { score: 6, group: 'Liella!', active: 0 },
    { score: 9, group: 'Aqours', active: 1 },
  ])(
    'recovers the LIVE and activates the correct energy count: $score $group',
    ({ score, group, active }) => {
      const { session, source, target, energies } = setup(score, group, active === 1 ? 1 : 4);
      expect(
        session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY)).success
      ).toBe(true);
      expect(session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
      expect(session.state!.players[0].waitingRoom.cardIds).toContain(source.instanceId);
      expect(
        session.state!.eventLog.some(
          (e) =>
            e.event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
            e.event.cardInstanceId === source.instanceId
        )
      ).toBe(true);
      const effect = session.state!.activeEffect!;
      expect(effect.selectableCardIds).toEqual([target.instanceId]);
      expect(effect.canSkipSelection).toBe(false);
      expect(
        session.executeCommand(createConfirmEffectStepCommand(P1, effect.id, target.instanceId))
          .success
      ).toBe(true);
      expect(session.state!.players[0].waitingRoom.cardIds).toContain(target.instanceId);
      expect(
        energies.every(
          (e) =>
            session.state!.players[0].energyZone.cardStates.get(e.instanceId)?.orientation ===
            OrientationState.WAITING
        )
      ).toBe(true);
      confirmPublicSelectionIfNeeded(session);
      expect(session.state!.players[0].hand.cardIds).toEqual([target.instanceId]);
      expect(
        energies.filter(
          (e) =>
            session.state!.players[0].energyZone.cardStates.get(e.instanceId)?.orientation ===
            OrientationState.ACTIVE
        )
      ).toHaveLength(active);
      expect(session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    }
  );
  it('keeps the self-sacrifice cost and safely ends when no LIVE exists', () => {
    const { session, source } = setup();
    authority(
      session,
      updatePlayer(session.state!, P1, (p) => ({
        ...p,
        waitingRoom: { ...p.waitingRoom, cardIds: [] },
      }))
    );
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY)).success
    ).toBe(true);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain(source.instanceId);
    expect(session.state!.activeEffect?.selectableCardIds).toEqual([]);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id))
        .success
    ).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
  });

  it.each([
    ['非主阶段', (game: GameState) => ({ ...game, currentPhase: GamePhase.LIVE_SET_PHASE })],
    ['非当前玩家', (game: GameState) => ({ ...game, activePlayerIndex: 1 })],
    [
      '来源不在舞台',
      (game: GameState) =>
        updatePlayer(game, P1, (player) => ({
          ...player,
          memberSlots: {
            ...player.memberSlots,
            slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
          },
        })),
    ],
  ] as const)('%s不可发动', (_label, mutate) => {
    const { session, source } = setup();
    authority(session, mutate(session.state!));
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY)).success
    ).toBe(false);
    expect(session.state?.activeEffect).toBeNull();
  });

  it('clears the source slot and both entry restriction traces through the shared leave-stage cost', () => {
    const { session, source } = setup();
    authority(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        movedToStageThisTurn: [source.instanceId],
        positionMovedThisTurn: [source.instanceId],
      }))
    );
    session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY));
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].movedToStageThisTurn).not.toContain(source.instanceId);
    expect(session.state?.players[0].positionMovedThisTurn).not.toContain(source.instanceId);
  });

  it('rejects outside, duplicate, and illegal-type selections without advancing', () => {
    const { session, source, target } = setup();
    session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY));
    const effect = session.state!.activeEffect!;
    for (const selectedCardIds of [['outside'], [target.instanceId, target.instanceId]]) {
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(
            P1,
            effect.id,
            undefined,
            undefined,
            undefined,
            undefined,
            selectedCardIds
          )
        ).success
      ).toBe(false);
      expect(session.state?.activeEffect?.id).toBe(effect.id);
    }
  });

  it('projects the reveal to both players and safely continues when the selected LIVE becomes stale', () => {
    const { session, source, target, energies } = setup();
    session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY));
    const selection = session.state!.activeEffect!;
    session.executeCommand(createConfirmEffectStepCommand(P1, selection.id, target.instanceId));
    const reveal = session.state!.activeEffect!;
    expect(reveal.revealedCardIds).toEqual([target.instanceId]);
    expect(reveal.publicCardSelectionAutoAdvanceAt).toEqual(expect.any(Number));
    for (const playerId of [P1, P2]) {
      expect(session.getPlayerViewState(playerId)?.activeEffect).toMatchObject({
        revealedObjectIds: [`obj_${target.instanceId}`],
        publicCardSelectionAutoAdvanceAt: reveal.publicCardSelectionAutoAdvanceAt,
      });
    }
    authority(
      session,
      updatePlayer(
        { ...session.state!, activeEffect: { ...reveal, publicCardSelectionAutoAdvanceAt: 0 } },
        P1,
        (player) => ({
          ...player,
          waitingRoom: {
            ...player.waitingRoom,
            cardIds: player.waitingRoom.cardIds.filter((id) => id !== target.instanceId),
          },
        })
      )
    );
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, 0)).success
    ).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(
      energies.every(
        (energyCard) =>
          session.state?.players[0].energyZone.cardStates.get(energyCard.instanceId)
            ?.orientation === OrientationState.WAITING
      )
    ).toBe(true);
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'SELECTED_CARD_LEFT_WAITING_ROOM',
      selectedCardId: target.instanceId,
      selectedCardIds: [target.instanceId],
      movedCardIds: [],
      activatedEnergyCardIds: [],
    });
    expect(session.state?.pendingAbilities).toEqual([]);
  });

  it('records exact activated energy ids and all player-facing selection copy', () => {
    const { session, source, target, energies } = setup(6, 'Aqours', 4);
    session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY));
    expect(session.state?.activeEffect).toMatchObject({
      stepText: '请选择1张LIVE卡加入手牌。',
      selectionLabel: '选择要加入手牌的LIVE卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
    });
    session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, target.instanceId)
    );
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'RECOVER_LIVE_ACTIVATE_ENERGY_IF_AQOURS_SCORE',
      selectedCardId: target.instanceId,
      selectedCardIds: [target.instanceId],
      conditionValue: 6,
      conditionMet: true,
      activatedEnergyCardIds: energies.map((energyCard) => energyCard.instanceId),
    });
    expect(session.state?.activeEffect).toBeNull();
  });

  it('uses the exact special-energy activation window and rejects invalid energy ids', () => {
    const { session, source, target, energies } = setup(6, 'Aqours', 5);
    authority(session, {
      ...session.state!,
      energyActivePhaseSkips: [
        {
          playerId: P1,
          energyCardId: energies[0].instanceId,
          sourceCardId: 'marker',
          abilityId: 'marker',
        },
      ],
    });
    session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY));
    session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, target.instanceId)
    );
    const reveal = session.state!.activeEffect!;
    authority(session, {
      ...session.state!,
      activeEffect: { ...reveal, publicCardSelectionAutoAdvanceAt: 0 },
    });
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, 0)).success
    ).toBe(true);
    const energySelection = session.state!.activeEffect!;
    expect(energySelection).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择要变为活跃状态的待机能量。',
      selectionLabel: '选择要变为活跃的能量',
      confirmSelectionLabel: '变为活跃',
      minSelectableCards: 4,
      maxSelectableCards: 4,
    });
    for (const ids of [
      [
        energies[0].instanceId,
        energies[0].instanceId,
        energies[1].instanceId,
        energies[2].instanceId,
      ],
      [energies[0].instanceId, energies[1].instanceId, energies[2].instanceId, 'outside'],
    ]) {
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(
            P1,
            energySelection.id,
            undefined,
            undefined,
            undefined,
            undefined,
            ids
          )
        ).success
      ).toBe(false);
      expect(session.state?.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    }
    authority(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        energyZone: removeCardFromStatefulZone(player.energyZone, energies[0].instanceId),
      }))
    );
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          energySelection.id,
          undefined,
          undefined,
          undefined,
          undefined,
          energies.slice(1).map((energyCard) => energyCard.instanceId)
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toContain(target.instanceId);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(target.instanceId);
    expect(
      energies
        .slice(1)
        .every(
          (energyCard) =>
            session.state?.players[0].energyZone.cardStates.get(energyCard.instanceId)
              ?.orientation === OrientationState.ACTIVE
        )
    ).toBe(true);
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'RECOVER_LIVE_ACTIVATE_ENERGY_IF_AQOURS_SCORE',
      activatedEnergyCardIds: energies.slice(1).map((energyCard) => energyCard.instanceId),
    });
  });
});
