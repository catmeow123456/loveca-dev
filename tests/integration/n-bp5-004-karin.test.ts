import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import {
  N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID,
  PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID,
  PL_N_BP5_004_ON_ENTER_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
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

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createKarin(cardCode = 'PL!N-bp5-004-AR'): MemberCardData {
  return {
    cardCode,
    name: '朝香果林',
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: 7,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly blade?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 1,
    blade: options.blade ?? 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMember(`TEST-MAIN-${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`TEST-ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>): void {
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

function placeStageMembers(
  game: GameState,
  playerId: string,
  entries: readonly {
    readonly cardId: string;
    readonly slot: SlotPosition;
    readonly orientation?: OrientationState;
  }[]
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: entries.reduce(
      (zone, entry) =>
        placeCardInSlot(zone, entry.slot, entry.cardId, {
          orientation: entry.orientation ?? OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
}

function setupOnEnterState(): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly source: ReturnType<typeof createCardInstance>;
  readonly blade3Effective4: ReturnType<typeof createCardInstance>;
  readonly blade4: ReturnType<typeof createCardInstance>;
  readonly blade5: ReturnType<typeof createCardInstance>;
} {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('n-bp5-004-karin-on-enter', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(createKarin(), PLAYER1, 'p1-n-bp5-004-karin');
  const blade3Effective4 = createCardInstance(
    createMember('PL!N-test-blade-3-effective-4', { blade: 3 }),
    PLAYER2,
    'p2-blade-3-effective-4'
  );
  const blade4 = createCardInstance(
    createMember('PL!N-test-blade-4', { blade: 4 }),
    PLAYER2,
    'p2-blade-4'
  );
  const blade5 = createCardInstance(
    createMember('PL!N-test-blade-5', { blade: 5 }),
    PLAYER2,
    'p2-blade-5'
  );

  let state = registerCards(session.state!, [source, blade3Effective4, blade4, blade5]);
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [source.instanceId] },
  }));
  state = placeStageMembers(state, PLAYER2, [
    { cardId: blade3Effective4.instanceId, slot: SlotPosition.LEFT },
    { cardId: blade4.instanceId, slot: SlotPosition.CENTER },
    { cardId: blade5.instanceId, slot: SlotPosition.RIGHT },
  ]);
  state = addLiveModifier(state, {
    kind: 'BLADE',
    playerId: PLAYER2,
    countDelta: 1,
    sourceCardId: blade3Effective4.instanceId,
    abilityId: 'test-effective-blade-plus-one',
  });
  (session as unknown as { authorityState: GameState }).authorityState = state;

  return { session, source, blade3Effective4, blade4, blade5 };
}

function setupLiveStartState(options: {
  readonly opponentBlade4Waiting?: boolean;
  readonly includeRyouranLive?: boolean;
} = {}): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
  readonly liveCard?: ReturnType<typeof createCardInstance>;
  readonly blade3: ReturnType<typeof createCardInstance>;
  readonly blade4: ReturnType<typeof createCardInstance>;
  readonly blade5: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(createKarin('PL!N-bp5-004-R'), PLAYER1, 'p1-live-karin');
  const liveCard =
    options.includeRyouranLive === true
      ? createCardInstance(createLive('PL!N-bp5-030-L'), PLAYER1, 'p1-ryouran-live')
      : undefined;
  const blade3 = createCardInstance(
    createMember('PL!N-live-test-blade-3', { blade: 3 }),
    PLAYER2,
    'p2-live-blade-3'
  );
  const blade4 = createCardInstance(
    createMember('PL!N-live-test-blade-4', { blade: 4 }),
    PLAYER2,
    'p2-live-blade-4'
  );
  const blade5 = createCardInstance(
    createMember('PL!N-live-test-blade-5', { blade: 5 }),
    PLAYER2,
    'p2-live-blade-5'
  );

  let game = createGameState('n-bp5-004-karin-live-start', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...(liveCard ? [liveCard] : []), blade3, blade4, blade5]);
  game = placeStageMembers(game, PLAYER1, [
    { cardId: source.instanceId, slot: SlotPosition.CENTER },
  ]);
  if (liveCard) {
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: {
        ...player.liveZone,
        cardIds: [liveCard.instanceId],
        cardStates: new Map([
          [
            liveCard.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN },
          ],
        ]),
      },
    }));
  }
  game = placeStageMembers(game, PLAYER2, [
    { cardId: blade3.instanceId, slot: SlotPosition.LEFT },
    {
      cardId: blade4.instanceId,
      slot: SlotPosition.CENTER,
      orientation: options.opponentBlade4Waiting ? OrientationState.WAITING : OrientationState.ACTIVE,
    },
    { cardId: blade5.instanceId, slot: SlotPosition.RIGHT },
  ]);
  return { game, source, liveCard, blade3, blade4, blade5 };
}

function orientationOf(game: GameState, playerId: string, cardId: string): OrientationState | null {
  return game.players
    .find((player) => player.id === playerId)
    ?.memberSlots.cardStates.get(cardId)?.orientation ?? null;
}

function startLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function resolvePayloads(game: GameState, abilityId: string) {
  return game.actionHistory
    .filter((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    .map((action) => action.payload);
}

describe('PL!N-bp5-004 Karin wait-cost opponent original BLADE four workflow', () => {
  it('on enter waits source as cost, then only allows an active opponent printed BLADE 4 member', () => {
    const { session, source, blade3Effective4, blade4, blade5 } = setupOnEnterState();

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );
    expect(playResult.success).toBe(true);
    let state = session.state!;

    expect(state.activeEffect).toMatchObject({
      abilityId: PL_N_BP5_004_ON_ENTER_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID,
      stepId: 'N_BP5_004_SELECT_SOURCE_WAIT_COST',
      selectableCardIds: [source.instanceId],
      canSkipSelection: true,
    });

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, source.instanceId);

    expect(orientationOf(state, PLAYER1, source.instanceId)).toBe(OrientationState.WAITING);
    expect(state.activeEffect).toMatchObject({
      abilityId: PL_N_BP5_004_ON_ENTER_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID,
      stepId: 'N_BP5_004_SELECT_OPPONENT_ORIGINAL_BLADE_FOUR_MEMBER_TO_WAIT',
      selectableCardIds: [blade4.instanceId],
    });
    expect(state.activeEffect?.selectableCardIds).not.toContain(blade3Effective4.instanceId);
    expect(state.activeEffect?.selectableCardIds).not.toContain(blade5.instanceId);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, blade4.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(orientationOf(state, PLAYER2, blade4.instanceId)).toBe(OrientationState.WAITING);
    expect(orientationOf(state, PLAYER2, blade3Effective4.instanceId)).toBe(OrientationState.ACTIVE);
    expect(orientationOf(state, PLAYER2, blade5.instanceId)).toBe(OrientationState.ACTIVE);
    expect(resolvePayloads(
      state,
      PL_N_BP5_004_ON_ENTER_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID
    )).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'START_SELECT_SOURCE_WAIT_COST' }),
        expect.objectContaining({ step: 'START_SELECT_OPPONENT_ORIGINAL_BLADE_FOUR_MEMBER' }),
        expect.objectContaining({
          step: 'WAIT_OPPONENT_ORIGINAL_BLADE_FOUR_MEMBER',
          targetCardId: blade4.instanceId,
          targetPrintedBlade: 4,
        }),
      ])
    );
    expect(
      state.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(2);
  });

  it('can resolve the same effect from LIVE_START', () => {
    const { game, source, blade4 } = setupLiveStartState();

    let state = startLiveStart(game);

    expect(state.activeEffect?.abilityId).toBe(
      PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID
    );

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, source.instanceId);
    expect(state.activeEffect?.selectableCardIds).toEqual([blade4.instanceId]);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, blade4.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(orientationOf(state, PLAYER1, source.instanceId)).toBe(OrientationState.WAITING);
    expect(orientationOf(state, PLAYER2, blade4.instanceId)).toBe(OrientationState.WAITING);
    expect(resolvePayloads(
      state,
      PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID
    ).at(-1)).toMatchObject({
      step: 'WAIT_OPPONENT_ORIGINAL_BLADE_FOUR_MEMBER',
      targetCardId: blade4.instanceId,
    });
  });

  it('lets the player decline without changing the source or opponent target', () => {
    const { game, source, blade4 } = setupLiveStartState();

    const started = startLiveStart(game);
    const declined = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);

    expect(declined.activeEffect).toBeNull();
    expect(declined.pendingAbilities).toEqual([]);
    expect(orientationOf(declined, PLAYER1, source.instanceId)).toBe(OrientationState.ACTIVE);
    expect(orientationOf(declined, PLAYER2, blade4.instanceId)).toBe(OrientationState.ACTIVE);
    expect(resolvePayloads(
      declined,
      PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID
    ).at(-1)).toMatchObject({
      step: 'SKIP_SOURCE_WAIT_COST',
    });
  });

  it('keeps the paid source WAITING and no-ops when no active opponent printed BLADE 4 target remains', () => {
    const { game, source, blade3, blade4, blade5 } = setupLiveStartState({
      opponentBlade4Waiting: true,
    });

    const started = startLiveStart(game);
    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, source.instanceId);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(orientationOf(resolved, PLAYER1, source.instanceId)).toBe(OrientationState.WAITING);
    expect(orientationOf(resolved, PLAYER2, blade3.instanceId)).toBe(OrientationState.ACTIVE);
    expect(orientationOf(resolved, PLAYER2, blade4.instanceId)).toBe(OrientationState.WAITING);
    expect(orientationOf(resolved, PLAYER2, blade5.instanceId)).toBe(OrientationState.ACTIVE);
    expect(resolvePayloads(
      resolved,
      PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID
    ).at(-1)).toMatchObject({
      step: 'NO_OPPONENT_ORIGINAL_BLADE_FOUR_TARGET_AFTER_COST',
      paidCostCardId: source.instanceId,
    });
  });

  it('still triggers Ryouran ALL Heart when LIVE_START no-ops after Karin pays source WAITING cost', () => {
    const { game, source, liveCard } = setupLiveStartState({
      opponentBlade4Waiting: true,
      includeRyouranLive: true,
    });

    const started = startLiveStart(game);
    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, source.instanceId);

    expect(resolved.activeEffect).toBeNull();
    expect(orientationOf(resolved, PLAYER1, source.instanceId)).toBe(OrientationState.WAITING);
    expect(resolvePayloads(
      resolved,
      PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID
    ).at(-1)).toMatchObject({
      step: 'NO_OPPONENT_ORIGINAL_BLADE_FOUR_TARGET_AFTER_COST',
    });
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: source.instanceId,
      sourceCardId: liveCard?.instanceId,
      abilityId: N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID,
      hearts: [{ color: HeartColor.RAINBOW, count: 1 }],
    });
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID &&
          action.payload.resolvedAbilityId ===
            PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID &&
          action.payload.targetMemberId === source.instanceId &&
          action.payload.step === 'RYOURAN_GAIN_ALL_HEART'
      )
    ).toBe(true);
  });
});
