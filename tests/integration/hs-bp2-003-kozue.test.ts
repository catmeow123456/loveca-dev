import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import {
  HS_BP2_003_LIVE_START_DISCARD_HAND_ARRANGE_TOP_THREE_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const SELECT_DISCARD_STEP_ID = 'HS_BP2_003_SELECT_DISCARD_HAND';
const ARRANGE_TOP_THREE_STEP_ID = 'HS_BP2_003_ARRANGE_TOP_THREE';

function member(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'スリーズブーケ',
    cardType: CardType.MEMBER,
    cost: 7,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function pending(id: string, sourceCardId: string): PendingAbilityState {
  return {
    id,
    abilityId: HS_BP2_003_LIVE_START_DISCARD_HAND_ARRANGE_TOP_THREE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    sourceSlot: SlotPosition.CENTER,
    eventIds: [`event-${id}`],
  };
}

function createSessionFromState(state: GameState): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  session.createGame('hs-bp2-003-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

function startScenario(options: {
  readonly testId: string;
  readonly sourceCardCode?: string;
  readonly handCount?: number;
  readonly deckCount?: number;
  readonly sourceOnStage?: boolean;
  readonly includeHandDiscardTriggerSource?: boolean;
}) {
  const source = createCardInstance(
    member(options.sourceCardCode ?? 'PL!HS-bp2-003-R', '乙宗 梢'),
    PLAYER1,
    `${options.testId}-source`
  );
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    createCardInstance(member(`HAND-${index}`), PLAYER1, `${options.testId}-hand-${index}`)
  );
  const deckCards = Array.from({ length: options.deckCount ?? 3 }, (_, index) =>
    createCardInstance(member(`DECK-${index}`), PLAYER1, `${options.testId}-deck-${index}`)
  );
  const triggerSource = options.includeHandDiscardTriggerSource
    ? createCardInstance(
        member('PL!HS-pb1-003-R', '大沢瑠璃乃'),
        PLAYER1,
        `${options.testId}-trigger-source`
      )
    : null;

  let game = createGameState(options.testId, PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ...handCards,
    ...deckCards,
    ...(triggerSource ? [triggerSource] : []),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    if (options.sourceOnStage !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (triggerSource) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, triggerSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
      mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots,
    };
  });
  game = { ...game, pendingAbilities: [pending(`${options.testId}-pending`, source.instanceId)] };
  const resolved = resolvePendingCardEffects(game).gameState;
  return {
    session: createSessionFromState(resolved),
    sourceId: source.instanceId,
    handCardIds: handCards.map((card) => card.instanceId),
    deckCardIds: deckCards.map((card) => card.instanceId),
  };
}

function confirmDiscard(
  session: ReturnType<typeof createGameSession>,
  selectedCardId?: string
): ReturnType<ReturnType<typeof createGameSession>['executeCommand']> {
  return session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
  );
}

function confirmArrange(
  session: ReturnType<typeof createGameSession>,
  selectedCardIds: readonly string[]
): ReturnType<ReturnType<typeof createGameSession>['executeCommand']> {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      selectedCardIds
    )
  );
}

function latestSummary(state: GameState, status: 'STARTED' | 'COMPLETED') {
  return state.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          HS_BP2_003_LIVE_START_DISCARD_HAND_ARRANGE_TOP_THREE_ABILITY_ID &&
        (action.payload.publicEffectSummary as { readonly summaryStatus?: unknown } | undefined)
          ?.summaryStatus === status
    )
    .at(-1)?.payload.publicEffectSummary as
    | {
        readonly discardedCostCardIds?: readonly string[];
        readonly actualInspectedCount?: number;
        readonly selectedCardIds?: readonly string[];
        readonly waitingRoomCardIds?: readonly string[];
      }
    | undefined;
}

