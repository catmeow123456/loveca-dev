import {
  confirmActiveEffectStepThroughPublicReveal,
  confirmPublicSelectionIfNeeded,
} from '../helpers/public-card-selection-confirmation';
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
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  BP6_013_ON_ENTER_RECOVER_MUSE_LIVE_IF_SUCCESS_SCORE_SIX_ABILITY_ID,
  BP6_023_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_SUCCESS_MUSE_ABILITY_ID,
  PL_PB1_032_LIVE_SUCCESS_HAS_MUSE_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID,
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
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMuseMember(cardCode: string, cost = 9): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createLive(
  cardCode: string,
  options: {
    readonly groupNames?: readonly string[];
    readonly score?: number;
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: options.groupNames ?? ["μ's"],
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
  const source = createCardInstance(createMuseMember('PL!-bp6-013-N'), PLAYER1, 'bp6-013-source');
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
    createLive('PL!S-bp6-aqours-live-target', { groupNames: ['Aqours'] }),
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
  return confirmIfConfirmOnly(
    resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pendingAbility(
          BP6_013_ON_ENTER_RECOVER_MUSE_LIVE_IF_SUCCESS_SCORE_SIX_ABILITY_ID,
          sourceId,
          TriggerCondition.ON_ENTER_STAGE
        ),
      ],
    }).gameState,
    PLAYER1
  );
}

function setupBp6023(options: { readonly successZoneGroup?: string; readonly deckCount: number }) {
  const source = createCardInstance(
    createLive('PL!-bp6-023-L', { score: 4 }),
    PLAYER1,
    'bp6-023-source'
  );
  const successLive =
    options.successZoneGroup !== undefined
      ? createCardInstance(
          createLive('PL!-bp6-023-success-live', {
            groupNames: [options.successZoneGroup],
            score: 3,
          }),
          PLAYER1,
          'bp6-023-success-live'
        )
      : null;
  const drawCards = Array.from({ length: options.deckCount }, (_, index) =>
    createCardInstance(
      createMuseMember(`PL!-bp6-023-draw-${index}`, 2),
      PLAYER1,
      `bp6-023-draw-${index}`
    )
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
  return confirmIfConfirmOnly(
    resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pendingAbility(
          BP6_023_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_SUCCESS_MUSE_ABILITY_ID,
          sourceId,
          TriggerCondition.ON_LIVE_SUCCESS
        ),
      ],
    }).gameState,
    PLAYER1
  );
}

