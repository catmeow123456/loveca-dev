import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  S_BP3_003_LIVE_START_DISCARD_UP_TO_TWO_GAIN_BLADE_ABILITY_ID,
  SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createPendingAbility(sourceCardId: string, sourceSlot: SlotPosition): PendingAbilityState {
  return {
    id: `pending-${sourceCardId}`,
    abilityId: SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`live-start-${sourceCardId}`],
    sourceSlot,
  };
}

function setupScenario(options: {
  readonly sourceCardCode?: string;
  readonly sourceName?: string;
  readonly handKind?: 'member' | 'live' | 'none';
  readonly sourceOnStage?: boolean;
} = {}): {
  readonly session: GameSession;
  readonly sourceCardId: string;
  readonly discardCardId: string | null;
  readonly drawCardId: string;
} {
  const source = createCardInstance(
    createMember(options.sourceCardCode ?? 'PL!SP-PR-009-PR', options.sourceName ?? '米女メイ'),
    PLAYER1,
    'source'
  );
  const discardCard =
    options.handKind === 'none'
      ? null
      : createCardInstance(
          options.handKind === 'live'
            ? createLive('PL!SP-test-discard-L')
            : createMember('PL!SP-test-discard-M'),
          PLAYER1,
          'discard'
        );
  const drawCard = createCardInstance(createMember('PL!SP-test-draw'), PLAYER1, 'draw');
  const fillerCard = createCardInstance(createMember('PL!SP-test-filler'), PLAYER1, 'filler');

  let game = createGameState('sp-pr-live-start-discard-blade-draw', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(
    game,
    discardCard ? [source, discardCard, drawCard, fillerCard] : [source, drawCard, fillerCard]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId, fillerCard.instanceId] },
    hand: discardCard ? addCardToZone(player.hand, discardCard.instanceId) : player.hand,
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
  }));

  const started = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [createPendingAbility(source.instanceId, SlotPosition.CENTER)],
  }).gameState;

  const session = createGameSession();
  session.createGame('sp-pr-live-start-discard-blade-draw-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = started;

  return {
    session,
    sourceCardId: source.instanceId,
    discardCardId: discardCard?.instanceId ?? null,
    drawCardId: drawCard.instanceId,
  };
}

function setupSbp3003(handCount = 3): {
  readonly session: GameSession;
  readonly sourceCardId: string;
  readonly handCardIds: readonly string[];
  readonly outsideCardId: string;
} {
  const source = createCardInstance(createMember('PL!S-bp3-003-P', '松浦果南'), PLAYER1, 's-bp3-003-source');
  const hand = Array.from({ length: handCount }, (_, index) =>
    createCardInstance(createMember(`S-BP3-003-HAND-${index}`), PLAYER1, `s-bp3-003-hand-${index}`)
  );
  const outside = createCardInstance(createMember('S-BP3-003-OUTSIDE'), PLAYER1, 's-bp3-003-outside');
  let game = registerCards(
    createGameState('s-bp3-003-focused', PLAYER1, 'P1', PLAYER2, 'P2'),
    [source, ...hand, outside]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
  }));
  const started = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [{
      ...createPendingAbility(source.instanceId, SlotPosition.CENTER),
      abilityId: S_BP3_003_LIVE_START_DISCARD_UP_TO_TWO_GAIN_BLADE_ABILITY_ID,
    }],
  }).gameState;
  const session = createGameSession();
  session.createGame('s-bp3-003-focused-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = started;
  return {
    session,
    sourceCardId: source.instanceId,
    handCardIds: hand.map((card) => card.instanceId),
    outsideCardId: outside.instanceId,
  };
}

function selectDiscard(session: GameSession, discardCardId: string | null): ReturnType<GameSession['executeCommand']> {
  return session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
  );
}

function selectDiscards(session: GameSession, discardCardIds: readonly string[]) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      null,
      undefined,
      null,
      discardCardIds
    )
  );
}

