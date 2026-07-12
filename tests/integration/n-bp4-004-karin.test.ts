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
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { ABILITY_ORDER_SELECTION_ID } from '../../src/application/card-effect-runner';
import {
  PL_N_BP4_004_LIVE_START_DRAW_WAIT_LOW_COST_OPPONENT_MEMBER_ABILITY_ID,
  PL_N_BP4_004_LIVE_START_STACK_NIJIGASAKI_MEMBERS_BY_OPPONENT_WAIT_COUNT_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setupKarinScenario(options: {
  readonly opponentMembers?: Partial<
    Record<
      SlotPosition,
      {
        readonly card: ReturnType<typeof createCardInstance>;
        readonly orientation: OrientationState;
      }
    >
  >;
  readonly mainDeckCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingRoomCards?: readonly ReturnType<typeof createCardInstance>[];
}): GameState {
  const karin = createCardInstance(
    createMember('PL!N-bp4-004-SEC', { name: '朝香果林', cost: 15 }),
    PLAYER1,
    'karin'
  );
  const mainDeckCards = [...(options.mainDeckCards ?? [])];
  const waitingRoomCards = [...(options.waitingRoomCards ?? [])];
  const opponentEntries = Object.entries(options.opponentMembers ?? {}) as [
    SlotPosition,
    {
      readonly card: ReturnType<typeof createCardInstance>;
      readonly orientation: OrientationState;
    },
  ][];
  let game = createGameState('n-bp4-004-karin', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    karin,
    ...mainDeckCards,
    ...waitingRoomCards,
    ...opponentEntries.map(([, entry]) => entry.card),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: mainDeckCards.map((card) => card.instanceId) },
    waitingRoom: waitingRoomCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.waitingRoom
    ),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, karin.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: opponentEntries.reduce(
      (slots, [slot, entry]) =>
        placeCardInSlot(slots, slot, entry.card.instanceId, {
          orientation: entry.orientation,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
  return { ...game, liveResolution: { ...game.liveResolution, performingPlayerId: PLAYER1 } };
}

function startLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function attachSession(state: GameState) {
  const session = createGameSession();
  session.createGame('n-bp4-004-karin-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

function selectPendingAbility(
  session: ReturnType<typeof createGameSession>,
  abilityId: string
): void {
  if (session.state?.activeEffect?.abilityId !== ABILITY_ORDER_SELECTION_ID) {
    expect(session.state?.activeEffect?.abilityId).toBe(abilityId);
    return;
  }
  const pending = session.state.pendingAbilities.find(
    (ability: PendingAbilityState) => ability.abilityId === abilityId
  );
  expect(pending).toBeTruthy();
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state.activeEffect.id,
      undefined,
      undefined,
      false,
      pending!.id
    )
  );
  expect(result.success, result.error).toBe(true);
}

function confirmActiveEffect(
  session: ReturnType<typeof createGameSession>,
  options: { readonly selectedCardId?: string | null; readonly selectedCardIds?: readonly string[] }
): void {
  const effect = session.state?.activeEffect;
  expect(effect).toBeTruthy();
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      effect!.id,
      options.selectedCardId,
      undefined,
      undefined,
      undefined,
      options.selectedCardIds
    )
  );
  expect(result.success, result.error).toBe(true);
  if (session.state?.activeEffect?.stepId === 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION') {
    const confirmed = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effect!.id)
    );
    expect(confirmed.success, confirmed.error).toBe(true);
  }
}

