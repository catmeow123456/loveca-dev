import { readFileSync } from 'node:fs';
import { createGameSession } from '../../src/application/game-session';
import type { AnyCardData, CardInstance, MemberCardData } from '../../src/domain/entities/card';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import type { ViewFrontCardInfo } from '../../src/online/types';
import {
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';
import { readFrozenGreenHasunosoraDeck } from './ai-curated-decks';

export interface PlanningCase {
  decisionId: string;
  turn: number;
  hand: string[];
  waitingRoom: string[];
  stage: Record<SlotPosition, string>;
  activeEnergy: number;
  energyCount: number;
  opponentStage: Partial<Record<SlotPosition, ViewFrontCardInfo>>;
  opponentSuccess: string[];
}
export const planningCases = (
  JSON.parse(
    readFileSync(new URL('../fixtures/ai-battle/f978-planning.json', import.meta.url), 'utf8')
  ) as { cases: PlanningCase[] }
).cases;

/** A local rule fixture, not the original authority checkpoint or hidden deck order. */
export function createPlanningFixture(decisionId: string) {
  const scenario = planningCases.find((c) => c.decisionId === decisionId)!;
  const deck = readFrozenGreenHasunosoraDeck().deck;
  const facts = new Map([...deck.mainDeck, ...deck.energyDeck].map((c) => [c.cardCode, c]));
  let now = 1000,
    randomCalls = 0;
  const session = createGameSession({
    now: () => now,
    randomInt: (max) => {
      randomCalls++;
      return max - 1;
    },
  });
  session.createGame(`planning-${decisionId}`, 'ai', 'AI', 'human', 'Human');
  if (!session.initializeGame(deck, deck).success) throw new Error('Fixture initialization failed');
  const g = session.state!;
  Object.assign(g, {
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
    waitingPlayerId: null,
    turnCount: scenario.turn,
  });
  const registry = g.cardRegistry as Map<string, CardInstance>;
  const p = g.players[0],
    other = g.players[1];
  const pool = [...p.hand.cardIds, ...p.mainDeck.cardIds];
  const use = (code: string) => {
    const id = pool.shift()!,
      data = facts.get(code);
    if (!data) throw new Error(`Missing frozen card ${code}`);
    registry.set(id, { ...registry.get(id)!, data });
    return id;
  };
  Object.assign(p.hand, { cardIds: scenario.hand.map(use) });
  Object.assign(p.waitingRoom, { cardIds: scenario.waitingRoom.map(use) });
  for (const slot of Object.values(SlotPosition))
    Object.assign(p, {
      memberSlots: placeCardInSlot(p.memberSlots, slot, use(scenario.stage[slot]), {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    });
  Object.assign(p.mainDeck, { cardIds: pool });
  const energy = [...p.energyZone.cardIds, ...p.energyDeck.cardIds];
  Object.assign(p.energyZone, {
    cardIds: energy.slice(0, scenario.energyCount),
    cardStates: new Map(
      energy.slice(0, scenario.energyCount).map((id, i) => [
        id,
        {
          orientation:
            i < scenario.activeEnergy ? OrientationState.ACTIVE : OrientationState.WAITING,
          face: FaceState.FACE_UP,
        },
      ])
    ),
  });
  Object.assign(p.energyDeck, { cardIds: energy.slice(scenario.energyCount) });
  const otherPool = [...other.hand.cardIds, ...other.mainDeck.cardIds];
  Object.assign(other.hand, { cardIds: [] });
  for (const [slot, front] of Object.entries(scenario.opponentStage)) {
    const id = otherPool.shift()!;
    const printed = facts.get(front.cardCode)! as MemberCardData;
    registry.set(id, {
      ...registry.get(id)!,
      data: { ...printed, hearts: front.hearts!, blade: front.blade! } as MemberCardData,
    });
    Object.assign(other, {
      memberSlots: placeCardInSlot(other.memberSlots, slot as SlotPosition, id, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    });
  }
  Object.assign(other.successZone, {
    cardIds: scenario.opponentSuccess.map((code) => {
      const id = otherPool.shift()!;
      registry.set(id, { ...registry.get(id)!, data: facts.get(code)! });
      return id;
    }),
  });
  Object.assign(other.mainDeck, { cardIds: otherPool });
  return {
    session,
    scenario,
    facts,
    now: () => now,
    advanceTime: (value: number) => {
      now = value;
    },
    randomCalls: () => randomCalls,
    setTop: (cards: readonly AnyCardData[]) => {
      cards.forEach((data, i) => {
        const id = session.state!.players[0].mainDeck.cardIds[i]!;
        registry.set(id, { ...registry.get(id)!, data });
      });
    },
  };
}
