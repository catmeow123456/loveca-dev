import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import {
  PL_PB1_029_LIVE_START_NO_SUCCESS_ONLY_LILYWHITE_SCORE_ABILITY_ID,
  PL_PB1_030_LIVE_START_OPPONENT_WAITING_REDUCE_REQUIREMENT_ABILITY_ID,
  PL_PB1_030_LIVE_SUCCESS_DIFFERENT_BIBI_RECOVER_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { applyHeartRequirementModifiers } from '../../src/domain/rules/live-requirement-modifiers';
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

function live(cardCode: string, name: string, score: number, unitName: string): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    unitName,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 5 }),
  };
}

function member(cardCode: string, name: string, unitName: string): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function card<T extends LiveCardData | MemberCardData>(
  data: T,
  instanceId: string,
  ownerId = PLAYER1
): CardInstance<T> {
  return createCardInstance(data, ownerId, instanceId);
}

function setupLiveStart(options: {
  readonly source: CardInstance<LiveCardData>;
  readonly ownMembers?: Partial<Record<SlotPosition, CardInstance<MemberCardData>>>;
  readonly opponentMembers?: Partial<
    Record<SlotPosition, { readonly card: CardInstance<MemberCardData>; readonly orientation: OrientationState }>
  >;
  readonly successLives?: readonly CardInstance<LiveCardData>[];
  readonly initialScore?: number;
}): GameState {
  const ownMembers = Object.entries(options.ownMembers ?? {}) as [
    SlotPosition,
    CardInstance<MemberCardData>,
  ][];
  const opponentMembers = Object.entries(options.opponentMembers ?? {}) as [
    SlotPosition,
    { readonly card: CardInstance<MemberCardData>; readonly orientation: OrientationState },
  ][];
  const allCards = [
    options.source,
    ...ownMembers.map(([, entry]) => entry),
    ...opponentMembers.map(([, entry]) => entry.card),
    ...(options.successLives ?? []),
  ];
  let game = createGameState('pl-pb1-029-030-live-start', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, allCards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, options.source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    successZone: (options.successLives ?? []).reduce(
      (zone, successLive) => addCardToZone(zone, successLive.instanceId),
      player.successZone
    ),
    memberSlots: ownMembers.reduce(
      (slots, [slot, entry]) =>
        placeCardInSlot(slots, slot, entry.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: opponentMembers.reduce(
      (slots, [slot, entry]) =>
        placeCardInSlot(slots, slot, entry.card.instanceId, {
          orientation: entry.orientation,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      playerScores: new Map([[PLAYER1, options.initialScore ?? options.source.data.score]]),
    },
  };
}

function resolveLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success, result.error).toBe(true);
  return confirmIfConfirmOnly(result.gameState, PLAYER1);
}

function pending(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition,
  id = abilityId
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`event:${id}`],
  };
}

