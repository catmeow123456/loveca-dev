import { expect } from 'vitest';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import type { AnyCardData, MemberCardData, CardInstance } from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  buildAiBattleDecision,
  materializeAiDecisionCommands,
  parseAiBattleResponse,
  type AiDecision,
  type AiSelection,
} from '../../src/server/ai-battle/decision';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';
export const P1 = 'ai';
export const P2 = 'human';
export const slots = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT];

export function member(code = 'MEMBER-TEST', cost = 3): MemberCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}
export function deck(): DeckConfig {
  return {
    mainDeck: Array.from({ length: 60 }, (_, i): AnyCardData =>
      i < 48
        ? member(`MEMBER-${i}`)
        : {
            cardCode: `LIVE-${i}`,
            name: `LIVE-${i}`,
            cardType: CardType.LIVE,
            score: 1,
            requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
          }
    ),
    energyDeck: Array.from({ length: 12 }, (_, i) => ({
      cardCode: `ENERGY-${i}`,
      name: '能量',
      cardType: CardType.ENERGY,
    })),
  };
}

export function setup(main = true) {
  let randomCalls = 0;
  let now = 1000;
  const session = createGameSession({
    now: () => now,
    randomInt: (max) => {
      randomCalls++;
      return max - 1;
    },
  });
  session.createGame('ai-test', P1, 'AI', P2, '真人');
  session.initializeGame(deck(), deck());
  if (main)
    Object.assign(session.state!, {
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
      waitingPlayerId: null,
    });
  return {
    session,
    randomCalls: () => randomCalls,
    advanceTime: (ms: number) => {
      now += ms;
    },
  };
}

export function decision(session: GameSession, playerId = P1): AiDecision {
  const result = buildAiBattleDecision(
    session.state!,
    playerId,
    session.getPlayerViewState(playerId)!
  );
  expect(
    result.kind,
    JSON.stringify({
      result,
      phase: session.state!.currentPhase,
      subPhase: session.state!.currentSubPhase,
      waiting: session.state!.waitingPlayerId,
      view: session.getPlayerViewState(playerId)?.permissions,
    })
  ).toBe('DECISION');
  if (result.kind !== 'DECISION') throw new Error('Expected decision');
  return result.decision;
}

export function submit(session: GameSession, current: AiDecision, selection: AiSelection) {
  const response = parseAiBattleResponse(current, JSON.stringify({ selection }));
  const commands = materializeAiDecisionCommands(current, response.selection, 1000);
  for (const command of commands) {
    const result = session.executeCommand(command);
    expect(result.success, result.error).toBe(true);
  }
  return commands.at(-1)!;
}

export function replaceHand(session: GameSession, data: AnyCardData[]) {
  const game = session.state!;
  const player = game.players[0];
  const pool = [...player.hand.cardIds, ...player.mainDeck.cardIds];
  const ids = pool.slice(0, data.length);
  Object.assign(player.hand, { cardIds: ids });
  Object.assign(player.mainDeck, { cardIds: pool.slice(data.length) });
  data.forEach((value, i) =>
    (game.cardRegistry as Map<string, CardInstance>).set(ids[i]!, {
      ...game.cardRegistry.get(ids[i]!)!,
      data: value,
    })
  );
  return ids;
}

export function stage(session: GameSession, data: MemberCardData, slot: SlotPosition) {
  const game = session.state!;
  const player = game.players[0];
  const id = player.mainDeck.cardIds[0]!;
  Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(1) });
  (game.cardRegistry as Map<string, CardInstance>).set(id, { ...game.cardRegistry.get(id)!, data });
  Object.assign(player, {
    memberSlots: placeCardInSlot(player.memberSlots, slot, id, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  });
  return id;
}
