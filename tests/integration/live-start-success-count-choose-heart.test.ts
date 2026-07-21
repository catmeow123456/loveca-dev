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
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { getPlayerLiveHeartModifiers } from '../../src/domain/rules/live-modifiers';
import {
  createAutoAdvancePublicEffectChoiceCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
  BP5_011_LIVE_START_SUCCESS_COUNT_CHOOSE_GREEN_BLUE_PURPLE_HEART_ABILITY_ID,
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

function createPendingAbility(
  sourceCardId: string,
  abilityId: string
): PendingAbilityState {
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
}): {
  readonly session: GameSession;
  readonly sourceCardId: string;
} {
  const source = createCardInstance(
    createMember(options.sourceCardCode, 'source'),
    PLAYER1,
    'source-member'
  );
  const ownSuccessLives = Array.from({ length: options.ownSuccessCount }, (_, index) =>
    createCardInstance(createLive(`PL!-test-own-success-${index}-L`), PLAYER1, `own-success-${index}`)
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

  let game = createGameState('live-start-success-count-choose-heart', PLAYER1, 'P1', PLAYER2, 'P2');
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
  session.createGame('live-start-success-count-choose-heart-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = started;
  return { session, sourceCardId: source.instanceId };
}

function chooseColor(session: GameSession, color: HeartColor): ReturnType<GameSession['executeCommand']> {
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

describe('LIVE start success-count choose Heart workflow', () => {
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
          expect.objectContaining({ id: HeartColor.PINK, text: expect.stringContaining('[桃ハート]') }),
          expect.objectContaining({ id: HeartColor.YELLOW, text: expect.stringContaining('[黄ハート]') }),
          expect.objectContaining({ id: HeartColor.PURPLE, text: expect.stringContaining('[紫ハート]') }),
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
    expect(session.state?.activeEffect?.effectChoice?.options.map((option) => option.text)).toEqual([
      expect.stringContaining('[緑ハート]'),
      expect.stringContaining('[青ハート]'),
      expect.stringContaining('[紫ハート]'),
    ]);

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
