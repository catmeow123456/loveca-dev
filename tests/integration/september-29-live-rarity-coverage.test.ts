import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { GameService } from '../../src/application/game-service';
import { getCardAbilityDefinitions } from '../../src/application/card-effect-runner';

import { createGameSession } from '../../src/application/game-session';
import {
  createAutoAdvancePublicRevealCommand,
  createAutoAdvancePublicEffectChoiceCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';

const P1 = 'player1';
const P2 = 'player2';
const cases = [
  { code: 'PL!-bp3-019-SRL', score: 0, scoreDelta: 1 },
  { code: 'PL!-bp3-022-SECL', score: 5, scoreDelta: 3 },
  { code: 'PL!-bp3-022-SRL', score: 5, scoreDelta: 3 },
  { code: 'PL!-bp3-023-SRL', score: 3, scoreDelta: 0 },
  { code: 'PL!-bp3-024-SRL', score: 2, scoreDelta: 1 },
  { code: 'PL!-bp3-025-SRL', score: 4, scoreDelta: 1 },
  { code: 'PL!-bp4-021-SRL', score: 6, scoreDelta: 1 },
  { code: 'PL!-bp5-021-SRL', score: 3, scoreDelta: 1 },
] as const;

function live(code: string, id: string, score = 0, owner = P1) {
  return createCardInstance(
    {
      cardCode: code,
      name: id,
      cardType: CardType.LIVE,
      groupNames: ["μ's"],
      score,
      requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 10 }),
    } satisfies LiveCardData,
    owner,
    id
  );
}

function setup(cardCase: (typeof cases)[number]) {
  const source = live(cardCase.code, 'source', cardCase.score);
  const otherLive = live('TEST-LIVE-OTHER', 'other-live');
  const successes = [
    live('TEST-SUCCESS-ONE', 'success-one', 4),
    live('TEST-SUCCESS-TWO', 'success-two', 5),
  ];
  const members = [4, 3, 3].map((blade, index) =>
    createCardInstance(
      {
        cardCode: `TEST-MEMBER-${index}`,
        name: ['高坂穂乃果', '南ことり', '園田海未'][index]!,
        cardType: CardType.MEMBER,
        groupNames: ["μ's"],
        cost: 4,
        blade,
        hearts: [],
        bladeHearts: [],
      } satisfies MemberCardData,
      P1,
      `member-${index}`
    )
  );
  const ownDeck = Array.from({ length: 8 }, (_, i) => live(`TEST-DECK-${i}`, `own-deck-${i}`));
  const opponentDeck = Array.from({ length: 3 }, (_, i) =>
    live(`TEST-OPPONENT-DECK-${i}`, `opponent-deck-${i}`, 0, P2)
  );
  let game = registerCards(createGameState('september-rarity', P1, 'P1', P2, 'P2'), [
    source,
    otherLive,
    ...successes,
    ...members,
    ...ownDeck,
    ...opponentDeck,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(
      addCardToStatefulZone(player.liveZone, source.instanceId),
      otherLive.instanceId
    ),
    successZone: successes.reduce(
      (zone, card) => addCardToStatefulZone(zone, card.instanceId),
      player.successZone
    ),
    mainDeck: { ...player.mainDeck, cardIds: ownDeck.map((card) => card.instanceId) },
    memberSlots: members.reduce(
      (slots, member, index) =>
        placeCardInSlot(
          slots,
          [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!,
          member.instanceId,
          { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE }
        ),
      player.memberSlots
    ),
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: opponentDeck.map((card) => card.instanceId) },
  }));
  const isSuccess = cardCase.code.startsWith('PL!-bp3-025-');
  game = {
    ...game,
    currentPhase: isSuccess ? GamePhase.LIVE_RESULT_PHASE : GamePhase.PERFORMANCE_PHASE,
    currentSubPhase: isSuccess ? SubPhase.RESULT_FIRST_SUCCESS_EFFECTS : SubPhase.NONE,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: P1,
      liveResults: new Map([[source.instanceId, true]]),
      playerScores: new Map([[P1, cardCase.score]]),
      playerRemainingHearts: new Map([[P1, []]]),
    },
  };
  return { game, source, members, ownDeck, isSuccess };
}

