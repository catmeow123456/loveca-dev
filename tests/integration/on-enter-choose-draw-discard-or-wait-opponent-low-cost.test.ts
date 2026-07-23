import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import type { DeckConfig } from '../../src/application/game-service';
import {
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
  PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID,
  PL_PR_005_006_008_ON_ENTER_CHOOSE_DRAW_DISCARD_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const EFFECT_TEXT =
  '【登场】从以下选择1项。\n\n・抽1张卡，将1张手牌放置入休息室。\n\n・将存在于对方的舞台的所有费用小于等于2的成员变为待机状态。';

const FAMILY_CARD_CODES = ['PL!-PR-005-PR', 'PL!-PR-006-PR', 'PL!-PR-008-PR'] as const;

function member(cardCode: string, cost: number, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function deck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 61 }, (_, index) =>
    member(`TEST-MEMBER-${index}`, 1)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => energy(`TEST-ENERGY-${index}`));
  return { mainDeck, energyDeck };
}

function setAuthorityState(
  session: ReturnType<typeof createGameSession>,
  state: GameState
): void {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}

function forceMainPhase(session: ReturnType<typeof createGameSession>): void {
  const state = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.MAIN_FREE;
  state.currentTurnType = TurnType.NORMAL;
  state.activePlayerIndex = 0;
  state.waitingPlayerId = null;
}

function createScenario(cardCode: string, options: { readonly withTargets?: boolean } = {}) {
  const session = createGameSession();
  session.createGame(`pr-choose-${cardCode}`, PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck(), deck());
  forceMainPhase(session);

  const source = createCardInstance(member(cardCode, 9, 'Source'), PLAYER1, `${cardCode}-source`);
  const handCard = createCardInstance(member('TEST-HAND', 1), PLAYER1, `${cardCode}-hand`);
  const firstDraw = createCardInstance(member('TEST-DRAW-1', 1), PLAYER1, `${cardCode}-draw-1`);
  const nextDraw = createCardInstance(member('TEST-DRAW-2', 1), PLAYER1, `${cardCode}-draw-2`);
  const ownMember = createCardInstance(member('TEST-OWN', 1), PLAYER1, `${cardCode}-own`);
  const observer = createCardInstance(
    member('PL!-pb1-015-R', 8, 'Observer'),
    PLAYER1,
    `${cardCode}-observer`
  );
  const lowActive = createCardInstance(member('TEST-OPPONENT-COST-0', 0), PLAYER2, `${cardCode}-low-active`);
  const lowWaiting = createCardInstance(member('TEST-OPPONENT-COST-1', 1), PLAYER2, `${cardCode}-low-waiting`);
  const highActive = createCardInstance(member('TEST-OPPONENT-COST-3', 3), PLAYER2, `${cardCode}-high`);
  const memberBelow = createCardInstance(member('TEST-MEMBER-BELOW-COST-1', 1), PLAYER2, `${cardCode}-below`);

  let state = registerCards(session.state!, [
    source,
    handCard,
    firstDraw,
    nextDraw,
    ownMember,
    observer,
    lowActive,
    lowWaiting,
    highActive,
    memberBelow,
  ]);
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [source.instanceId, handCard.instanceId] },
    mainDeck: {
      ...player.mainDeck,
      cardIds: [firstDraw.instanceId, nextDraw.instanceId, ...player.mainDeck.cardIds.slice(0, 1)],
    },
    waitingRoom: { ...player.waitingRoom, cardIds: [] },
    memberSlots: {
      ...player.memberSlots,
      slots: {
        [SlotPosition.LEFT]: ownMember.instanceId,
        [SlotPosition.CENTER]: null,
        [SlotPosition.RIGHT]: observer.instanceId,
      },
      cardStates: new Map([
        [ownMember.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        [observer.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
  }));
  state = updatePlayer(state, PLAYER2, (player) => ({
    ...player,
    memberSlots: options.withTargets
      ? {
          ...player.memberSlots,
          slots: {
            [SlotPosition.LEFT]: lowActive.instanceId,
            [SlotPosition.CENTER]: lowWaiting.instanceId,
            [SlotPosition.RIGHT]: highActive.instanceId,
          },
          cardStates: new Map([
            [lowActive.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
            [lowWaiting.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
            [highActive.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
          ]),
          memberBelow: {
            ...player.memberSlots.memberBelow,
            [SlotPosition.LEFT]: [memberBelow.instanceId],
          },
        }
      : player.memberSlots,
  }));
  setAuthorityState(session, state);

  session.setManualOperationMode('FREE');
  const result = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(result.success).toBe(true);

  return {
    session,
    source,
    handCard,
    firstDraw,
    nextDraw,
    ownMember,
    observer,
    lowActive,
    lowWaiting,
    highActive,
    memberBelow,
  };
}

function chooseOption(
  session: ReturnType<typeof createGameSession>,
  optionId?: string | null,
  expectedSuccess = true
): void {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      effectId,
      undefined,
      undefined,
      undefined,
      optionId
    )
  );
  expect(result.success).toBe(expectedSuccess);
  if (result.success) {
    confirmPublicSelectionIfNeeded(session);
  }
}

function appendNextDrawPending(
  session: ReturnType<typeof createGameSession>,
  sourceCardId: string
): void {
  setAuthorityState(session, {
    ...session.state!,
    pendingAbilities: [
      ...session.state!.pendingAbilities,
      {
        id: `next-draw-${sourceCardId}`,
        abilityId: MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
        sourceCardId,
        controllerId: PLAYER1,
        timingId: TriggerCondition.ON_ENTER_STAGE,
        eventIds: [`next-draw-event-${sourceCardId}`],
      },
    ],
  });
}

function removeSourceFromStage(
  session: ReturnType<typeof createGameSession>,
  sourceCardId: string
): void {
  const state = updatePlayer(session.state!, PLAYER1, (player) => {
    const cardStates = new Map(player.memberSlots.cardStates);
    cardStates.delete(sourceCardId);
    return {
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, sourceCardId],
      },
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
        cardStates,
      },
    };
  });
  setAuthorityState(session, state);
}

