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
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { SP_PR_LIVE_START_DISCARD_GAIN_BLADE_DRAW_IF_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function selectDiscard(session: GameSession, discardCardId: string | null): ReturnType<GameSession['executeCommand']> {
  return session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
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
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
  });
});
