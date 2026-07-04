import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  BladeHearts,
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
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID,
  BP5_004_AUTO_ON_CHEER_NO_BLADE_MEMBER_THREE_GAIN_ALL_HEART_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  BladeHeartEffect,
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

function createUmi(cardCode = 'PL!-bp5-004-AR'): MemberCardData {
  return createMember(cardCode, {
    name: '園田海未',
    groupNames: ["μ's"],
    cost: 13,
  });
}

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly cost?: number;
    readonly bladeHearts?: BladeHearts;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ["μ's"],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
    bladeHearts: options.bladeHearts,
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function bladeHeart(color = HeartColor.PINK): BladeHearts[number] {
  return { effect: BladeHeartEffect.HEART, heartColor: color };
}

function createBaseGame(testId: string): GameState {
  return {
    ...createGameState(testId, PLAYER1, 'P1', PLAYER2, 'P2'),
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.MAIN_FREE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
  };
}

function setupActivatedState(options: {
  readonly ownExtraMembers?: readonly ReturnType<typeof createCardInstance>[];
  readonly activeEnergyCount: number;
  readonly includeLegalTarget?: boolean;
}): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
  readonly legalTarget?: ReturnType<typeof createCardInstance>;
  readonly highCostTarget: ReturnType<typeof createCardInstance>;
  readonly waitingTarget: ReturnType<typeof createCardInstance>;
  readonly energyCards: readonly ReturnType<typeof createCardInstance>[];
} {
  const source = createCardInstance(createUmi(), PLAYER1, 'p1-bp5-004-umi');
  const legalTarget =
    options.includeLegalTarget !== false
      ? createCardInstance(
          createMember('PL!-opponent-cost-10', { cost: 10 }),
          PLAYER2,
          'p2-cost-10'
        )
      : undefined;
  const highCostTarget = createCardInstance(
    createMember('PL!-opponent-cost-11', { cost: 11 }),
    PLAYER2,
    'p2-cost-11'
  );
  const waitingTarget = createCardInstance(
    createMember('PL!-opponent-cost-9-waiting', { cost: 9 }),
    PLAYER2,
    'p2-cost-9-waiting'
  );
  const energyCards = Array.from({ length: Math.max(4, options.activeEnergyCount) }, (_, index) =>
    createCardInstance(createEnergy(`PL!-energy-${index}`), PLAYER1, `p1-energy-${index}`)
  );

  let game = createBaseGame('pl-bp5-004-umi-activated');
  game = registerCards(game, [
    source,
    ...(options.ownExtraMembers ?? []),
    ...(legalTarget ? [legalTarget] : []),
    highCostTarget,
    waitingTarget,
    ...energyCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    const ownEntries = [
      { cardId: source.instanceId, slot: SlotPosition.CENTER },
      ...((options.ownExtraMembers ?? []).map((card, index) => ({
        cardId: card.instanceId,
        slot: index === 0 ? SlotPosition.LEFT : SlotPosition.RIGHT,
      })) as readonly { readonly cardId: string; readonly slot: SlotPosition }[]),
    ];
    const memberSlots = ownEntries.reduce(
      (zone, entry) =>
        placeCardInSlot(zone, entry.slot, entry.cardId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    );
    const energyZone = energyCards.reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation:
            index < options.activeEnergyCount
              ? OrientationState.ACTIVE
              : OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    );
    return { ...player, memberSlots, energyZone };
  });
  game = updatePlayer(game, PLAYER2, (player) => {
    const entries = [
      ...(legalTarget ? [{ cardId: legalTarget.instanceId, slot: SlotPosition.LEFT }] : []),
      { cardId: highCostTarget.instanceId, slot: SlotPosition.CENTER },
      { cardId: waitingTarget.instanceId, slot: SlotPosition.RIGHT, waiting: true },
    ];
    return {
      ...player,
      memberSlots: entries.reduce(
        (zone, entry) =>
          placeCardInSlot(zone, entry.slot, entry.cardId, {
            orientation: entry.waiting ? OrientationState.WAITING : OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        player.memberSlots
      ),
    };
  });

  return { game, source, legalTarget, highCostTarget, waitingTarget, energyCards };
}

function activateUmi(game: GameState, sourceId: string): GameState {
  return activateCardAbility(
    game,
    PLAYER1,
    sourceId,
    BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID
  );
}

function latestPayload(game: GameState, abilityId: string, step?: string) {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === abilityId &&
        (step === undefined || action.payload.step === step)
    )?.payload;
}

function latestPayCostPayload(game: GameState) {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'PAY_COST' &&
        action.payload.abilityId ===
          BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID
    )?.payload;
}