describe('PL!N-bp4-004 Karin live-start workflows', () => {
  it('draws one and can wait an opponent cost 9 or lower member', () => {
    const drawn = createCardInstance(createMember('PL!N-drawn'), PLAYER1, 'drawn');
    const target = createCardInstance(createMember('OPP-low', { cost: 9 }), PLAYER2, 'target');
    const state = startLiveStart(
      setupKarinScenario({
        mainDeckCards: [drawn],
        opponentMembers: {
          [SlotPosition.CENTER]: { card: target, orientation: OrientationState.ACTIVE },
        },
      })
    );
    const session = attachSession(state);

    selectPendingAbility(
      session,
      PL_N_BP4_004_LIVE_START_DRAW_WAIT_LOW_COST_OPPONENT_MEMBER_ABILITY_ID
    );
    expect(session.state?.players[0].hand.cardIds).toContain(drawn.instanceId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([target.instanceId]);

    confirmActiveEffect(session, { selectedCardId: target.instanceId });

    expect(
      session.state?.players[1].memberSlots.cardStates.get(target.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('does not offer cost 10 targets, and still draws one', () => {
    const drawn = createCardInstance(createMember('PL!N-drawn'), PLAYER1, 'drawn');
    const highCost = createCardInstance(createMember('OPP-high', { cost: 10 }), PLAYER2, 'high');
    const state = startLiveStart(
      setupKarinScenario({
        mainDeckCards: [drawn],
        opponentMembers: {
          [SlotPosition.CENTER]: { card: highCost, orientation: OrientationState.ACTIVE },
        },
      })
    );
    const session = attachSession(state);

    selectPendingAbility(
      session,
      PL_N_BP4_004_LIVE_START_DRAW_WAIT_LOW_COST_OPPONENT_MEMBER_ABILITY_ID
    );

    expect(session.state?.players[0].hand.cardIds).toContain(drawn.instanceId);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(highCost.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('counts a member waited by the first ability when the stack ability resolves second', () => {
    const drawn = createCardInstance(createMember('PL!N-drawn'), PLAYER1, 'drawn');
    const deckRest = createCardInstance(createMember('PL!N-rest'), PLAYER1, 'rest');
    const alreadyWait = createCardInstance(createMember('OPP-wait', { cost: 4 }), PLAYER2, 'wait');
    const activeLow = createCardInstance(
      createMember('OPP-active', { cost: 4 }),
      PLAYER2,
      'active'
    );
    const topSecond = createCardInstance(
      createMember('PL!N-stack-second'),
      PLAYER1,
      'stack-second'
    );
    const topFirst = createCardInstance(createMember('PL!N-stack-first'), PLAYER1, 'stack-first');
    const state = startLiveStart(
      setupKarinScenario({
        mainDeckCards: [drawn, deckRest],
        waitingRoomCards: [topFirst, topSecond],
        opponentMembers: {
          [SlotPosition.LEFT]: { card: alreadyWait, orientation: OrientationState.WAITING },
          [SlotPosition.RIGHT]: { card: activeLow, orientation: OrientationState.ACTIVE },
        },
      })
    );
    const session = attachSession(state);

    selectPendingAbility(
      session,
      PL_N_BP4_004_LIVE_START_DRAW_WAIT_LOW_COST_OPPONENT_MEMBER_ABILITY_ID
    );
    confirmActiveEffect(session, { selectedCardId: activeLow.instanceId });
    selectPendingAbility(
      session,
      PL_N_BP4_004_LIVE_START_STACK_NIJIGASAKI_MEMBERS_BY_OPPONENT_WAIT_COUNT_ABILITY_ID
    );

    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);
    confirmActiveEffect(session, {
      selectedCardIds: [topSecond.instanceId, topFirst.instanceId],
    });

    expect(session.state?.players[0].mainDeck.cardIds.slice(0, 3)).toEqual([
      topSecond.instanceId,
      topFirst.instanceId,
      deckRest.instanceId,
    ]);
  });

  it('uses the current wait count if the stack ability resolves before the draw-wait ability', () => {
    const drawn = createCardInstance(createMember('PL!N-drawn'), PLAYER1, 'drawn');
    const alreadyWait = createCardInstance(createMember('OPP-wait', { cost: 4 }), PLAYER2, 'wait');
    const activeLow = createCardInstance(
      createMember('OPP-active', { cost: 4 }),
      PLAYER2,
      'active'
    );
    const firstCandidate = createCardInstance(
      createMember('PL!N-stack-first'),
      PLAYER1,
      'stack-first'
    );
    const secondCandidate = createCardInstance(
      createMember('PL!N-stack-second'),
      PLAYER1,
      'stack-second'
    );
    const state = startLiveStart(
      setupKarinScenario({
        mainDeckCards: [drawn],
        waitingRoomCards: [firstCandidate, secondCandidate],
        opponentMembers: {
          [SlotPosition.LEFT]: { card: alreadyWait, orientation: OrientationState.WAITING },
          [SlotPosition.RIGHT]: { card: activeLow, orientation: OrientationState.ACTIVE },
        },
      })
    );
    const session = attachSession(state);

    selectPendingAbility(
      session,
      PL_N_BP4_004_LIVE_START_STACK_NIJIGASAKI_MEMBERS_BY_OPPONENT_WAIT_COUNT_ABILITY_ID
    );

    expect(session.state?.activeEffect?.maxSelectableCards).toBe(1);
    confirmActiveEffect(session, { selectedCardIds: [secondCandidate.instanceId] });

    expect(session.state?.players[0].hand.cardIds).toContain(secondCandidate.instanceId);
    expect(session.state?.players[0].mainDeck.cardIds[0]).toBe(drawn.instanceId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_N_BP4_004_LIVE_START_STACK_NIJIGASAKI_MEMBERS_BY_OPPONENT_WAIT_COUNT_ABILITY_ID &&
          action.payload.selectedCardIds?.[0] === secondCandidate.instanceId &&
          action.payload.maxSelectableCards === 1
      )
    ).toBe(true);
  });
});