describe('PR on-enter choose draw-discard or wait all opponent low-cost members', () => {
  it.each(FAMILY_CARD_CODES)(
    'opens the same mandatory two-option window through real play for %s',
    (cardCode) => {
      const { session, source } = createScenario(cardCode);
      const effect = session.state?.activeEffect;

      expect(
        session.state?.eventLog.some(
          (entry) =>
            entry.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
            entry.event.cardInstanceId === source.instanceId
        )
      ).toBe(true);
      expect(effect).toMatchObject({
        abilityId:
          PL_PR_005_006_008_ON_ENTER_CHOOSE_DRAW_DISCARD_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
        sourceCardId: source.instanceId,
        effectText: EFFECT_TEXT,
        stepText: '请选择要执行的效果。',
        selectionLabel: '选择要执行的效果',
        canSkipSelection: false,
        effectChoice: {
          mode: 'SINGLE',
          options: [
            {
              id: 'draw_discard',
              text: '抽1张卡，将1张手牌放置入休息室。',
            },
            {
              id: 'wait_opponent_low_cost',
              text: '将对方舞台上所有费用小于等于2的成员变为待机状态。',
            },
          ],
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true,
        },
      });
      expect(effect?.selectableCardIds).toBeUndefined();
      expect(effect?.skipSelectionLabel).toBeUndefined();

      const before = {
        activeEffect: effect,
        actionCount: session.state!.actionHistory.length,
        hand: [...session.state!.players[0].hand.cardIds],
        deck: [...session.state!.players[0].mainDeck.cardIds],
      };
      chooseOption(session, undefined, false);
      expect(session.state?.activeEffect).toEqual(before.activeEffect);
      expect(session.state?.actionHistory).toHaveLength(before.actionCount);
      chooseOption(session, 'forged_option', false);
      expect(session.state?.activeEffect).toEqual(before.activeEffect);
      expect(session.state?.players[0].hand.cardIds).toEqual(before.hand);
      expect(session.state?.players[0].mainDeck.cardIds).toEqual(before.deck);
    }
  );

  it('delegates draw one discard one, keeps the window private, rejects stale input, and continues only after discard', () => {
    const { session, source, handCard, firstDraw, nextDraw } = createScenario(FAMILY_CARD_CODES[0]);
    appendNextDrawPending(session, source.instanceId);
    removeSourceFromStage(session, source.instanceId);

    chooseOption(session, 'draw_discard');

    expect(session.state?.activeEffect).toMatchObject({
      abilityId:
        PL_PR_005_006_008_ON_ENTER_CHOOSE_DRAW_DISCARD_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
      sourceCardId: source.instanceId,
      effectText: EFFECT_TEXT,
      stepText: '请选择1张手牌放置入休息室。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    });
    expect(session.state?.activeEffect?.selectableOptions).toBeUndefined();
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      handCard.instanceId,
      firstDraw.instanceId,
    ]);
    expect(session.state?.players[0].hand.cardIds).toContain(firstDraw.instanceId);
    expect(session.state?.pendingAbilities.map((ability) => ability.id)).toContain(
      `next-draw-${source.instanceId}`
    );

    const effectId = session.state!.activeEffect!.id;
    session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effectId, 'not-in-hand')
    );
    expect(session.state?.activeEffect?.id).toBe(effectId);
    session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        effectId,
        undefined,
        undefined,
        undefined,
        undefined,
        [firstDraw.instanceId, firstDraw.instanceId]
      )
    );
    expect(session.state?.activeEffect?.id).toBe(effectId);

    const beforeEventCount = session.state!.eventLog.length;
    const result = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effectId, firstDraw.instanceId)
    );
    expect(result.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      source.instanceId,
      firstDraw.instanceId,
    ]);
    expect(session.state?.players[0].hand.cardIds).toContain(nextDraw.instanceId);
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.eventLog.slice(beforeEventCount).some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === ZoneType.HAND &&
          entry.event.toZone === ZoneType.WAITING_ROOM &&
          entry.event.cardInstanceIds?.includes(firstDraw.instanceId) === true
      )
    ).toBe(true);
  });

  it('waits every matching opponent main-stage member, skips no-op events, excludes own/high-cost/memberBelow, and enqueues triggers after resolve', () => {
    const scenario = createScenario(FAMILY_CARD_CODES[1], { withTargets: true });
    const { session, source, ownMember, lowActive, lowWaiting, highActive, memberBelow } = scenario;
    removeSourceFromStage(session, source.instanceId);
    const beforeDrawCount = session.state!.players[0].hand.cardIds.length;

    chooseOption(session, 'wait_opponent_low_cost');

    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[1].memberSlots.cardStates.get(lowActive.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(lowWaiting.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(highActive.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.players[0].memberSlots.cardStates.get(ownMember.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.eventLog.filter(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === lowActive.instanceId
      )
    ).toHaveLength(1);
    expect(
      session.state?.eventLog.filter(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          [lowWaiting.instanceId, highActive.instanceId, memberBelow.instanceId].includes(
            entry.event.cardInstanceId
          )
      )
    ).toHaveLength(0);

    const action = [...session.state!.actionHistory]
      .reverse()
      .find(
        (candidate) =>
          candidate.type === 'RESOLVE_ABILITY' &&
          candidate.payload.abilityId ===
            PL_PR_005_006_008_ON_ENTER_CHOOSE_DRAW_DISCARD_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID &&
          candidate.payload.step === 'WAIT_OPPONENT_LOW_COST_MEMBERS'
      );
    expect(action?.payload).toMatchObject({
      matchedTargetCardIds: [lowActive.instanceId, lowWaiting.instanceId],
      actualWaitingTargetCardIds: [lowActive.instanceId],
      previousOrientations: [
        { cardId: lowActive.instanceId, orientation: OrientationState.ACTIVE },
        { cardId: lowWaiting.instanceId, orientation: OrientationState.WAITING },
      ],
    });
    expect(action?.payload.memberStateChangedEventIds).toHaveLength(1);

    const familyResolveIndex = session.state!.actionHistory.indexOf(action!);
    const observerResolveIndex = session.state!.actionHistory.findIndex(
      (candidate) =>
        candidate.type === 'RESOLVE_ABILITY' &&
        candidate.payload.abilityId ===
          PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID
    );
    expect(observerResolveIndex).toBeGreaterThan(familyResolveIndex);
    expect(session.state!.players[0].hand.cardIds.length).toBe(beforeDrawCount + 1);
  });

  it('matches printed costs 0, 1, and 2 across all three opponent main-stage slots', () => {
    const scenario = createScenario(FAMILY_CARD_CODES[0], { withTargets: true });
    const replacementCostTwo = createCardInstance(
      member('TEST-OPPONENT-COST-2', 2),
      PLAYER2,
      scenario.highActive.instanceId
    );
    setAuthorityState(
      scenario.session,
      registerCards(scenario.session.state!, [replacementCostTwo])
    );

    chooseOption(scenario.session, 'wait_opponent_low_cost');

    for (const cardId of [
      scenario.lowActive.instanceId,
      scenario.lowWaiting.instanceId,
      scenario.highActive.instanceId,
    ]) {
      expect(
        scenario.session.state?.players[1].memberSlots.cardStates.get(cardId)?.orientation
      ).toBe(OrientationState.WAITING);
    }
  });

  it.each([false, true])(
    'completes the wait branch with no state-change event when targets are %s',
    (allAlreadyWaiting) => {
      const scenario = createScenario(FAMILY_CARD_CODES[2], {
        withTargets: allAlreadyWaiting,
      });
      if (allAlreadyWaiting) {
        let state = updatePlayer(sessionState(scenario.session), PLAYER2, (player) => {
          const cardStates = new Map(player.memberSlots.cardStates);
          cardStates.set(scenario.lowActive.instanceId, {
            orientation: OrientationState.WAITING,
            face: FaceState.FACE_UP,
          });
          return {
            ...player,
            memberSlots: { ...player.memberSlots, cardStates },
          };
        });
        setAuthorityState(scenario.session, state);
      }
      const beforeEvents = scenario.session.state!.eventLog.length;
      chooseOption(scenario.session, 'wait_opponent_low_cost');
      expect(scenario.session.state?.activeEffect).toBeNull();
      expect(
        scenario.session.state?.eventLog
          .slice(beforeEvents)
          .filter((entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)
      ).toHaveLength(0);
    }
  );
});

function sessionState(session: ReturnType<typeof createGameSession>): GameState {
  return session.state!;
}
