import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  BP6_013_ON_ENTER_RECOVER_MUSE_LIVE_IF_SUCCESS_SCORE_SIX_ABILITY_ID,
  BP6_023_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_SUCCESS_MUSE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
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

function createMuseMember(cardCode: string, cost = 9): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: "μ's",
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createLive(
  cardCode: string,
  options: {
    readonly groupName?: string;
    readonly score?: number;
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: options.groupName ?? "μ's",
    cardType: CardType.LIVE,
    score: options.score ?? 4,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}

function pendingAbility(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`${abilityId}:event`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function createSessionFromGame(game: GameState): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  session.createGame('pl-bp6-013-023-success-zone', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function setupBp6013(options: {
  readonly successScore: number;
  readonly includeMuseLiveTarget?: boolean;
  readonly includeInvalidTargets?: boolean;
}) {
  const source = createCardInstance(
    createMuseMember('PL!-bp6-013-N'),
    PLAYER1,
    'bp6-013-source'
  );
  const successLive = createCardInstance(
    createLive('PL!-bp6-success-live', { score: options.successScore }),
    PLAYER1,
    'bp6-013-success-live'
  );
  const museLiveTarget =
    options.includeMuseLiveTarget === true
      ? createCardInstance(createLive('PL!-bp6-muse-live-target'), PLAYER1, 'bp6-013-muse-live')
      : null;
  const aqoursLiveTarget = createCardInstance(
    createLive('PL!S-bp6-aqours-live-target', { groupName: 'Aqours' }),
    PLAYER1,
    'bp6-013-aqours-live'
  );
  const museMemberTarget = createCardInstance(
    createMuseMember('PL!-bp6-muse-member-target', 2),
    PLAYER1,
    'bp6-013-muse-member'
  );

  let game = createGameState('pl-bp6-013-success-zone', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    successLive,
    ...(museLiveTarget ? [museLiveTarget] : []),
    ...(options.includeInvalidTargets === true ? [aqoursLiveTarget, museMemberTarget] : []),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    successZone: {
      ...player.successZone,
      cardIds: [successLive.instanceId],
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [
        ...(museLiveTarget ? [museLiveTarget.instanceId] : []),
        ...(options.includeInvalidTargets === true
          ? [aqoursLiveTarget.instanceId, museMemberTarget.instanceId]
          : []),
      ],
    },
    hand: {
      ...player.hand,
      cardIds: [],
    },
  }));

  return {
    game,
    sourceId: source.instanceId,
    museLiveTargetId: museLiveTarget?.instanceId ?? null,
    aqoursLiveTargetId: aqoursLiveTarget.instanceId,
    museMemberTargetId: museMemberTarget.instanceId,
  };
}

function startBp6013(game: GameState, sourceId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      pendingAbility(
        BP6_013_ON_ENTER_RECOVER_MUSE_LIVE_IF_SUCCESS_SCORE_SIX_ABILITY_ID,
        sourceId,
        TriggerCondition.ON_ENTER_STAGE
      ),
    ],
  }).gameState;
}

function setupBp6023(options: {
  readonly successZoneGroup?: string;
  readonly deckCount: number;
}) {
  const source = createCardInstance(
    createLive('PL!-bp6-023-L', { score: 4 }),
    PLAYER1,
    'bp6-023-source'
  );
  const successLive =
    options.successZoneGroup !== undefined
      ? createCardInstance(
          createLive('PL!-bp6-023-success-live', {
            groupName: options.successZoneGroup,
            score: 3,
          }),
          PLAYER1,
          'bp6-023-success-live'
        )
      : null;
  const drawCards = Array.from({ length: options.deckCount }, (_, index) =>
    createCardInstance(createMuseMember(`PL!-bp6-023-draw-${index}`, 2), PLAYER1, `bp6-023-draw-${index}`)
  );

  let game = createGameState('pl-bp6-023-success-zone', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...(successLive ? [successLive] : []), ...drawCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: [source.instanceId],
      cardStates: new Map([
        [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
    successZone: {
      ...player.successZone,
      cardIds: successLive ? [successLive.instanceId] : [],
    },
    mainDeck: {
      ...player.mainDeck,
      cardIds: drawCards.map((card) => card.instanceId),
    },
    hand: {
      ...player.hand,
      cardIds: [],
    },
  }));

  return {
    game,
    sourceId: source.instanceId,
    drawCardIds: drawCards.map((card) => card.instanceId),
    successLiveId: successLive?.instanceId ?? null,
  };
}

function startBp6023(game: GameState, sourceId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      pendingAbility(
        BP6_023_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_SUCCESS_MUSE_ABILITY_ID,
        sourceId,
        TriggerCondition.ON_LIVE_SUCCESS
      ),
    ],
  }).gameState;
}

