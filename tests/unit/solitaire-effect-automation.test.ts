import { describe, expect, it } from 'vitest';
import {
  createGameState,
  type ActiveEffectState,
  type GameState,
} from '../../src/domain/entities/game';
import { GameCommandType } from '../../src/application/game-commands';
import {
  buildSolitaireOpponentEffectCommand,
  resolveSolitaireOpponentEffectCommandForExecution,
} from '../../src/application/solitaire-effect-automation';
import { SlotPosition } from '../../src/shared/types/enums';

const HUMAN_PLAYER_ID = 'human';
const OPPONENT_PLAYER_ID = 'system-opponent';
const NOW = 12_345;

function createEffect(
  patch: Partial<ActiveEffectState> = {}
): ActiveEffectState {
  return {
    id: 'effect-1',
    abilityId: 'test-ability',
    sourceCardId: 'source-card',
    controllerId: HUMAN_PLAYER_ID,
    effectText: '测试效果',
    stepId: 'TEST_STEP',
    stepText: '确认后结算。',
    awaitingPlayerId: OPPONENT_PLAYER_ID,
    ...patch,
  };
}

function createState(
  effectPatch: Partial<ActiveEffectState> = {},
  statePatch: Partial<GameState> = {}
): GameState {
  const state = {
    ...createGameState(
      'solitaire-effect-automation',
      HUMAN_PLAYER_ID,
      '玩家',
      OPPONENT_PLAYER_ID,
      '系统对手'
    ),
    activeEffect: createEffect(effectPatch),
    ...statePatch,
  };
  const hiddenHandCardIds =
    state.activeEffect?.selectableCardVisibility === 'AWAITING_PLAYER_ONLY'
      ? state.activeEffect.selectableCardIds ?? []
      : [];
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === OPPONENT_PLAYER_ID
        ? {
            ...player,
            hand: {
              ...player.hand,
              cardIds: [...hiddenHandCardIds],
            },
          }
        : player
    ),
  };
}

