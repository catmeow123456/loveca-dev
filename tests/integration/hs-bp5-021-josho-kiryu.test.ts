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
  type LiveModifierState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import {
  addLiveModifier,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import {
  HS_BP5_021_LIVE_START_TARGET_HASUNOSORA_MEMBER_ORIGINAL_HEART_PINK_ABILITY_ID,
  HS_BP5_021_LIVE_START_THREE_MIRACRA_STAGE_MEMBERS_SCORE_ABILITY_ID,
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
const ABILITY_ORDER_SELECTION_ID = 'system:select-pending-card-effect';

function createMember(options: {
  readonly cardCode: string;
  readonly name: string;
  readonly groupNames?: readonly string[];
  readonly unitName?: string;
  readonly hearts?: readonly ReturnType<typeof createHeartIcon>[];
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name,
    groupNames: options.groupNames ?? ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: 10,
    blade: 1,
    hearts: options.hearts ?? [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createJoshoKiryuLive(): LiveCardData {
  return {
    cardCode: 'PL!HS-bp5-021-L',
    name: 'ジョーショーキリュー',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'Mira-Cra Park!',
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 10 }),
  };
}

function stageState() {
  return { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP };
}

function setupLiveStartGame(options: {
  readonly ownMembers?: readonly {
    readonly card: ReturnType<typeof createCardInstance>;
    readonly slot: SlotPosition;
  }[];
  readonly opponentMembers?: readonly {
    readonly card: ReturnType<typeof createCardInstance>;
    readonly slot: SlotPosition;
  }[];
  readonly memberBelow?: readonly {
    readonly card: ReturnType<typeof createCardInstance>;
    readonly underSlot: SlotPosition;
  }[];
  readonly modifiers?: readonly LiveModifierState[];
}): {
  readonly game: GameState;
  readonly liveId: string;
} {
  const live = createCardInstance(createJoshoKiryuLive(), PLAYER1, 'josho-kiryu-live');
  const cards = [
    live,
    ...(options.ownMembers ?? []).map((entry) => entry.card),
    ...(options.opponentMembers ?? []).map((entry) => entry.card),
    ...(options.memberBelow ?? []).map((entry) => entry.card),
  ];
  let game = createGameState('hs-bp5-021-josho-kiryu', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, cards);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const entry of options.ownMembers ?? []) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.card.instanceId, stageState());
    }
    for (const entry of options.memberBelow ?? []) {
      memberSlots = addMemberBelowMember(memberSlots, entry.underSlot, entry.card.instanceId);
    }
    return {
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId, stageState()),
      memberSlots,
    };
  });
  game = updatePlayer(game, PLAYER2, (player) => {
    let memberSlots = player.memberSlots;
    for (const entry of options.opponentMembers ?? []) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.card.instanceId, stageState());
    }
    return {
      ...player,
      memberSlots,
    };
  });
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
    },
  };
  for (const modifier of options.modifiers ?? []) {
    game = addLiveModifier(game, modifier);
  }
  return {
    game,
    liveId: live.instanceId,
  };
}

function startLiveStart(game: GameState): GameSession {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  const session = createGameSession();
  session.createGame('hs-bp5-021-josho-kiryu-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = result.gameState;
  return session;
}

function resolveInPrintedOrder(session: GameSession): void {
  const activeEffect = session.state!.activeEffect!;
  expect(activeEffect.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
  const pendingAbilityIds = activeEffect.metadata?.pendingAbilityIds as readonly string[];
  const abilityIdsInOrder = pendingAbilityIds.map(
    (pendingAbilityId) =>
      session.state!.pendingAbilities.find((ability) => ability.id === pendingAbilityId)!.abilityId
  );
  expect(abilityIdsInOrder).toEqual([
    HS_BP5_021_LIVE_START_TARGET_HASUNOSORA_MEMBER_ORIGINAL_HEART_PINK_ABILITY_ID,
    HS_BP5_021_LIVE_START_THREE_MIRACRA_STAGE_MEMBERS_SCORE_ABILITY_ID,
  ]);

  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, activeEffect.id, undefined, undefined, true)
  );
  expect(result.success).toBe(true);
}

