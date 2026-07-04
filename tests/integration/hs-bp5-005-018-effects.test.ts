import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  getCardById,
  registerCards,
  updatePlayer,
  type GameState,
  type LiveModifierState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID,
  HS_BP5_018_LIVE_START_DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { unitAliasIs } from '../../src/application/effects/card-selectors';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(
  cardCode: string,
  name = cardCode,
  options: {
    readonly unitName?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: options.groupNames ?? ['蓮ノ空'],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string, name = cardCode, score = 7): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空'],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function baseGame(testId: string): GameState {
  return createGameState(testId, PLAYER1, 'P1', PLAYER2, 'P2');
}

function stageMember(
  game: GameState,
  cardId: string,
  slot: SlotPosition,
  playerId = PLAYER1
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

function placeLive(game: GameState, cardId: string): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

function withPending(
  game: GameState,
  abilityId: string,
  sourceCardId: string,
  timingId = TriggerCondition.ON_LIVE_START
): GameState {
  return {
    ...game,
    pendingAbilities: [
      {
        id: `${abilityId}:${sourceCardId}:pending`,
        abilityId,
        sourceCardId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId,
        eventIds: ['manual-event'],
      },
    ],
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function resolveConfirmOnly(game: GameState): GameState {
  return confirmIfConfirmOnly(resolve(game), PLAYER1);
}

function confirm(game: GameState, selectedCardId?: string | null): GameState {
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, selectedCardId);
}

function setupAuroraStage(options: {
  readonly members: readonly {
    readonly id: string;
    readonly name: string;
    readonly cost: number;
  }[];
  readonly sourceInLiveZone?: boolean;
  readonly liveModifiers?: readonly LiveModifierState[];
}): { readonly game: GameState; readonly liveId: string; readonly memberIds: readonly string[] } {
  const live = createCardInstance(
    createLive('PL!HS-bp5-018-L', 'AURORA FLOWER'),
    PLAYER1,
    'bp5-018-live'
  );
  const members = options.members.map((member) =>
    createCardInstance(
      createMember(`PL!HS-bp5-018-${member.id}`, member.name, { cost: member.cost }),
      PLAYER1,
      member.id
    )
  );
  let game = registerCards(baseGame(`bp5-018-${options.members.map((m) => m.id).join('-')}`), [
    live,
    ...members,
  ]);
  if (options.sourceInLiveZone ?? true) {
    game = placeLive(game, live.instanceId);
  }
  for (const [index, member] of members.entries()) {
    game = stageMember(game, member.instanceId, [
      SlotPosition.LEFT,
      SlotPosition.CENTER,
      SlotPosition.RIGHT,
    ][index]);
  }
  return {
    game: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveModifiers: options.liveModifiers ?? game.liveResolution.liveModifiers,
      },
    },
    liveId: live.instanceId,
    memberIds: members.map((member) => member.instanceId),
  };
}

function setupKosuzu(options: {
  readonly handCards?: readonly { readonly id: string; readonly unitName?: string }[];
  readonly stageTargets?: readonly {
    readonly id: string;
    readonly name: string;
    readonly unitName?: string;
    readonly cost: number;
  }[];
  readonly liveModifiers?: readonly LiveModifierState[];
} = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly handIds: readonly string[];
  readonly targetIds: readonly string[];
} {
  const source = createCardInstance(
    createMember('PL!HS-bp5-005-R', '徒町 小鈴', { unitName: 'DOLLCHESTRA', cost: 4 }),
    PLAYER1,
    'bp5-005-source'
  );
  const handCards = (options.handCards ?? []).map((card) =>
    createCardInstance(
      createMember(`PL!HS-bp5-005-${card.id}`, card.id, {
        unitName: card.unitName,
      }),
      PLAYER1,
      card.id
    )
  );
  const targets = (options.stageTargets ?? []).map((target) =>
    createCardInstance(
      createMember(`PL!HS-bp5-005-${target.id}`, target.name, {
        unitName: target.unitName,
        cost: target.cost,
      }),
      PLAYER1,
      target.id
    )
  );

  let game = registerCards(baseGame(`bp5-005-${handCards.length}-${targets.length}`), [
    source,
    ...handCards,
    ...targets,
  ]);
  game = stageMember(game, source.instanceId, SlotPosition.CENTER);
  for (const [index, target] of targets.entries()) {
    game = stageMember(game, target.instanceId, [SlotPosition.LEFT, SlotPosition.RIGHT][index]);
  }
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
  }));

  return {
    game: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveModifiers: options.liveModifiers ?? game.liveResolution.liveModifiers,
      },
    },
    sourceId: source.instanceId,
    handIds: handCards.map((card) => card.instanceId),
    targetIds: targets.map((target) => target.instanceId),
  };
}

