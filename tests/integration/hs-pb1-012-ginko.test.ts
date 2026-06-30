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
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  name: string,
  cost = 1,
  groupName = '蓮ノ空',
  blade = 1
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost,
    blade,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string, name: string, groupName = '蓮ノ空'): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: `Energy ${cardCode}`,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMemberCard(`MEM-${index}`, `Member ${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
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

function createTestMemberInstances(
  ownerId: string,
  prefix: string,
  count: number
): ReturnType<typeof createCardInstance>[] {
  return Array.from({ length: count }, (_, index) =>
    createCardInstance(
      createMemberCard(`PL!HS-test-${prefix}-${index}`, `${prefix} member ${index}`),
      ownerId,
      `${ownerId}-${prefix}-${index}`
    )
  );
}

function setupHsPb1012Scenario(config: {
  readonly ownMemberCount: number;
  readonly opponentMemberCount: number;
  readonly includeLiveTarget: boolean;
}): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly ginkoId: string;
  readonly ownMemberIds: readonly string[];
  readonly opponentMemberIds: readonly string[];
  readonly liveTargetId: string | null;
  readonly ownDeckFillerId: string;
  readonly opponentDeckFillerId: string;
} {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame(
    `hs-pb1-012-ginko-${config.ownMemberCount}-${config.opponentMemberCount}-${config.includeLiveTarget}`,
    PLAYER1,
    'Player 1',
    PLAYER2,
    'Player 2'
  );
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const ginko = createCardInstance(
    createMemberCard('PL!HS-pb1-012-R', '百生吟子', 13, '蓮ノ空', 3),
    PLAYER1,
    'p1-pb1-012-ginko'
  );
  const ownMembers = createTestMemberInstances(PLAYER1, 'pb1-012-own', config.ownMemberCount);
  const opponentMembers = createTestMemberInstances(
    PLAYER2,
    'pb1-012-opponent',
    config.opponentMemberCount
  );
  const ownDeckFiller = createCardInstance(
    createLiveCard('PL!HS-test-pb1-012-own-filler', 'Own Filler Live'),
    PLAYER1,
    'p1-pb1-012-own-filler'
  );
  const opponentDeckFiller = createCardInstance(
    createLiveCard('PL!HS-test-pb1-012-opponent-filler', 'Opponent Filler Live'),
    PLAYER2,
    'p2-pb1-012-opponent-filler'
  );
  const liveTarget = config.includeLiveTarget
    ? createCardInstance(
        createLiveCard('PL!HS-test-pb1-012-live', 'Recoverable Live'),
        PLAYER1,
        'p1-pb1-012-live'
      )
    : null;

  let state = registerCards(session.state!, [
    ginko,
    ...ownMembers,
    ...opponentMembers,
    ownDeckFiller,
    opponentDeckFiller,
    ...(liveTarget ? [liveTarget] : []),
  ]);
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [ginko.instanceId] },
    mainDeck: { ...player.mainDeck, cardIds: [ownDeckFiller.instanceId] },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [
        ...ownMembers.map((card) => card.instanceId),
        ...(liveTarget ? [liveTarget.instanceId] : []),
      ],
    },
    successZone: { ...player.successZone, cardIds: [] },
    liveZone: { ...player.liveZone, cardIds: [] },
    memberSlots: {
      ...player.memberSlots,
      slots: {
        [SlotPosition.LEFT]: null,
        [SlotPosition.CENTER]: null,
        [SlotPosition.RIGHT]: null,
      },
      cardStates: new Map(),
    },
  }));
  state = updatePlayer(state, PLAYER2, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    mainDeck: { ...player.mainDeck, cardIds: [opponentDeckFiller.instanceId] },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: opponentMembers.map((card) => card.instanceId),
    },
    successZone: { ...player.successZone, cardIds: [] },
    liveZone: { ...player.liveZone, cardIds: [] },
  }));
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const playResult = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, ginko.instanceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(playResult.success).toBe(true);

  return {
    session,
    ginkoId: ginko.instanceId,
    ownMemberIds: ownMembers.map((card) => card.instanceId),
    opponentMemberIds: opponentMembers.map((card) => card.instanceId),
    liveTargetId: liveTarget?.instanceId ?? null,
    ownDeckFillerId: ownDeckFiller.instanceId,
    opponentDeckFillerId: opponentDeckFiller.instanceId,
  };
}

describe('HS-pb1-012 Ginko recycle members workflow', () => {
  it('re-reads both waiting rooms on confirm before checking the moved member count', () => {
    const {
      session,
      ginkoId,
      ownMemberIds,
      opponentMemberIds,
      ownDeckFillerId,
      opponentDeckFillerId,
    } = setupHsPb1012Scenario({
      ownMemberCount: 9,
      opponentMemberCount: 9,
      includeLiveTarget: false,
    });

    const lateOwnMember = createCardInstance(
      createMemberCard('PL!HS-test-pb1-012-late-own', 'late own member'),
      PLAYER1,
      'p1-pb1-012-late-own'
    );
    const lateOpponentMember = createCardInstance(
      createMemberCard('PL!HS-test-pb1-012-late-opponent', 'late opponent member'),
      PLAYER2,
      'p2-pb1-012-late-opponent'
    );
    let state = registerCards(session.state!, [lateOwnMember, lateOpponentMember]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, lateOwnMember.instanceId],
      },
    }));
    state = updatePlayer(state, PLAYER2, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, lateOpponentMember.instanceId],
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    expect(session.state?.activeEffect?.metadata?.totalWaitingRoomMemberCount).toBe(18);

    const recycleResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'continue'
      )
    );

    const expectedOwnMoved = [...ownMemberIds, lateOwnMember.instanceId];
    const expectedOpponentMoved = [...opponentMemberIds, lateOpponentMember.instanceId];
    expect(recycleResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(new Set(session.state?.players[0].mainDeck.cardIds)).toEqual(
      new Set([ownDeckFillerId, ...expectedOwnMoved])
    );
    expect(new Set(session.state?.players[1].mainDeck.cardIds)).toEqual(
      new Set([opponentDeckFillerId, ...expectedOpponentMoved])
    );
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: ginkoId,
      abilityId: HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID,
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID &&
          action.payload.step === 'RECYCLE_MEMBERS_NO_LIVE_TARGET_GAIN_BLADE' &&
          Array.isArray(action.payload.movedOwnMemberCardIds) &&
          action.payload.movedOwnMemberCardIds.length === expectedOwnMoved.length &&
          Array.isArray(action.payload.movedOpponentMemberCardIds) &&
          action.payload.movedOpponentMemberCardIds.length === expectedOpponentMoved.length &&
          action.payload.totalMovedMemberCount === 20 &&
          action.payload.bladeBonus === 2
      )
    ).toBe(true);
  });

  it('recovers a waiting-room Live before adding Blade and preserves finish payload fields', () => {
    const { session, ginkoId, liveTargetId } = setupHsPb1012Scenario({
      ownMemberCount: 12,
      opponentMemberCount: 8,
      includeLiveTarget: true,
    });

    expect(liveTargetId).not.toBeNull();

    const recycleResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'continue'
      )
    );

    expect(recycleResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('HS_PB1_012_SELECT_WAITING_ROOM_LIVE');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([liveTargetId]);

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, liveTargetId)
    );

    expect(recoverResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([liveTargetId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: ginkoId,
      abilityId: HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID,
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID &&
          action.payload.step === 'RECOVER_LIVE_GAIN_BLADE' &&
          action.payload.selectedCardId === liveTargetId &&
          Array.isArray(action.payload.movedOwnMemberCardIds) &&
          action.payload.movedOwnMemberCardIds.length === 12 &&
          Array.isArray(action.payload.movedOpponentMemberCardIds) &&
          action.payload.movedOpponentMemberCardIds.length === 8 &&
          action.payload.totalMovedMemberCount === 20 &&
          action.payload.bladeBonus === 2
      )
    ).toBe(true);
  });
});
