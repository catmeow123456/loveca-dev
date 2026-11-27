import { describe, expect, it } from 'vitest';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID as DELEGATE,
  S_PB2_004_LIVE_SUCCESS_LOOK_TOP_BY_MEMBER_HEART_COLOR_ABILITY_ID as DIA,
  S_PB2_015_ON_ENTER_LOOK_TOP_BY_OTHER_GUILTY_KISS_ABILITY_ID as YOSHIKO,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { moveMemberBetweenSlotsAndEnqueueTriggers } from '../../src/application/card-effects/runtime/member-slot-moved-triggers';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createCardInstance } from '../../src/domain/entities/card';
import { emitGameEvent, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addMemberBelowMember } from '../../src/domain/entities/zone';
import {
  createEnterStageEvent,
  type EnterWaitingRoomEvent,
} from '../../src/domain/events/game-events';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { createPublicObjectId } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor as H,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  P1,
  P2,
  gameWith,
  hand,
  live,
  liveZone,
  member,
  sessionFor,
  setState,
  stage,
} from '../helpers/modifier-workflow-fixtures';
import { getNovember27MemberData } from '../helpers/november-27-draft-effects';

const DIA_BASE = 'PL!S-pb2-004';
const YOSHIKO_BASE = 'PL!S-pb2-015';
const DIA_TEXT =
  '【LIVE成功时】选择１名存在于自己的舞台的『Aqours』的成员。检视自己的卡组顶，等同于该成员持有的HEART中数量最多的１种颜色的HEART的数量的张数的卡片。将其中的１张卡片加入手牌。其余的放置入休息室。';
const TOP_IDS = ['top-1', 'top-2', 'top-3', 'top-4', 'top-5', 'top-6'];
const topCards = TOP_IDS.map((id) => member(`TEST-${id}`, id));

function withDeck(game: GameState) {
  return updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: TOP_IDS },
  }));
}

function choose(
  session: ReturnType<typeof sessionFor>,
  cardId?: string | null,
  option?: string,
  cards?: readonly string[]
) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      session.state!.activeEffect!.id,
      cardId,
      undefined,
      undefined,
      option,
      cards
    )
  );
}

function expectPrivateTakeOne(session: ReturnType<typeof sessionFor>, expected: readonly string[]) {
  expect(session.state!.activeEffect).toMatchObject({
    inspectionCardIds: expected,
    selectableCardIds: expected,
    canSkipSelection: false,
    confirmSelectionLabel: '加入手牌',
  });
  expect(session.state!.inspectionZone.revealedCardIds).toEqual([]);
  const own = session.getPlayerViewState(P1)!;
  const opponent = session.getPlayerViewState(P2)!;
  expect(opponent.activeEffect?.selectableObjectIds).toBeUndefined();
  for (const id of expected) {
    expect(own.objects[createPublicObjectId(id)]?.surface).toBe('FRONT');
    expect(opponent.objects[createPublicObjectId(id)]?.surface).toBe('BACK');
  }
  expect(choose(session, null).success).toBe(false);
}

function setupDia() {
  const dia = createCardInstance(getNovember27MemberData(DIA_BASE), P1, 'dia');
  const target = member('TEST-BIG-HEART', 'target', P1, {
    groupNames: ['Aqours'],
    hearts: [
      { color: H.RED, count: 1 },
      { color: H.ORANGE, count: 2 },
      { color: H.GRAY, count: 6 },
      { color: H.RAINBOW, count: 5 },
    ],
  });
  const wrongGroup = member('TEST-WRONG-GROUP', 'wrong-group');
  const opponent = member('TEST-OPPONENT', 'opponent', P2, { groupNames: ['Aqours'] });
  const below = member('TEST-BELOW', 'below', P1, { groupNames: ['Aqours'] });
  const song = live('TEST-OWN-SONG', 'song', { score: 2 });
  const oppSong = createCardInstance(live('TEST-OPP-SONG', 'opp-song').data, P2, 'opp-song');
  let game = gameWith([dia, target, wrongGroup, below, opponent, song, oppSong, ...topCards]);
  game = withDeck(stage(stage(game, [dia, target, wrongGroup]), [opponent], P2));
  game = liveZone(liveZone(game, song), oppSong);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: addMemberBelowMember(player.memberSlots, SlotPosition.CENTER, 'below'),
  }));
  const session = sessionFor({
    ...game,
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
    currentTurnType: TurnType.SECOND_PLAYER_TURN,
    activePlayerIndex: 1,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: P2,
      liveResults: new Map([
        ['song', true],
        ['opp-song', false],
      ]),
      playerScores: new Map([
        [P1, 2],
        [P2, 0],
      ]),
    },
  });
  const entered = session.executeCommand(
    createConfirmStepCommand(P2, SubPhase.PERFORMANCE_JUDGMENT)
  );
  expect(entered.success, entered.error).toBe(true);
  return session;
}