describe('PL!HS-bp5-018 AURORA FLOWER workflow', () => {
  it('adds score when three stage members have pairwise different names and effective costs', () => {
    const scenario = setupAuroraStage({
      members: [
        { id: 'kaho', name: '日野下花帆', cost: 4 },
        { id: 'sayaka', name: '村野さやか', cost: 5 },
        { id: 'rurino', name: '大沢瑠璃乃', cost: 6 },
      ],
    });

    const state = resolveConfirmOnly(
      withPending(
        scenario.game,
        HS_BP5_018_LIVE_START_DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE_ABILITY_ID,
        scenario.liveId
      )
    );

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      sourceCardId: scenario.liveId,
      liveCardId: scenario.liveId,
      abilityId: HS_BP5_018_LIVE_START_DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE_ABILITY_ID,
      countDelta: 1,
    });
    expect(state.pendingAbilities).toEqual([]);
  });

  it('adds score when a multi-name member can use an unoccupied name and costs differ', () => {
    const scenario = setupAuroraStage({
      members: [
        { id: 'll-bp1-001', name: '上原歩夢&澁谷かのん&日野下花帆', cost: 20 },
        { id: 'ayumu', name: '上原歩夢', cost: 4 },
        { id: 'kaho', name: '日野下花帆', cost: 5 },
      ],
    });

    const state = resolveConfirmOnly(
      withPending(
        scenario.game,
        HS_BP5_018_LIVE_START_DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE_ABILITY_ID,
        scenario.liveId
      )
    );

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      sourceCardId: scenario.liveId,
      liveCardId: scenario.liveId,
      abilityId: HS_BP5_018_LIVE_START_DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE_ABILITY_ID,
      countDelta: 1,
    });
    expect(state.actionHistory.at(-1)?.payload.conditionMet).toBe(true);
  });

  it('does not add score when names repeat', () => {
    const scenario = setupAuroraStage({
      members: [
        { id: 'kaho-a', name: '日野下花帆', cost: 4 },
        { id: 'kaho-b', name: '日野下花帆', cost: 5 },
        { id: 'rurino', name: '大沢瑠璃乃', cost: 6 },
      ],
    });

    const state = resolveConfirmOnly(
      withPending(
        scenario.game,
        HS_BP5_018_LIVE_START_DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE_ABILITY_ID,
        scenario.liveId
      )
    );

    expect(state.activeEffect).toBeNull();
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.abilityId ===
          HS_BP5_018_LIVE_START_DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toBe(false);
    expect(state.actionHistory.at(-1)?.payload.conditionMet).toBe(false);
  });

  it('uses current effective member costs and fails when they repeat', () => {
    const scenario = setupAuroraStage({
      members: [
        { id: 'kaho', name: '日野下花帆', cost: 4 },
        { id: 'sayaka', name: '村野さやか', cost: 3 },
        { id: 'rurino', name: '大沢瑠璃乃', cost: 6 },
      ],
    });
    const gameWithCostModifier: GameState = {
      ...scenario.game,
      liveResolution: {
        ...scenario.game.liveResolution,
        liveModifiers: [
          {
            kind: 'MEMBER_COST',
            playerId: PLAYER1,
            memberCardId: scenario.memberIds[1],
            sourceCardId: scenario.memberIds[1],
            abilityId: 'test:effective-cost-repeat',
            countDelta: 1,
          },
        ],
      },
    };

    const state = resolveConfirmOnly(
      withPending(
        gameWithCostModifier,
        HS_BP5_018_LIVE_START_DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE_ABILITY_ID,
        scenario.liveId
      )
    );

    expect(state.actionHistory.at(-1)?.payload.conditionMet).toBe(false);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.abilityId ===
          HS_BP5_018_LIVE_START_DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toBe(false);
  });

  it('consumes the pending no-op when the source is not in own live zone', () => {
    const scenario = setupAuroraStage({
      sourceInLiveZone: false,
      members: [
        { id: 'kaho', name: '日野下花帆', cost: 4 },
        { id: 'sayaka', name: '村野さやか', cost: 5 },
        { id: 'rurino', name: '大沢瑠璃乃', cost: 6 },
      ],
    });

    const state = resolveConfirmOnly(
      withPending(
        scenario.game,
        HS_BP5_018_LIVE_START_DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE_ABILITY_ID,
        scenario.liveId
      )
    );

    expect(state.pendingAbilities).toEqual([]);
    expect(state.actionHistory.at(-1)?.payload.sourceInLiveZone).toBe(false);
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('keeps the exact triple-unit identity visible across hand, deck, waiting room, and live zone', () => {
    const handCard = createCardInstance(createLive('PL!HS-bp2-020-L'), PLAYER1, 'triple-hand');
    const deckCard = createCardInstance(createLive('PL!HS-sd1-020-SD'), PLAYER1, 'triple-deck');
    const waitingCard = createCardInstance(
      createLive('PL!HS-bp5-018-L'),
      PLAYER1,
      'triple-waiting'
    );
    const liveCard = createCardInstance(createLive('PL!HS-bp5-018-L'), PLAYER1, 'triple-live');
    let game = registerCards(baseGame('triple-unit-zones'), [
      handCard,
      deckCard,
      waitingCard,
      liveCard,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: addCardToZone(player.hand, handCard.instanceId),
      mainDeck: addCardToZone(player.mainDeck, deckCard.instanceId),
      waitingRoom: addCardToZone(player.waitingRoom, waitingCard.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, liveCard.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));

    for (const cardId of [handCard, deckCard, waitingCard, liveCard].map((card) => card.instanceId)) {
      const card = getCardById(game, cardId);
      expect(card).not.toBeNull();
      expect(unitAliasIs('スリーズブーケ')(card!)).toBe(true);
      expect(unitAliasIs('DOLLCHESTRA')(card!)).toBe(true);
      expect(unitAliasIs('みらくらぱーく！')(card!)).toBe(true);
    }
  });
});

describe('PL!HS-bp5-005 Kosuzu workflow', () => {
  it('no-ops when there is no DOLLCHESTRA hand card to discard', () => {
    const scenario = setupKosuzu({
      handCards: [{ id: 'miracra-card', unitName: 'みらくらぱーく！' }],
      stageTargets: [{ id: 'target', name: '村野さやか', unitName: 'DOLLCHESTRA', cost: 12 }],
    });

    const state = resolve(
      withPending(
        scenario.game,
        HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID,
        scenario.sourceId
      )
    );

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toEqual(scenario.handIds);
    expect(state.players[0].waitingRoom.cardIds).toEqual([]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('can be declined without discarding', () => {
    const scenario = setupKosuzu({
      handCards: [{ id: 'doll-card', unitName: 'DOLLCHESTRA' }],
      stageTargets: [{ id: 'target', name: '村野さやか', unitName: 'DOLLCHESTRA', cost: 12 }],
    });

    let state = resolve(
      withPending(
        scenario.game,
        HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID,
        scenario.sourceId
      )
    );
    state = confirm(state, null);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual(scenario.handIds);
    expect(state.players[0].waitingRoom.cardIds).toEqual([]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('discards only DOLLCHESTRA through the waiting-room event wrapper before target selection', () => {
    const scenario = setupKosuzu({
      handCards: [
        { id: 'doll-card', unitName: 'DOLLCHESTRA' },
        { id: 'miracra-card', unitName: 'みらくらぱーく！' },
      ],
      stageTargets: [{ id: 'target', name: '村野さやか', unitName: 'DOLLCHESTRA', cost: 12 }],
    });

    let state = resolve(
      withPending(
        scenario.game,
        HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID,
        scenario.sourceId
      )
    );

    expect(state.activeEffect?.selectableCardIds).toEqual([scenario.handIds[0]]);
    state = confirm(state, scenario.handIds[0]);

    expect(state.players[0].waitingRoom.cardIds).toContain(scenario.handIds[0]);
    expect(state.players[0].hand.cardIds).toEqual([scenario.handIds[1]]);
    expect(
      state.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceIds.includes(scenario.handIds[0]) &&
          entry.event.fromZone === ZoneType.HAND
      )
    ).toBe(true);
    expect(state.activeEffect?.selectableCardIds).toEqual([scenario.targetIds[0], scenario.sourceId]);
  });

  it('sets the source cost from target printed cost and gains BLUE Heart at cost 10 or higher', () => {
    const scenario = setupKosuzu({
      handCards: [{ id: 'doll-card', unitName: 'DOLLCHESTRA' }],
      stageTargets: [{ id: 'target', name: '村野さやか', unitName: 'DOLLCHESTRA', cost: 12 }],
    });

    let state = resolve(
      withPending(
        scenario.game,
        HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID,
        scenario.sourceId
      )
    );
    state = confirm(state, scenario.handIds[0]);
    state = confirm(state, scenario.targetIds[0]);

    expect(getMemberEffectiveCost(state, PLAYER1, scenario.sourceId)).toBe(11);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'MEMBER_COST_SET',
      playerId: PLAYER1,
      memberCardId: scenario.sourceId,
      sourceCardId: scenario.sourceId,
      abilityId: HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID,
      setTo: 11,
    });
    expect(getMemberEffectiveHeartIcons(state, PLAYER1, scenario.sourceId)).toContainEqual(
      createHeartIcon(HeartColor.BLUE, 1)
    );
  });

  it('does not gain BLUE Heart when the set cost is below 10', () => {
    const scenario = setupKosuzu({
      handCards: [{ id: 'doll-card', unitName: 'DOLLCHESTRA' }],
      stageTargets: [{ id: 'target', name: '村野さやか', unitName: 'DOLLCHESTRA', cost: 9 }],
    });

    let state = resolve(
      withPending(
        scenario.game,
        HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID,
        scenario.sourceId
      )
    );
    state = confirm(state, scenario.handIds[0]);
    state = confirm(state, scenario.targetIds[0]);

    expect(getMemberEffectiveCost(state, PLAYER1, scenario.sourceId)).toBe(8);
    expect(getMemberEffectiveHeartIcons(state, PLAYER1, scenario.sourceId)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
    ]);
  });

  it('allows the source itself to be selected as the DOLLCHESTRA cost reference', () => {
    const scenario = setupKosuzu({
      handCards: [{ id: 'doll-card', unitName: 'DOLLCHESTRA' }],
      stageTargets: [],
    });

    let state = resolve(
      withPending(
        scenario.game,
        HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID,
        scenario.sourceId
      )
    );
    state = confirm(state, scenario.handIds[0]);
    expect(state.activeEffect?.selectableCardIds).toEqual([scenario.sourceId]);
    state = confirm(state, scenario.sourceId);

    expect(getMemberEffectiveCost(state, PLAYER1, scenario.sourceId)).toBe(3);
  });

  it('overrides existing source cost modifiers instead of stacking as a delta', () => {
    const scenario = setupKosuzu({
      handCards: [{ id: 'doll-card', unitName: 'DOLLCHESTRA' }],
      stageTargets: [{ id: 'target', name: '村野さやか', unitName: 'DOLLCHESTRA', cost: 12 }],
      liveModifiers: [
        {
          kind: 'MEMBER_COST',
          playerId: PLAYER1,
          memberCardId: 'bp5-005-source',
          sourceCardId: 'bp5-005-source',
          abilityId: 'test:existing-source-cost-delta',
          countDelta: 6,
        },
      ],
    });

    let state = resolve(
      withPending(
        scenario.game,
        HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID,
        scenario.sourceId
      )
    );
    state = confirm(state, scenario.handIds[0]);
    state = confirm(state, scenario.targetIds[0]);

    expect(getMemberEffectiveCost(state, PLAYER1, scenario.sourceId)).toBe(11);
  });

  it('keeps the paid discard but no-ops when the selected target becomes illegal', () => {
    const scenario = setupKosuzu({
      handCards: [{ id: 'doll-card', unitName: 'DOLLCHESTRA' }],
      stageTargets: [{ id: 'target', name: '村野さやか', unitName: 'DOLLCHESTRA', cost: 12 }],
    });

    let state = resolve(
      withPending(
        scenario.game,
        HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID,
        scenario.sourceId
      )
    );
    state = confirm(state, scenario.handIds[0]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    state = confirm(state, scenario.targetIds[0]);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].waitingRoom.cardIds).toContain(scenario.handIds[0]);
    expect(getMemberEffectiveCost(state, PLAYER1, scenario.sourceId)).toBe(4);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.abilityId ===
          HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID
      )
    ).toBe(false);
  });

  it('keeps the paid discard but no-ops when the source leaves stage before target resolution', () => {
    const scenario = setupKosuzu({
      handCards: [{ id: 'doll-card', unitName: 'DOLLCHESTRA' }],
      stageTargets: [{ id: 'target', name: '村野さやか', unitName: 'DOLLCHESTRA', cost: 12 }],
    });

    let state = resolve(
      withPending(
        scenario.game,
        HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID,
        scenario.sourceId
      )
    );
    state = confirm(state, scenario.handIds[0]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    state = confirm(state, scenario.targetIds[0]);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].waitingRoom.cardIds).toContain(scenario.handIds[0]);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.abilityId ===
          HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID
      )
    ).toBe(false);
    expect(state.actionHistory.at(-1)?.payload.step).toBe('SOURCE_NOT_ON_STAGE_AFTER_COST');
  });
});
