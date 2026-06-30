import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { addHeartLiveModifierForMember } from '../../src/domain/rules/live-modifiers';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP5_015_LIVE_START_ALL_SIX_STAGE_HEARTS_GAIN_TWO_BLADE_ABILITY_ID,
  N_SD1_004_LIVE_START_DISCARD_GAIN_TWO_BLADE_ABILITY_ID,
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

function createNijigasakiMember(
  cardCode: string,
  name: string,
  hearts: readonly HeartColor[],
  cost = 4
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: hearts.map((color) => createHeartIcon(color, 1)),
  };
}

function createSessionWithState(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('n-bp5-015-shizuku-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function setupLiveStart(options: {
  readonly sourceHearts?: readonly HeartColor[];
  readonly leftSource?: boolean;
  readonly otherStageMembers: readonly ReturnType<typeof createCardInstance>[];
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly mutateBeforeTrigger?: (game: GameState, sourceId: string) => GameState;
}): {
  readonly session: GameSession;
  readonly source: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(
    createNijigasakiMember(
      'PL!N-bp5-015-N',
      '桜坂しずく',
      options.sourceHearts ?? [HeartColor.PINK]
    ),
    PLAYER1,
    'shizuku-source'
  );
  let game = createGameState('n-bp5-015-shizuku', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...options.otherStageMembers, ...(options.handCards ?? [])]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(
      player.memberSlots,
      options.leftSource === true ? SlotPosition.LEFT : SlotPosition.CENTER,
      source.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    );
    const slots = options.leftSource === true ? [SlotPosition.CENTER, SlotPosition.RIGHT] : [
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
    ];
    for (const [index, member] of options.otherStageMembers.entries()) {
      const slot = slots[index];
      if (!slot) {
        continue;
      }
      memberSlots = placeCardInSlot(memberSlots, slot, member.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      hand: {
        ...player.hand,
        cardIds: (options.handCards ?? []).map((card) => card.instanceId),
      },
      memberSlots,
    };
  });
  game = options.mutateBeforeTrigger?.(game, source.instanceId) ?? game;

  const stateWithPending = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_START]);
  const resolveResult = resolvePendingCardEffects(stateWithPending);
  return { session: createSessionWithState(resolveResult.gameState), source };
}

function createMemberInstance(
  id: string,
  hearts: readonly HeartColor[],
  cardCode = `PL!N-test-${id}`
) {
  return createCardInstance(
    createNijigasakiMember(cardCode, id, hearts),
    PLAYER1,
    id
  );
}

describe('PL!N-bp5-015-N Shizuku live-start workflow', () => {
  it('adds BLADE +2 when own stage members collectively have all six Heart colors', () => {
    const redYellowGreen = createMemberInstance('red-yellow-green', [
      HeartColor.RED,
      HeartColor.YELLOW,
      HeartColor.GREEN,
    ]);
    const bluePurple = createMemberInstance('blue-purple', [HeartColor.BLUE, HeartColor.PURPLE]);
    const { session, source } = setupLiveStart({
      otherStageMembers: [redYellowGreen, bluePurple],
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: source.instanceId,
      abilityId: N_BP5_015_LIVE_START_ALL_SIX_STAGE_HEARTS_GAIN_TWO_BLADE_ABILITY_ID,
    });
  });

  it('does not add BLADE when any one required Heart color is missing', () => {
    const redYellowGreen = createMemberInstance('red-yellow-green', [
      HeartColor.RED,
      HeartColor.YELLOW,
      HeartColor.GREEN,
    ]);
    const blueOnly = createMemberInstance('blue-only', [HeartColor.BLUE]);
    const { session, source } = setupLiveStart({
      otherStageMembers: [redYellowGreen, blueOnly],
    });

    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.sourceCardId === source.instanceId &&
          modifier.abilityId ===
            N_BP5_015_LIVE_START_ALL_SIX_STAGE_HEARTS_GAIN_TWO_BLADE_ABILITY_ID
      )
    ).toBe(false);
  });

  it('counts effective member Heart modifiers when checking the six stage Heart colors', () => {
    const redYellowGreen = createMemberInstance('red-yellow-green', [
      HeartColor.RED,
      HeartColor.YELLOW,
      HeartColor.GREEN,
    ]);
    const blueOnly = createMemberInstance('blue-only', [HeartColor.BLUE]);
    const { session, source } = setupLiveStart({
      otherStageMembers: [redYellowGreen, blueOnly],
      mutateBeforeTrigger: (game) => {
        const heartResult = addHeartLiveModifierForMember(game, {
          playerId: PLAYER1,
          memberCardId: blueOnly.instanceId,
          sourceCardId: blueOnly.instanceId,
          abilityId: 'test:gain-purple-heart',
          hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
        });
        return heartResult!.gameState;
      },
    });

    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: source.instanceId,
      abilityId: N_BP5_015_LIVE_START_ALL_SIX_STAGE_HEARTS_GAIN_TWO_BLADE_ABILITY_ID,
    });
  });

  it('continues ordered pending resolution after resolving the direct live-start ability', () => {
    const source = createCardInstance(
      createNijigasakiMember('PL!N-bp5-015-N', '桜坂しずく', [HeartColor.PINK]),
      PLAYER1,
      'ordered-shizuku'
    );
    const karin = createCardInstance(
      createNijigasakiMember('PL!N-sd1-004-SD', '朝香果林', [HeartColor.RED], 11),
      PLAYER1,
      'ordered-karin'
    );
    const yellowGreenBluePurple = createMemberInstance('yellow-green-blue-purple', [
      HeartColor.YELLOW,
      HeartColor.GREEN,
      HeartColor.BLUE,
      HeartColor.PURPLE,
    ]);
    const hand = createMemberInstance('ordered-hand', [HeartColor.PINK]);
    let game = createGameState('n-bp5-015-continuation', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, karin, yellowGreenBluePurple, hand]);
    game = updatePlayer(game, PLAYER1, (player) => {
      let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.LEFT, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, karin.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
      memberSlots = placeCardInSlot(
        memberSlots,
        SlotPosition.RIGHT,
        yellowGreenBluePurple.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      );
      return {
        ...player,
        hand: {
          ...player.hand,
          cardIds: [hand.instanceId],
        },
        memberSlots,
      };
    });

    const stateWithPending = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_START]);
    const resolveResult = resolvePendingCardEffects(stateWithPending);
    const session = createSessionWithState(resolveResult.gameState);

    expect(session.state?.activeEffect?.canResolveInOrder).toBe(true);
    const result = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, undefined, undefined, true)
    );
    expect(result.success).toBe(true);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_SD1_004_LIVE_START_DISCARD_GAIN_TWO_BLADE_ABILITY_ID,
      selectableCardIds: [hand.instanceId],
    });
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: source.instanceId,
      abilityId: N_BP5_015_LIVE_START_ALL_SIX_STAGE_HEARTS_GAIN_TWO_BLADE_ABILITY_ID,
    });
  });
});