function selectTarget(session: GameSession, targetCardId: string): void {
  const activeEffect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, activeEffect.id, targetCardId)
  );
  expect(result.success).toBe(true);
}

function getScoreModifier(game: GameState, liveId: string): LiveModifierState | undefined {
  return game.liveResolution.liveModifiers.find(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.liveCardId === liveId &&
      modifier.abilityId === HS_BP5_021_LIVE_START_THREE_MIRACRA_STAGE_MEMBERS_SCORE_ABILITY_ID
  );
}

describe('PL!HS-bp5-021-L Josho Kiryu workflow', () => {
  it('opens Hasunosora target selection first and replaces the target member original Hearts with Pink', () => {
    const target = createCardInstance(
      createMember({
        cardCode: 'PL!HS-test-kaho',
        name: '日野下花帆',
        unitName: 'Cerise Bouquet',
        hearts: [createHeartIcon(HeartColor.GREEN, 1), createHeartIcon(HeartColor.BLUE, 1)],
      }),
      PLAYER1,
      'hasunosora-target'
    );
    const game = setupLiveStartGame({
      ownMembers: [{ card: target, slot: SlotPosition.CENTER }],
    }).game;
    const session = startLiveStart(game);

    resolveInPrintedOrder(session);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_BP5_021_LIVE_START_TARGET_HASUNOSORA_MEMBER_ORIGINAL_HEART_PINK_ABILITY_ID,
      selectableCardIds: [target.instanceId],
      canSkipSelection: false,
    });

    selectTarget(session, target.instanceId);

    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: PLAYER1,
      memberCardId: target.instanceId,
      color: HeartColor.PINK,
      sourceCardId: 'josho-kiryu-live',
      abilityId: HS_BP5_021_LIVE_START_TARGET_HASUNOSORA_MEMBER_ORIGINAL_HEART_PINK_ABILITY_ID,
    });
    expect(getMemberEffectiveHeartIcons(session.state!, PLAYER1, target.instanceId)).toEqual([
      createHeartIcon(HeartColor.PINK, 2),
    ]);
  });

  it('replaces the target member, not the LIVE source, and keeps normal Heart bonuses appended', () => {
    const target = createCardInstance(
      createMember({
        cardCode: 'PL!HS-test-rurino',
        name: '大沢瑠璃乃',
        unitName: 'Mira-Cra Park!',
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      }),
      PLAYER1,
      'bonus-target'
    );
    const bonusModifier: LiveModifierState = {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: target.instanceId,
      hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
      sourceCardId: 'other-source',
      abilityId: 'test:bonus-heart',
    };
    const game = setupLiveStartGame({
      ownMembers: [{ card: target, slot: SlotPosition.CENTER }],
      modifiers: [bonusModifier],
    }).game;
    const session = startLiveStart(game);

    resolveInPrintedOrder(session);
    selectTarget(session, target.instanceId);

    expect(getMemberEffectiveHeartIcons(session.state!, PLAYER1, target.instanceId)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.PURPLE, 1),
    ]);
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'MEMBER_ORIGINAL_HEART_REPLACEMENT' &&
          modifier.memberCardId === 'josho-kiryu-live'
      )
    ).toBe(false);
  });

  it('no-ops the target replacement and advances pending when there is no own main-stage Hasunosora target', () => {
    const blocker = createCardInstance(
      createMember({
        cardCode: 'PL!SP-test-kanon',
        name: '澁谷かのん',
        groupNames: ['Liella!'],
        unitName: 'Liella!',
      }),
      PLAYER1,
      'own-non-hasunosora'
    );
    const belowHasunosora = createCardInstance(
      createMember({
        cardCode: 'PL!HS-test-below',
        name: '百生吟子',
        unitName: 'Cerise Bouquet',
      }),
      PLAYER1,
      'below-hasunosora'
    );
    const opponentHasunosora = createCardInstance(
      createMember({
        cardCode: 'PL!HS-test-opponent',
        name: '徒町小鈴',
        unitName: 'Mira-Cra Park!',
      }),
      PLAYER2,
      'opponent-hasunosora'
    );
    const game = setupLiveStartGame({
      ownMembers: [{ card: blocker, slot: SlotPosition.CENTER }],
      opponentMembers: [{ card: opponentHasunosora, slot: SlotPosition.CENTER }],
      memberBelow: [{ card: belowHasunosora, underSlot: SlotPosition.CENTER }],
    }).game;
    const session = startLiveStart(game);

    resolveInPrintedOrder(session);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP5_021_LIVE_START_TARGET_HASUNOSORA_MEMBER_ORIGINAL_HEART_PINK_ABILITY_ID &&
          action.payload.reason === 'NO_HASUNOSORA_STAGE_MEMBER_TARGET'
      )
    ).toBe(true);
  });

  it('adds score +1 to this LIVE when own main-stage Mira-Cra members are three or more', () => {
    const members = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT].map((slot, index) => ({
      slot,
      card: createCardInstance(
        createMember({
          cardCode: `PL!HS-test-miracra-${index}`,
          name: ['大沢瑠璃乃', '藤島慈', '安養寺姫芽'][index]!,
          unitName: 'Mira-Cra Park!',
        }),
        PLAYER1,
        `miracra-${index}`
      ),
    }));
    const { game, liveId } = setupLiveStartGame({ ownMembers: members });
    const session = startLiveStart(game);

    resolveInPrintedOrder(session);
    selectTarget(session, members[0]!.card.instanceId);

    expect(getScoreModifier(session.state!, liveId)).toMatchObject({
      kind: 'SCORE',
      playerId: PLAYER1,
      liveCardId: liveId,
      countDelta: 1,
      sourceCardId: liveId,
      abilityId: HS_BP5_021_LIVE_START_THREE_MIRACRA_STAGE_MEMBERS_SCORE_ABILITY_ID,
    });
  });

  it('does not count memberBelow or opponent Mira-Cra members for target options or score', () => {
    const ownMira = createCardInstance(
      createMember({
        cardCode: 'PL!HS-test-own-miracra',
        name: '大沢瑠璃乃',
        unitName: 'Mira-Cra Park!',
      }),
      PLAYER1,
      'own-miracra'
    );
    const belowMira = createCardInstance(
      createMember({
        cardCode: 'PL!HS-test-below-miracra',
        name: '藤島慈',
        unitName: 'Mira-Cra Park!',
      }),
      PLAYER1,
      'below-miracra'
    );
    const opponentMira = createCardInstance(
      createMember({
        cardCode: 'PL!HS-test-opponent-miracra',
        name: '安養寺姫芽',
        unitName: 'Mira-Cra Park!',
      }),
      PLAYER2,
      'opponent-miracra'
    );
    const { game, liveId } = setupLiveStartGame({
      ownMembers: [{ card: ownMira, slot: SlotPosition.CENTER }],
      opponentMembers: [{ card: opponentMira, slot: SlotPosition.CENTER }],
      memberBelow: [{ card: belowMira, underSlot: SlotPosition.CENTER }],
    });
    const session = startLiveStart(game);

    resolveInPrintedOrder(session);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([ownMira.instanceId]);

    selectTarget(session, ownMira.instanceId);

    expect(getScoreModifier(session.state!, liveId)).toBeUndefined();
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP5_021_LIVE_START_THREE_MIRACRA_STAGE_MEMBERS_SCORE_ABILITY_ID &&
          action.payload.conditionMet === false &&
          action.payload.miraCraStageMemberCount === 1
      )
    ).toBe(true);
  });
});
