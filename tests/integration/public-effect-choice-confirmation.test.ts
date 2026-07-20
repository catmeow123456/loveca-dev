import { describe, expect, it } from 'vitest';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createAutoAdvancePublicEffectChoiceCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { registerActiveEffectStepHandler } from '../../src/application/card-effects/runtime/step-registry';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID,
  PUBLIC_EFFECT_CHOICE_DISPLAY_DURATION_MS,
} from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
import { createCardInstance } from '../../src/domain/entities/card';
import {
  addAction,
  createGameState,
  registerCards,
  updatePlayer,
  type ActiveEffectState,
  type GameState,
} from '../../src/domain/entities/game';
import { projectPlayerViewState } from '../../src/online/projector';
import { CardType } from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const SINGLE_ABILITY_ID = 'test:public-effect-choice-single';
const SINGLE_STEP_ID = 'CHOOSE_SINGLE_EFFECT';
const MULTI_ABILITY_ID = 'test:public-effect-choice-multi';
const MULTI_STEP_ID = 'CHOOSE_MULTI_EFFECTS';
const COMBINED_ABILITY_ID = 'test:public-effect-choice-with-card-selection';
const COMBINED_STEP_ID = 'CHOOSE_CARD_AND_DESTINATION';

function createSessionWithEffect(effect: ActiveEffectState) {
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.createGame('public-effect-choice-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = {
    ...session.state!,
    activeEffect: effect,
  };
  return {
    session,
    setNow: (value: number) => {
      now = value;
    },
  };
}

function singleEffect(): ActiveEffectState {
  return {
    id: 'single-effect',
    abilityId: SINGLE_ABILITY_ID,
    sourceCardId: 'single-source',
    controllerId: P1,
    effectText: '从以下选择1项。',
    stepId: SINGLE_STEP_ID,
    stepText: '请选择要执行的效果。',
    awaitingPlayerId: P1,
    selectableOptions: [{ id: 'legacy-dynamic-leak', label: '不应投影' }],
    effectChoice: {
      mode: 'SINGLE',
      options: [
        { id: 'draw', text: '抽1张牌。', selectable: true },
        { id: 'score', text: '此LIVE分数+1。', selectable: false },
      ],
      minSelections: 1,
      maxSelections: 1,
      publicConfirmation: true,
    },
  };
}

function submitEffectChoice(
  session: ReturnType<typeof createGameSession>,
  optionIds: readonly string[],
  selectedCardId?: string
) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      session.state!.activeEffect!.id,
      selectedCardId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      optionIds
    )
  );
}