describe('SP PR LIVE start discard gain BLADE and draw if LIVE shared workflow', () => {
  it.each([
    ['PL!SP-PR-009-PR', '米女メイ'],
    ['PL!SP-PR-011-PR', '鬼塚夏美'],
    ['PL!SP-PR-012-PR', 'ウィーン・マルガレーテ'],
  ] as const)('discards a member card and gives source member BLADE for %s', (cardCode, name) => {
    const { session, sourceCardId, discardCardId, drawCardId } = setupScenario({
      sourceCardCode: cardCode,
      sourceName: name,
      handKind: 'member',
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID,
      selectableCardIds: [discardCardId],
      canSkipSelection: true,
    });

    expect(selectDiscard(session, discardCardId).success).toBe(true);

    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discardCardId);
    expect(session.state?.players[0].hand.cardIds).not.toContain(drawCardId);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId,
      abilityId: SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID,
    });
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'DISCARD_GAIN_BLADE',
      discardedCardId: discardCardId,
      discardedCardIds: [discardCardId],
    });
  });

  it('discards a LIVE card, gives BLADE, and draws one', () => {
    const { session, discardCardId, drawCardId } = setupScenario({ handKind: 'live' });

    expect(selectDiscard(session, discardCardId).success).toBe(true);

    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discardCardId);
    expect(session.state?.players[0].hand.cardIds).toContain(drawCardId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'DISCARD_LIVE_GAIN_BLADE_DRAW_ONE' &&
          action.payload.discardedCardId === discardCardId &&
          action.payload.discardedCardIds?.[0] === discardCardId &&
          action.payload.discardedLive === true &&
          action.payload.drawnCardIds?.[0] === drawCardId
      )
    ).toBe(true);
  });

  it('declines without discarding or adding BLADE', () => {
    const { session, discardCardId } = setupScenario({ handKind: 'member' });

    expect(selectDiscard(session, null).success).toBe(true);

    expect(session.state?.players[0].hand.cardIds).toContain(discardCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(discardCardId);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('consumes pending without opening a discard choice when hand is empty', () => {
    const { session } = setupScenario({ handKind: 'none' });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) => action.type === 'RESOLVE_ABILITY' && action.payload.step === 'NO_HAND_TO_DISCARD'
      )
    ).toBe(true);
  });

  it('consumes pending safely when the source member is no longer on stage', () => {
    const { session, discardCardId } = setupScenario({
      handKind: 'member',
      sourceOnStage: false,
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toContain(discardCardId);
    expect(
      session.state?.actionHistory.some(
        (action) => action.type === 'RESOLVE_ABILITY' && action.payload.step === 'SOURCE_NOT_ON_STAGE'
      )
    ).toBe(true);
  });

  it('S-bp3-003 supports 0, 1, or 2 discards and grants two BLADE per discarded card', () => {
    for (const discardCount of [0, 1, 2]) {
      const source = createCardInstance(createMember('PL!S-bp3-003-P', '松浦果南'), PLAYER1, `source-${discardCount}`);
      const hand = [0, 1].map((index) =>
        createCardInstance(createMember(`S-BP3-003-HAND-${discardCount}-${index}`), PLAYER1, `hand-${discardCount}-${index}`)
      );
      let game = registerCards(
        createGameState(`s-bp3-003-live-start-${discardCount}`, PLAYER1, 'P1', PLAYER2, 'P2'),
        [source, ...hand]
      );
      game = updatePlayer(game, PLAYER1, (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
      }));
      const started = resolvePendingCardEffects({
        ...game,
        pendingAbilities: [{
          ...createPendingAbility(source.instanceId, SlotPosition.CENTER),
          abilityId: S_BP3_003_LIVE_START_DISCARD_UP_TO_TWO_GAIN_BLADE_ABILITY_ID,
        }],
      }).gameState;
      const session = createGameSession();
      session.createGame(`s-bp3-003-live-start-session-${discardCount}`, PLAYER1, 'P1', PLAYER2, 'P2');
      (session as unknown as { authorityState: GameState }).authorityState = started;

      expect(session.state?.activeEffect).toMatchObject({
        stepText: '可以将至多2张手牌放置入休息室；每放置1张，此成员获得[BLADE][BLADE]。',
        minSelectableCards: 1,
        maxSelectableCards: 2,
        selectionLabel: '选择要放置入休息室的卡',
        confirmSelectionLabel: '放置入休息室',
        skipSelectionLabel: '不发动',
      });
      expect(session.state?.activeEffect?.stepText).not.toContain('来源成员');
      expect(
        discardCount === 0
          ? selectDiscard(session, null).success
          : selectDiscards(session, hand.slice(0, discardCount).map((card) => card.instanceId)).success
      ).toBe(true);
      if (discardCount === 0) {
        expect(session.state?.liveResolution.liveModifiers).toEqual([]);
      } else {
        expect(session.state?.liveResolution.liveModifiers).toContainEqual({
          kind: 'BLADE',
          playerId: PLAYER1,
          countDelta: discardCount * 2,
          sourceCardId: source.instanceId,
          abilityId: S_BP3_003_LIVE_START_DISCARD_UP_TO_TWO_GAIN_BLADE_ABILITY_ID,
        });
      }
    }
  });

  it('S-bp3-003 rejects duplicate, over-limit, and outside-candidate selections atomically', () => {
    const duplicate = setupSbp3003();
    expect(selectDiscards(duplicate.session, [duplicate.handCardIds[0]!, duplicate.handCardIds[0]!]).success).toBe(false);
    expect(duplicate.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(duplicate.session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(duplicate.session.state?.activeEffect).not.toBeNull();

    const overLimit = setupSbp3003();
    expect(selectDiscards(overLimit.session, overLimit.handCardIds).success).toBe(false);
    expect(overLimit.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(overLimit.session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(overLimit.session.state?.activeEffect).not.toBeNull();

    const outside = setupSbp3003();
    expect(selectDiscards(outside.session, [outside.outsideCardId]).success).toBe(false);
    expect(outside.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(outside.session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(outside.session.state?.activeEffect).not.toBeNull();
  });

  it('S-bp3-003 does not advance when the selected hand card became stale', () => {
    const scenario = setupSbp3003(2);
    (scenario.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      scenario.session.state!,
      PLAYER1,
      (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: player.hand.cardIds.filter((cardId) => cardId !== scenario.handCardIds[0]) },
      })
    );

    expect(selectDiscards(scenario.session, [scenario.handCardIds[0]!]).success).toBe(false);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(scenario.session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(scenario.session.state?.activeEffect).not.toBeNull();
  });

  it('S-bp3-003 safely ends without discarding or adding BLADE when the source leaves after opening', () => {
    const scenario = setupSbp3003(2);
    (scenario.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      scenario.session.state!,
      PLAYER1,
      (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      })
    );

    expect(selectDiscards(scenario.session, [scenario.handCardIds[0]!]).success).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(scenario.handCardIds);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(scenario.session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
  });

  it('continues ordered pending after a decline into the next discard window', () => {
    const first = createCardInstance(createMember('PL!SP-PR-009-PR', '米女メイ'), PLAYER1, 'first');
    const second = createCardInstance(createMember('PL!SP-PR-011-PR', '鬼塚夏美'), PLAYER1, 'second');
    const discard = createCardInstance(createMember('PL!SP-test-discard-M'), PLAYER1, 'discard');
    let game = createGameState('sp-pr-live-start-ordered', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [first, second, discard]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: addCardToZone(player.hand, discard.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
        SlotPosition.RIGHT,
        second.instanceId
      ),
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(first.instanceId, SlotPosition.LEFT),
        createPendingAbility(second.instanceId, SlotPosition.RIGHT),
      ],
    };

    const orderSelection = resolvePendingCardEffects(game).gameState;
    const session = createGameSession();
    session.createGame('sp-pr-live-start-ordered-session', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = orderSelection;

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          true
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.sourceCardId).toBe(first.instanceId);

    expect(selectDiscard(session, null).success).toBe(true);
    expect(session.state?.activeEffect?.sourceCardId).toBe(second.instanceId);

    expect(selectDiscard(session, discard.instanceId).success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toContain(discard.instanceId);
  });
});
