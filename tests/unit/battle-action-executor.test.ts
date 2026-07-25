import { describe, expect, it, vi } from 'vitest';
import { executeBattleActionPayload } from '../../client/src/lib/battleActionExecutor';
import { GameCommandType } from '../../src/application/game-commands';
import { ZoneType } from '../../src/shared/types/enums';

describe('executeBattleActionPayload', () => {
  it('executes the dedicated live-set withdrawal payload', () => {
    const unsetLiveCard = vi.fn();

    const handled = executeBattleActionPayload(
      {
        type: GameCommandType.UNSET_LIVE_CARD,
        cardId: 'set-card',
      },
      { unsetLiveCard }
    );

    expect(handled).toBe(true);
    expect(unsetLiveCard).toHaveBeenCalledWith('set-card');
  });

  it('executes inspected card target payloads', () => {
    const moveInspectedCardToBottom = vi.fn();

    const handled = executeBattleActionPayload(
      {
        type: GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM,
        cardId: 'inspected-card',
      },
      { moveInspectedCardToBottom }
    );

    expect(handled).toBe(true);
    expect(moveInspectedCardToBottom).toHaveBeenCalledWith('inspected-card');
  });

  it('executes resolution card target payloads with deck position', () => {
    const moveResolutionCardToZone = vi.fn();

    const handled = executeBattleActionPayload(
      {
        type: GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE,
        cardId: 'resolution-card',
        toZone: ZoneType.MAIN_DECK,
        position: 'TOP',
      },
      { moveResolutionCardToZone }
    );

    expect(handled).toBe(true);
    expect(moveResolutionCardToZone).toHaveBeenCalledWith('resolution-card', ZoneType.MAIN_DECK, {
      position: 'TOP',
    });
  });

  it('returns false when a required handler is missing', () => {
    const handled = executeBattleActionPayload(
      {
        type: GameCommandType.MOVE_INSPECTED_CARD_TO_TOP,
        cardId: 'inspected-card',
      },
      {}
    );

    expect(handled).toBe(false);
  });
});