function setupCutiePantherLiveSuccess(options: {
  readonly bibiMembers?: readonly CardInstance<MemberCardData>[];
  readonly waitingRoomCards?: readonly CardInstance<MemberCardData>[];
  readonly extraPending?: readonly PendingAbilityState[];
}): { readonly game: GameState; readonly source: CardInstance<LiveCardData> } {
  const source = card(live('PL!-pb1-030-L', 'Cutie Panther', 5, 'BiBi'), 'cutie-panther');
  const allCards = [source, ...(options.bibiMembers ?? []), ...(options.waitingRoomCards ?? [])];
  let game = createGameState('pl-pb1-030-live-success', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, allCards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    memberSlots: (options.bibiMembers ?? []).reduce(
      (slots, entry, index) =>
        placeCardInSlot(slots, [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!, entry.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
    waitingRoom: (options.waitingRoomCards ?? []).reduce(
      (zone, entry) => addCardToZone(zone, entry.instanceId),
      player.waitingRoom
    ),
  }));
  return {
    game: {
      ...game,
      pendingAbilities: [
        pending(
          PL_PB1_030_LIVE_SUCCESS_DIFFERENT_BIBI_RECOVER_MEMBER_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS,
          'cutie-panther-pending'
        ),
        ...(options.extraPending ?? []),
      ],
    },
    source,
  };
}

function latestPayload(game: GameState, abilityId: string) {
  return [...game.actionHistory]
    .reverse()
    .find((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    ?.payload;
}

describe('PL!-pb1-029-L and PL!-pb1-030-L LIVE card workflows', () => {
  it('adds SCORE +1 for PL!-pb1-029 after confirm-only when no success LIVE and stage is only lilywhite', () => {
    const source = card(live('PL!-pb1-029-L', '知らないLove＊教えてLove', 1, 'lilywhite'), 'shiranai-love');
    const umi = card(member('PL!-test-umi', '園田海未', 'lilywhite'), 'umi');
    const rin = card(member('PL!-test-rin', '星空凛', 'lilywhite'), 'rin');
    const game = setupLiveStart({
      source,
      ownMembers: { [SlotPosition.LEFT]: umi, [SlotPosition.CENTER]: rin },
      initialScore: 1,
    });
    const queued = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START])
      .gameState;

    expect(queued.activeEffect?.effectText).toContain('成功LIVE 0张');
    expect(queued.activeEffect?.effectText).toContain('满足条件，分数+1');

    const state = confirmIfConfirmOnly(queued, PLAYER1);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: source.instanceId,
      sourceCardId: source.instanceId,
      abilityId: PL_PB1_029_LIVE_START_NO_SUCCESS_ONLY_LILYWHITE_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(2);
  });

  it('does not add SCORE for PL!-pb1-029 when success zone is nonzero or stage is not only lilywhite', () => {
    const source = card(live('PL!-pb1-029-L', '知らないLove＊教えてLove', 1, 'lilywhite'), 'shiranai-love');
    const successLive = card(live('PL!-success-live', 'success', 1, 'lilywhite'), 'success-live');
    const maki = card(member('PL!-test-maki', '西木野真姫', 'BiBi'), 'maki');
    const game = setupLiveStart({
      source,
      ownMembers: { [SlotPosition.LEFT]: maki },
      successLives: [successLive],
      initialScore: 1,
    });
    const queued = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START])
      .gameState;

    expect(queued.activeEffect?.effectText).toContain('成功LIVE 1张');
    expect(queued.activeEffect?.effectText).toContain('lilywhite 0名');
    expect(queued.activeEffect?.effectText).toContain('未满足条件，不增加分数');

    const state = confirmIfConfirmOnly(queued, PLAYER1);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId === PL_PB1_029_LIVE_START_NO_SUCCESS_ONLY_LILYWHITE_SCORE_ABILITY_ID
      )
    ).toBe(false);
  });

  it('reduces PL!-pb1-030 required neutral Heart by 2 when opponent has a waiting member', () => {
    const source = card(live('PL!-pb1-030-L', 'Cutie Panther', 5, 'BiBi'), 'cutie-panther');
    const opponentWaiting = card(
      member('PL!-opponent-waiting', 'opponent waiting', 'Printemps'),
      'opponent-waiting',
      PLAYER2
    );
    const game = setupLiveStart({
      source,
      opponentMembers: {
        [SlotPosition.CENTER]: { card: opponentWaiting, orientation: OrientationState.WAITING },
      },
    });
    const queued = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START])
      .gameState;

    expect(queued.activeEffect?.effectText).toContain('对方待机成员 1名');
    expect(queued.activeEffect?.effectText).toContain('减少2个[無ハート]');

    const state = confirmIfConfirmOnly(queued, PLAYER1);
    const modifiers = state.liveResolution.liveRequirementModifiers.get(source.instanceId) ?? [];
    const adjusted = applyHeartRequirementModifiers(source.data.requirements, modifiers);
    expect(state.liveResolution.liveRequirementReductions.get(source.instanceId)).toBe(2);
    expect(adjusted.colorRequirements.get(HeartColor.RAINBOW)).toBe(3);
  });

  it('does not reduce PL!-pb1-030 required Heart when opponent has no waiting member', () => {
    const source = card(live('PL!-pb1-030-L', 'Cutie Panther', 5, 'BiBi'), 'cutie-panther');
    const opponentActive = card(
      member('PL!-opponent-active', 'opponent active', 'Printemps'),
      'opponent-active',
      PLAYER2
    );
    const game = setupLiveStart({
      source,
      opponentMembers: {
        [SlotPosition.CENTER]: { card: opponentActive, orientation: OrientationState.ACTIVE },
      },
    });
    const queued = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START])
      .gameState;

    expect(queued.activeEffect?.effectText).toContain('对方待机成员 0名');
    expect(queued.activeEffect?.effectText).toContain('未满足条件，不减少必要[無ハート]');

    const state = confirmIfConfirmOnly(queued, PLAYER1);
    expect(state.liveResolution.liveRequirementReductions.get(source.instanceId)).toBeUndefined();
    expect(state.liveResolution.liveRequirementModifiers.get(source.instanceId)).toBeUndefined();
  });

  it('recovers one BiBi member from waiting room for PL!-pb1-030 LIVE success', () => {
    const eli = card(member('PL!-bibi-eli', '絢瀬絵里', 'BiBi'), 'eli');
    const maki = card(member('PL!-bibi-maki', '西木野真姫', 'BiBi'), 'maki');
    const nico = card(member('PL!-bibi-nico', '矢澤にこ', 'BiBi'), 'nico');
    const scenario = setupCutiePantherLiveSuccess({
      bibiMembers: [eli, maki],
      waitingRoomCards: [nico],
    });
    const started = resolvePendingCardEffects(scenario.game).gameState;

    expect(started.activeEffect).toMatchObject({
      abilityId: PL_PB1_030_LIVE_SUCCESS_DIFFERENT_BIBI_RECOVER_MEMBER_ABILITY_ID,
      awaitingPlayerId: PLAYER1,
      selectableCardIds: [nico.instanceId],
    });
    expect(started.activeEffect?.effectText).toContain('不同名BiBi成员 2名');

    const state = confirmActiveEffectStepThroughPublicReveal(started, PLAYER1, started.activeEffect!.id, nico.instanceId);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toContain(nico.instanceId);
    expect(state.players[0].waitingRoom.cardIds).not.toContain(nico.instanceId);
  });

  it('consumes PL!-pb1-030 LIVE success no-op branches and continues later pending abilities', () => {
    const eli = card(member('PL!-bibi-eli', '絢瀬絵里', 'BiBi'), 'eli');
    const shiranai = card(
      live('PL!-pb1-029-L', '知らないLove＊教えてLove', 1, 'lilywhite'),
      'shiranai-love'
    );
    const continuation = pending(
      PL_PB1_029_LIVE_START_NO_SUCCESS_ONLY_LILYWHITE_SCORE_ABILITY_ID,
      shiranai.instanceId,
      TriggerCondition.ON_LIVE_START,
      'shiranai-continuation'
    );
    const scenario = setupCutiePantherLiveSuccess({
      bibiMembers: [eli],
      waitingRoomCards: [],
      extraPending: [continuation],
    });
    const game = registerCards(
      updatePlayer(scenario.game, PLAYER1, (player) => ({
        ...player,
        liveZone: addCardToStatefulZone(player.liveZone, shiranai.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      })),
      [shiranai]
    );

    const state = resolvePendingCardEffects(game).gameState;

    expect(latestPayload(state, PL_PB1_030_LIVE_SUCCESS_DIFFERENT_BIBI_RECOVER_MEMBER_ABILITY_ID)).toMatchObject({
      step: 'SKIP_CONDITION_NOT_MET',
      differentNamedBiBiMemberCount: 1,
      waitingRoomCandidateCount: 0,
    });
    expect(state.pendingAbilities.map((ability) => ability.id)).not.toContain('cutie-panther-pending');
    expect(state.activeEffect).toMatchObject({
      abilityId: PL_PB1_029_LIVE_START_NO_SUCCESS_ONLY_LILYWHITE_SCORE_ABILITY_ID,
    });
    expect(state.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  });
});