describe('PL!HS-bp2-003 乙宗梢 LIVE-start discard and arrange', () => {
  it.each(['PL!HS-bp2-003-R', 'PL!HS-bp2-003-P'])(
    'discards one, privately inspects top three, and arranges them for %s',
    (sourceCardCode) => {
      const { session, handCardIds, deckCardIds } = startScenario({
        testId: `normal-${sourceCardCode}`,
        sourceCardCode,
      });
      expect(session.state?.activeEffect).toMatchObject({
        abilityId: HS_BP2_003_LIVE_START_DISCARD_HAND_ARRANGE_TOP_THREE_ABILITY_ID,
        stepId: SELECT_DISCARD_STEP_ID,
        selectableCardIds: handCardIds,
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
      });

      const beforeDiscardSeq = session.getCurrentPublicEventSeq();
      const discardResult = confirmDiscard(session, handCardIds[0]);
      expect(discardResult.success, discardResult.error).toBe(true);
      expect(session.state?.activeEffect).toMatchObject({
        stepId: ARRANGE_TOP_THREE_STEP_ID,
        inspectionCardIds: deckCardIds,
        selectableCardIds: deckCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: 3,
      });
      expect(latestSummary(session.state!, 'STARTED')?.discardedCostCardIds).toEqual([
        handCardIds[0],
      ]);
      const startedPublicSummary = session
        .getPublicEventsSince(beforeDiscardSeq)
        .find(
          (event) =>
            event.type === 'CardEffectSummary' &&
            event.abilityId === HS_BP2_003_LIVE_START_DISCARD_HAND_ARRANGE_TOP_THREE_ABILITY_ID &&
            event.summaryStatus === 'STARTED'
        );
      expect(startedPublicSummary?.type).toBe('CardEffectSummary');
      if (startedPublicSummary?.type === 'CardEffectSummary') {
        expect(
          (startedPublicSummary.discardedCostCards?.length ?? 0) +
            (startedPublicSummary.hiddenDiscardedCostCardCount ?? 0)
        ).toBe(1);
      }

      const p1View = projectPlayerViewState(session.state!, PLAYER1);
      const p2View = projectPlayerViewState(session.state!, PLAYER2);
      expect(p1View.activeEffect?.selectableObjectIds).toEqual(
        deckCardIds.map((cardId) => createPublicObjectId(cardId))
      );
      expect(p2View.activeEffect?.selectableObjectIds).toBeUndefined();

      const beforeArrangeSeq = session.getCurrentPublicEventSeq();
      const arrangeResult = confirmArrange(session, [deckCardIds[2]!, deckCardIds[0]!]);
      expect(arrangeResult.success, arrangeResult.error).toBe(true);
      expect(session.state?.players[0].mainDeck.cardIds.slice(0, 2)).toEqual([
        deckCardIds[2],
        deckCardIds[0],
      ]);
      expect(session.state?.players[0].mainDeck.cardIds).toContain(handCardIds[0]);
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual([deckCardIds[1]]);
      expect(session.state?.inspectionZone.cardIds).toEqual([]);
      expect(latestSummary(session.state!, 'COMPLETED')).toMatchObject({
        discardedCostCardIds: [handCardIds[0]],
        selectedCardIds: [deckCardIds[2], deckCardIds[0]],
        waitingRoomCardIds: [deckCardIds[1]],
      });
      const completedPublicSummary = session
        .getPublicEventsSince(beforeArrangeSeq)
        .find(
          (event) =>
            event.type === 'CardEffectSummary' &&
            event.abilityId === HS_BP2_003_LIVE_START_DISCARD_HAND_ARRANGE_TOP_THREE_ABILITY_ID &&
            event.summaryStatus === 'COMPLETED'
        );
      expect(completedPublicSummary?.type).toBe('CardEffectSummary');
      if (completedPublicSummary?.type === 'CardEffectSummary') {
        expect(
          (completedPublicSummary.discardedCostCards?.length ?? 0) +
            (completedPublicSummary.hiddenDiscardedCostCardCount ?? 0)
        ).toBe(1);
      }
      expect(
        session.state?.eventLog.some(
          (entry) =>
            entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
            entry.event.fromZone === ZoneType.MAIN_DECK &&
            entry.event.cardInstanceIds?.join(',') === deckCardIds[1]
        )
      ).toBe(true);
    }
  );

  it('uses the hand-to-waiting trigger wrapper before entering the arrange step', () => {
    const { session, handCardIds } = startScenario({
      testId: 'discard-trigger',
      includeHandDiscardTriggerSource: true,
    });
    const result = confirmDiscard(session, handCardIds[0]);
    expect(result.success, result.error).toBe(true);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === ZoneType.HAND &&
          entry.event.cardInstanceIds?.includes(handCardIds[0]!)
      )
    ).toBe(true);
    expect(
      session.state?.pendingAbilities.some(
        (ability) =>
          ability.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      )
    ).toBe(true);
  });

  it('skips without discarding or inspecting', () => {
    const { session, handCardIds, deckCardIds } = startScenario({ testId: 'skip' });
    const result = confirmDiscard(session);
    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual(handCardIds);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(deckCardIds);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(latestSummary(session.state!, 'STARTED')).toBeUndefined();
  });

  it.each([
    ['no hand', { handCount: 0 }],
    ['source left stage', { sourceOnStage: false }],
  ] as const)('consumes pending without opening an empty window for %s', (_label, options) => {
    const { session, deckCardIds } = startScenario({ testId: `no-op-${_label}`, ...options });
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(deckCardIds);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
  });

  it('rejects duplicate, out-of-range, and stale arrange input without changing the current step', () => {
    const duplicate = startScenario({ testId: 'duplicate' });
    confirmDiscard(duplicate.session, duplicate.handCardIds[0]);
    const duplicateResult = confirmArrange(duplicate.session, [
      duplicate.deckCardIds[0]!,
      duplicate.deckCardIds[0]!,
    ]);
    expect(duplicateResult.success).toBe(false);
    expect(duplicate.session.state?.activeEffect?.stepId).toBe(ARRANGE_TOP_THREE_STEP_ID);
    expect(duplicate.session.state?.inspectionZone.cardIds).toEqual(duplicate.deckCardIds);

    const outOfRange = startScenario({ testId: 'out-of-range' });
    confirmDiscard(outOfRange.session, outOfRange.handCardIds[0]);
    const unrelated = createCardInstance(member('UNRELATED'), PLAYER1, 'unrelated');
    (outOfRange.session as unknown as { authorityState: GameState }).authorityState = registerCards(
      outOfRange.session.state!,
      [unrelated]
    );
    const outOfRangeResult = confirmArrange(outOfRange.session, [unrelated.instanceId]);
    expect(outOfRangeResult.success).toBe(false);
    expect(outOfRange.session.state?.activeEffect?.stepId).toBe(ARRANGE_TOP_THREE_STEP_ID);
    expect(outOfRange.session.state?.inspectionZone.cardIds).toEqual(outOfRange.deckCardIds);

    const stale = startScenario({ testId: 'stale' });
    confirmDiscard(stale.session, stale.handCardIds[0]);
    (stale.session as unknown as { authorityState: GameState }).authorityState = {
      ...stale.session.state!,
      inspectionZone: {
        ...stale.session.state!.inspectionZone,
        cardIds: stale.deckCardIds.slice(1),
      },
    };
    const staleResult = confirmArrange(stale.session, [stale.deckCardIds[0]!]);
    expect(staleResult.success).toBe(false);
    expect(stale.session.state?.activeEffect?.stepId).toBe(ARRANGE_TOP_THREE_STEP_ID);
    expect(stale.session.state?.inspectionZone.cardIds).toEqual(stale.deckCardIds.slice(1));
  });

  it('refreshes before inspection and uses the actual available count when fewer than three remain', () => {
    const { session, handCardIds, deckCardIds } = startScenario({
      testId: 'refresh-short',
      deckCount: 1,
    });
    const result = confirmDiscard(session, handCardIds[0]);
    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect?.inspectionCardIds).toHaveLength(2);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(
      expect.arrayContaining([handCardIds[0], deckCardIds[0]])
    );
    expect(latestSummary(session.state!, 'STARTED')).toMatchObject({
      discardedCostCardIds: [handCardIds[0]],
      actualInspectedCount: 2,
    });
  });

  it('continues to the next pending ability after arranging', () => {
    const { session, sourceId, handCardIds, deckCardIds } = startScenario({
      testId: 'continuation',
      handCount: 2,
    });
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      pendingAbilities: [...session.state!.pendingAbilities, pending('later-pending', sourceId)],
    };
    confirmDiscard(session, handCardIds[0]);
    const result = confirmArrange(session, deckCardIds);
    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_BP2_003_LIVE_START_DISCARD_HAND_ARRANGE_TOP_THREE_ABILITY_ID,
      stepId: SELECT_DISCARD_STEP_ID,
      selectableCardIds: [handCardIds[1]],
    });
  });
});
