import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import { moveMemberBetweenSlots } from '../../src/application/effects/member-state';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import { SP_PB1_006_AUTO_ENTER_OR_MOVE_GAIN_TWO_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string, cost = 9): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
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
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>): void {
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

function setupEnterSession(): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
} {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('sp-pb1-006-kinako-enter', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(createMember('PL!SP-pb1-006-R', 9), PLAYER1, 'kinako-source');
  const state = registerCards(session.state!, [source]);
  (session as unknown as { authorityState: GameState }).authorityState = state;
  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  p1.hand.cardIds = [source.instanceId];
  p1.mainDeck.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: null,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map();

  return { session, sourceId: source.instanceId };
}

function setupMoveState(): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly otherId: string;
} {
  const source = createCardInstance(createMember('PL!SP-pb1-006-P＋', 9), PLAYER1, 'kinako-source');
  const other = createCardInstance(createMember('PL!SP-test-other', 2), PLAYER1, 'other-member');
  let game = createGameState('sp-pb1-006-kinako-move', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, other]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.LEFT, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.RIGHT,
      other.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
  }));

  return { game, sourceId: source.instanceId, otherId: other.instanceId };
}

function playKinako(session: ReturnType<typeof createGameSession>, sourceId: string): void {
  const result = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, sourceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(result.success).toBe(true);
}

function resolveMove(options: {
  readonly game: GameState;
  readonly cardId: string;
  readonly toSlot: SlotPosition;
  readonly triggerPlayerId?: string;
}): GameState {
  const moveResult = moveMemberBetweenSlots(
    options.game,
    PLAYER1,
    options.cardId,
    options.toSlot
  );
  expect(moveResult).not.toBeNull();
  let movedState = moveResult!.gameState;
  if (options.triggerPlayerId) {
    movedState = {
      ...movedState,
      eventLog: movedState.eventLog.map((entry) =>
        entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
        entry.event.cardInstanceId === options.cardId
          ? {
              ...entry,
              event: { ...entry.event, triggerPlayerId: options.triggerPlayerId },
            }
          : entry
      ),
    };
  }
  const result = new GameService().executeCheckTiming(movedState, [
    TriggerCondition.ON_MEMBER_SLOT_MOVED,
  ]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function bladeModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'BLADE' &&
      modifier.abilityId === SP_PB1_006_AUTO_ENTER_OR_MOVE_GAIN_TWO_BLADE_ABILITY_ID
  );
}

describe('PL!SP-pb1-006 Kinako enter-or-move BLADE workflow', () => {
  it('gains BLADE +2 when this member enters', () => {
    const scenario = setupEnterSession();
    playKinako(scenario.session, scenario.sourceId);

    expect(bladeModifiers(scenario.session.state!)).toEqual([
      expect.objectContaining({
        sourceCardId: scenario.sourceId,
        countDelta: 2,
      }),
    ]);
  });

  it('gains BLADE +2 when this member moves', () => {
    const scenario = setupMoveState();
    const state = resolveMove({
      game: scenario.game,
      cardId: scenario.sourceId,
      toSlot: SlotPosition.CENTER,
    });

    expect(bladeModifiers(state)).toEqual([
      expect.objectContaining({
        sourceCardId: scenario.sourceId,
        countDelta: 2,
      }),
    ]);
  });

  it('triggers once for entering and again for moving after entry', () => {
    const scenario = setupEnterSession();
    playKinako(scenario.session, scenario.sourceId);
    const moved = resolveMove({
      game: scenario.session.state!,
      cardId: scenario.sourceId,
      toSlot: SlotPosition.RIGHT,
    });

    expect(bladeModifiers(moved)).toHaveLength(2);
    expect(getMemberEffectiveBladeCount(moved, PLAYER1, scenario.sourceId)).toBe(5);
  });

  it('also triggers when the movement event is marked as caused by the opponent', () => {
    const scenario = setupMoveState();
    const state = resolveMove({
      game: scenario.game,
      cardId: scenario.sourceId,
      toSlot: SlotPosition.CENTER,
      triggerPlayerId: PLAYER2,
    });

    expect(bladeModifiers(state)).toHaveLength(1);
  });

  it('does not trigger when another member moves', () => {
    const scenario = setupMoveState();
    const state = resolveMove({
      game: scenario.game,
      cardId: scenario.otherId,
      toSlot: SlotPosition.CENTER,
    });

    expect(bladeModifiers(state)).toEqual([]);
  });
});