describe('PL!S-pb2-004 费用11「黑泽黛雅」', () => {
  it('uses the authorized mandatory Chinese wording for every rarity', () => {
    const original = getNovember27MemberData(DIA_BASE).cardTextCn!;
    expect(original).toContain('可以将其中的１张卡片加入手牌');
    expect(original.replace('可以将其中的１张卡片加入手牌', '将其中的１张卡片加入手牌')).toBe(
      DIA_TEXT
    );
    for (const rarity of ['PP', 'UNSEEN']) {
      expect(getCardAbilityDefinitionsForCardCode(`${DIA_BASE}-${rarity}`)).toEqual([
        expect.objectContaining({
          abilityId: DIA,
          baseCardCodes: [DIA_BASE],
          triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
          effectText: DIA_TEXT,
        }),
      ]);
    }
  });

  it.each([0, 1])(
    'uses the live color maximum after a target moves, including orange and equal maxima (%i)',
    (orangeBonus) => {
      const session = setupDia();
      expect(session.state!.activeEffect).toMatchObject({
        abilityId: DIA,
        selectableCardIds: ['dia', 'target'],
        canSkipSelection: false,
      });
      expect(choose(session, 'below').success).toBe(false);
      expect(choose(session, 'opponent').success).toBe(false);
      const moved = moveMemberBetweenSlotsAndEnqueueTriggers(
        session.state!,
        P1,
        'target',
        SlotPosition.LEFT,
        enqueueTriggeredCardEffects
      )!;
      setState(
        session,
        addLiveModifier(moved.gameState, {
          kind: 'HEART',
          target: 'TARGET_MEMBER',
          playerId: P1,
          sourceCardId: 'dia',
          targetMemberCardId: 'target',
          hearts: [
            { color: H.RED, count: 1 },
            { color: H.ORANGE, count: orangeBonus },
          ],
        })
      );
      expect(choose(session, 'target').success).toBe(true);
      const expected = TOP_IDS.slice(0, 2 + orangeBonus);
      expectPrivateTakeOne(session, expected);
      expect(choose(session, 'top-2').success).toBe(true);
      expect(session.state!.players[0].hand.cardIds).toEqual(['top-2']);
      const remainderEvents = session
        .state!.eventLog.map(({ event }) => event)
        .filter(
          (event): event is EnterWaitingRoomEvent =>
            event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
        );
      expect(remainderEvents).toEqual([
        expect.objectContaining({
          fromZone: ZoneType.MAIN_DECK,
          cardInstanceIds: expected.filter((id) => id !== 'top-2'),
        }),
      ]);
      expect(session.state!.activeEffect).toBeNull();
    }
  );

  it('rejects a reentered target and permits the actual source as a target', () => {
    const session = setupDia();
    setState(
      session,
      emitGameEvent(
        session.state!,
        createEnterStageEvent('target', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
      )
    );
    expect(choose(session, 'target').success).toBe(false);
    expect(session.state!.inspectionZone.cardIds).toEqual([]);
    expect(choose(session, 'dia').success).toBe(true);
    expectPrivateTakeOne(session, ['top-1']);
    expect(choose(session, 'top-1').success).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual(['top-1']);
  });

  it('continues through the command when all captured targets have become stale', () => {
    const session = setupDia();
    setState(
      session,
      emitGameEvent(
        emitGameEvent(
          session.state!,
          createEnterStageEvent('dia', ZoneType.HAND, SlotPosition.LEFT, P1, P1)
        ),
        createEnterStageEvent('target', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
      )
    );
    expect(choose(session).success).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(TOP_IDS);
    expect(session.state!.inspectionZone.cardIds).toEqual([]);
  });
});

function setupYoshiko(count: number, withYou = false, withBelow = false) {
  const yoshiko = createCardInstance(getNovember27MemberData(YOSHIKO_BASE), P1, 'yoshiko');
  const riko = createCardInstance(getNovember27MemberData('PL!S-pb2-002'), P1, 'riko');
  const mari = createCardInstance(getNovember27MemberData('PL!S-pb2-026'), P1, 'mari');
  const you = createCardInstance(getNovember27MemberData('PL!S-bp7-005'), P1, 'you');
  const costs = [member('TEST-COST-1', 'cost-1'), member('TEST-COST-2', 'cost-2')];
  const energy = Array.from({ length: 4 }, (_, i) =>
    createCardInstance(
      { cardCode: `E-${i}`, name: 'Energy', cardType: CardType.ENERGY },
      P1,
      `energy-${i}`
    )
  );
  let game = gameWith([yoshiko, riko, mari, you, ...costs, ...energy, ...topCards]);
  const stageMembers = withYou
    ? [riko, you, yoshiko]
    : withBelow
      ? [you]
      : [riko, mari].slice(0, count);
  game = withDeck(hand(stage(game, stageMembers), withYou ? costs : [yoshiko]));
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: withBelow
      ? addMemberBelowMember(player.memberSlots, SlotPosition.LEFT, 'riko')
      : player.memberSlots,
    energyZone: {
      ...player.energyZone,
      cardIds: energy.map(({ instanceId }) => instanceId),
      cardStates: new Map(
        energy.map(({ instanceId }) => [
          instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
        ])
      ),
    },
  }));
  return sessionFor({
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
  });
}

