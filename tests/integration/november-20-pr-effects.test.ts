import { describe, expect, it } from 'vitest';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_PR_034_AUTO_RELAY_LOW_COST_TARGET_GAIN_BLADE_ABILITY_ID as RELAY,
  SP_PR_035_LIVE_SUCCESS_OPPONENT_TWELVE_CHEER_SCORE_ABILITY_ID as SCORE,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { moveMemberBetweenSlotsAndEnqueueTriggers } from '../../src/application/card-effects/runtime/member-slot-moved-triggers';
import { playMemberFromZoneToStageSlotWithReplacement } from '../../src/application/card-effects/runtime/play-member-to-stage';
import {
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createCardInstance } from '../../src/domain/entities/card';
import { emitGameEvent, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  addLiveModifier,
  getLiveCardScoreModifier,
  getMemberEffectiveBladeCount,
  getPlayerLiveScoreModifier,
} from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  GamePhase,
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
  confirm,
  gameWith,
  hand,
  live,
  liveZone,
  member,
  sessionFor,
  setState,
  stage,
} from '../helpers/modifier-workflow-fixtures';
import { getNovember20MemberData } from '../helpers/november-20-draft-effects';

const RINA = 'PL!N-PR-038';
const REN = 'PL!SP-PR-034';
const MIA = 'PL!N-PR-039';
const TOMARI = 'PL!SP-PR-035';
const RELAY_TEXT =
  '【自动】此成员从舞台被放置入休息室时，此成员与费用小于等于11的成员进行了换手的场合，LIVE结束时为止，该换手登场的成员获得[ブレード][ブレード]。';
const SCORE_TEXT =
  '【LIVE成功时】因声援被公开的对方的卡片的张数大于等于12张的场合，LIVE的合计分数＋１。';

function exportedMember(baseCode: string, id: string) {
  return createCardInstance(getNovember20MemberData(baseCode), P1, id);
}

function bladeModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter((modifier) => modifier.abilityId === RELAY);
}

function setupRelay(
  options: {
    readonly cost?: number;
    readonly costDelta?: number;
    readonly replacementOnEnter?: boolean;
    readonly withRen?: boolean;
  } = {}
) {
  const rina = exportedMember(RINA, 'rina');
  const ren = options.withRen ? [exportedMember(REN, 'ren')] : [];
  const replacement = options.replacementOnEnter
    ? exportedMember('PL!S-pb2-032', 'replacement')
    : member('TEST-REPLACEMENT', 'replacement', P1, { cost: options.cost ?? 11 });
  const second = member('TEST-SECOND-REPLACEMENT', 'second', P1, { cost: 10 });
  const padding = member('TEST-P1-PADDING', 'p1-padding');
  const energy = Array.from({ length: 12 }, (_, index) =>
    createCardInstance(
      { cardType: CardType.ENERGY, cardCode: `E-${index}`, name: 'Energy' },
      P1,
      `energy-${index}`
    )
  );
  let game = hand(
    stage(gameWith([rina, ...ren, replacement, second, padding, ...energy]), [rina, ...ren]),
    [replacement, second]
  );
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [padding.instanceId] },
    energyZone: {
      ...player.energyZone,
      cardIds: energy.map((card) => card.instanceId),
      cardStates: new Map(
        energy.map(({ instanceId }) => [
          instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
        ])
      ),
    },
  }));
  if (options.costDelta) {
    game = addLiveModifier(game, {
      kind: 'MEMBER_COST',
      playerId: P1,
      memberCardId: 'replacement',
      countDelta: options.costDelta,
    });
  }
  const session = sessionFor({
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
  });
  return {
    session,
    relay: (cardId = 'replacement', slot = SlotPosition.LEFT) =>
      session.executeCommand(
        createPlayMemberToSlotCommand(P1, cardId, slot, { relayMode: 'SINGLE' })
      ),
  };
}

