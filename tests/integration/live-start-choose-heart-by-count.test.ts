import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToZone,
  addEnergyBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { HeartPool } from '../../src/domain/value-objects/heart';
import { LiveResolver } from '../../src/domain/rules/live-resolver';
import { createEnterStageEvent, createLiveStartEvent } from '../../src/domain/events/game-events';
import {
  getPlayerLiveHeartModifiers,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import {
  createAutoAdvancePublicEffectChoiceCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
  BP5_011_LIVE_START_SUCCESS_COUNT_CHOOSE_GREEN_BLUE_PURPLE_HEART_ABILITY_ID,
  N_BP8_007_LIVE_START_ENERGY_BELOW_NIJIGASAKI_COUNT_CHOOSE_HEART_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createPendingAbility(sourceCardId: string, abilityId: string): PendingAbilityState {
  return {
    id: `pending-${sourceCardId}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setupScenario(options: {
  readonly sourceCardCode: string;
  readonly abilityId: string;
  readonly ownSuccessCount: number;
  readonly opponentSuccessCount?: number;
  readonly sourceUnit?: string;
  readonly firstSuccessCardCode?: string;
}): {
  readonly session: GameSession;
  readonly sourceCardId: string;
} {
  const source = createCardInstance(
    { ...createMember(options.sourceCardCode, 'source'), unitName: options.sourceUnit },
    PLAYER1,
    'source-member'
  );
  const ownSuccessLives = Array.from({ length: options.ownSuccessCount }, (_, index) =>
    createCardInstance(
      createLive(
        index === 0 && options.firstSuccessCardCode
          ? options.firstSuccessCardCode
          : `PL!-test-own-success-${index}-L`
      ),
      PLAYER1,
      `own-success-${index}`
    )
  );
  const opponentSuccessLives = Array.from(
    { length: options.opponentSuccessCount ?? 0 },
    (_, index) =>
      createCardInstance(
        createLive(`PL!-test-opponent-success-${index}-L`),
        PLAYER2,
        `opponent-success-${index}`
      )
  );

  let game = createGameState('live-start-choose-heart-by-count', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...ownSuccessLives, ...opponentSuccessLives]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    successZone: ownSuccessLives.reduce(
      (zone, live) => addCardToZone(zone, live.instanceId),
      player.successZone
    ),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    successZone: opponentSuccessLives.reduce(
      (zone, live) => addCardToZone(zone, live.instanceId),
      player.successZone
    ),
  }));

  const started = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [createPendingAbility(source.instanceId, options.abilityId)],
  }).gameState;

  const session = createGameSession();
  session.createGame('live-start-choose-heart-by-count-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = started;
  return { session, sourceCardId: source.instanceId };
}

function chooseColor(
  session: GameSession,
  color: HeartColor
): ReturnType<GameSession['executeCommand']> {
  const effectId = session.state!.activeEffect!.id;
  const selected = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      effectId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [color]
    )
  );
  if (!selected.success) return selected;
  const publicEffect = session.state!.activeEffect!;
  (session as unknown as { authorityState: GameState }).authorityState = {
    ...session.state!,
    activeEffect: { ...publicEffect, publicEffectChoiceAutoAdvanceAt: 0 },
  };
  return session.executeCommand(createAutoAdvancePublicEffectChoiceCommand(PLAYER2, effectId, 0));
}

function expectSourceHeartModifier(
  game: GameState,
  abilityId: string,
  sourceCardId: string,
  color: HeartColor,
  count: number
): void {
  expect(game.liveResolution.liveModifiers).toContainEqual({
    kind: 'HEART',
    target: 'SOURCE_MEMBER',
    playerId: PLAYER1,
    sourceCardId,
    abilityId,
    hearts: [{ color, count }],
  });
  expect(game.liveResolution.playerHeartBonuses.has(PLAYER1)).toBe(false);
  expect(getPlayerLiveHeartModifiers(game.liveResolution, PLAYER1)).toEqual([]);
}

describe('LIVE start choose Heart by count workflow', () => {
  it.each([
    { code: 'PL!-bp3-013-N', unit: '「lilywhite」', count: 2 },
    { code: 'PL!-bp3-012-N', unit: 'Printemps', count: 1 },
    { code: 'PL!-bp3-011-N', unit: 'BiBi', count: 1 },
  ])(
    'applies 春情浪漫 only to the lily white source in the shared family: $code',
    ({ code, unit, count }) => {
      const { session, sourceCardId } = setupScenario({
        sourceCardCode: code,
        abilityId: BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
        ownSuccessCount: 1,
        sourceUnit: unit,
        firstSuccessCardCode: 'PL!-pb2-041-L',
      });
      expect(chooseColor(session, HeartColor.YELLOW).success).toBe(true);
      expectSourceHeartModifier(
        session.state!,
        BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
        sourceCardId,
        HeartColor.YELLOW,
        count
      );
    }
  );
  it('gives BP3 group source member two selected Yellow Hearts for two own success LIVE cards', () => {
    const { session, sourceCardId } = setupScenario({
      sourceCardCode: 'PL!-bp3-011-N',
      abilityId: BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
      ownSuccessCount: 2,
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          expect.objectContaining({
            id: HeartColor.PINK,
            text: expect.stringContaining('[桃ハート]'),
          }),
          expect.objectContaining({
            id: HeartColor.YELLOW,
            text: expect.stringContaining('[黄ハート]'),
          }),
          expect.objectContaining({
            id: HeartColor.PURPLE,
            text: expect.stringContaining('[紫ハート]'),
          }),
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      canSkipSelection: false,
    });

    expect(chooseColor(session, HeartColor.YELLOW).success).toBe(true);

    expectSourceHeartModifier(
      session.state!,
      BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
      sourceCardId,
      HeartColor.YELLOW,
      2
    );
    const payload = session.state!.actionHistory.find(
      (action) => action.payload.step === 'GAIN_SELECTED_HEART_BY_SUCCESS_LIVE_COUNT'
    )!.payload;
    expect(payload).toMatchObject({ heartCount: 2, successLiveCount: 2 });
    expect(payload).not.toHaveProperty('energyBelowMemberCount');
  });

  it('gives BP5-011 source member one selected Blue Heart for one own success LIVE card', () => {
    const { session, sourceCardId } = setupScenario({
      sourceCardCode: 'PL!-bp5-011-N',
      abilityId: BP5_011_LIVE_START_SUCCESS_COUNT_CHOOSE_GREEN_BLUE_PURPLE_HEART_ABILITY_ID,
      ownSuccessCount: 1,
    });

    expect(session.state?.activeEffect?.effectChoice?.options.map((option) => option.id)).toEqual([
      HeartColor.GREEN,
      HeartColor.BLUE,
      HeartColor.PURPLE,
    ]);
    expect(session.state?.activeEffect?.effectChoice?.options.map((option) => option.text)).toEqual(
      [
        expect.stringContaining('[緑ハート]'),
        expect.stringContaining('[青ハート]'),
        expect.stringContaining('[紫ハート]'),
      ]
    );

    expect(chooseColor(session, HeartColor.BLUE).success).toBe(true);

    expectSourceHeartModifier(
      session.state!,
      BP5_011_LIVE_START_SUCCESS_COUNT_CHOOSE_GREEN_BLUE_PURPLE_HEART_ABILITY_ID,
      sourceCardId,
      HeartColor.BLUE,
      1
    );
  });

  it('rejects a color outside the configured choices without changing state', () => {
    const { session } = setupScenario({
      sourceCardCode: 'PL!-bp5-011-N',
      abilityId: BP5_011_LIVE_START_SUCCESS_COUNT_CHOOSE_GREEN_BLUE_PURPLE_HEART_ABILITY_ID,
      ownSuccessCount: 1,
    });
    const activeEffectId = session.state!.activeEffect!.id;

    const result = chooseColor(session, HeartColor.YELLOW);

    expect(result.success).toBe(false);
    expect(session.state?.activeEffect?.id).toBe(activeEffectId);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('still opens and resolves the color choice when own success LIVE zone is empty', () => {
    const { session } = setupScenario({
      sourceCardCode: 'PL!-bp3-012-N',
      abilityId: BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
      ownSuccessCount: 0,
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
      effectChoice: {
        options: [
          expect.objectContaining({ id: HeartColor.PINK }),
          expect.objectContaining({ id: HeartColor.YELLOW }),
          expect.objectContaining({ id: HeartColor.PURPLE }),
        ],
      },
      canSkipSelection: false,
    });

    expect(chooseColor(session, HeartColor.PURPLE).success).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(session.state?.liveResolution.playerHeartBonuses.has(PLAYER1)).toBe(false);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID &&
          action.payload.step === 'CHOOSE_HEART_NO_SUCCESS_LIVE' &&
          action.payload.selectedHeartColor === HeartColor.PURPLE &&
          action.payload.successLiveCount === 0
      )
    ).toBe(true);
  });

  it('counts only the controller own success LIVE zone', () => {
    const { session } = setupScenario({
      sourceCardCode: 'PL!-bp3-013-N',
      abilityId: BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
      ownSuccessCount: 0,
      opponentSuccessCount: 2,
    });

    expect(chooseColor(session, HeartColor.YELLOW).success).toBe(true);

    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'CHOOSE_HEART_NO_SUCCESS_LIVE' &&
          action.payload.successLiveCount === 0
      )
    ).toBe(true);
  });
});

const SETSUNA_ABILITY = N_BP8_007_LIVE_START_ENERGY_BELOW_NIJIGASAKI_COUNT_CHOOSE_HEART_ABILITY_ID;

function setupSetsuna(energyCounts: readonly number[], otherGroup = '虹ヶ咲') {
  const result = setupScenario({
    sourceCardCode: 'PL!N-bp8-007-R',
    abilityId: SETSUNA_ABILITY,
    ownSuccessCount: 3,
  });
  let game = result.session.state!;
  // Only the effect bonus is asserted: the export explicitly marks printed HEART as missing.
  const source = game.cardRegistry.get(result.sourceCardId)!;
  game = {
    ...game,
    cardRegistry: new Map(game.cardRegistry).set(source.instanceId, {
      ...source,
      data: { ...source.data, groupNames: ['虹ヶ咲'] },
    }),
  };
  const slots = [SlotPosition.CENTER, SlotPosition.LEFT, SlotPosition.RIGHT];
  for (const [index, count] of energyCounts.entries()) {
    const slot = slots[index]!;
    const cardId = index === 0 ? result.sourceCardId : `nijigasaki-member-${index}`;
    if (index > 0) {
      const card = createCardInstance(
        { ...createMember(`TEST-MEMBER-${index}`), groupNames: [otherGroup] },
        PLAYER1,
        cardId
      );
      game = registerCards(game, [card]);
      game = updatePlayer(game, PLAYER1, (player) => ({
        ...player,
        memberSlots: placeCardInSlot(player.memberSlots, slot, cardId),
      }));
    }
    for (let i = 0; i < count; i++) {
      const energy = createCardInstance(
        { cardCode: `ENERGY-${index}-${i}`, name: '能量', cardType: CardType.ENERGY },
        PLAYER1,
        `energy-${index}-${i}`
      );
      game = registerCards(game, [energy]);
      game = updatePlayer(game, PLAYER1, (player) => ({
        ...player,
        memberSlots: addEnergyBelowMember(player.memberSlots, slot, energy.instanceId),
      }));
    }
  }
  (result.session as unknown as { authorityState: GameState }).authorityState = game;
  return result;
}

describe('PL!N-bp8-007 费用2「优木雪菜」 choose HEART by energy-bearing member count', () => {
  it.each([HeartColor.PINK, HeartColor.RED, HeartColor.YELLOW])(
    'counts each eligible member once and adds selected %s to this member',
    (color) => {
      const { session, sourceCardId } = setupSetsuna([3, 1, 2]);
      const before = getMemberEffectiveHeartIcons(session.state!, PLAYER1, sourceCardId)
        .filter((h) => h.color === color)
        .reduce((n, h) => n + h.count, 0);
      const requiredLive = {
        ...createLive('SETSUNA-JUDGMENT'),
        requirements: createHeartRequirement({ [color]: before + 3 }),
      };
      const resolver = new LiveResolver();
      expect(
        resolver.judgeSingleLive(
          'judgment',
          requiredLive,
          HeartPool.fromHeartIcons(
            getMemberEffectiveHeartIcons(session.state!, PLAYER1, sourceCardId)
          )
        ).isSuccess
      ).toBe(false);
      expect(chooseColor(session, color).success).toBe(true);
      expectSourceHeartModifier(session.state!, SETSUNA_ABILITY, sourceCardId, color, 3);
      expect(
        resolver.judgeSingleLive(
          'judgment',
          requiredLive,
          HeartPool.fromHeartIcons(
            getMemberEffectiveHeartIcons(session.state!, PLAYER1, sourceCardId)
          )
        ).isSuccess
      ).toBe(true);
      expect(
        getMemberEffectiveHeartIcons(session.state!, PLAYER1, sourceCardId)
          .filter((h) => h.color === color)
          .reduce((n, h) => n + h.count, 0)
      ).toBe(before + 3);
    }
  );

  it.each([0, 1, 2])(
    'handles %i qualifying members, with a mandatory choice even for zero',
    (count) => {
      const { session, sourceCardId } = setupSetsuna([Number(count > 0), Number(count > 1), 0]);
      expect(session.state!.activeEffect?.canSkipSelection).toBe(false);
      expect(chooseColor(session, HeartColor.RED).success).toBe(true);
      expect(session.state!.activeEffect).toBeNull();
      if (count === 0) expect(session.state!.liveResolution.liveModifiers).toEqual([]);
      else
        expectSourceHeartModifier(
          session.state!,
          SETSUNA_ABILITY,
          sourceCardId,
          HeartColor.RED,
          count
        );
    }
  );

  it('ignores non-Nijigasaki members, members without energy, and success-zone card count', () => {
    const { session, sourceCardId } = setupSetsuna([1, 2, 0], 'Aqours');
    expect(session.state!.players[0].successZone.cardIds).toHaveLength(3);
    expect(chooseColor(session, HeartColor.YELLOW).success).toBe(true);
    expectSourceHeartModifier(session.state!, SETSUNA_ABILITY, sourceCardId, HeartColor.YELLOW, 1);
    const payload = session.state!.actionHistory.find(
      (action) => action.payload.step === 'GAIN_SELECTED_HEART_BY_ENERGY_BELOW_NIJIGASAKI_COUNT'
    )!.payload;
    expect(payload).toMatchObject({ heartCount: 1, energyBelowMemberCount: 1 });
    expect(payload).not.toHaveProperty('successLiveCount');
  });

  it('rejects an unavailable color without advancing', () => {
    const { session } = setupSetsuna([1]);
    const before = session.state;
    expect(chooseColor(session, HeartColor.BLUE).success).toBe(false);
    expect(session.state).toBe(before);
  });

  it('recounts the current stage when the color choice resolves', () => {
    const { session, sourceCardId } = setupSetsuna([1, 1, 1]);
    const state = updatePlayer(session.state!, PLAYER1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.RIGHT),
    }));
    (session as unknown as { authorityState: GameState }).authorityState = state;
    expect(chooseColor(session, HeartColor.RED).success).toBe(true);
    expectSourceHeartModifier(session.state!, SETSUNA_ABILITY, sourceCardId, HeartColor.RED, 2);
  });

  it.each([false, true])(
    'does not transfer the captured reward after source leaves; reentered=%s',
    (reentered) => {
      const { session, sourceCardId } = setupSetsuna([1, 1]);
      let state = updatePlayer(session.state!, PLAYER1, (p) => ({
        ...p,
        memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
      }));
      if (reentered) {
        state = updatePlayer(state, PLAYER1, (p) => ({
          ...p,
          memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, sourceCardId),
        }));
        state = emitGameEvent(
          state,
          createEnterStageEvent(sourceCardId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
        );
      }
      (session as unknown as { authorityState: GameState }).authorityState = state;
      expect(chooseColor(session, HeartColor.RED).success).toBe(true);
      expect(session.state!.liveResolution.liveModifiers).toEqual([]);
      expect(session.state!.activeEffect).toBeNull();
    }
  );

  it('keeps the captured source when it only changes stage slot', () => {
    const { session, sourceCardId } = setupSetsuna([1]);
    let state = updatePlayer(session.state!, PLAYER1, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(
        removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
        SlotPosition.RIGHT,
        sourceCardId
      ),
    }));
    state = updatePlayer(state, PLAYER1, (p) => ({
      ...p,
      memberSlots: {
        ...p.memberSlots,
        energyBelow: { ...p.memberSlots.energyBelow, [SlotPosition.RIGHT]: ['energy-0-0'] },
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = state;
    expect(chooseColor(session, HeartColor.RED).success).toBe(true);
    expectSourceHeartModifier(session.state!, SETSUNA_ABILITY, sourceCardId, HeartColor.RED, 1);
  });
});

it.each([
  [
    'PL!-bp3-012-N',
    BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
    HeartColor.YELLOW,
  ],
  [
    'PL!-bp5-011-N',
    BP5_011_LIVE_START_SUCCESS_COUNT_CHOOSE_GREEN_BLUE_PURPLE_HEART_ABILITY_ID,
    HeartColor.BLUE,
  ],
])(
  'keeps existing family rewards bound to their captured source object: %s',
  (code, abilityId, color) => {
    const { session, sourceCardId } = setupScenario({
      sourceCardCode: code,
      abilityId,
      ownSuccessCount: 2,
    });
    let state = updatePlayer(session.state!, PLAYER1, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(
        removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
        SlotPosition.CENTER,
        sourceCardId
      ),
    }));
    state = emitGameEvent(
      state,
      createEnterStageEvent(sourceCardId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
    );
    (session as unknown as { authorityState: GameState }).authorityState = state;
    expect(chooseColor(session, color as HeartColor).success).toBe(true);
    expect(session.state!.liveResolution.liveModifiers).toEqual([]);
  }
);

it('pins a queued Setsuna source to its LIVE-start event even before the choice opens', () => {
  const { session, sourceCardId } = setupSetsuna([1]);
  let state = { ...session.state!, activeEffect: null };
  state = emitGameEvent(
    state,
    createEnterStageEvent(sourceCardId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );
  const liveStart = createLiveStartEvent(PLAYER1, []);
  state = emitGameEvent(state, liveStart);
  state = emitGameEvent(
    state,
    createEnterStageEvent(sourceCardId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );
  const resolved = resolvePendingCardEffects({
    ...state,
    pendingAbilities: [
      { ...createPendingAbility(sourceCardId, SETSUNA_ABILITY), eventIds: [liveStart.eventId] },
    ],
  }).gameState;
  expect(resolved.activeEffect).toBeNull();
  expect(resolved.pendingAbilities).toEqual([]);
  expect(resolved.liveResolution.liveModifiers).toEqual([]);
});