function orientationOf(game: GameState, playerId: string, cardId: string): OrientationState | null {
  return game.players
    .find((player) => player.id === playerId)
    ?.memberSlots.cardStates.get(cardId)?.orientation ?? null;
}

function activeEnergyIds(game: GameState): readonly string[] {
  const player = game.players.find((candidate) => candidate.id === PLAYER1);
  return (
    player?.energyZone.cardIds.filter(
      (cardId) => player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.ACTIVE
    ) ?? []
  );
}

function setupCheerState(cards: readonly ReturnType<typeof createCardInstance>[]): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(createUmi('PL!-bp5-004-P'), PLAYER1, 'p1-cheer-umi');
  let game = createBaseGame('pl-bp5-004-umi-cheer');
  game = registerCards(game, [source, ...cards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return { game, source };
}

function enqueueCheer(
  game: GameState,
  playerId: string,
  revealedCardIds: readonly string[],
  options: { readonly additional?: boolean } = {}
): GameState {
  const event = createCheerEvent(playerId, revealedCardIds, revealedCardIds.length, {
    automated: true,
    additional: options.additional,
  });
  return enqueueTriggeredCardEffects(emitGameEvent(game, event), [TriggerCondition.ON_CHEER], {
    cheerEvents: [event],
  });
}

function resolveOwnCheer(game: GameState, revealedCardIds: readonly string[]): GameState {
  return resolvePendingCardEffects(enqueueCheer(game, PLAYER1, revealedCardIds)).gameState;
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        BP5_004_AUTO_ON_CHEER_NO_BLADE_MEMBER_THREE_GAIN_ALL_HEART_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!-bp5-004 Umi dynamic activated and on-cheer workflows', () => {
  it('pays three energy with only Umi on stage and waits only an active opponent cost 10 or lower member', () => {
    const { game, source, legalTarget, highCostTarget, waitingTarget } = setupActivatedState({
      activeEnergyCount: 3,
    });

    let state = activateUmi(game, source.instanceId);

    expect(latestPayCostPayload(state)).toMatchObject({
      amount: 3,
      reducedEnergyCost: 3,
      stageGroupKeys: ['muse'],
    });
    expect(state.activeEffect).toMatchObject({
      abilityId: BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID,
      selectableCardIds: [legalTarget!.instanceId],
    });
    expect(state.activeEffect?.selectableCardIds).not.toContain(highCostTarget.instanceId);
    expect(state.activeEffect?.selectableCardIds).not.toContain(waitingTarget.instanceId);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, legalTarget!.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(orientationOf(state, PLAYER2, legalTarget!.instanceId)).toBe(OrientationState.WAITING);
    expect(latestPayload(
      state,
      BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID,
      'WAIT_OPPONENT_COST_TEN_MEMBER'
    )).toMatchObject({
      targetCardId: legalTarget!.instanceId,
      reducedEnergyCost: 3,
    });
  });

  it('does not reduce extra for duplicate muse members', () => {
    const duplicateMuse = createCardInstance(
      createMember('PL!-test-duplicate-muse', { groupNames: ["μ's"] }),
      PLAYER1,
      'p1-duplicate-muse'
    );
    const { game, source } = setupActivatedState({
      ownExtraMembers: [duplicateMuse],
      activeEnergyCount: 3,
    });

    const state = activateUmi(game, source.instanceId);

    expect(latestPayCostPayload(state)).toMatchObject({
      amount: 3,
      reducedEnergyCost: 3,
      stageGroupKeys: ['muse'],
    });
  });

  it('reduces activated cost to zero with LL-bp2-001 and consumes no energy', () => {
    const llBp2 = createCardInstance(
      createMember('LL-bp2-001-R+', {
        name: '渡辺曜&鬼塚夏美&大沢瑠璃乃',
        groupNames: ['Aqours', 'Liella!', '蓮ノ空'],
      }),
      PLAYER1,
      'p1-ll-bp2-001'
    );
    const { game, source, legalTarget } = setupActivatedState({
      ownExtraMembers: [llBp2],
      activeEnergyCount: 0,
    });

    const state = activateUmi(game, source.instanceId);

    expect(latestPayCostPayload(state)).toMatchObject({
      amount: 0,
      reducedEnergyCost: 0,
      stageGroupKeys: ['aqours', 'hasunosora', 'liella', 'muse'],
    });
    expect(activeEnergyIds(state)).toEqual([]);
    expect(state.activeEffect?.selectableCardIds).toEqual([legalTarget!.instanceId]);
  });

  it('reduces activated cost to one with LL-bp3-001', () => {
    const llBp3 = createCardInstance(
      createMember('LL-bp3-001-R+', {
        name: '高坂穂乃果&高海千歌&上原歩夢',
        groupNames: ["μ's", 'Aqours', '虹ヶ咲'],
      }),
      PLAYER1,
      'p1-ll-bp3-001'
    );
    const { game, source } = setupActivatedState({
      ownExtraMembers: [llBp3],
      activeEnergyCount: 1,
    });

    const state = activateUmi(game, source.instanceId);

    expect(latestPayCostPayload(state)).toMatchObject({
      amount: 1,
      reducedEnergyCost: 1,
      stageGroupKeys: ['aqours', 'muse', 'nijigasaki'],
    });
    expect(activeEnergyIds(state)).toHaveLength(0);
  });

  it('keeps zero cost when LL-bp2-001 has duplicated groups elsewhere on stage', () => {
    const llBp2 = createCardInstance(
      createMember('LL-bp2-001-R+', {
        groupNames: ['Aqours', 'Liella!', '蓮ノ空'],
      }),
      PLAYER1,
      'p1-ll-bp2-001-duplicates'
    );
    const duplicates = createCardInstance(
      createMember('PL!-test-duplicate-all-groups', {
        groupNames: ["μ's", 'Aqours', 'Liella!', '蓮ノ空'],
      }),
      PLAYER1,
      'p1-duplicate-all-groups'
    );
    const { game, source } = setupActivatedState({
      ownExtraMembers: [llBp2, duplicates],
      activeEnergyCount: 0,
    });

    const state = activateUmi(game, source.instanceId);

    expect(latestPayCostPayload(state)).toMatchObject({
      amount: 0,
      reducedEnergyCost: 0,
      stageGroupKeys: ['aqours', 'hasunosora', 'liella', 'muse'],
    });
  });

  it('does not pay or open a target window when active energy is insufficient', () => {
    const { game, source } = setupActivatedState({
      activeEnergyCount: 2,
    });

    const state = activateUmi(game, source.instanceId);

    expect(state).toBe(game);
    expect(state.activeEffect).toBeNull();
    expect(latestPayCostPayload(state)).toBeUndefined();
    expect(activeEnergyIds(state)).toHaveLength(2);
  });

  it('keeps paid energy waiting and no-ops when no legal opponent target remains after cost', () => {
    const { game, source } = setupActivatedState({
      activeEnergyCount: 3,
      includeLegalTarget: false,
    });

    const state = activateUmi(game, source.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(activeEnergyIds(state)).toHaveLength(0);
    expect(latestPayload(
      state,
      BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID,
      'NO_OPPONENT_COST_TEN_TARGET_AFTER_COST'
    )).toMatchObject({
      reducedEnergyCost: 3,
      paidEnergyCardIds: ['p1-energy-0', 'p1-energy-1', 'p1-energy-2'],
    });
  });

  it('gains ALL Heart when own normal cheer reveals three own members without bladeHearts', () => {
    const revealed = [0, 1, 2].map((index) =>
      createCardInstance(createMember(`PL!-cheer-no-blade-${index}`), PLAYER1, `p1-no-blade-${index}`)
    );
    const { game, source } = setupCheerState(revealed);

    const state = resolveOwnCheer(game, revealed.map((card) => card.instanceId));

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      sourceCardId: source.instanceId,
      abilityId: BP5_004_AUTO_ON_CHEER_NO_BLADE_MEMBER_THREE_GAIN_ALL_HEART_ABILITY_ID,
      hearts: [{ color: HeartColor.RAINBOW, count: 1 }],
    });
    expect(latestPayload(
      state,
      BP5_004_AUTO_ON_CHEER_NO_BLADE_MEMBER_THREE_GAIN_ALL_HEART_ABILITY_ID,
      'COUNT_NO_BLADE_HEART_MEMBERS_FROM_CHEER'
    )).toMatchObject({
      noBladeHeartMemberCount: 3,
      conditionMet: true,
    });
  });

  it('records turn once without gaining ALL Heart when only two no-blade members are revealed', () => {
    const revealed = [0, 1].map((index) =>
      createCardInstance(createMember(`PL!-cheer-two-no-blade-${index}`), PLAYER1, `p1-two-${index}`)
    );
    const { game } = setupCheerState(revealed);

    const state = resolveOwnCheer(game, revealed.map((card) => card.instanceId));

    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(abilityUseCount(state)).toBe(1);
    expect(latestPayload(
      state,
      BP5_004_AUTO_ON_CHEER_NO_BLADE_MEMBER_THREE_GAIN_ALL_HEART_ABILITY_ID,
      'COUNT_NO_BLADE_HEART_MEMBERS_FROM_CHEER'
    )).toMatchObject({
      noBladeHeartMemberCount: 2,
      conditionMet: false,
    });

    const secondCheer = enqueueCheer(state, PLAYER1, revealed.map((card) => card.instanceId));
    expect(secondCheer.pendingAbilities).toEqual([]);
    expect(abilityUseCount(secondCheer)).toBe(1);
  });

  it('does not count bladeHeart members, live cards, opponent cards, or additional cheer', () => {
    const ownNoBladeA = createCardInstance(createMember('PL!-own-no-blade-a'), PLAYER1, 'own-a');
    const ownNoBladeB = createCardInstance(createMember('PL!-own-no-blade-b'), PLAYER1, 'own-b');
    const ownBladeHeart = createCardInstance(
      createMember('PL!-own-blade-heart', { bladeHearts: [bladeHeart()] }),
      PLAYER1,
      'own-blade-heart'
    );
    const ownLive = createCardInstance(createLive('PL!-own-live'), PLAYER1, 'own-live');
    const opponentNoBlade = createCardInstance(
      createMember('PL!-opponent-no-blade'),
      PLAYER2,
      'opponent-no-blade'
    );
    const { game } = setupCheerState([
      ownNoBladeA,
      ownNoBladeB,
      ownBladeHeart,
      ownLive,
      opponentNoBlade,
    ]);

    const state = resolveOwnCheer(game, [
      ownNoBladeA.instanceId,
      ownNoBladeB.instanceId,
      ownBladeHeart.instanceId,
      ownLive.instanceId,
      opponentNoBlade.instanceId,
    ]);

    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(latestPayload(
      state,
      BP5_004_AUTO_ON_CHEER_NO_BLADE_MEMBER_THREE_GAIN_ALL_HEART_ABILITY_ID,
      'COUNT_NO_BLADE_HEART_MEMBERS_FROM_CHEER'
    )).toMatchObject({
      noBladeHeartMemberCardIds: [ownNoBladeA.instanceId, ownNoBladeB.instanceId],
      noBladeHeartMemberCount: 2,
      conditionMet: false,
    });

    const additional = enqueueCheer(game, PLAYER1, [
      ownNoBladeA.instanceId,
      ownNoBladeB.instanceId,
      ownBladeHeart.instanceId,
    ], { additional: true });
    expect(additional.pendingAbilities).toEqual([]);
  });

  it('safely consumes pending without turn use when the source leaves stage before on-cheer resolves', () => {
    const revealed = [0, 1, 2].map((index) =>
      createCardInstance(
        createMember(`PL!-cheer-source-gone-${index}`),
        PLAYER1,
        `p1-source-gone-${index}`
      )
    );
    const { game, source } = setupCheerState(revealed);
    const queued = enqueueCheer(game, PLAYER1, revealed.map((card) => card.instanceId));
    const sourceGone = updatePlayer(queued, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));

    const resolved = resolvePendingCardEffects(sourceGone).gameState;

    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(abilityUseCount(resolved)).toBe(0);
    expect(latestPayload(
      resolved,
      BP5_004_AUTO_ON_CHEER_NO_BLADE_MEMBER_THREE_GAIN_ALL_HEART_ABILITY_ID,
      'SOURCE_NOT_ON_STAGE'
    )).toMatchObject({
      sourceCardId: source.instanceId,
    });
  });
});