describe('PL!N-PR-038 费用9「天王寺璃奈」', () => {
  it('uses the exact shared definition for every rarity and preserves the original source', () => {
    for (const code of [RINA, REN].flatMap((base) => [`${base}-PR`, `${base}-UNSEEN`])) {
      expect(getCardAbilityDefinitionsForCardCode(code)).toEqual([
        expect.objectContaining({
          abilityId: RELAY,
          baseCardCodes: [REN, RINA],
          category: 'AUTO',
          sourceZone: 'STAGE_MEMBER',
          triggerCondition: TriggerCondition.ON_LEAVE_STAGE,
          triggerToZones: [ZoneType.WAITING_ROOM],
          queued: true,
          implemented: true,
          effectText: RELAY_TEXT,
        }),
      ]);
    }
  });

  it.each([
    { cost: 11, costDelta: 0, expected: 2 },
    { cost: 12, costDelta: 0, expected: 0 },
    { cost: 12, costDelta: -1, expected: 2 },
    { cost: 11, costDelta: 1, expected: 0 },
  ])(
    'checks effective cost after real relay with printed $cost and modifier $costDelta',
    ({ cost, costDelta, expected }) => {
      const { session, relay } = setupRelay({ cost, costDelta });
      const played = relay();
      expect(played.success, played.error).toBe(true);
      expect(session.state!.players[0].waitingRoom.cardIds).toContain('rina');
      expect(session.state!.eventLog.map(({ event }) => event)).toContainEqual(
        expect.objectContaining({
          eventType: TriggerCondition.ON_LEAVE_STAGE,
          cardInstanceId: 'rina',
          toZone: ZoneType.WAITING_ROOM,
          replacingCardId: 'replacement',
        })
      );
      expect(session.state!.actionHistory.map(({ payload }) => payload)).toContainEqual(
        expect.objectContaining({
          abilityId: RELAY,
          sourceCardId: 'rina',
          replacingCardEffectiveCost: cost + costDelta,
          bladeBonus: expected,
        })
      );
      expect(getMemberEffectiveBladeCount(session.state!, P1, 'replacement')).toBe(1 + expected);
    }
  );

  it.each(['shifted', 'reentered'])(
    'rechecks a real relay target that has %s before resolution',
    (change) => {
      const { session, relay } = setupRelay({ replacementOnEnter: true });
      const played = relay();
      expect(played.success, played.error).toBe(true);
      expect(session.state!.pendingAbilities).toContainEqual(
        expect.objectContaining({ abilityId: RELAY, sourceCardId: 'rina' })
      );
      const original = session.state!;
      if (change === 'shifted') {
        setState(
          session,
          moveMemberBetweenSlotsAndEnqueueTriggers(
            original,
            P1,
            'replacement',
            SlotPosition.RIGHT,
            enqueueTriggeredCardEffects
          )!.gameState
        );
      } else {
        const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
          original,
          P1,
          'replacement',
          enqueueTriggeredCardEffects
        )!.gameState;
        setState(
          session,
          playMemberFromZoneToStageSlotWithReplacement(left, P1, {
            cardId: 'replacement',
            sourceZone: ZoneType.WAITING_ROOM,
            toSlot: SlotPosition.RIGHT,
          })!.gameState
        );
      }
      expect(session.state!.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe('replacement');
      const chose = session.executeCommand(
        createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'rina')
      );
      expect(chose.success, chose.error).toBe(true);
      const confirmed = confirm(session, P1);
      expect(confirmed.success, confirmed.error).toBe(true);
      expect(bladeModifiers(session.state!)).toHaveLength(change === 'shifted' ? 1 : 0);
    }
  );

  it('gives no BLADE when the source leaves without a relay', () => {
    const { session } = setupRelay();
    const ordinaryLeave = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      session.state!,
      P1,
      'rina',
      enqueueTriggeredCardEffects
    )!.gameState;
    expect(ordinaryLeave.pendingAbilities).toEqual([expect.objectContaining({ abilityId: RELAY })]);
    const resolved = resolvePendingCardEffects(ordinaryLeave).gameState;
    expect(bladeModifiers(resolved)).toEqual([]);
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('lets Rina and Ren trigger the shared ability independently in the same turn', () => {
    const { session, relay } = setupRelay({ withRen: true });
    expect(relay().success).toBe(true);
    expect(session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe('ren');
    expect(relay('second', SlotPosition.CENTER).success).toBe(true);
    expect(bladeModifiers(session.state!)).toEqual([
      expect.objectContaining({
        sourceCardId: 'rina',
        targetMemberCardId: 'replacement',
        countDelta: 2,
      }),
      expect.objectContaining({ sourceCardId: 'ren', targetMemberCardId: 'second', countDelta: 2 }),
    ]);
    expect(getMemberEffectiveBladeCount(session.state!, P1, 'replacement')).toBe(3);
    expect(getMemberEffectiveBladeCount(session.state!, P1, 'second')).toBe(3);
  });
});

function cheerCards(prefix: string, count: number, playerId: string) {
  return Array.from({ length: count }, (_, index) =>
    member(`TEST-${prefix}-${index}`, `${prefix}-${index}`, playerId)
  );
}

function setupScore(options: {
  readonly opponentCount: number;
  readonly ownCount?: number;
  readonly withTomari?: boolean;
  readonly ownSuccess?: boolean;
  readonly withPriorCheer?: boolean;
}) {
  const ownSuccess = options.ownSuccess ?? true;
  const mia = exportedMember(MIA, 'mia');
  const tomari = options.withTomari ? [exportedMember(TOMARI, 'tomari')] : [];
  const first = live('TEST-LIVE-1', 'own-live-1', { score: 2 });
  const second = live('TEST-LIVE-2', 'own-live-2', { score: 3 });
  const opponent = createCardInstance(
    live('TEST-OPPONENT-LIVE', 'opp-live', { score: 1 }).data,
    P2,
    'opp-live'
  );
  const own = cheerCards('own', options.ownCount ?? 0, P1);
  const opposing = cheerCards('opposing', options.opponentCount, P2);
  const prior = cheerCards('prior', options.withPriorCheer ? 12 : 0, P2);
  const padding = member('TEST-P2-PADDING', 'p2-padding', P2);
  const ownIds = own.map((card) => card.instanceId);
  const opposingIds = opposing.map((card) => card.instanceId);
  const priorIds = prior.map((card) => card.instanceId);
  let game = stage(
    gameWith([mia, ...tomari, first, second, opponent, ...own, ...opposing, ...prior, padding]),
    [mia, ...tomari]
  );
  for (const song of [first, second, opponent]) {
    game = liveZone(game, song);
  }
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [padding.instanceId] },
    waitingRoom: { ...player.waitingRoom, cardIds: [...opposingIds, ...priorIds] },
  }));
  if (priorIds.length > 0) {
    game = emitGameEvent(game, createCheerEvent(P2, priorIds, priorIds.length));
  }
  if (ownIds.length > 0) {
    game = emitGameEvent(game, createCheerEvent(P1, ownIds, ownIds.length));
  }
  const normal = opposingIds.slice(0, 11);
  const additional = opposingIds.slice(11);
  game = emitGameEvent(game, createCheerEvent(P2, normal, normal.length));
  if (additional.length > 0) {
    game = emitGameEvent(
      game,
      createCheerEvent(P2, additional, additional.length, { additional: true })
    );
  }
  game = {
    ...game,
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
    currentTurnType: TurnType.SECOND_PLAYER_TURN,
    activePlayerIndex: 1,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: P2,
      firstPlayerCheerCardIds: ownIds,
      secondPlayerCheerCardIds: opposingIds,
      liveResults: new Map([
        [first.instanceId, ownSuccess],
        [second.instanceId, ownSuccess],
        [opponent.instanceId, !ownSuccess],
      ]),
      playerScores: new Map([
        [P1, ownSuccess ? 5 : 0],
        [P2, ownSuccess ? 0 : 1],
      ]),
    },
  };
  const session = sessionFor(game);
  return {
    session,
    opposingIds,
    liveIds: [first.instanceId, second.instanceId],
    enter: () =>
      session.executeCommand(createConfirmStepCommand(P2, SubPhase.PERFORMANCE_JUDGMENT)),
  };
}

