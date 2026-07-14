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
import { S_BP3_007_ACTIVATED_PAY_ENERGY_BOTTOM_WAITING_LIVE_DRAW_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1',
  P2 = 'p2';
const member = (code: string): MemberCardData => ({
  cardCode: code,
  name: '国木田花丸',
  groupNames: ['Aqours'],
  cardType: CardType.MEMBER,
  cost: 9,
  blade: 1,
  hearts: [createHeartIcon(HeartColor.PINK, 1)],
});
const live = (code: string): LiveCardData => ({
  cardCode: code,
  name: code,
  groupNames: ['Aqours'],
  cardType: CardType.LIVE,
  score: 3,
  requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
});
const energy = (code: string): EnergyCardData => ({
  cardCode: code,
  name: code,
  cardType: CardType.ENERGY,
});
function authority(session: ReturnType<typeof createGameSession>, state: GameState) {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}
function setup(target: 'self' | 'opponent' = 'self') {
  const session = createGameSession();
  session.createGame('s-bp3-007', P1, 'P1', P2, 'P2');
  const source = createCardInstance(member('PL!S-bp3-007-P'), P1, 'source');
  const targetLive = createCardInstance(
    live('target-live'),
    target === 'self' ? P1 : P2,
    'target-live'
  );
  const draw = createCardInstance(live('draw'), P1, 'draw');
  const e = createCardInstance(energy('energy'), P1, 'energy');
  let game = registerCards(session.state!, [source, targetLive, draw, e]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: [] },
    mainDeck: { ...p.mainDeck, cardIds: [draw.instanceId] },
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    waitingRoom: { ...p.waitingRoom, cardIds: target === 'self' ? [targetLive.instanceId] : [] },
    energyZone: {
      ...p.energyZone,
      cardIds: [e.instanceId],
      cardStates: new Map([
        [e.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
  }));
  game = updatePlayer(game, P2, (p) => ({
    ...p,
    waitingRoom: {
      ...p.waitingRoom,
      cardIds: target === 'opponent' ? [targetLive.instanceId] : [],
    },
    mainDeck: { ...p.mainDeck, cardIds: [] },
  }));
  authority(session, {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
  });
  return { session, source, targetLive, draw, e };
}
describe('PL!S-bp3-007 国木田花丸', () => {
  it.each(['PL!S-bp3-007-P', 'PL!S-bp3-007-R'])('%s shares one implemented definition', (code) =>
    expect(
      getCardAbilityDefinitionsForCardCode(code).filter((d) => d.abilityId === ABILITY)
    ).toHaveLength(1)
  );
  it.each(['self', 'opponent'] as const)(
    'pays [E], publicly confirms, bottoms the %s LIVE, then draws',
    (target) => {
      const { session, source, targetLive, draw, e } = setup(target);
      expect(
        session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY)).success
      ).toBe(true);
      expect(session.state!.players[0].energyZone.cardStates.get(e.instanceId)?.orientation).toBe(
        OrientationState.WAITING
      );
      expect(session.state!.activeEffect?.stepText).toBe('请选择要处理休息室的玩家。');
      const targetId = target === 'self' ? P1 : P2;
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(
            P1,
            session.state!.activeEffect!.id,
            undefined,
            undefined,
            undefined,
            targetId
          )
        ).success
      ).toBe(true);
      const effect = session.state!.activeEffect!;
      expect(effect.selectionLabel).toBe('选择要放置于卡组底的LIVE卡');
      expect(effect.confirmSelectionLabel).toBe('放置于卡组底');
      expect(
        session.executeCommand(createConfirmEffectStepCommand(P1, effect.id, targetLive.instanceId))
          .success
      ).toBe(true);
      expect(session.state!.players[target === 'self' ? 0 : 1].waitingRoom.cardIds).toContain(
        targetLive.instanceId
      );
      expect(session.state!.players[0].hand.cardIds).toEqual([]);
      confirmPublicSelectionIfNeeded(session);
      expect(session.state!.players[target === 'self' ? 0 : 1].mainDeck.cardIds.at(-1)).toBe(
        targetLive.instanceId
      );
      expect(session.state!.players[0].hand.cardIds).toEqual([draw.instanceId]);
    }
  );
  it('keeps the paid cost and turn use when the selected player has no LIVE', () => {
    const { session, source, e } = setup('self');
    authority(
      session,
      updatePlayer(session.state!, P1, (p) => ({
        ...p,
        waitingRoom: { ...p.waitingRoom, cardIds: [] },
      }))
    );
    session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY));
    const effect = session.state!.activeEffect!;
    session.executeCommand(
      createConfirmEffectStepCommand(P1, effect.id, undefined, undefined, undefined, P2)
    );
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players[0].energyZone.cardStates.get(e.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY)).success
    ).toBe(false);
  });

  it.each([
    ['非主阶段', (game: GameState) => ({ ...game, currentPhase: GamePhase.LIVE_PHASE })],
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
    [
      '活跃能量不足',
      (game: GameState) =>
        updatePlayer(game, P1, (player) => ({
          ...player,
          energyZone: {
            ...player.energyZone,
            cardStates: new Map(
              player.energyZone.cardIds.map((id) => [
                id,
                { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
              ])
            ),
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

  it('rejects an outside player option and an outside LIVE id without advancing', () => {
    const { session, source, targetLive } = setup();
    session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY));
    const playerStepId = session.state!.activeEffect!.id;
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, playerStepId, undefined, undefined, undefined, 'other')
      ).success
    ).toBe(false);
    expect(session.state?.activeEffect?.stepId).toBe('S_BP3_007_SELECT_PLAYER');
    session.executeCommand(
      createConfirmEffectStepCommand(P1, playerStepId, undefined, undefined, undefined, P1)
    );
    const liveStep = session.state!.activeEffect!;
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, liveStep.id, 'outside')).success
    ).toBe(false);
    expect(session.state?.activeEffect?.stepId).toBe('S_BP3_007_SELECT_WAITING_LIVE');
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(targetLive.instanceId);
  });

  it('projects the same public reveal and safely resolves a stale target exactly once', () => {
    const { session, source, targetLive, draw } = setup();
    session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY));
    session.executeCommand(
      createConfirmEffectStepCommand(
        P1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        P1
      )
    );
    const selection = session.state!.activeEffect!;
    session.executeCommand(createConfirmEffectStepCommand(P1, selection.id, targetLive.instanceId));
    const reveal = session.state!.activeEffect!;
    expect(reveal.revealedCardIds).toEqual([targetLive.instanceId]);
    expect(reveal.publicCardSelectionAutoAdvanceAt).toEqual(expect.any(Number));
    for (const playerId of [P1, P2]) {
      expect(session.getPlayerViewState(playerId)?.activeEffect).toMatchObject({
        revealedObjectIds: [`obj_${targetLive.instanceId}`],
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
          waitingRoom: { ...player.waitingRoom, cardIds: [] },
          hand: { ...player.hand, cardIds: [targetLive.instanceId] },
        })
      )
    );
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, 0)).success
    ).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([draw.instanceId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([targetLive.instanceId]);
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'SELECTED_LIVE_LEFT_WAITING_ROOM',
      movedCardIds: [],
      drawnCardIds: [],
    });
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P1, reveal.id, 0)).success
    ).toBe(false);
  });

  it('records the exact successful movement and draw payload', () => {
    const { session, source, targetLive, draw } = setup();
    session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY));
    session.executeCommand(
      createConfirmEffectStepCommand(
        P1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        P1
      )
    );
    session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, targetLive.instanceId)
    );
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'BOTTOM_WAITING_LIVE_DRAW',
      movedCardIds: [targetLive.instanceId],
      drawnCardIds: [draw.instanceId],
      fromZone: ZoneType.WAITING_ROOM,
      toZone: ZoneType.MAIN_DECK,
    });
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
  });

  it('uses the exact special-energy payment window and rejects duplicate, outside, and stale ids', () => {
    const { session, source, e } = setup();
    const extra = createCardInstance(energy('extra-energy'), P1, 'extra-energy');
    let game = registerCards(session.state!, [extra]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: [...player.energyZone.cardIds, extra.instanceId],
        cardStates: new Map([
          ...player.energyZone.cardStates,
          [extra.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    authority(session, {
      ...game,
      energyActivePhaseSkips: [
        { playerId: P1, energyCardId: e.instanceId, sourceCardId: 'marker', abilityId: 'marker' },
      ],
    });
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY)).success
    ).toBe(true);
    const payment = session.state!.activeEffect!;
    expect(payment).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择用于支付[E]的活跃能量卡。',
      selectionLabel: '选择用于支付费用的能量卡',
      confirmSelectionLabel: '支付费用',
      selectableCardIds: [e.instanceId, extra.instanceId],
    });
    for (const ids of [[e.instanceId, e.instanceId], ['outside']]) {
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(
            P1,
            payment.id,
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
        energyZone: removeCardFromStatefulZone(player.energyZone, e.instanceId),
      }))
    );
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, payment.id, undefined, undefined, undefined, undefined, [
          e.instanceId,
        ])
      ).success
    ).toBe(false);
    expect(session.state?.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    expect(
      session.state?.actionHistory.some((action) => action.payload.abilityId === ABILITY)
    ).toBe(false);
  });
});