describe('PL!S-pb2-015 费用4「津岛善子」', () => {
  it.each([0, 1, 2])(
    'uses real structured unit identity and looks at 2 × %i cards together',
    (count) => {
      const session = setupYoshiko(count, false, count === 0);
      const played = session.executeCommand(
        createPlayMemberToSlotCommand(P1, 'yoshiko', SlotPosition.RIGHT)
      );
      expect(played.success, played.error).toBe(true);
      const definition = getCardAbilityDefinitionsForCardCode(`${YOSHIKO_BASE}-UNSEEN`)[0];
      expect(definition).toMatchObject({
        abilityId: YOSHIKO,
        baseCardCodes: [YOSHIKO_BASE],
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        effectText: getNovember27MemberData(YOSHIKO_BASE).cardTextCn,
        delegatedOnEnterFromWaitingRoomPolicy: { decision: 'ALLOW', reason: 'SOURCE_INDEPENDENT' },
      });
      if (count) {
        expectPrivateTakeOne(session, TOP_IDS.slice(0, count * 2));
        expect(choose(session, 'top-2').success).toBe(true);
        expect(session.state!.players[0].hand.cardIds).toEqual(['top-2']);
      }
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.players[0].mainDeck.cardIds).toEqual(TOP_IDS.slice(count * 2));
    }
  );

  it('uses the selected member’s ON_ENTER through the real cost-15 You delegation', () => {
    const session = setupYoshiko(0, true);
    expect(session.executeCommand(createActivateAbilityCommand(P1, 'you', DELEGATE)).success).toBe(
      true
    );
    expect(choose(session, undefined, undefined, ['cost-1', 'cost-2']).success).toBe(true);
    expect(choose(session, 'yoshiko').success).toBe(true);
    expect(choose(session, undefined, 'target-first').success).toBe(true);
    expect(session.state!.activeEffect).toMatchObject({
      abilityId: YOSHIKO,
      sourceCardId: 'yoshiko',
    });
    expectPrivateTakeOne(session, ['top-1', 'top-2']);
    expect(choose(session, 'top-1').success).toBe(true);
    expect(session.state!.activeEffect?.sourceCardId).toBe('you');
    expect(choose(session, 'cost-1').success).toBe(true);
    expect(choose(session, 'you').success).toBe(true);
    expect(session.state!.delegatedAbilitySequence).toBeNull();
    expect(session.state!.activeEffect).toBeNull();
  });

  it('counts the same card ID as an other member once that card becomes a new rules object', () => {
    const session = setupYoshiko(0);
    const source = session.state!.cardRegistry.get('yoshiko')!;
    const placed = updatePlayer(stage(session.state!, [source]), P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
    }));
    const originalEntry = createEnterStageEvent(
      'yoshiko',
      ZoneType.HAND,
      SlotPosition.LEFT,
      P1,
      P1
    );
    const queued = enqueueTriggeredCardEffects(
      emitGameEvent(placed, originalEntry),
      [TriggerCondition.ON_ENTER_STAGE],
      { enterStageEvents: [originalEntry] }
    );
    expect(queued.pendingAbilities).toEqual([expect.objectContaining({ abilityId: YOSHIKO })]);
    const reentered = emitGameEvent(
      queued,
      createEnterStageEvent('yoshiko', ZoneType.WAITING_ROOM, SlotPosition.LEFT, P1, P1)
    );
    setState(session, resolvePendingCardEffects(reentered).gameState);
    expectPrivateTakeOne(session, ['top-1', 'top-2']);
    expect(choose(session, 'top-1').success).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
  });
});
