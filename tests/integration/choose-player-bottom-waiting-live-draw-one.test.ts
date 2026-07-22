import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type EnergyCardData,
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
  placeCardInSlot,
  removeCardFromSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  createActivateAbilityCommand,
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  ABILITY_ORDER_SELECTION_ID,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import {
  S_BP3_007_ACTIVATED_PAY_ENERGY_BOTTOM_WAITING_LIVE_DRAW_ABILITY_ID as ABILITY,
  S_PR_041_ON_ENTER_CHOOSE_PLAYER_BOTTOM_WAITING_LIVE_DRAW_ONE_ABILITY_ID as ON_ENTER_ABILITY,
} from '../../src/application/card-effects/ability-ids';
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
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1',
  P2 = 'p2';
const member = (code: string, name = '国木田花丸', cost = 9): MemberCardData => ({
  cardCode: code,
  name,
  groupNames: ['Aqours'],
  cardType: CardType.MEMBER,
  cost,
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

interface OnEnterSetupOptions {
  readonly ownLive?: boolean;
  readonly opponentLive?: boolean;
  readonly drawCard?: boolean;
  readonly includeNonLive?: boolean;
}

function setupOnEnter(options: OnEnterSetupOptions = {}) {
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.createGame('s-pr-041', P1, 'P1', P2, 'P2');
  const source = createCardInstance(member('PL!S-PR-041-PR', '黒澤ルビィ', 15), P1, 'ruby-source');
  const ownLive = createCardInstance(live('own-live'), P1, 'own-live');
  const opponentLive = createCardInstance(live('opponent-live'), P2, 'opponent-live');
  const nonLive = createCardInstance(member('waiting-member'), P1, 'waiting-member');
  const draw = createCardInstance(live('draw-card'), P1, 'draw-card');
  const opponentDeckFiller = createCardInstance(
    live('opponent-deck-filler'),
    P2,
    'opponent-deck-filler'
  );
  let game = registerCards(session.state!, [
    source,
    ownLive,
    opponentLive,
    nonLive,
    draw,
    opponentDeckFiller,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [source.instanceId] },
    mainDeck: {
      ...player.mainDeck,
      cardIds: options.drawCard === false ? [] : [draw.instanceId],
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [
        ...(options.ownLive === false ? [] : [ownLive.instanceId]),
        ...(options.includeNonLive === false ? [] : [nonLive.instanceId]),
      ],
    },
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [opponentDeckFiller.instanceId] },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: options.opponentLive === false ? [] : [opponentLive.instanceId],
    },
  }));
  authority(session, {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.MAIN_FREE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
  });
  session.localFreePlay = true;
  const play = session.executeCommand(
    createPlayMemberToSlotCommand(P1, source.instanceId, SlotPosition.CENTER, { freePlay: true })
  );
  expect(play.success).toBe(true);
  return {
    session,
    source,
    ownLive,
    opponentLive,
    nonLive,
    draw,
    setNow(value: number) {
      now = value;
    },
  };
}

function chooseTarget(
  session: ReturnType<typeof createGameSession>,
  targetPlayerId: string,
  actingPlayerId = P1
) {
  const effect = session.state!.activeEffect!;
  return session.executeCommand(
    createConfirmEffectStepCommand(
      actingPlayerId,
      effect.id,
      undefined,
      undefined,
      undefined,
      targetPlayerId
    )
  );
}

function selectLive(
  session: ReturnType<typeof createGameSession>,
  cardId: string,
  actingPlayerId = P1
) {
  return session.executeCommand(
    createConfirmEffectStepCommand(actingPlayerId, session.state!.activeEffect!.id, cardId)
  );
}

function expirePublicSelection(
  session: ReturnType<typeof createGameSession>,
  setNow: (value: number) => void,
  playerId = P1
) {
  const reveal = session.state!.activeEffect!;
  const deadline = reveal.publicCardSelectionAutoAdvanceAt!;
  setNow(deadline);
  return session.executeCommand(
    createAutoAdvancePublicCardSelectionCommand(playerId, reveal.id, deadline)
  );
}