function setupPb1032(options: {
  readonly successZoneGroup?: string;
  readonly deckCount: number;
  readonly sourceCount?: number;
}) {
  const sourceLives = Array.from({ length: options.sourceCount ?? 1 }, (_, index) =>
    createCardInstance(
      createLive('PL!-pb1-032-L', { groupNames: ["μ's"], score: 2 }),
      PLAYER1,
      `pb1-032-source-${index}`
    )
  );
  const successLive =
    options.successZoneGroup !== undefined
      ? createCardInstance(
          createLive('PL!-pb1-032-success-live', {
            groupNames: [options.successZoneGroup],
            score: 3,
          }),
          PLAYER1,
          'pb1-032-success-live'
        )
      : null;
  const drawCards = Array.from({ length: options.deckCount }, (_, index) =>
    createCardInstance(
      createMuseMember(`PL!-pb1-032-draw-${index}`, 2),
      PLAYER1,
      `pb1-032-draw-${index}`
    )
  );
  let game = createGameState('pl-pb1-032-success-zone', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [...sourceLives, ...(successLive ? [successLive] : []), ...drawCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: sourceLives.map((card) => card.instanceId),
      cardStates: new Map(
        sourceLives.map((card) => [
          card.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
        ])
      ),
    },
    successZone: { ...player.successZone, cardIds: successLive ? [successLive.instanceId] : [] },
    mainDeck: { ...player.mainDeck, cardIds: drawCards.map((card) => card.instanceId) },
    hand: { ...player.hand, cardIds: [] },
  }));

  return {
    game,
    sourceIds: sourceLives.map((card) => card.instanceId),
    drawCardIds: drawCards.map((card) => card.instanceId),
  };
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
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.players[0].hand.cardIds).toContain(scenario.museLiveTargetId);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(scenario.museLiveTargetId);
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

  it('PL!-pb1-032-L shows a confirm-only preview, then draws one when an existing Muse card is in success zone', () => {
    const scenario = setupPb1032({ successZoneGroup: "μ's", deckCount: 1 });
    const confirmation = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [
        pendingAbility(
          PL_PB1_032_LIVE_SUCCESS_HAS_MUSE_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID,
          scenario.sourceIds[0]!,
          TriggerCondition.ON_LIVE_SUCCESS
        ),
      ],
    }).gameState;

    expect(confirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(confirmation.players[0].hand.cardIds).toEqual([]);
    expect(confirmation.activeEffect?.effectText).toContain(
      "当前自己的成功LIVE卡区有1张『μ's』卡，条件满足，实际抽1张卡"
    );

    const resolved = confirmIfConfirmOnly(confirmation, PLAYER1);
    expect(resolved.players[0].hand.cardIds).toEqual([scenario.drawCardIds[0]]);
    expect(
      latestPayload(resolved, PL_PB1_032_LIVE_SUCCESS_HAS_MUSE_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID)
    ).toMatchObject({
      hasMuseSuccessCard: true,
      drawCount: 1,
    });
  });

  it('PL!-pb1-032-L shows an unmet real-time result and draws zero for no or non-Muse success-zone cards', () => {
    for (const successZoneGroup of [undefined, 'Aqours']) {
      const scenario = setupPb1032({ successZoneGroup, deckCount: 1 });
      const confirmation = resolvePendingCardEffects({
        ...scenario.game,
        pendingAbilities: [
          pendingAbility(
            PL_PB1_032_LIVE_SUCCESS_HAS_MUSE_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID,
            scenario.sourceIds[0]!,
            TriggerCondition.ON_LIVE_SUCCESS
          ),
        ],
      }).gameState;

      expect(confirmation.activeEffect?.effectText).toContain('条件未满足，实际抽0张卡');
      const resolved = confirmIfConfirmOnly(confirmation, PLAYER1);
      expect(resolved.pendingAbilities).toEqual([]);
      expect(resolved.players[0].hand.cardIds).toEqual([]);
      expect(
        latestPayload(resolved, PL_PB1_032_LIVE_SUCCESS_HAS_MUSE_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID)
      ).toMatchObject({
        hasMuseSuccessCard: false,
        drawCount: 0,
        drawnCardIds: [],
      });
    }
  });

  it('PL!-pb1-032-L does not count its source LIVE before it enters success zone and safely resolves an empty deck', () => {
    const scenario = setupPb1032({ deckCount: 0 });
    const resolved = confirmIfConfirmOnly(
      resolvePendingCardEffects({
        ...scenario.game,
        pendingAbilities: [
          pendingAbility(
            PL_PB1_032_LIVE_SUCCESS_HAS_MUSE_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID,
            scenario.sourceIds[0]!,
            TriggerCondition.ON_LIVE_SUCCESS
          ),
        ],
      }).gameState,
      PLAYER1
    );

    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(
      latestPayload(resolved, PL_PB1_032_LIVE_SUCCESS_HAS_MUSE_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID)
    ).toMatchObject({
      hasMuseSuccessCard: false,
      drawCount: 0,
    });
  });

  it('PL!-pb1-032-L continues to the next pending after a manually confirmed unmet result', () => {
    const scenario = setupPb1032({ deckCount: 0, sourceCount: 2 });
    const orderSelection = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: scenario.sourceIds.map((sourceCardId) =>
        pendingAbility(
          PL_PB1_032_LIVE_SUCCESS_HAS_MUSE_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID,
          sourceCardId,
          TriggerCondition.ON_LIVE_SUCCESS
        )
      ),
    }).gameState;
    const preview = confirmActiveEffectStepThroughPublicReveal(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      scenario.sourceIds[0]
    );
    const afterFirst = confirmActiveEffectStepThroughPublicReveal(
      preview,
      PLAYER1,
      preview.activeEffect!.id
    );

    expect(afterFirst.players[0].hand.cardIds).toEqual([]);
    expect(afterFirst.pendingAbilities).toHaveLength(1);
    expect(afterFirst.activeEffect).toMatchObject({
      sourceCardId: scenario.sourceIds[1],
      metadata: { confirmOnlyPendingAbility: true },
    });
  });

  it('PL!-pb1-032-L resolves multiple pending abilities in order without confirm-only and manually selected pending opens it first', () => {
    const orderedScenario = setupPb1032({ successZoneGroup: "μ's", deckCount: 2, sourceCount: 2 });
    const orderSelection = resolvePendingCardEffects({
      ...orderedScenario.game,
      pendingAbilities: orderedScenario.sourceIds.map((sourceCardId) =>
        pendingAbility(
          PL_PB1_032_LIVE_SUCCESS_HAS_MUSE_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID,
          sourceCardId,
          TriggerCondition.ON_LIVE_SUCCESS
        )
      ),
    }).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);

    const ordered = confirmActiveEffectStepThroughPublicReveal(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.players[0].hand.cardIds).toEqual(orderedScenario.drawCardIds);

    const manualScenario = setupPb1032({ successZoneGroup: "μ's", deckCount: 2, sourceCount: 2 });
    const manualOrderSelection = resolvePendingCardEffects({
      ...manualScenario.game,
      pendingAbilities: manualScenario.sourceIds.map((sourceCardId) =>
        pendingAbility(
          PL_PB1_032_LIVE_SUCCESS_HAS_MUSE_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID,
          sourceCardId,
          TriggerCondition.ON_LIVE_SUCCESS
        )
      ),
    }).gameState;
    const preview = confirmActiveEffectStepThroughPublicReveal(
      manualOrderSelection,
      PLAYER1,
      manualOrderSelection.activeEffect!.id,
      manualScenario.sourceIds[0]
    );
    expect(preview.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(preview.players[0].hand.cardIds).toEqual([]);

    const afterConfirm = confirmActiveEffectStepThroughPublicReveal(
      preview,
      PLAYER1,
      preview.activeEffect!.id
    );
    expect(afterConfirm.players[0].hand.cardIds).toEqual([manualScenario.drawCardIds[0]]);
  });
});
