import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addMemberBelowMember, placeCardInSlot } from '../../src/domain/entities/zone';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import {
  N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID,
  PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID,
  PL_N_BP5_004_ON_ENTER_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID,
  PL_N_BP3_017_023_LIVE_START_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID,
  PL_N_BP3_017_023_ON_ENTER_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID,
  PL_PR_007_009_LIVE_START_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID,
  PL_PR_007_009_ON_ENTER_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID,
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

function activateSourceWaitCost(game: GameState): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    null,
    null,
    undefined,
    'activate'
  );
}

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

type CostLteFourWaitCardCode =
  | 'PL!N-bp3-017-N'
  | 'PL!N-bp3-023-N'
  | 'PL!S-bp3-012-N'
  | 'PL!S-bp3-017-N'
  | 'PL!-PR-007-PR'
  | 'PL!-PR-009-PR';

function createCostLteFourWaitSource(cardCode: CostLteFourWaitCardCode): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: cardCode.startsWith('PL!S-')
      ? ['Aqours']
      : cardCode.startsWith('PL!-PR-')
        ? ["μ's"]
        : ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 2,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
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
  const energyDeck = Array.from({ length: 12 }, (_, index) =>
    createEnergyCard(`TEST-ENE-${index}`)
  );
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

function setupLiveStartState(
  options: {
    readonly opponentBlade4Waiting?: boolean;
    readonly includeRyouranLive?: boolean;
  } = {}
): {
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
      orientation: options.opponentBlade4Waiting
        ? OrientationState.WAITING
        : OrientationState.ACTIVE,
    },
    { cardId: blade5.instanceId, slot: SlotPosition.RIGHT },
  ]);
  return { game, source, liveCard, blade3, blade4, blade5 };
}

function orientationOf(game: GameState, playerId: string, cardId: string): OrientationState | null {
  return (
    game.players.find((player) => player.id === playerId)?.memberSlots.cardStates.get(cardId)
      ?.orientation ?? null
  );
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

function setupBp3LiveStart(cardCode: CostLteFourWaitCardCode) {
  const source = createCardInstance(
    createCostLteFourWaitSource(cardCode),
    PLAYER1,
    `${cardCode}-source`
  );
  const cost4 = createCardInstance(
    createMember('TEST-COST-4', { cost: 4 }),
    PLAYER2,
    `${cardCode}-cost4`
  );
  const cost5 = createCardInstance(
    createMember('TEST-COST-5', { cost: 5 }),
    PLAYER2,
    `${cardCode}-cost5`
  );
  const waitingCost3 = createCardInstance(
    createMember('TEST-WAITING-COST-3', { cost: 3 }),
    PLAYER2,
    `${cardCode}-waiting-cost3`
  );
  const ownCost2 = createCardInstance(
    createMember('TEST-OWN-COST-2', { cost: 2 }),
    PLAYER1,
    `${cardCode}-own-cost2`
  );
  const belowCost1 = createCardInstance(
    createMember('TEST-BELOW-COST-1', { cost: 1 }),
    PLAYER2,
    `${cardCode}-below-cost1`
  );
  let game = createGameState(`${cardCode}-live-start`, PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, cost4, cost5, waitingCost3, ownCost2, belowCost1]);
  game = placeStageMembers(game, PLAYER1, [
    { cardId: source.instanceId, slot: SlotPosition.CENTER },
    { cardId: ownCost2.instanceId, slot: SlotPosition.LEFT },
  ]);
  game = placeStageMembers(game, PLAYER2, [
    { cardId: cost4.instanceId, slot: SlotPosition.LEFT },
    { cardId: cost5.instanceId, slot: SlotPosition.CENTER },
    {
      cardId: waitingCost3.instanceId,
      slot: SlotPosition.RIGHT,
      orientation: OrientationState.WAITING,
    },
  ]);
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: addMemberBelowMember(
      player.memberSlots,
      SlotPosition.CENTER,
      belowCost1.instanceId
    ),
  }));
  return { game, source, cost4, cost5, waitingCost3, ownCost2, belowCost1 };
}