describe('PL!S-PR-041-PR 费用15「黒澤ルビィ」 shared ON_ENTER entry', () => {
  it.each([
    { label: '自己', targetPlayerId: P1, card: 'ownLive' as const, targetIndex: 0 },
    { label: '对方', targetPlayerId: P2, card: 'opponentLive' as const, targetIndex: 1 },
  ])('通过真实登场路径选择$label，公开后置底并由自己抽1', (testCase) => {
    const scenario = setupOnEnter();
    const effect = scenario.session.state!.activeEffect!;
    expect(effect).toMatchObject({
      abilityId: ON_ENTER_ABILITY,
      sourceCardId: scenario.source.instanceId,
      effectText:
        '【登场】选择自己或对方。自己将该玩家存在于休息室的1张LIVE卡放置于该玩家的卡组底。如此做的场合，自己抽1张卡。',
      stepId: 'S_BP3_007_SELECT_PLAYER',
      stepText: '请选择要处理休息室的玩家。',
      selectableOptions: [
        { id: P1, label: '自己' },
        { id: P2, label: '对方' },
      ],
      canSkipSelection: false,
    });
    expect(effect.stepId).not.toBe('CONFIRM_ONLY_EFFECT');
    expect(chooseTarget(scenario.session, testCase.targetPlayerId).success).toBe(true);
    const liveStep = scenario.session.state!.activeEffect!;
    expect(liveStep).toMatchObject({
      stepText: '请选择1张LIVE卡放置于该玩家的卡组底。',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择要放置于卡组底的LIVE卡',
      confirmSelectionLabel: '放置于卡组底',
      canSkipSelection: false,
      metadata: {
        targetPlayerId: testCase.targetPlayerId,
        publicCardSelectionConfirmation: {
          destination: 'MAIN_DECK_BOTTOM',
          sourcePlayerId: testCase.targetPlayerId,
        },
      },
    });
    expect(liveStep.selectableOptions).toBeUndefined();
    expect(liveStep.selectableSlots).toBeUndefined();
    const selected = scenario[testCase.card];
    expect(selectLive(scenario.session, selected.instanceId).success).toBe(true);
    expect(scenario.session.state!.activeEffect?.revealedCardIds).toEqual([selected.instanceId]);
    expect(scenario.session.state!.players[testCase.targetIndex]!.waitingRoom.cardIds).toContain(
      selected.instanceId
    );
    expect(scenario.session.state!.players[0]!.hand.cardIds).toEqual([]);
    expect(
      scenario.session.state!.actionHistory.filter(
        (action) => action.payload.step === 'BOTTOM_WAITING_LIVE_DRAW'
      )
    ).toHaveLength(0);
    expect(expirePublicSelection(scenario.session, scenario.setNow, P2).success).toBe(true);
    expect(scenario.session.state!.players[testCase.targetIndex]!.mainDeck.cardIds.at(-1)).toBe(
      selected.instanceId
    );
    expect(scenario.session.state!.players[0]!.hand.cardIds).toEqual([scenario.draw.instanceId]);
    expect(scenario.session.state!.pendingAbilities).toEqual([]);
    expect(scenario.session.state!.activeEffect).toBeNull();
  });

  it('所选玩家没有LIVE时不打开空选卡窗口、不抽牌并继续', () => {
    const scenario = setupOnEnter({ opponentLive: false });
    expect(chooseTarget(scenario.session, P2).success).toBe(true);
    expect(scenario.session.state!.activeEffect).toBeNull();
    expect(scenario.session.state!.players[0]!.hand.cardIds).toEqual([]);
    expect(scenario.session.state!.players[0]!.mainDeck.cardIds).toContain(
      scenario.draw.instanceId
    );
    expect(scenario.session.state!.pendingAbilities).toEqual([]);
    expect(scenario.session.state!.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: ON_ENTER_ABILITY,
      step: 'NO_LIVE_TARGET',
      targetPlayerId: P2,
      movedCardIds: [],
      drawnCardIds: [],
    });
  });

  it('拒绝非法玩家、越权玩家、非LIVE、候选外、重复与提交前stale输入', () => {
    const scenario = setupOnEnter();
    const playerEffectId = scenario.session.state!.activeEffect!.id;
    expect(chooseTarget(scenario.session, 'outside').success).toBe(false);
    expect(chooseTarget(scenario.session, P1, P2).success).toBe(false);
    expect(scenario.session.state!.activeEffect!.id).toBe(playerEffectId);
    expect(chooseTarget(scenario.session, P1).success).toBe(true);
    const liveEffect = scenario.session.state!.activeEffect!;
    for (const cardId of [scenario.nonLive.instanceId, 'outside']) {
      expect(selectLive(scenario.session, cardId).success).toBe(false);
      expect(scenario.session.state!.activeEffect!.id).toBe(liveEffect.id);
    }
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          liveEffect.id,
          undefined,
          undefined,
          undefined,
          undefined,
          [scenario.ownLive.instanceId, scenario.ownLive.instanceId]
        )
      ).success
    ).toBe(false);
    authority(
      scenario.session,
      updatePlayer(scenario.session.state!, P1, (player) => ({
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter(
            (cardId) => cardId !== scenario.ownLive.instanceId
          ),
        },
        hand: {
          ...player.hand,
          cardIds: [...player.hand.cardIds, scenario.ownLive.instanceId],
        },
      }))
    );
    expect(selectLive(scenario.session, scenario.ownLive.instanceId).success).toBe(false);
    expect(scenario.session.state!.activeEffect!.stepId).toBe('S_BP3_007_SELECT_WAITING_LIVE');
    expect(scenario.session.state!.players[0]!.mainDeck.cardIds).not.toContain(
      scenario.ownLive.instanceId
    );
  });

  it('入队并打开窗口后来源离开舞台仍可结算', () => {
    const scenario = setupOnEnter();
    authority(
      scenario.session,
      updatePlayer(scenario.session.state!, P1, (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: [...player.waitingRoom.cardIds, scenario.source.instanceId],
        },
      }))
    );
    expect(chooseTarget(scenario.session, P1).success).toBe(true);
    expect(selectLive(scenario.session, scenario.ownLive.instanceId).success).toBe(true);
    expect(expirePublicSelection(scenario.session, scenario.setNow).success).toBe(true);
    expect(scenario.session.state!.players[0]!.mainDeck.cardIds.at(-1)).toBe(
      scenario.ownLive.instanceId
    );
    expect(scenario.session.state!.players[0]!.hand.cardIds).toEqual([scenario.draw.instanceId]);
  });

  it('抽牌堆为空时仍成功置底、抽0并继续', () => {
    const scenario = setupOnEnter({ drawCard: false, ownLive: false, includeNonLive: false });
    expect(chooseTarget(scenario.session, P2).success).toBe(true);
    expect(selectLive(scenario.session, scenario.opponentLive.instanceId).success).toBe(true);
    expect(expirePublicSelection(scenario.session, scenario.setNow).success).toBe(true);
    expect(scenario.session.state!.players[0]!.mainDeck.cardIds).toEqual([]);
    expect(scenario.session.state!.players[1]!.mainDeck.cardIds.at(-1)).toBe(
      scenario.opponentLive.instanceId
    );
    expect(scenario.session.state!.players[0]!.hand.cardIds).toEqual([]);
    expect(scenario.session.state!.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'BOTTOM_WAITING_LIVE_DRAW',
      movedCardIds: [scenario.opponentLive.instanceId],
      drawnCardIds: [],
    });
    expect(scenario.session.state!.pendingAbilities).toEqual([]);
  });

  it('双方看到相同公开选择和deadline，提前请求失败，到期任一方可结算且只结算一次', () => {
    const scenario = setupOnEnter();
    chooseTarget(scenario.session, P1);
    selectLive(scenario.session, scenario.ownLive.instanceId);
    const reveal = scenario.session.state!.activeEffect!;
    const deadline = reveal.publicCardSelectionAutoAdvanceAt!;
    expect(deadline).toBe(12_000);
    for (const playerId of [P1, P2]) {
      expect(scenario.session.getPlayerViewState(playerId)?.activeEffect).toMatchObject({
        revealedObjectIds: [`obj_${scenario.ownLive.instanceId}`],
        publicCardSelectionAutoAdvanceAt: deadline,
      });
    }
    scenario.setNow(deadline - 1);
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P1, reveal.id, deadline)
      ).success
    ).toBe(false);
    expect(scenario.session.state!.players[0]!.waitingRoom.cardIds).toContain(
      scenario.ownLive.instanceId
    );
    expect(scenario.session.state!.players[0]!.hand.cardIds).toEqual([]);
    scenario.setNow(deadline);
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, deadline)
      ).success
    ).toBe(true);
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P1, reveal.id, deadline)
      ).success
    ).toBe(false);
    expect(
      scenario.session.state!.actionHistory.filter(
        (action) =>
          action.payload.abilityId === ON_ENTER_ABILITY &&
          action.payload.step === 'BOTTOM_WAITING_LIVE_DRAW'
      )
    ).toHaveLength(1);
  });

  it('公开到期时目标stale则不移动、不抽牌并继续', () => {
    const scenario = setupOnEnter();
    chooseTarget(scenario.session, P1);
    selectLive(scenario.session, scenario.ownLive.instanceId);
    const reveal = scenario.session.state!.activeEffect!;
    authority(
      scenario.session,
      updatePlayer(scenario.session.state!, P1, (player) => ({
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter(
            (cardId) => cardId !== scenario.ownLive.instanceId
          ),
        },
        hand: { ...player.hand, cardIds: [scenario.ownLive.instanceId] },
      }))
    );
    scenario.setNow(reveal.publicCardSelectionAutoAdvanceAt!);
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(
          P2,
          reveal.id,
          reveal.publicCardSelectionAutoAdvanceAt!
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state!.activeEffect).toBeNull();
    expect(scenario.session.state!.players[0]!.mainDeck.cardIds).toEqual([
      scenario.draw.instanceId,
    ]);
    expect(scenario.session.state!.players[0]!.hand.cardIds).toEqual([scenario.ownLive.instanceId]);
    expect(scenario.session.state!.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: ON_ENTER_ABILITY,
      step: 'SELECTED_LIVE_LEFT_WAITING_ROOM',
      movedCardIds: [],
      drawnCardIds: [],
    });
  });

  it('同一登场事件重复入队时只保留一个能力实例', () => {
    const source = createCardInstance(
      member('PL!S-PR-041-PR', '黒澤ルビィ', 15),
      P1,
      'duplicate-source'
    );
    let game = registerCards(createGameState('s-pr-041-duplicate', P1, 'P1', P2, 'P2'), [source]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    const event = createEnterStageEvent(
      source.instanceId,
      ZoneType.HAND,
      SlotPosition.CENTER,
      P1,
      P1
    );
    game = emitGameEvent(game, event);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE], {
      enterStageEvents: [event],
    });
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE], {
      enterStageEvents: [event],
    });
    expect(
      game.pendingAbilities.filter((ability) => ability.abilityId === ON_ENTER_ABILITY)
    ).toHaveLength(1);
    expect(
      game.actionHistory.filter(
        (action) =>
          action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === ON_ENTER_ABILITY
      )
    ).toHaveLength(1);
  });

  it('ordered batch完成第一项后打开第二个真实玩家选择窗口', () => {
    const sources = [0, 1].map((index) =>
      createCardInstance(member('PL!S-PR-041-PR', '黒澤ルビィ', 15), P1, `ordered-source-${index}`)
    );
    const targets = [0, 1].map((index) =>
      createCardInstance(live(`ordered-target-${index}`), P1, `ordered-target-${index}`)
    );
    const draws = [0, 1].map((index) =>
      createCardInstance(live(`ordered-draw-${index}`), P1, `ordered-draw-${index}`)
    );
    let game = registerCards(createGameState('s-pr-041-ordered', P1, 'P1', P2, 'P2'), [
      ...sources,
      ...targets,
      ...draws,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: targets.map((card) => card.instanceId) },
      mainDeck: { ...player.mainDeck, cardIds: draws.map((card) => card.instanceId) },
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, sources[0]!.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.RIGHT,
        sources[1]!.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    const events = sources.map((source, index) =>
      createEnterStageEvent(
        source.instanceId,
        ZoneType.HAND,
        index === 0 ? SlotPosition.LEFT : SlotPosition.RIGHT,
        P1,
        P1
      )
    );
    game = events.reduce((state, event) => emitGameEvent(state, event), game);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE], {
      enterStageEvents: events,
    });
    game = resolvePendingCardEffects(game).gameState;
    expect(game.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(game.activeEffect?.canResolveInOrder).toBe(true);

    let now = 20_000;
    const session = createGameSession({ now: () => now });
    session.createGame('s-pr-041-ordered-session', P1, 'P1', P2, 'P2');
    authority(session, game);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, undefined, null, true)
      ).success
    ).toBe(true);
    expect(session.state!.activeEffect).toMatchObject({
      abilityId: ON_ENTER_ABILITY,
      stepId: 'S_BP3_007_SELECT_PLAYER',
    });
    const firstSourceId = session.state!.activeEffect!.sourceCardId;
    chooseTarget(session, P1);
    const firstTargetId = session.state!.activeEffect!.selectableCardIds![0]!;
    selectLive(session, firstTargetId);
    now = session.state!.activeEffect!.publicCardSelectionAutoAdvanceAt!;
    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(
          P1,
          session.state!.activeEffect!.id,
          session.state!.activeEffect!.publicCardSelectionAutoAdvanceAt!
        )
      ).success
    ).toBe(true);
    expect(session.state!.activeEffect).toMatchObject({
      abilityId: ON_ENTER_ABILITY,
      stepId: 'S_BP3_007_SELECT_PLAYER',
    });
    expect(session.state!.activeEffect!.sourceCardId).not.toBe(firstSourceId);
    expect(session.state!.activeEffect!.stepId).not.toBe('CONFIRM_ONLY_EFFECT');
    chooseTarget(session, P1);
    const secondTargetId = session.state!.activeEffect!.selectableCardIds![0]!;
    selectLive(session, secondTargetId);
    now = session.state!.activeEffect!.publicCardSelectionAutoAdvanceAt!;
    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(
          P2,
          session.state!.activeEffect!.id,
          session.state!.activeEffect!.publicCardSelectionAutoAdvanceAt!
        )
      ).success
    ).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(session.state!.players[0]!.hand.cardIds).toHaveLength(2);
  });
});
