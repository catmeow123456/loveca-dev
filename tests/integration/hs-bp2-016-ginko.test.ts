import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import { HS_PB1_024_ON_ENTER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { projectPlayerViewState, createPublicObjectId } from '../../src/online/projector';
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

function createMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'スリーズブーケ',
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createSessionFromState(state: GameState): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  session.createGame('hs-bp2-016-ginko-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

function startGinkoArrange(params: {
  readonly testId: string;
  readonly sourceCardCode?: string;
  readonly sourceName?: string;
  readonly topNames?: readonly string[];
} = {}): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly topCardIds: readonly string[];
} {
  const source = createCardInstance(
    createMember(params.sourceCardCode ?? 'PL!HS-bp2-016-N', params.sourceName ?? '百生 吟子'),
    PLAYER1,
    `${params.testId ?? 'ginko'}-source`
  );
  const topCards = (params.topNames ?? ['top-a', 'top-b']).map((name, index) =>
    createCardInstance(
      createMember(`PL!HS-bp2-016-${name}`, `Top ${index}`),
      PLAYER1,
      `${params.testId ?? 'ginko'}-${name}`
    )
  );

  let game = createGameState(params.testId ?? 'hs-bp2-016-ginko', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...topCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: topCards.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = {
    ...game,
    pendingAbilities: [
      {
        id: `${params.testId ?? 'ginko'}-on-enter`,
        abilityId: HS_PB1_024_ON_ENTER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
        sourceCardId: source.instanceId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId: TriggerCondition.ON_ENTER_STAGE,
        eventIds: [`${params.testId ?? 'ginko'}-event`],
      },
    ],
  };

  const session = createSessionFromState(resolvePendingCardEffects(game).gameState);
  return {
    session,
    sourceId: source.instanceId,
    topCardIds: topCards.map((card) => card.instanceId),
  };
}

function confirmArrange(
  session: ReturnType<typeof createGameSession>,
  selectedCardIds: readonly string[]
): void {
  const result = session.executeCommand(
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
  expect(result.success, result.error).toBe(true);
}

function attemptArrange(
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

describe('PL!HS-bp2-016-N 百生 吟子 arrange inspected top two', () => {
  it('starts the reused PL!HS-pb1-024 arrange workflow and keeps inspected cards private', () => {
    const { session, topCardIds } = startGinkoArrange({ testId: 'hs-bp2-016-visibility' });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_PB1_024_ON_ENTER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
      sourceCardId: 'hs-bp2-016-visibility-source',
      stepId: 'HS_PB1_024_ARRANGE_TOP_TWO',
      stepText:
        '请选择要留在卡组顶的卡牌。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
      selectableCardIds: topCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 2,
      selectionLabel: '按卡组顶从上到下的顺序选择卡牌',
      confirmSelectionLabel: '按此顺序放回卡组顶',
    });

    const p1View = projectPlayerViewState(session.state!, PLAYER1);
    const p2View = projectPlayerViewState(session.state!, PLAYER2);
    expect(p1View.activeEffect?.selectableObjectIds).toEqual(
      topCardIds.map((cardId) => createPublicObjectId(cardId))
    );
    expect(p2View.activeEffect?.selectableObjectIds).toBeUndefined();
    for (const cardId of topCardIds) {
      expect(p1View.objects[createPublicObjectId(cardId)]?.surface).toBe('FRONT');
      expect(p2View.objects[createPublicObjectId(cardId)]?.surface).not.toBe('FRONT');
    }
  });

  it('puts two selected cards back on top in the selected order', () => {
    const { session, topCardIds } = startGinkoArrange({ testId: 'hs-bp2-016-two' });

    confirmArrange(session, [topCardIds[1]!, topCardIds[0]!]);

    expect(session.state?.players[0].mainDeck.cardIds.slice(0, 2)).toEqual([
      topCardIds[1],
      topCardIds[0],
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.activeEffect).toBeNull();
  });

  it('puts one selected card on top and sends the other inspected card to waiting room', () => {
    const { session, topCardIds } = startGinkoArrange({ testId: 'hs-bp2-016-one' });

    confirmArrange(session, [topCardIds[1]!]);

    expect(session.state?.players[0].mainDeck.cardIds[0]).toBe(topCardIds[1]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([topCardIds[0]]);
    expect(
      session.state?.eventLog.some((entry) => {
        const event = entry.event;
        return (
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MAIN_DECK &&
          event.toZone === ZoneType.WAITING_ROOM &&
          event.cardInstanceIds?.join(',') === topCardIds[0]
        );
      })
    ).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.activeEffect).toBeNull();
  });

  it('sends both inspected cards to waiting room when zero cards are selected', () => {
    const { session, topCardIds } = startGinkoArrange({ testId: 'hs-bp2-016-zero' });

    confirmArrange(session, []);

    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(topCardIds);
    expect(
      session.state?.eventLog.some((entry) => {
        const event = entry.event;
        return (
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MAIN_DECK &&
          event.toZone === ZoneType.WAITING_ROOM &&
          event.cardInstanceIds?.join(',') === topCardIds.join(',')
        );
      })
    ).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.activeEffect).toBeNull();
  });

  it('does not advance on duplicate, out-of-range, or stale selected cards', () => {
    const duplicate = startGinkoArrange({ testId: 'hs-bp2-016-duplicate' });
    const duplicateResult = attemptArrange(duplicate.session, [
      duplicate.topCardIds[0]!,
      duplicate.topCardIds[0]!,
    ]);
    expect(duplicateResult.success).toBe(false);
    expect(duplicate.session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_024_ON_ENTER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID
    );
    expect(duplicate.session.state?.inspectionZone.cardIds).toEqual(duplicate.topCardIds);

    const outOfRange = startGinkoArrange({ testId: 'hs-bp2-016-out-of-range' });
    const unrelated = createCardInstance(createMember('PL!HS-bp2-016-unrelated'), PLAYER1, 'unrelated');
    (outOfRange.session as unknown as { authorityState: GameState }).authorityState = registerCards(
      outOfRange.session.state!,
      [unrelated]
    );
    const outOfRangeResult = attemptArrange(outOfRange.session, [unrelated.instanceId]);
    expect(outOfRangeResult.success).toBe(false);
    expect(outOfRange.session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_024_ON_ENTER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID
    );
    expect(outOfRange.session.state?.inspectionZone.cardIds).toEqual(outOfRange.topCardIds);

    const stale = startGinkoArrange({ testId: 'hs-bp2-016-stale' });
    (stale.session as unknown as { authorityState: GameState }).authorityState = {
      ...stale.session.state!,
      inspectionZone: {
        ...stale.session.state!.inspectionZone,
        cardIds: [stale.topCardIds[1]!],
      },
    };
    const staleResult = attemptArrange(stale.session, [stale.topCardIds[0]!]);
    expect(staleResult.success).toBe(false);
    expect(stale.session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_024_ON_ENTER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID
    );
    expect(stale.session.state?.inspectionZone.cardIds).toEqual([stale.topCardIds[1]]);
  });
});