function latestPayload(game: GameState, abilityId: string) {
  return game.actionHistory
    .filter((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    .at(-1)?.payload;
}

describe('PL!-bp6-013/023 success-zone workflows', () => {
  it('PL!-bp6-013-N recovers one waiting room Muse live when success score is at least six', () => {
    const scenario = setupBp6013({
      successScore: 6,
      includeMuseLiveTarget: true,
      includeInvalidTargets: true,
    });
    const started = startBp6013(scenario.game, scenario.sourceId);

    expect(started.activeEffect?.abilityId).toBe(
      BP6_013_ON_ENTER_RECOVER_MUSE_LIVE_IF_SUCCESS_SCORE_SIX_ABILITY_ID
    );
    expect(started.activeEffect?.selectableCardIds).toEqual([scenario.museLiveTargetId]);
    expect(started.activeEffect?.canSkipSelection).toBe(false);

    const session = createSessionFromGame(started);
    const result = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        scenario.museLiveTargetId ?? undefined
      )
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toContain(scenario.museLiveTargetId);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(
      scenario.museLiveTargetId
    );
  });

  it('PL!-bp6-013-N consumes pending without recovery when success score is below six', () => {
    const scenario = setupBp6013({ successScore: 5, includeMuseLiveTarget: true });
    const state = startBp6013(scenario.game, scenario.sourceId);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toEqual([]);
    expect(
      latestPayload(state, BP6_013_ON_ENTER_RECOVER_MUSE_LIVE_IF_SUCCESS_SCORE_SIX_ABILITY_ID)
    ).toMatchObject({
      successScoreConditionMet: false,
      selectableCardIds: [],
    });
  });

  it('PL!-bp6-013-N consumes pending when condition is met but no Muse live target exists', () => {
    const scenario = setupBp6013({ successScore: 6, includeInvalidTargets: true });
    const state = startBp6013(scenario.game, scenario.sourceId);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toEqual([]);
    expect(state.players[0].waitingRoom.cardIds).toEqual([
      scenario.aqoursLiveTargetId,
      scenario.museMemberTargetId,
    ]);
    expect(
      latestPayload(state, BP6_013_ON_ENTER_RECOVER_MUSE_LIVE_IF_SUCCESS_SCORE_SIX_ABILITY_ID)
    ).toMatchObject({
      successScoreConditionMet: true,
      selectableCardIds: [],
    });
  });

  it('PL!-bp6-023-L draws only one without an existing Muse success-zone card', () => {
    const scenario = setupBp6023({ deckCount: 2 });
    const state = startBp6023(scenario.game, scenario.sourceId);

    expect(state.players[0].hand.cardIds).toEqual([scenario.drawCardIds[0]]);
    expect(state.players[0].mainDeck.cardIds).toEqual([scenario.drawCardIds[1]]);
    expect(
      latestPayload(state, BP6_023_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_SUCCESS_MUSE_ABILITY_ID)
    ).toMatchObject({
      hasMuseSuccessCard: false,
      drawCount: 1,
      drawnCardIds: [scenario.drawCardIds[0]],
    });
  });

  it('PL!-bp6-023-L draws two when an existing Muse card is in success zone', () => {
    const scenario = setupBp6023({ successZoneGroup: "μ's", deckCount: 3 });
    const state = startBp6023(scenario.game, scenario.sourceId);

    expect(state.players[0].hand.cardIds).toEqual([
      scenario.drawCardIds[0],
      scenario.drawCardIds[1],
    ]);
    expect(state.players[0].mainDeck.cardIds).toEqual([scenario.drawCardIds[2]]);
    expect(
      latestPayload(state, BP6_023_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_SUCCESS_MUSE_ABILITY_ID)
    ).toMatchObject({
      hasMuseSuccessCard: true,
      drawCount: 2,
      drawnCardIds: [scenario.drawCardIds[0], scenario.drawCardIds[1]],
    });
  });

  it('PL!-bp6-023-L does not draw extra for a non-Muse success-zone card', () => {
    const scenario = setupBp6023({ successZoneGroup: 'Aqours', deckCount: 2 });
    const state = startBp6023(scenario.game, scenario.sourceId);

    expect(state.players[0].hand.cardIds).toEqual([scenario.drawCardIds[0]]);
    expect(
      latestPayload(state, BP6_023_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_SUCCESS_MUSE_ABILITY_ID)
    ).toMatchObject({
      hasMuseSuccessCard: false,
      drawCount: 1,
      drawnCardIds: [scenario.drawCardIds[0]],
    });
  });

  it('PL!-bp6-023-L keeps draw helper semantics when the deck has fewer than two cards', () => {
    const scenario = setupBp6023({ successZoneGroup: "μ's", deckCount: 1 });
    const state = startBp6023(scenario.game, scenario.sourceId);

    expect(state.players[0].hand.cardIds).toEqual([scenario.drawCardIds[0]]);
    expect(state.players[0].mainDeck.cardIds).toEqual([]);
    expect(
      latestPayload(state, BP6_023_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_SUCCESS_MUSE_ABILITY_ID)
    ).toMatchObject({
      hasMuseSuccessCard: true,
      drawCount: 2,
      drawnCardIds: [scenario.drawCardIds[0]],
    });
  });
});
