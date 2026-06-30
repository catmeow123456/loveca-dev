import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import {
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  registerCards,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { SP_PB2_000_ON_ENTER_DOUBLE_RELAY_DRAW_AND_GAIN_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
    readonly hasBladeHeart?: boolean;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    unitName: options.groupNames?.[0] ?? 'Liella!',
    cardType: CardType.MEMBER,
    cost: options.cost ?? 7,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
    ...(options.hasBladeHeart
      ? { bladeHearts: [{ effect: BladeHeartEffect.DRAW }] }
      : {}),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMember(`MEM-${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergy(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forceMainPhase(session: GameSession): void {
  const state = session.state!;
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
  };
  mutableState.currentPhase = GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.MAIN_FREE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;
}

function setupDoubleRelayScenario(options: {
  readonly sourceCardCode?: string;
  readonly leftGroupName?: string;
  readonly centerGroupName?: string;
  readonly leftHasBladeHeart?: boolean;
  readonly centerHasBladeHeart?: boolean;
} = {}): {
  readonly session: GameSession;
  readonly sourceId: string;
  readonly leftReplacementId: string;
  readonly centerReplacementId: string;
  readonly drawCardIds: readonly string[];
} {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('sp-pb2-000-chisato-natsumi', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);
  forceMainPhase(session);

  const source = createCardInstance(
    createMember(options.sourceCardCode ?? 'PL!SP-pb2-000-R', {
      name: '嵐 千砂都＆鬼塚夏美',
      cost: 15,
    }),
    PLAYER1,
    'chisato-natsumi-source'
  );
  const centerReplacement = createCardInstance(
    createMember('PL!SP-test-center', {
      name: 'Center Replacement',
      cost: 8,
      groupNames: [options.centerGroupName ?? 'Liella!'],
      hasBladeHeart: options.centerHasBladeHeart,
    }),
    PLAYER1,
    'center-replacement'
  );
  const leftReplacement = createCardInstance(
    createMember(options.leftGroupName === 'Aqours' ? 'PL!S-test-left' : 'PL!SP-test-left', {
      name: 'Left Replacement',
      cost: 7,
      groupNames: [options.leftGroupName ?? 'Liella!'],
      hasBladeHeart: options.leftHasBladeHeart,
    }),
    PLAYER1,
    'left-replacement'
  );
  const drawOne = createCardInstance(createMember('PL!SP-test-draw-1'), PLAYER1, 'draw-1');
  const drawTwo = createCardInstance(createMember('PL!SP-test-draw-2'), PLAYER1, 'draw-2');

  const state = registerCards(session.state!, [
    source,
    centerReplacement,
    leftReplacement,
    drawOne,
    drawTwo,
  ]);
  (session as unknown as { authorityState: GameState }).authorityState = state;
  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  p1.hand.cardIds = [source.instanceId];
  p1.mainDeck.cardIds = [drawOne.instanceId, drawTwo.instanceId];
  p1.waitingRoom.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: leftReplacement.instanceId,
    [SlotPosition.CENTER]: centerReplacement.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map([
    [leftReplacement.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    [
      centerReplacement.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
    ],
  ]);

  return {
    session,
    sourceId: source.instanceId,
    leftReplacementId: leftReplacement.instanceId,
    centerReplacementId: centerReplacement.instanceId,
    drawCardIds: [drawOne.instanceId, drawTwo.instanceId],
  };
}

function playWithDoubleRelay(session: GameSession, sourceId: string): void {
  const result = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, sourceId, SlotPosition.CENTER, {
      freePlay: true,
      relayMode: 'DOUBLE',
      relayReplacementSlots: [SlotPosition.CENTER, SlotPosition.LEFT],
    })
  );
  expect(result.success).toBe(true);
}

function latestResolvePayload(game: GameState) {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_PB2_000_ON_ENTER_DOUBLE_RELAY_DRAW_AND_GAIN_BLADE_ABILITY_ID
    )?.payload;
}

describe('PL!SP-pb2-000 Chisato and Natsumi on-enter workflow', () => {
  it.each(['PL!SP-pb2-000-R', 'PL!SP-pb2-000-DUO'])(
    'draws two for %s double relay with two Liella replacements',
    (sourceCardCode) => {
      const scenario = setupDoubleRelayScenario({ sourceCardCode });
      playWithDoubleRelay(scenario.session, scenario.sourceId);

      expect(scenario.session.state?.activeEffect).toBeNull();
      expect(scenario.session.state?.players[0].hand.cardIds).toEqual(
        expect.arrayContaining(scenario.drawCardIds)
      );
      expect(latestResolvePayload(scenario.session.state!)).toMatchObject({
        conditionMet: true,
        drawCount: 2,
        drawnCardIds: scenario.drawCardIds,
      });
    }
  );

  it('draws first and grants BLADE +4 for two no-Blade-Heart Liella replacements', () => {
    const scenario = setupDoubleRelayScenario();
    playWithDoubleRelay(scenario.session, scenario.sourceId);

    expect(latestResolvePayload(scenario.session.state!)).toMatchObject({
      drawnCardIds: scenario.drawCardIds,
      noBladeHeartLiellaReplacementCardIds: [
        scenario.centerReplacementId,
        scenario.leftReplacementId,
      ],
      bladeBonus: 4,
    });
    expect(scenario.session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 4,
      sourceCardId: scenario.sourceId,
      abilityId: SP_PB2_000_ON_ENTER_DOUBLE_RELAY_DRAW_AND_GAIN_BLADE_ABILITY_ID,
    });
  });

  it('does not count non-Liella replacements', () => {
    const scenario = setupDoubleRelayScenario({ leftGroupName: 'Aqours' });
    playWithDoubleRelay(scenario.session, scenario.sourceId);

    expect(latestResolvePayload(scenario.session.state!)).toMatchObject({
      liellaReplacementCardIds: [scenario.centerReplacementId],
      noBladeHeartLiellaReplacementCardIds: [scenario.centerReplacementId],
      drawCount: 1,
      bladeBonus: 2,
    });
    expect(scenario.session.state?.players[0].hand.cardIds).toContain(scenario.drawCardIds[0]);
    expect(scenario.session.state?.players[0].hand.cardIds).not.toContain(scenario.drawCardIds[1]);
  });

  it('consumes pending as no-op when double relay metadata is missing', () => {
    const scenario = setupDoubleRelayScenario();
    const pendingAbility: PendingAbilityState = {
      id: 'sp-pb2-000-no-metadata',
      abilityId: SP_PB2_000_ON_ENTER_DOUBLE_RELAY_DRAW_AND_GAIN_BLADE_ABILITY_ID,
      sourceCardId: scenario.sourceId,
      controllerId: PLAYER1,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: ['enter-stage'],
    };
    const state = resolvePendingCardEffects({
      ...scenario.session.state!,
      pendingAbilities: [pendingAbility],
    }).gameState;

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(latestResolvePayload(state)).toMatchObject({
      conditionMet: false,
      reason: 'NOT_DOUBLE_RELAY',
      relayReplacementCardIds: [],
    });
  });
});