describe('solitaire opponent effect automation', () => {
  it('does not act on an effect awaiting the human player', () => {
    const state = createState({ awaitingPlayerId: HUMAN_PLAYER_ID });

    expect(
      buildSolitaireOpponentEffectCommand(state, OPPONENT_PLAYER_ID, NOW)
    ).toBeNull();
  });

  it('confirms a no-input effect and skips an optional selection', () => {
    expect(
      buildSolitaireOpponentEffectCommand(
        createState(),
        OPPONENT_PLAYER_ID,
        NOW
      )
    ).toMatchObject({
      type: GameCommandType.CONFIRM_EFFECT_STEP,
      playerId: OPPONENT_PLAYER_ID,
      effectId: 'effect-1',
      timestamp: NOW,
    });

    expect(
      buildSolitaireOpponentEffectCommand(
        createState({
          selectableCardIds: ['card-a'],
          selectableCardMode: 'SINGLE',
          canSkipSelection: true,
        }),
        OPPONENT_PLAYER_ID,
        NOW
      )
    ).toMatchObject({
      selectedCardId: null,
    });
  });

  it('treats cleared empty arrays as confirmation but keeps an empty SINGLE selection blocked', () => {
    expect(
      buildSolitaireOpponentEffectCommand(
        createState({
          selectableCardIds: [],
          selectableOptions: [],
          selectableSlots: [],
        }),
        OPPONENT_PLAYER_ID,
        NOW
      )
    ).toMatchObject({
      type: GameCommandType.CONFIRM_EFFECT_STEP,
      effectId: 'effect-1',
    });

    expect(
      buildSolitaireOpponentEffectCommand(
        createState({
          selectableCardIds: [],
          selectableCardMode: 'SINGLE',
        }),
        OPPONENT_PLAYER_ID,
        NOW
      )
    ).toBeNull();
  });

  it('selects the first public card for a mandatory SINGLE selection', () => {
    expect(
      buildSolitaireOpponentEffectCommand(
        createState({
          selectableCardIds: ['card-a', 'card-b'],
          selectableCardMode: 'SINGLE',
        }),
        OPPONENT_PLAYER_ID,
        NOW
      )
    ).toMatchObject({
      selectedCardId: 'card-a',
    });

    expect(
      buildSolitaireOpponentEffectCommand(
        createState({
          selectableCardIds: ['legacy-card-a', 'legacy-card-b'],
        }),
        OPPONENT_PLAYER_ID,
        NOW
      )
    ).toMatchObject({
      selectedCardId: 'legacy-card-a',
    });
  });

  it('uses a versioned blind token without placing the card ID in the command', () => {
    const command = buildSolitaireOpponentEffectCommand(
      createState({
        selectableCardIds: ['hidden-card-a', 'hidden-card-b'],
        selectableCardVisibility: 'AWAITING_PLAYER_BLIND',
        selectableCardMode: 'SINGLE',
        metadata: {
          blindSelectionVersion: 7,
        },
      }),
      OPPONENT_PLAYER_ID,
      NOW
    );

    expect(command).toMatchObject({
      selectedCardId: 'blind-card-v7-0',
    });
    expect(JSON.stringify(command)).not.toContain('hidden-card-a');
    expect(JSON.stringify(command)).not.toContain('hidden-card-b');
  });

  it('selects the first required hidden hand cards with positional tokens', () => {
    const state = createState({
      selectableCardIds: [
        'hidden-card-a',
        'hidden-card-b',
        'hidden-card-c',
        'hidden-card-d',
      ],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      metadata: {
        blindSelectionVersion: 4,
      },
    });
    const command = buildSolitaireOpponentEffectCommand(
      state,
      OPPONENT_PLAYER_ID,
      NOW
    );

    expect(command).toMatchObject({
      selectedCardIds: ['blind-card-v4-0', 'blind-card-v4-1'],
    });
    expect(JSON.stringify(command)).not.toContain('hidden-card-a');
    expect(JSON.stringify(command)).not.toContain('hidden-card-b');
    expect(
      resolveSolitaireOpponentEffectCommandForExecution(state, command!)
    ).toMatchObject({
      selectedCardIds: ['hidden-card-a', 'hidden-card-b'],
    });
    expect(command).toMatchObject({
      selectedCardIds: ['blind-card-v4-0', 'blind-card-v4-1'],
    });
  });

  it('resolves a legacy implicit private-hand single selection without logging its ID', () => {
    const state = createState({
      selectableCardIds: ['hidden-card-a', 'hidden-card-b'],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      canSkipSelection: false,
    });
    const command = buildSolitaireOpponentEffectCommand(
      state,
      OPPONENT_PLAYER_ID,
      NOW
    );

    expect(command).toMatchObject({
      selectedCardId: 'blind-card-0',
    });
    expect(JSON.stringify(command)).not.toContain('hidden-card-a');
    expect(
      resolveSolitaireOpponentEffectCommandForExecution(state, command!)
    ).toMatchObject({
      selectedCardId: 'hidden-card-a',
    });
    expect(command).toMatchObject({
      selectedCardId: 'blind-card-0',
    });
  });

  it('keeps the first maximum number for a mandatory hidden hand range', () => {
    const command = buildSolitaireOpponentEffectCommand(
      createState({
        selectableCardIds: [
          'hidden-card-a',
          'hidden-card-b',
          'hidden-card-c',
          'hidden-card-d',
        ],
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: 3,
      }),
      OPPONENT_PLAYER_ID,
      NOW
    );

    expect(command).toMatchObject({
      selectedCardIds: ['blind-card-0', 'blind-card-1', 'blind-card-2'],
    });
    expect(JSON.stringify(command)).not.toContain('hidden-card');
  });

  it('stops for optional or invalid hidden hand multi-selection', () => {
    expect(
      buildSolitaireOpponentEffectCommand(
        createState({
          selectableCardIds: ['hidden-card-a', 'hidden-card-b'],
          selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
          selectableCardMode: 'ORDERED_MULTI',
          minSelectableCards: 0,
          maxSelectableCards: 2,
          canSkipSelection: true,
        }),
        OPPONENT_PLAYER_ID,
        NOW
      )
    ).toBeNull();

    expect(
      buildSolitaireOpponentEffectCommand(
        createState({
          selectableCardIds: ['hidden-card-a'],
          selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
          selectableCardMode: 'ORDERED_MULTI',
          minSelectableCards: 2,
          maxSelectableCards: 2,
        }),
        OPPONENT_PLAYER_ID,
        NOW
      )
    ).toBeNull();
  });

  it('does not treat a private non-hand ordered selection as a hand decision', () => {
    const state = createState({
      selectableCardIds: ['inspected-card-a', 'inspected-card-b'],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 1,
      maxSelectableCards: 2,
    });
    state.players[1] = {
      ...state.players[1]!,
      hand: {
        ...state.players[1]!.hand,
        cardIds: [],
      },
    };

    expect(
      buildSolitaireOpponentEffectCommand(state, OPPONENT_PLAYER_ID, NOW)
    ).toBeNull();
  });

  it('does not treat a private non-hand implicit single selection as a hand decision', () => {
    const state = createState({
      selectableCardIds: ['inspected-card-a'],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    });
    state.players[1] = {
      ...state.players[1]!,
      hand: {
        ...state.players[1]!.hand,
        cardIds: [],
      },
    };

    expect(
      buildSolitaireOpponentEffectCommand(state, OPPONENT_PLAYER_ID, NOW)
    ).toBeNull();
  });

  it('does not resolve stale or forged positional tokens', () => {
    const state = createState({
      selectableCardIds: ['hidden-card-a', 'hidden-card-b'],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      metadata: {
        blindSelectionVersion: 3,
      },
    });
    const forgedCommand = {
      type: GameCommandType.CONFIRM_EFFECT_STEP,
      playerId: OPPONENT_PLAYER_ID,
      effectId: 'effect-1',
      selectedCardIds: ['blind-card-v2-0'],
      timestamp: NOW,
    } as const;

    expect(
      resolveSolitaireOpponentEffectCommandForExecution(state, forgedCommand)
    ).toBe(forgedCommand);
  });

  it('selects the first simple option or slot', () => {
    expect(
      buildSolitaireOpponentEffectCommand(
        createState({
          selectableOptions: [
            { id: 'option-a', label: '选项 A' },
            { id: 'option-b', label: '选项 B' },
          ],
        }),
        OPPONENT_PLAYER_ID,
        NOW
      )
    ).toMatchObject({
      selectedOptionId: 'option-a',
    });

    expect(
      buildSolitaireOpponentEffectCommand(
        createState({
          selectableSlots: [SlotPosition.LEFT, SlotPosition.CENTER],
        }),
        OPPONENT_PLAYER_ID,
        NOW
      )
    ).toMatchObject({
      selectedSlot: SlotPosition.LEFT,
    });
  });

  it.each([
    {
      name: 'ordered multi-card selection',
      effect: {
        selectableCardIds: ['card-a', 'card-b'],
        selectableCardMode: 'ORDERED_MULTI' as const,
        minSelectableCards: 1,
        maxSelectableCards: 2,
      },
    },
    {
      name: 'structured single effect choice',
      effect: {
        effectChoice: {
          mode: 'SINGLE' as const,
          options: [{ id: 'choice-a', text: '分支 A' }],
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true as const,
        },
      },
    },
    {
      name: 'structured multi effect choice',
      effect: {
        effectChoice: {
          mode: 'MULTI' as const,
          options: [{ id: 'choice-a', text: '分支 A' }],
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true as const,
        },
      },
    },
    {
      name: 'numeric input',
      effect: {
        numericInput: { min: 0, max: 3, integerOnly: true },
      },
    },
    {
      name: 'stage formation',
      effect: {
        stageFormation: {
          playerId: OPPONENT_PLAYER_ID,
          slots: [],
        },
      },
    },
    {
      name: 'combined input surfaces',
      effect: {
        selectableCardIds: ['card-a'],
        selectableCardMode: 'SINGLE' as const,
        selectableSlots: [SlotPosition.LEFT],
      },
    },
  ])('stops safely for $name', ({ effect }) => {
    expect(
      buildSolitaireOpponentEffectCommand(
        createState(effect),
        OPPONENT_PLAYER_ID,
        NOW
      )
    ).toBeNull();
  });

  it('does not act while a pending choice or cost payment exists', () => {
    const pendingChoiceState = createState({}, {
      pendingChoice: {
        id: 'choice-1',
        playerId: OPPONENT_PLAYER_ID,
        kind: 'CONFIRM_OPTIONAL',
        sourceAbilityId: 'test-ability',
      },
    });
    const pendingCostState = createState({}, {
      pendingCostPayment: {
        id: 'cost-1',
        playerId: OPPONENT_PLAYER_ID,
        sourceCardId: 'source-card',
        sourceSlot: SlotPosition.LEFT,
        printedCost: 1,
        finalEnergyCost: 1,
        payableEnergyCardIds: ['energy-1'],
      },
    } as Partial<GameState>);

    expect(
      buildSolitaireOpponentEffectCommand(
        pendingChoiceState,
        OPPONENT_PLAYER_ID,
        NOW
      )
    ).toBeNull();
    expect(
      buildSolitaireOpponentEffectCommand(
        pendingCostState,
        OPPONENT_PLAYER_ID,
        NOW
      )
    ).toBeNull();
  });

  it('does not advance public displays before their authoritative deadline', () => {
    const cardDisplay = createState({
      publicCardSelectionAutoAdvanceAt: NOW + 1,
    });
    expect(
      buildSolitaireOpponentEffectCommand(
        cardDisplay,
        OPPONENT_PLAYER_ID,
        NOW
      )
    ).toBeNull();
    expect(
      buildSolitaireOpponentEffectCommand(
        cardDisplay,
        OPPONENT_PLAYER_ID,
        NOW + 1
      )
    ).toMatchObject({
      publicCardSelectionAutoAdvanceAt: NOW + 1,
    });

    const choiceDisplay = createState({
      publicEffectChoiceAutoAdvanceAt: NOW + 10,
    });
    expect(
      buildSolitaireOpponentEffectCommand(
        choiceDisplay,
        OPPONENT_PLAYER_ID,
        NOW + 9
      )
    ).toBeNull();
    expect(
      buildSolitaireOpponentEffectCommand(
        choiceDisplay,
        OPPONENT_PLAYER_ID,
        NOW + 10
      )
    ).toMatchObject({
      publicEffectChoiceAutoAdvanceAt: NOW + 10,
    });
  });
});
