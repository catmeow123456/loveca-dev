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
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
import { liveResolver } from '../../src/domain/rules/live-resolver';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import {
  PL_N_BP3_014_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
  PL_N_BP3_015_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
  PL_N_PB1_034_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
  PL_N_PB1_036_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
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

const CARD_CASES = [
  {
    cardCode: 'PL!N-bp3-014-N',
    cardId: 'kasumi',
    abilityId: PL_N_BP3_014_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
    printedHearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    options: [HeartColor.PINK, HeartColor.YELLOW, HeartColor.GREEN],
  },
  {
    cardCode: 'PL!N-bp3-015-N',
    cardId: 'shizuku',
    abilityId: PL_N_BP3_015_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
    printedHearts: [createHeartIcon(HeartColor.RED, 1)],
    options: [HeartColor.RED, HeartColor.BLUE, HeartColor.PURPLE],
  },
  {
    cardCode: 'PL!N-pb1-034-N',
    cardId: 'shioriko',
    abilityId: PL_N_PB1_034_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
    printedHearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    options: [HeartColor.YELLOW, HeartColor.GREEN, HeartColor.BLUE],
  },
  {
    cardCode: 'PL!N-pb1-036-N',
    cardId: 'lanzhu',
    abilityId: PL_N_PB1_036_LIVE_START_REPLACE_ORIGINAL_HEART_COLOR_ABILITY_ID,
    printedHearts: [createHeartIcon(HeartColor.PINK, 1)],
    options: [HeartColor.PINK, HeartColor.RED, HeartColor.PURPLE],
  },
] as const;

function createMember(cardCode: string, hearts: readonly ReturnType<typeof createHeartIcon>[]): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: '虹ヶ咲学園スクールアイドル同好会',
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts,
  };
}

function createLive(
  cardCode: string,
  color: HeartColor
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [color]: 1 }),
  };
}

function setupState(cardCase: (typeof CARD_CASES)[number]): {
  readonly game: GameState;
  readonly member: ReturnType<typeof createCardInstance>;
} {
  const member = createCardInstance(
    createMember(cardCase.cardCode, cardCase.printedHearts),
    PLAYER1,
    cardCase.cardId
  );
  const live = createCardInstance(createLive('PL!N-test-live-L', HeartColor.GREEN), PLAYER1, 'live');
  let game = createGameState('live-start-replace-original-heart-color', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [member, live]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, live.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return {
    game: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        performingPlayerId: PLAYER1,
      },
    },
    member,
  };
}

function startLiveStartSelection(game: GameState): GameSession {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  const session = createGameSession();
  session.createGame('live-start-replace-original-heart-color-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = result.gameState;
  return session;
}

function resolveSelectedColor(session: GameSession, color: HeartColor): void {
  const activeEffect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, activeEffect.id, undefined, undefined, undefined, color)
  );
  expect(result.success).toBe(true);
}

function judgeSingleLive(memberData: MemberCardData, color: HeartColor): boolean {
  const result = liveResolver.performLive(
    PLAYER1,
    [memberData],
    [
      {
        cardId: `${color}-live`,
        data: createLive(`${color}-live`, color),
      },
    ],
    []
  );
  return result.liveJudgments[0]?.isSuccess === true;
}

describe('LIVE start original Heart color replacement workflow', () => {
  it('replaces PL!N-bp3-014 original Yellow Heart with Green for LIVE judgment', () => {
    const cardCase = CARD_CASES[0];
    const { game, member } = setupState(cardCase);
    const session = startLiveStartSelection(game);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: cardCase.abilityId,
      selectableOptions: cardCase.options.map((color) => expect.objectContaining({ id: color })),
      canSkipSelection: false,
    });

    resolveSelectedColor(session, HeartColor.GREEN);

    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: PLAYER1,
      memberCardId: member.instanceId,
      color: HeartColor.GREEN,
      sourceCardId: member.instanceId,
      abilityId: cardCase.abilityId,
    });

    const effectiveHearts = getMemberEffectiveHeartIcons(session.state!, PLAYER1, member.instanceId);
    expect(effectiveHearts).toEqual([createHeartIcon(HeartColor.GREEN, 1)]);
    const effectiveMemberData = {
      ...member.data,
      hearts: effectiveHearts,
    } as MemberCardData;
    expect(judgeSingleLive(effectiveMemberData, HeartColor.GREEN)).toBe(true);
    expect(judgeSingleLive(effectiveMemberData, HeartColor.YELLOW)).toBe(false);
  });

  it.each(CARD_CASES)('$cardCode opens the configured color choices', (cardCase) => {
    const { game } = setupState(cardCase);
    const session = startLiveStartSelection(game);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: cardCase.abilityId,
      selectableOptions: cardCase.options.map((color) => expect.objectContaining({ id: color })),
      canSkipSelection: false,
    });
  });

  it('keeps the choice step open and writes no modifier for an invalid option', () => {
    const { game } = setupState(CARD_CASES[0]);
    const session = startLiveStartSelection(game);
    const activeEffectId = session.state!.activeEffect!.id;

    const result = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        activeEffectId,
        undefined,
        undefined,
        undefined,
        HeartColor.RED
      )
    );

    expect(result.success).toBe(false);
    expect(session.state?.activeEffect?.id).toBe(activeEffectId);
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) => modifier.kind === 'MEMBER_ORIGINAL_HEART_REPLACEMENT'
      )
    ).toBe(false);
  });
});
