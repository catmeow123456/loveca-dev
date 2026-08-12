import type { OpeningRpsGesture } from '../../online/release-types.js';
import type { Seat } from '../../online/types.js';
import { AI_BATTLE_PROTOCOL_VERSIONS } from '../../shared/ai-battle-protocol-versions.js';
import { resolveOpeningRpsWinner } from '../services/opening-rps.js';
import { AI_PHASE_THREE_PREGAME_POLICY_VERSION } from './system-participant.js';

export const AI_CONTROLLED_PREGAME_RESULT_SCHEMA_VERSION =
  AI_BATTLE_PROTOCOL_VERSIONS.runtime.controlledPregameResult;

const SYSTEM_GESTURE = 'ROCK' satisfies OpeningRpsGesture;
const HUMAN_GESTURE = 'SCISSORS' satisfies OpeningRpsGesture;

export interface AiControlledPregameResult {
  readonly schemaVersion: typeof AI_CONTROLLED_PREGAME_RESULT_SCHEMA_VERSION;
  readonly policyVersion: typeof AI_PHASE_THREE_PREGAME_POLICY_VERSION;
  readonly humanReady: true;
  readonly systemReady: true;
  readonly rpsResolution: 'SERVER_DETERMINISTIC';
  readonly rpsRound: 1;
  readonly humanGesture: typeof HUMAN_GESTURE;
  readonly systemGesture: typeof SYSTEM_GESTURE;
  readonly rpsWinnerSeat: Seat;
  readonly turnOrderChoice: 'SYSTEM_FIRST' | 'SYSTEM_SECOND';
  readonly firstSeat: Seat;
  readonly systemSeat: Seat;
}

export function resolveControlledAiPregame<THuman, TSystem>(input: {
  readonly human: THuman;
  readonly system: TSystem;
  readonly requestedSystemSeat: Seat;
}): {
  readonly first: THuman | TSystem;
  readonly second: THuman | TSystem;
  readonly result: AiControlledPregameResult;
} {
  const humanSeat: Seat = input.requestedSystemSeat === 'FIRST' ? 'SECOND' : 'FIRST';
  const rpsWinner = resolveOpeningRpsWinner(
    { participantId: input.requestedSystemSeat, gesture: SYSTEM_GESTURE },
    { participantId: humanSeat, gesture: HUMAN_GESTURE }
  );
  if (rpsWinner !== input.requestedSystemSeat) {
    throw new Error('受控 AI 赛前猜拳必须由 SYSTEM 按冻结政策获胜');
  }

  return {
    first: input.requestedSystemSeat === 'FIRST' ? input.system : input.human,
    second: input.requestedSystemSeat === 'SECOND' ? input.system : input.human,
    result: {
      schemaVersion: AI_CONTROLLED_PREGAME_RESULT_SCHEMA_VERSION,
      policyVersion: AI_PHASE_THREE_PREGAME_POLICY_VERSION,
      humanReady: true,
      systemReady: true,
      rpsResolution: 'SERVER_DETERMINISTIC',
      rpsRound: 1,
      humanGesture: HUMAN_GESTURE,
      systemGesture: SYSTEM_GESTURE,
      rpsWinnerSeat: input.requestedSystemSeat,
      turnOrderChoice: input.requestedSystemSeat === 'FIRST' ? 'SYSTEM_FIRST' : 'SYSTEM_SECOND',
      firstSeat: 'FIRST',
      systemSeat: input.requestedSystemSeat,
    },
  };
}
