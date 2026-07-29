import { describe, expect, it } from 'vitest';
import { resolveControlledAiPregame } from '../../src/server/ai-battle/system-pregame';
import { resolveOpeningRpsWinner } from '../../src/server/services/opening-rps';

describe('AI battle controlled pregame', () => {
  it('resolves both requested SYSTEM seats through the shared RPS rule', () => {
    const human = { participantKind: 'USER' as const };
    const system = { participantKind: 'SYSTEM' as const };

    const systemFirst = resolveControlledAiPregame({
      human,
      system,
      requestedSystemSeat: 'FIRST',
    });
    expect(systemFirst).toMatchObject({
      first: system,
      second: human,
      result: {
        schemaVersion: 'ai-battle.controlled-pregame-result/v1',
        policyVersion: 'ai-battle.phase-three-pregame/v1',
        humanReady: true,
        systemReady: true,
        humanGesture: 'SCISSORS',
        systemGesture: 'ROCK',
        rpsWinnerSeat: 'FIRST',
        turnOrderChoice: 'SYSTEM_FIRST',
        systemSeat: 'FIRST',
      },
    });

    const systemSecond = resolveControlledAiPregame({
      human,
      system,
      requestedSystemSeat: 'SECOND',
    });
    expect(systemSecond).toMatchObject({
      first: human,
      second: system,
      result: {
        rpsWinnerSeat: 'SECOND',
        turnOrderChoice: 'SYSTEM_SECOND',
        firstSeat: 'FIRST',
        systemSeat: 'SECOND',
      },
    });
  });

  it('keeps tie and all winning gestures in one shared rule function', () => {
    expect(
      resolveOpeningRpsWinner(
        { participantId: 'left', gesture: 'ROCK' },
        { participantId: 'right', gesture: 'ROCK' }
      )
    ).toBeNull();
    expect(
      resolveOpeningRpsWinner(
        { participantId: 'left', gesture: 'ROCK' },
        { participantId: 'right', gesture: 'SCISSORS' }
      )
    ).toBe('left');
    expect(
      resolveOpeningRpsWinner(
        { participantId: 'left', gesture: 'SCISSORS' },
        { participantId: 'right', gesture: 'PAPER' }
      )
    ).toBe('left');
    expect(
      resolveOpeningRpsWinner(
        { participantId: 'left', gesture: 'PAPER' },
        { participantId: 'right', gesture: 'ROCK' }
      )
    ).toBe('left');
    expect(
      resolveOpeningRpsWinner(
        { participantId: 'left', gesture: 'SCISSORS' },
        { participantId: 'right', gesture: 'ROCK' }
      )
    ).toBe('right');
  });
});
