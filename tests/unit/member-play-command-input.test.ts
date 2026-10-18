import { describe, expect, it } from 'vitest';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { SlotPosition } from '../../src/shared/types/enums';
import { parseAiHumanCommand } from '../../src/server/ai-battle/human-command';
import { parseTutorialGameCommand } from '../../src/server/services/tutorial-command-validation';
import { toTransport } from '../../src/online/serde';

describe('explicit member payment mode at human command boundaries', () => {
  it.each(['NONE', 'SINGLE'] as const)(
    'preserves %s through AI and tutorial input validation',
    (relayMode) => {
      const command = createPlayMemberToSlotCommand('p1', 'card', SlotPosition.LEFT, { relayMode });
      expect(parseAiHumanCommand(command)).toMatchObject({ relayMode });
      expect(parseTutorialGameCommand(toTransport(command))).toMatchObject({ relayMode });
    }
  );
  it('rejects an unknown payment mode rather than interpreting it as automatic relay', () => {
    const command = {
      ...createPlayMemberToSlotCommand('p1', 'card', SlotPosition.LEFT),
      relayMode: 'INVALID',
    };
    expect(() => parseAiHumanCommand(command)).toThrow();
    expect(() => parseTutorialGameCommand(toTransport(command))).toThrow();
  });
});