function playBp3Source(cardCode: CostLteFourWaitCardCode) {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame(`${cardCode}-on-enter`, PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);
  const source = createCardInstance(
    createCostLteFourWaitSource(cardCode),
    PLAYER1,
    `${cardCode}-on-enter-source`
  );
  const target = createCardInstance(
    createMember('TEST-ON-ENTER-COST-4', { cost: 4 }),
    PLAYER2,
    `${cardCode}-on-enter-target`
  );
  let state = registerCards(session.state!, [source, target]);
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [source.instanceId] },
  }));
  state = placeStageMembers(state, PLAYER2, [
    { cardId: target.instanceId, slot: SlotPosition.CENTER },
  ]);
  (session as unknown as { authorityState: GameState }).authorityState = state;
  expect(
    session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    ).success
  ).toBe(true);
  return { session, source, target };
}

describe('PL!N-bp3-017 / 023 shared cost <= 4 configuration', () => {
  for (const cardCode of [
    'PL!N-bp3-017-N',
    'PL!N-bp3-023-N',
    'PL!S-bp3-012-N',
    'PL!S-bp3-017-N',
  ] as const) {
    it(`reuses both ON_ENTER and LIVE_START definitions for ${cardCode}`, () => {
      const entered = playBp3Source(cardCode);
      expect(entered.session.state?.activeEffect?.abilityId).toBe(
        PL_N_BP3_017_023_ON_ENTER_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID
      );
      const live = startLiveStart(setupBp3LiveStart(cardCode).game);
      expect(live.activeEffect?.abilityId).toBe(
        PL_N_BP3_017_023_LIVE_START_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID
      );
    });
  }

  for (const cardCode of ['PL!-PR-007-PR', 'PL!-PR-009-PR'] as const) {
    it(`uses the PR identities and exact player copy through real ON_ENTER and LIVE_START for ${cardCode}`, () => {
      const effectText =
        '【登场】/【LIVE开始时】可以将此成员变为待机状态：将存在于对方的舞台的1名费用小于等于4的成员变为待机状态。（待机状态的成员持有的[ブレード]，在声援时不能增加公开张数。）';
      const entered = playBp3Source(cardCode);
      let enteredState = entered.session.state!;
      expect(enteredState.activeEffect).toMatchObject({
        abilityId: PL_PR_007_009_ON_ENTER_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID,
        effectText,
        stepText:
          '可以将此成员变为待机状态。如此做后，选择对方舞台上1名费用小于等于4且当前非待机的成员变为待机状态。',
        selectableOptions: [{ id: 'activate', label: '发动' }],
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
      });
      expect(enteredState.activeEffect?.selectableCardIds).toBeUndefined();
      enteredState = activateSourceWaitCost(enteredState);
      expect(enteredState.activeEffect).toMatchObject({
        selectionLabel: '选择对方舞台上费用小于等于4的成员',
        confirmSelectionLabel: '变为待机状态',
        stepText:
          '请选择对方舞台上1名费用小于等于4且当前非待机的成员变为待机状态。',
      });
      enteredState = confirmActiveEffectStep(
        enteredState,
        PLAYER1,
        enteredState.activeEffect!.id,
        entered.target.instanceId
      );
      expect(orientationOf(enteredState, PLAYER1, entered.source.instanceId)).toBe(
        OrientationState.WAITING
      );
      expect(orientationOf(enteredState, PLAYER2, entered.target.instanceId)).toBe(
        OrientationState.WAITING
      );

      const liveSetup = setupBp3LiveStart(cardCode);
      const live = startLiveStart(liveSetup.game);
      expect(live.activeEffect).toMatchObject({
        abilityId: PL_PR_007_009_LIVE_START_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID,
        effectText,
      });
    });
  }

  it('resolves PL!N-bp3-017-N ON_ENTER by waiting source then a cost 4 opponent member', () => {
    const { session, source, target } = playBp3Source('PL!N-bp3-017-N');
    let state = session.state!;
    expect(state.activeEffect?.abilityId).toBe(
      PL_N_BP3_017_023_ON_ENTER_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID
    );
    expect(state.activeEffect).toMatchObject({
      selectableOptions: [{ id: 'activate', label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(state.activeEffect?.selectableCardIds).toBeUndefined();
    state = activateSourceWaitCost(state);
    expect(state.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, target.instanceId);
    expect(orientationOf(state, PLAYER1, source.instanceId)).toBe(OrientationState.WAITING);
    expect(orientationOf(state, PLAYER2, target.instanceId)).toBe(OrientationState.WAITING);
  });

  it('resolves PL!N-bp3-017-N LIVE_START and filters cost 5, WAITING, own, and memberBelow cards', () => {
    const { game, source, cost4, cost5, waitingCost3, ownCost2, belowCost1 } =
      setupBp3LiveStart('PL!N-bp3-017-N');
    let state = startLiveStart(game);
    expect(state.activeEffect?.abilityId).toBe(
      PL_N_BP3_017_023_LIVE_START_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID
    );
    state = activateSourceWaitCost(state);
    expect(state.activeEffect?.selectableCardIds).toEqual([cost4.instanceId]);
    expect(state.activeEffect?.selectableCardIds).not.toEqual(
      expect.arrayContaining([
        cost5.instanceId,
        waitingCost3.instanceId,
        ownCost2.instanceId,
        belowCost1.instanceId,
      ])
    );
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, cost4.instanceId);
    expect(orientationOf(state, PLAYER2, cost4.instanceId)).toBe(OrientationState.WAITING);
  });

  it('uses the same ON_ENTER and LIVE_START workflow ability ids for PL!N-bp3-023-N', () => {
    const entered = playBp3Source('PL!N-bp3-023-N');
    expect(entered.session.state?.activeEffect?.abilityId).toBe(
      PL_N_BP3_017_023_ON_ENTER_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID
    );
    const live = startLiveStart(setupBp3LiveStart('PL!N-bp3-023-N').game);
    expect(live.activeEffect?.abilityId).toBe(
      PL_N_BP3_017_023_LIVE_START_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID
    );
  });

  it('declines without changing either member and continues pending', () => {
    const { game, source, cost4 } = setupBp3LiveStart('PL!N-bp3-017-N');
    const started = startLiveStart(game);
    const declined = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);
    expect(declined.activeEffect).toBeNull();
    expect(declined.pendingAbilities).toEqual([]);
    expect(orientationOf(declined, PLAYER1, source.instanceId)).toBe(OrientationState.ACTIVE);
    expect(orientationOf(declined, PLAYER2, cost4.instanceId)).toBe(OrientationState.ACTIVE);
  });

  it('does not pay when source is already WAITING or has left the main stage', () => {
    for (const sourcePlacement of ['WAITING', 'ABSENT'] as const) {
      const setup = setupBp3LiveStart('PL!N-bp3-017-N');
      let game = setup.game;
      game = updatePlayer(game, PLAYER1, (player) => {
        const memberSlots =
          sourcePlacement === 'WAITING'
            ? {
                ...player.memberSlots,
                cardStates: new Map(player.memberSlots.cardStates).set(setup.source.instanceId, {
                  orientation: OrientationState.WAITING,
                  face: FaceState.FACE_UP,
                }),
              }
            : {
                ...player.memberSlots,
                slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
                cardStates: new Map(
                  [...player.memberSlots.cardStates].filter(
                    ([id]) => id !== setup.source.instanceId
                  )
                ),
              };
        return { ...player, memberSlots };
      });
      const resolved = startLiveStart(game);
      expect(resolved.activeEffect).toBeNull();
      expect(resolved.pendingAbilities).toEqual([]);
      expect(orientationOf(resolved, PLAYER2, setup.cost4.instanceId)).toBe(
        OrientationState.ACTIVE
      );
    }
  });

  it('keeps the active window unchanged for an illegal activation option or target input', () => {
    const setup = setupBp3LiveStart('PL!N-bp3-017-N');
    let state = startLiveStart(setup.game);
    const invalidSource = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      null,
      null,
      undefined,
      'invalid-option'
    );
    expect(invalidSource).toBe(state);
    state = activateSourceWaitCost(state);
    const invalidTarget = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      setup.cost5.instanceId
    );
    expect(invalidTarget).toBe(state);
  });

  it('does not pay when the fixed source becomes WAITING or leaves before activation is confirmed', () => {
    for (const sourceState of ['WAITING', 'ABSENT'] as const) {
      const setup = setupBp3LiveStart('PL!-PR-007-PR');
      let state = startLiveStart(setup.game);
      state = updatePlayer(state, PLAYER1, (player) => ({
        ...player,
        memberSlots:
          sourceState === 'WAITING'
            ? {
                ...player.memberSlots,
                cardStates: new Map(player.memberSlots.cardStates).set(setup.source.instanceId, {
                  orientation: OrientationState.WAITING,
                  face: FaceState.FACE_UP,
                }),
              }
            : {
                ...player.memberSlots,
                slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
                cardStates: new Map(
                  [...player.memberSlots.cardStates].filter(
                    ([id]) => id !== setup.source.instanceId
                  )
                ),
              },
      }));

      const resolved = activateSourceWaitCost(state);

      expect(resolved.activeEffect).toBeNull();
      expect(resolved.pendingAbilities).toEqual([]);
      expect(orientationOf(resolved, PLAYER2, setup.cost4.instanceId)).toBe(
        OrientationState.ACTIVE
      );
      expect(
        resolvePayloads(
          resolved,
          PL_PR_007_009_LIVE_START_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID
        ).at(-1)
      ).toMatchObject({ step: 'SKIP_SOURCE_NOT_ACTIVE_AT_COST' });
    }
  });

  it('keeps paid source WAITING, records stale no-target, and continues when the selected target is no longer legal', () => {
    const setup = setupBp3LiveStart('PL!N-bp3-017-N');
    let state = startLiveStart(setup.game);
    state = activateSourceWaitCost(state);
    state = updatePlayer(state, PLAYER2, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set(setup.cost4.instanceId, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    const stale = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      setup.cost4.instanceId
    );
    expect(stale.activeEffect).toBeNull();
    expect(stale.pendingAbilities).toEqual([]);
    expect(orientationOf(stale, PLAYER1, setup.source.instanceId)).toBe(OrientationState.WAITING);
    expect(
      stale.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(1);
    expect(
      resolvePayloads(
        stale,
        PL_N_BP3_017_023_LIVE_START_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID
      ).at(-1)
    ).toMatchObject({
      step: 'STALE_NO_OPPONENT_COST_LTE_FOUR_TARGET',
      staleTargetCardId: setup.cost4.instanceId,
      targetKind: 'COST_LTE_FOUR',
      targetMaxCost: 4,
    });
  });

  it('refreshes candidates when the selected target is stale but another legal target remains', () => {
    const setup = setupBp3LiveStart('PL!N-bp3-017-N');
    let game = updatePlayer(setup.game, PLAYER2, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set(setup.waitingCost3.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    let state = startLiveStart(game);
    state = activateSourceWaitCost(state);
    expect(state.activeEffect?.selectableCardIds).toEqual([
      setup.cost4.instanceId,
      setup.waitingCost3.instanceId,
    ]);
    state = updatePlayer(state, PLAYER2, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set(setup.cost4.instanceId, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    const refreshed = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      setup.cost4.instanceId
    );
    expect(refreshed.activeEffect?.selectableCardIds).toEqual([setup.waitingCost3.instanceId]);
    expect(orientationOf(refreshed, PLAYER1, setup.source.instanceId)).toBe(
      OrientationState.WAITING
    );
    expect(orientationOf(refreshed, PLAYER2, setup.waitingCost3.instanceId)).toBe(
      OrientationState.ACTIVE
    );
    expect(
      refreshed.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(1);
  });

  it('keeps the paid source WAITING, clears activeEffect, and continues when no legal target remains after payment', () => {
    const setup = setupBp3LiveStart('PL!N-bp3-017-N');
    let state = startLiveStart(setup.game);
    state = updatePlayer(state, PLAYER2, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set(setup.cost4.instanceId, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    state = activateSourceWaitCost(state);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(orientationOf(state, PLAYER1, setup.source.instanceId)).toBe(OrientationState.WAITING);
    expect(
      resolvePayloads(
        state,
        PL_N_BP3_017_023_LIVE_START_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID
      ).at(-1)
    ).toMatchObject({
      step: 'NO_OPPONENT_COST_LTE_FOUR_TARGET_AFTER_COST',
      paidCostCardId: setup.source.instanceId,
    });
  });

  it('records source and target state-change events in cost-then-target order', () => {
    const setup = setupBp3LiveStart('PL!N-bp3-023-N');
    let state = startLiveStart(setup.game);
    state = activateSourceWaitCost(state);
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, setup.cost4.instanceId);
    const events = state.eventLog.filter(
      (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
    );
    expect(events.map((entry) => entry.event.cardInstanceId)).toEqual([
      setup.source.instanceId,
      setup.cost4.instanceId,
    ]);
    expect(
      resolvePayloads(
        state,
        PL_N_BP3_017_023_LIVE_START_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID
      ).at(-1)
    ).toMatchObject({
      step: 'WAIT_OPPONENT_COST_LTE_FOUR_MEMBER',
      targetKind: 'COST_LTE_FOUR',
      targetMaxCost: 4,
    });
  });

  it('ignores a repeated target confirmation after the PR effect has resolved', () => {
    const setup = setupBp3LiveStart('PL!-PR-009-PR');
    let state = startLiveStart(setup.game);
    state = activateSourceWaitCost(state);
    const effectId = state.activeEffect!.id;
    state = confirmActiveEffectStep(state, PLAYER1, effectId, setup.cost4.instanceId);
    const eventCount = state.eventLog.filter(
      (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
    ).length;
    const repeated = confirmActiveEffectStep(state, PLAYER1, effectId, setup.cost4.instanceId);
    expect(repeated).toBe(state);
    expect(
      repeated.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(eventCount);
  });

  it('continues ordered resolution from PR-007 into PR-009 without an extra confirm-only window', () => {
    const setup = setupBp3LiveStart('PL!-PR-007-PR');
    const secondSource = createCardInstance(
      createCostLteFourWaitSource('PL!-PR-009-PR'),
      PLAYER1,
      'ordered-second-source'
    );
    let game = registerCards(setup.game, [secondSource]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.RIGHT,
        secondSource.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
    }));
    let state = startLiveStart(game);
    expect(state.activeEffect).toMatchObject({ canResolveInOrder: true });
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, null, null, true);
    expect(state.activeEffect?.metadata).toMatchObject({ orderedResolution: true });
    const firstSourceId = state.activeEffect!.sourceCardId;
    expect(state.activeEffect?.sourceCardId).toBe(firstSourceId);
    state = activateSourceWaitCost(state);
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, setup.cost4.instanceId);
    expect(state.activeEffect).toMatchObject({
      abilityId: PL_PR_007_009_LIVE_START_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID,
      stepId: 'WAIT_SELF_OPPONENT_WAIT_CHOOSE_ACTIVATION',
      selectableOptions: [{ id: 'activate', label: '发动' }],
      sourceCardId: [setup.source.instanceId, secondSource.instanceId].find(
        (cardId) => cardId !== firstSourceId
      ),
      metadata: expect.objectContaining({ orderedResolution: true }),
    });
  });
});

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
      stepId: 'WAIT_SELF_OPPONENT_WAIT_CHOOSE_ACTIVATION',
      selectableOptions: [{ id: 'activate', label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(state.activeEffect?.selectableCardIds).toBeUndefined();

    state = activateSourceWaitCost(state);

    expect(orientationOf(state, PLAYER1, source.instanceId)).toBe(OrientationState.WAITING);
    expect(state.activeEffect).toMatchObject({
      abilityId: PL_N_BP5_004_ON_ENTER_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID,
      stepId: 'WAIT_SELF_OPPONENT_WAIT_SELECT_TARGET',
      selectableCardIds: [blade4.instanceId],
    });
    expect(state.activeEffect?.selectableCardIds).not.toContain(blade3Effective4.instanceId);
    expect(state.activeEffect?.selectableCardIds).not.toContain(blade5.instanceId);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, blade4.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(orientationOf(state, PLAYER2, blade4.instanceId)).toBe(OrientationState.WAITING);
    expect(orientationOf(state, PLAYER2, blade3Effective4.instanceId)).toBe(
      OrientationState.ACTIVE
    );
    expect(orientationOf(state, PLAYER2, blade5.instanceId)).toBe(OrientationState.ACTIVE);
    expect(
      resolvePayloads(
        state,
        PL_N_BP5_004_ON_ENTER_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'START_CHOOSE_SOURCE_WAIT_COST' }),
        expect.objectContaining({
          step: 'START_SELECT_OPPONENT_ORIGINAL_BLADE_FOUR_MEMBER',
        }),
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

    state = activateSourceWaitCost(state);
    expect(state.activeEffect?.selectableCardIds).toEqual([blade4.instanceId]);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, blade4.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(orientationOf(state, PLAYER1, source.instanceId)).toBe(OrientationState.WAITING);
    expect(orientationOf(state, PLAYER2, blade4.instanceId)).toBe(OrientationState.WAITING);
    expect(
      resolvePayloads(
        state,
        PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID
      ).at(-1)
    ).toMatchObject({
      step: 'WAIT_OPPONENT_ORIGINAL_BLADE_FOUR_MEMBER',
      targetCardId: blade4.instanceId,
      targetPrintedBlade: 4,
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
    expect(
      resolvePayloads(
        declined,
        PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID
      ).at(-1)
    ).toMatchObject({
      step: 'SKIP_SOURCE_WAIT_COST',
    });
  });

  it('keeps the paid source WAITING and no-ops when no active opponent printed BLADE 4 target remains', () => {
    const { game, source, blade3, blade4, blade5 } = setupLiveStartState({
      opponentBlade4Waiting: true,
    });

    const started = startLiveStart(game);
    const resolved = activateSourceWaitCost(started);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(orientationOf(resolved, PLAYER1, source.instanceId)).toBe(OrientationState.WAITING);
    expect(orientationOf(resolved, PLAYER2, blade3.instanceId)).toBe(OrientationState.ACTIVE);
    expect(orientationOf(resolved, PLAYER2, blade4.instanceId)).toBe(OrientationState.WAITING);
    expect(orientationOf(resolved, PLAYER2, blade5.instanceId)).toBe(OrientationState.ACTIVE);
    expect(
      resolvePayloads(
        resolved,
        PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID
      ).at(-1)
    ).toMatchObject({
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
    const resolved = activateSourceWaitCost(started);

    expect(resolved.activeEffect).toBeNull();
    expect(orientationOf(resolved, PLAYER1, source.instanceId)).toBe(OrientationState.WAITING);
    expect(
      resolvePayloads(
        resolved,
        PL_N_BP5_004_LIVE_START_WAIT_SELF_OPPONENT_ORIGINAL_BLADE_FOUR_WAIT_ABILITY_ID
      ).at(-1)
    ).toMatchObject({
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