describe('PL!N-PR-039 费用11「米娅·泰勒」', () => {
  it('uses the exact shared definition for every rarity and preserves the original source', () => {
    for (const code of [MIA, TOMARI].flatMap((base) => [`${base}-PR`, `${base}-UNSEEN`])) {
      expect(getCardAbilityDefinitionsForCardCode(code)).toEqual([
        expect.objectContaining({
          abilityId: SCORE,
          baseCardCodes: [TOMARI, MIA],
          category: 'LIVE_SUCCESS',
          sourceZone: 'STAGE_MEMBER',
          triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
          queued: true,
          implemented: true,
          effectText: SCORE_TEXT,
        }),
      ]);
    }
  });

  it.each([11, 12])(
    'counts %i current opponent reveals, including additional, despite leaving resolution',
    (opponentCount) => {
      const { session, enter, opposingIds, liveIds } = setupScore({
        opponentCount,
        ownCount: 12,
        withPriorCheer: true,
      });
      const entered = enter();
      expect(entered.success, entered.error).toBe(true);
      expect(session.state!.eventLog.map(({ event }) => event)).toContainEqual(
        expect.objectContaining({
          eventType: TriggerCondition.ON_LIVE_SUCCESS,
          playerId: P1,
          successfulLiveCardIds: liveIds,
        })
      );
      expect(session.state!.resolutionZone.cardIds).toEqual([]);
      expect(session.state!.players[1].waitingRoom.cardIds).toEqual(
        expect.arrayContaining(opposingIds)
      );
      expect(session.state!.activeEffect?.effectText).toContain(
        `对方声援公开的卡片${opponentCount}张`
      );
      expect(getPlayerLiveScoreModifier(session.state!.liveResolution, P1)).toBe(0);
      expect(confirm(session, P1).success).toBe(true);
      const liveResolution = session.state!.liveResolution;
      const bonus = Number(opponentCount === 12);
      expect(getPlayerLiveScoreModifier(liveResolution, P1)).toBe(bonus);
      expect(getPlayerLiveScoreModifier(liveResolution, P2)).toBe(0);
      expect(liveResolution.playerScores.get(P1)).toBe(5 + bonus);
      expect(liveResolution.playerScores.get(P2)).toBe(0);
      for (const liveId of liveIds) {
        expect(getLiveCardScoreModifier(liveResolution, liveId)).toBe(0);
      }
      expect(session.state!.actionHistory.map(({ payload }) => payload)).toContainEqual(
        expect.objectContaining({
          abilityId: SCORE,
          sourceCardId: 'mia',
          matchingCardIds: opposingIds,
        })
      );
    }
  );

  it('does not trigger Mia when the owner fails and only the opponent succeeds', () => {
    const { session, enter } = setupScore({ opponentCount: 12, ownSuccess: false });
    const entered = enter();
    expect(entered.success, entered.error).toBe(true);
    expect(session.state!.eventLog.map(({ event }) => event)).toContainEqual(
      expect.objectContaining({
        eventType: TriggerCondition.ON_LIVE_SUCCESS,
        playerId: P2,
        successfulLiveCardIds: ['opp-live'],
      })
    );
    expect(session.state!.actionHistory.some(({ payload }) => payload.abilityId === SCORE)).toBe(
      false
    );
    expect(getPlayerLiveScoreModifier(session.state!.liveResolution, P1)).toBe(0);
  });

  it('lets Mia and Tomari each add one to the same player total when both trigger', () => {
    const { session, enter, liveIds } = setupScore({ opponentCount: 12, withTomari: true });
    expect(enter().success).toBe(true);
    expect(session.state!.pendingAbilities).toEqual([
      expect.objectContaining({ abilityId: SCORE, sourceCardId: 'mia' }),
      expect.objectContaining({ abilityId: SCORE, sourceCardId: 'tomari' }),
    ]);
    const done = session.executeCommand(
      createConfirmEffectStepCommand(
        P1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        true
      )
    );
    expect(done.success, done.error).toBe(true);
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(session.state!.activeEffect).toBeNull();
    expect(
      session.state!.liveResolution.liveModifiers.filter((modifier) => modifier.abilityId === SCORE)
    ).toEqual([
      expect.objectContaining({ sourceCardId: 'mia', countDelta: 1 }),
      expect.objectContaining({ sourceCardId: 'tomari', countDelta: 1 }),
    ]);
    expect(getPlayerLiveScoreModifier(session.state!.liveResolution, P1)).toBe(2);
    expect(session.state!.liveResolution.playerScores.get(P1)).toBe(7);
    for (const liveId of liveIds) {
      expect(getLiveCardScoreModifier(session.state!.liveResolution, liveId)).toBe(0);
    }
  });
});