describe('public effect-choice confirmation', () => {
  it('uses an authoritative fixed 1500ms disclosure visible to both players and hides dynamic selectability from the opponent', () => {
    registerActiveEffectStepHandler(SINGLE_ABILITY_ID, SINGLE_STEP_ID, (game, input) =>
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', P1, {
        selectedOptionId: input.selectedOptionId,
        selectedEffectOptionIds: input.selectedEffectOptionIds,
      })
    );
    const { session, setNow } = createSessionWithEffect(singleEffect());
    const choosingP1 = projectPlayerViewState(session.state!, P1, { now: 10_000 });
    const choosingP2 = projectPlayerViewState(session.state!, P2, { now: 10_000 });
    expect(choosingP1.activeEffect?.effectChoice?.options).toEqual([
      { id: 'draw', text: '抽1张牌。', selectable: true },
      { id: 'score', text: '此LIVE分数+1。', selectable: false },
    ]);
    expect(choosingP2.activeEffect?.effectChoice?.options).toEqual([
      { id: 'draw', text: '抽1张牌。' },
      { id: 'score', text: '此LIVE分数+1。' },
    ]);
    expect(choosingP1.activeEffect?.selectableOptions).toBeUndefined();
    expect(choosingP2.activeEffect?.selectableOptions).toBeUndefined();

    const selected = submitEffectChoice(session, ['draw']);
    expect(selected.success, selected.error).toBe(true);
    const initialUndo = session.getUndoAvailability(P1).entry;
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID,
      publicEffectChoiceAutoAdvanceAt: 11_500,
      effectChoice: { selectedOptionIds: ['draw'] },
    });
    expect(PUBLIC_EFFECT_CHOICE_DISPLAY_DURATION_MS).toBe(1_500);
    for (const playerId of [P1, P2]) {
      const view = projectPlayerViewState(session.state!, playerId, { now: 10_400 });
      expect(view.activeEffect).toMatchObject({
        publicEffectChoiceAutoAdvanceAt: 11_500,
        publicEffectChoiceAutoAdvanceAfterMs: 1_100,
        effectChoice: { selectedOptionIds: ['draw'] },
      });
      expect(
        view.permissions.availableCommands.some(
          (hint) => hint.command === 'CONFIRM_EFFECT_STEP'
        )
      ).toBe(true);
    }

    expect(
      session.executeCommand(
        createAutoAdvancePublicEffectChoiceCommand(P2, 'single-effect', 11_500)
      ).success
    ).toBe(false);
    setNow(11_500);
    expect(
      session.executeCommand(
        createAutoAdvancePublicEffectChoiceCommand('outsider', 'single-effect', 11_500)
      ).success
    ).toBe(false);
    const advanced = session.executeCommand(
      createAutoAdvancePublicEffectChoiceCommand(P2, 'single-effect', 11_500)
    );
    expect(advanced.success, advanced.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      selectedOptionId: 'draw',
      selectedEffectOptionIds: ['draw'],
    });
    expect(session.getUndoAvailability(P1).entry?.undoEntryId).toBe(initialUndo?.undoEntryId);
    expect(
      session.executeCommand(
        createAutoAdvancePublicEffectChoiceCommand(P1, 'single-effect', 11_500)
      ).success
    ).toBe(false);
  });

  it('rejects forged, disabled and duplicate selections without opening disclosure', () => {
    registerActiveEffectStepHandler(SINGLE_ABILITY_ID, SINGLE_STEP_ID, (game) => game);
    for (const optionIds of [['forged'], ['score'], ['draw', 'draw']] as const) {
      const { session } = createSessionWithEffect(singleEffect());
      const rejected = submitEffectChoice(session, optionIds);
      expect(rejected.success).toBe(false);
      expect(session.state?.activeEffect?.stepId).toBe(SINGLE_STEP_ID);
      expect(session.state?.activeEffect?.publicEffectChoiceAutoAdvanceAt).toBeUndefined();
    }

    const malformedSingle = createSessionWithEffect({
      ...singleEffect(),
      effectChoice: {
        ...singleEffect().effectChoice!,
        minSelections: 0,
      },
    }).session.executeCommand(
      createConfirmEffectStepCommand(
        P1,
        'single-effect',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        []
      )
    );
    expect(malformedSingle.success).toBe(false);
  });

  it('allows a legacy canSkipSelection decline without creating a public choice window', () => {
    registerActiveEffectStepHandler(SINGLE_ABILITY_ID, SINGLE_STEP_ID, (game, input) =>
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', P1, {
        skipped: input.selectedCardId === null,
        selectedEffectOptionIds: input.selectedEffectOptionIds,
      })
    );
    const { session } = createSessionWithEffect({
      ...singleEffect(),
      canSkipSelection: true,
      skipSelectionLabel: '不改变必要Heart',
    });
    const result = session.executeCommand(
      createConfirmEffectStepCommand(P1, 'single-effect', null)
    );
    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({ skipped: true });
    expect(session.state?.actionHistory.at(-1)?.payload.selectedEffectOptionIds).toBeUndefined();
  });

  it('accepts legacy selectedOptionId only as a SINGLE fallback and still discloses it', () => {
    registerActiveEffectStepHandler(SINGLE_ABILITY_ID, SINGLE_STEP_ID, (game, input) =>
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', P1, {
        selectedOptionId: input.selectedOptionId,
        selectedEffectOptionIds: input.selectedEffectOptionIds,
      })
    );
    const { session, setNow } = createSessionWithEffect(singleEffect());
    const submitted = session.executeCommand(
      createConfirmEffectStepCommand(
        P1,
        'single-effect',
        undefined,
        undefined,
        undefined,
        'draw'
      )
    );
    expect(submitted.success, submitted.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID,
      effectChoice: { selectedOptionIds: ['draw'] },
    });
    setNow(11_500);
    expect(
      session.executeCommand(
        createAutoAdvancePublicEffectChoiceCommand(P2, 'single-effect', 11_500)
      ).success
    ).toBe(true);
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      selectedOptionId: 'draw',
      selectedEffectOptionIds: ['draw'],
    });

    const disabled = createSessionWithEffect(singleEffect()).session.executeCommand(
      createConfirmEffectStepCommand(
        P1,
        'single-effect',
        undefined,
        undefined,
        undefined,
        'score'
      )
    );
    expect(disabled.success).toBe(false);

    const multiEffect: ActiveEffectState = {
      ...singleEffect(),
      abilityId: MULTI_ABILITY_ID,
      stepId: MULTI_STEP_ID,
      effectChoice: {
        ...singleEffect().effectChoice!,
        mode: 'MULTI',
        maxSelections: 2,
      },
    };
    registerActiveEffectStepHandler(MULTI_ABILITY_ID, MULTI_STEP_ID, (game) => game);
    const multi = createSessionWithEffect(multiEffect).session.executeCommand(
      createConfirmEffectStepCommand(
        P1,
        'single-effect',
        undefined,
        undefined,
        undefined,
        'draw'
      )
    );
    expect(multi.success).toBe(false);
  });

  it('normalizes MULTI selections to printed order before disclosure and resolution', () => {
    registerActiveEffectStepHandler(MULTI_ABILITY_ID, MULTI_STEP_ID, (game, input) =>
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', P1, {
        selectedEffectOptionIds: input.selectedEffectOptionIds,
      })
    );
    const effect: ActiveEffectState = {
      ...singleEffect(),
      id: 'multi-effect',
      abilityId: MULTI_ABILITY_ID,
      stepId: MULTI_STEP_ID,
      effectChoice: {
        mode: 'MULTI',
        options: [
          { id: 'first', text: '可选效果1' },
          { id: 'second', text: '可选效果2' },
          { id: 'third', text: '可选效果3' },
        ],
        minSelections: 2,
        maxSelections: 2,
        publicConfirmation: true,
      },
    };
    const { session, setNow } = createSessionWithEffect(effect);
    expect(submitEffectChoice(session, ['third', 'first']).success).toBe(true);
    expect(session.state?.activeEffect?.effectChoice?.selectedOptionIds).toEqual([
      'first',
      'third',
    ]);
    setNow(11_500);
    expect(
      session.executeCommand(
        createAutoAdvancePublicEffectChoiceCommand(P1, 'multi-effect', 11_500)
      ).success
    ).toBe(true);
    expect(session.state?.actionHistory.at(-1)?.payload.selectedEffectOptionIds).toEqual([
      'first',
      'third',
    ]);
  });

  it('chains effect disclosure before public card disclosure and clears effectChoice before the restored handler', () => {
    const card = createCardInstance(
      { cardCode: 'TEST-LIVE', name: 'Test Live', cardType: CardType.LIVE, score: 1 },
      P1,
      'waiting-live'
    );
    registerActiveEffectStepHandler(COMBINED_ABILITY_ID, COMBINED_STEP_ID, (game, input) => {
      const effect = game.activeEffect;
      const selectedCardId = input.selectedCardId;
      const player = game.players.find((candidate) => candidate.id === P1);
      if (!effect || !selectedCardId || !player?.waitingRoom.cardIds.includes(selectedCardId)) {
        return game;
      }
      const moved = updatePlayer(game, P1, (current) => ({
        ...current,
        waitingRoom: {
          ...current.waitingRoom,
          cardIds: current.waitingRoom.cardIds.filter((cardId) => cardId !== selectedCardId),
        },
        hand: { ...current.hand, cardIds: [...current.hand.cardIds, selectedCardId] },
      }));
      return addAction({ ...moved, activeEffect: null }, 'RESOLVE_ABILITY', P1, {
        selectedCardId,
        selectedOptionId: input.selectedOptionId,
        selectedEffectOptionIds: input.selectedEffectOptionIds,
        effectChoicePresentAtResolution: effect.effectChoice !== undefined,
      });
    });
    const effect: ActiveEffectState = {
      id: 'combined-effect',
      abilityId: COMBINED_ABILITY_ID,
      sourceCardId: 'combined-source',
      controllerId: P1,
      effectText: '选择1张卡，将其放置于手牌或卡组底。',
      stepId: COMBINED_STEP_ID,
      stepText: '请选择卡牌和放置位置。',
      awaitingPlayerId: P1,
      selectableCardIds: [card.instanceId],
      effectChoice: {
        mode: 'SINGLE',
        options: [
          { id: 'hand', text: '加入手牌' },
          { id: 'bottom', text: '放置于卡组底' },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      metadata: {
        publicCardSelectionConfirmation: { destination: 'HAND' },
      },
    };
    const { session, setNow } = createSessionWithEffect(effect);
    let game = registerCards(session.state!, [card]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [card.instanceId] },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = game;

    expect(submitEffectChoice(session, ['hand'], card.instanceId).success).toBe(true);
    const firstSelectionUndoId = session.getUndoAvailability(P1).entry?.undoEntryId;
    expect(session.state?.activeEffect?.stepId).toBe(
      PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([card.instanceId]);

    setNow(11_500);
    expect(
      session.executeCommand(
        createAutoAdvancePublicEffectChoiceCommand(P2, 'combined-effect', 11_500)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [card.instanceId],
      publicCardSelectionAutoAdvanceAt: 13_500,
    });
    expect(session.state?.activeEffect?.effectChoice).toBeUndefined();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([card.instanceId]);

    // 公开后目标变为 stale 时不移动，并恢复最初选择窗口供重试。
    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      session.state!,
      P1,
      (player) => ({
        ...player,
        waitingRoom: { ...player.waitingRoom, cardIds: [] },
        hand: { ...player.hand, cardIds: [card.instanceId] },
      })
    );
    setNow(13_500);
    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P2, 'combined-effect', 13_500)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: COMBINED_STEP_ID,
    });
    expect(session.state?.activeEffect?.effectChoice?.selectedOptionIds).toBeUndefined();
    expect(session.state?.activeEffect?.publicCardSelectionAutoAdvanceAt).toBeUndefined();
    expect(session.state?.activeEffect?.publicEffectChoiceAutoAdvanceAt).toBeUndefined();

    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      session.state!,
      P1,
      (player) => ({
        ...player,
        waitingRoom: { ...player.waitingRoom, cardIds: [card.instanceId] },
        hand: { ...player.hand, cardIds: [] },
      })
    );
    expect(submitEffectChoice(session, ['hand'], card.instanceId).success).toBe(true);
    const selectionUndoId = session.getUndoAvailability(P1).entry?.undoEntryId;
    expect(selectionUndoId).not.toBe(firstSelectionUndoId);
    setNow(15_000);
    expect(
      session.executeCommand(
        createAutoAdvancePublicEffectChoiceCommand(P1, 'combined-effect', 15_000)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      publicCardSelectionAutoAdvanceAt: 17_000,
    });
    setNow(17_000);
    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(P2, 'combined-effect', 17_000)
      ).success
    ).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([card.instanceId]);
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      selectedCardId: card.instanceId,
      selectedOptionId: 'hand',
      selectedEffectOptionIds: ['hand'],
      effectChoicePresentAtResolution: false,
    });
    expect(session.getUndoAvailability(P1).entry?.undoEntryId).toBe(selectionUndoId);
    const undo = session.undoLastStepForPlayer(P1, selectionUndoId!);
    expect(undo.success, undo.error).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(COMBINED_STEP_ID);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([card.instanceId]);
  });

  it('rejects stale deadline generations and selection payloads during disclosure', () => {
    registerActiveEffectStepHandler(SINGLE_ABILITY_ID, SINGLE_STEP_ID, (game) => ({
      ...game,
      activeEffect: null,
    }));
    const { session, setNow } = createSessionWithEffect(singleEffect());
    expect(submitEffectChoice(session, ['draw']).success).toBe(true);
    setNow(11_500);
    expect(
      session.executeCommand(
        createAutoAdvancePublicEffectChoiceCommand(P2, 'single-effect', 11_499)
      ).success
    ).toBe(false);
    expect(
      session.executeCommand({
        ...createAutoAdvancePublicEffectChoiceCommand(P2, 'single-effect', 11_500),
        selectedEffectOptionIds: ['draw'],
      }).success
    ).toBe(false);
    expect(session.state?.activeEffect?.stepId).toBe(
      PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID
    );
  });
});