function finishChoices(initial: GameState): GameState {
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.restoreRuntimeState({ authorityState: initial, currentPublicSeq: 0 });
  for (let step = 0; session.state?.activeEffect && step < 16; step++) {
    const effect = session.state.activeEffect;
    let command;
    if (effect.publicRevealAutoAdvanceAt !== undefined) {
      const deadline = effect.publicRevealAutoAdvanceAt;
      const generation = effect.publicRevealGeneration!;
      expect(
        session.executeCommand(
          createAutoAdvancePublicRevealCommand(P2, effect.id, deadline, generation)
        ).success
      ).toBe(false);
      expect(session.state?.inspectionZone.cardIds).toEqual(initial.inspectionZone.cardIds);
      expect(session.state?.players[0]?.waitingRoom.cardIds).toEqual([]);
      now = deadline;
      command = createAutoAdvancePublicRevealCommand(P2, effect.id, deadline, generation);
    } else if (effect.publicEffectChoiceAutoAdvanceAt !== undefined) {
      now = effect.publicEffectChoiceAutoAdvanceAt;
      command = createAutoAdvancePublicEffectChoiceCommand(P2, effect.id, now);
    } else {
      command = createConfirmEffectStepCommand(
        effect.awaitingPlayerId,
        effect.id,
        effect.selectableCardIds?.[0],
        null,
        effect.stepId === 'SELECT_NEXT_PENDING_ABILITY',
        effect.effectChoice?.options[0]?.id
      );
    }
    const result = session.executeCommand(command);
    expect(result.success, `${effect.stepId}: ${result.error ?? ''}`).toBe(true);
  }
  expect(session.state?.activeEffect).toBeNull();
  expect(session.state?.pendingAbilities).toEqual([]);
  return session.state!;
}

describe('September 29 LIVE reprints use actual timing and existing workflows', () => {
  it.each(cases)('$code enters the real queue and resolves its complete effect', (cardCase) => {
    const scenario = setup(cardCase);
    const result = new GameService().executeCheckTiming(scenario.game, [
      scenario.isSuccess ? TriggerCondition.ON_LIVE_SUCCESS : TriggerCondition.ON_LIVE_START,
    ]);
    expect(result.success).toBe(true);
    expect(result.gameState.activeEffect).not.toBeNull();
    const resolved = finishChoices(result.gameState);
    const expectedAbilities = getCardAbilityDefinitions(cardCase.code);
    for (const definition of expectedAbilities) {
      expect(
        resolved.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === definition.abilityId
        )
      ).toBe(true);
    }
    const sourceScore = resolved.liveResolution.liveModifiers.filter(
      (modifier) => modifier.kind === 'SCORE' && modifier.liveCardId === scenario.source.instanceId
    );
    expect(
      sourceScore.reduce(
        (total, modifier) => total + (modifier.kind === 'SCORE' ? modifier.countDelta : 0),
        0
      )
    ).toBe(cardCase.scoreDelta);
    if (cardCase.code.startsWith('PL!-bp3-023-') || cardCase.code.startsWith('PL!-bp4-021-')) {
      expect(resolved.liveResolution.liveModifiers).toContainEqual(
        expect.objectContaining({
          kind: 'REQUIREMENT',
          liveCardId: scenario.source.instanceId,
          modifiers: [
            {
              color: HeartColor.RAINBOW,
              countDelta: cardCase.code.startsWith('PL!-bp3-023-') ? -2 : -1,
            },
          ],
        })
      );
    }
    if (cardCase.code.startsWith('PL!-bp3-022-')) {
      expect(resolved.players[0]!.waitingRoom.cardIds).toEqual(
        scenario.ownDeck.slice(0, 3).map((card) => card.instanceId)
      );
      expect(
        resolved.eventLog.filter(
          ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
        )
      ).toHaveLength(1);
    }
    if (cardCase.code.startsWith('PL!-bp3-024-') || cardCase.code.startsWith('PL!-bp5-021-')) {
      expect(resolved.liveResolution.liveModifiers).toContainEqual(
        expect.objectContaining({
          kind: 'HEART',
          target: 'TARGET_MEMBER',
          targetMemberCardId: scenario.members[0]!.instanceId,
        })
      );
    }
    if (cardCase.code.startsWith('PL!-bp5-021-')) {
      expect(resolved.players[0]!.waitingRoom.cardIds).toHaveLength(1);
      expect(resolved.players[1]!.waitingRoom.cardIds).toHaveLength(1);
    }
  });
});
