import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartRequirement,
  type AnyCardData,
  type CardInstance,
  type LiveCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createLiveSuccessEvent } from '../../src/domain/events/game-events';
import { emitGameEvent } from '../../src/domain/entities/game';
import { createGameSession } from '../../src/application/game-session';
import {
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
  createMoveOwnedCardToZoneCommand,
  createSelectSuccessLiveCommand,
} from '../../src/application/game-commands';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID,
  MAKI_ON_ENTER_ABILITY_ID,
  PL_BP8_021_AUTO_ENTER_SUCCESS_LOOK_TOP_FOUR_MUSE_MEMBER_ABILITY_ID as ABILITY,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getEnterSuccessZoneEventsFromLog } from '../../src/application/card-effects/runtime/success-zone-entry-triggers';
import { placeHandLiveCardInSuccessZoneForPlayer } from '../../src/application/card-effects/runtime/success-zone';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import { createPublicObjectId } from '../../src/online/projector';
import {
  CardType,
  BladeHeartEffect,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const TEXT =
  '【自动】此卡被放置入成功LIVE卡区时，存在于自己的成功LIVE卡区的卡片小于等于１张的场合，检视自己的卡组顶的４张卡片。可以将其中的１张『μ’s』的成员卡公开并加入手牌。其余的放置入休息室。';
const JP_TEXT =
  '【自動】このカードが成功ライブカード置き場に置かれたとき、自分の成功ライブカード置き場にあるカードが１枚以下の場合、自分のデッキの上からカードを４枚見る。その中から『μ’s』のメンバーカードを1枚公開して手札に加えてもよい。残りを控え室に置く。';

function card(id: string, type = CardType.MEMBER, group = 'μ’s', code = `TEST-${id}`, owner = P1) {
  const common = { cardCode: code, name: code, groupNames: [group] };
  const data: AnyCardData =
    type === CardType.LIVE
      ? { ...common, cardType: CardType.LIVE, score: 2, requirements: createHeartRequirement({}) }
      : { ...common, cardType: CardType.MEMBER, cost: 4, blade: 1, hearts: [] };
  return createCardInstance(data, owner, id);
}

function setup(
  options: {
    top?: CardInstance[];
    existing?: CardInstance[];
    sourceCode?: string;
    sourceZone?: ZoneType.HAND | ZoneType.WAITING_ROOM | ZoneType.LIVE_ZONE;
    original?: CardInstance;
  } = {}
) {
  // Authority: cards_export_2026-10-21.json, PL!-bp8-021-SECL; no external fixture reads.
  const sourceData: LiveCardData = {
    cardCode: options.sourceCode ?? 'PL!-bp8-021-SECL',
    name: '我们的奇迹',
    nameJp: 'それは僕たちの奇跡',
    cardType: CardType.LIVE,
    groupNames: ['μ’s'],
    score: 2,
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 1,
      [HeartColor.PURPLE]: 2,
      [HeartColor.RAINBOW]: 2,
    }),
    bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }],
    cardTextJp: JP_TEXT,
    cardTextCn: TEXT,
  };
  const source = createCardInstance(sourceData, P1, 'source');
  const top = options.top ?? [
    card('curly'),
    card('straight', CardType.MEMBER, "μ's"),
    card('other', CardType.MEMBER, 'Aqours'),
    card('muse-live', CardType.LIVE),
  ];
  const existing = options.existing ?? [];
  const padding = card('padding');
  const opponentPadding = card('opponent-padding', CardType.MEMBER, 'μ’s', 'TEST-P2', P2);
  const sourceZone = options.sourceZone ?? ZoneType.LIVE_ZONE;
  let game = registerCards(createGameState('bp8-021', P1, 'P1', P2, 'P2'), [
    source,
    ...top,
    ...existing,
    padding,
    opponentPadding,
    ...(options.original ? [options.original] : []),
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    mainDeck: {
      ...p.mainDeck,
      cardIds: [...top.map((c) => c.instanceId), ...(top.length >= 4 ? ['padding'] : [])],
    },
    hand: { ...p.hand, cardIds: sourceZone === ZoneType.HAND ? ['source'] : [] },
    waitingRoom: {
      ...p.waitingRoom,
      cardIds: sourceZone === ZoneType.WAITING_ROOM ? ['source'] : [],
    },
    successZone: { ...p.successZone, cardIds: existing.map((c) => c.instanceId) },
    liveZone:
      sourceZone === ZoneType.LIVE_ZONE
        ? addCardToStatefulZone(p.liveZone, 'source')
        : options.original
          ? addCardToStatefulZone(p.liveZone, options.original.instanceId)
          : p.liveZone,
  }));
  game = updatePlayer(game, P2, (p) => ({
    ...p,
    mainDeck: { ...p.mainDeck, cardIds: ['opponent-padding'] },
  }));
  const candidate = options.original?.instanceId ?? 'source';
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_SETTLEMENT,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[candidate, true]]),
      liveWinnerIds: [P1],
      playerScores: new Map([
        [P1, 2],
        [P2, 0],
      ]),
    },
  };
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
  function mutate(fn: (game: GameState) => GameState) {
    (session as unknown as { authorityState: GameState }).authorityState = fn(session.state!);
  }
  function choose(id: string | null, player = P1, selectedIds?: string[]) {
    return session.executeCommand(
      createConfirmEffectStepCommand(
        player,
        session.state!.activeEffect!.id,
        id,
        undefined,
        undefined,
        undefined,
        selectedIds
      )
    );
  }
  function advance(player = P2) {
    const effect = session.state!.activeEffect!;
    now = effect.publicRevealAutoAdvanceAt!;
    return session.executeCommand(
      createAutoAdvancePublicRevealCommand(player, effect.id, now, effect.publicRevealGeneration!)
    );
  }
  function enter() {
    return session.executeCommand(createSelectSuccessLiveCommand(P1, candidate));
  }
  return {
    session,
    source,
    top,
    enter,
    choose,
    advance,
    mutate,
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe('PL!-bp8-021 score 2 我们的奇迹 actual success-zone entry', () => {
  it('uses complete exported text and base identity for every rarity', () => {
    for (const code of ['PL!-bp8-021-SECL', 'PL!-bp8-021-UNSEEN']) {
      const definitions = getCardAbilityDefinitionsForCardCode(code).filter(
        (d) => d.abilityId === ABILITY
      );
      expect(definitions).toHaveLength(1);
      expect(definitions[0]).toMatchObject({
        baseCardCodes: ['PL!-bp8-021'],
        effectText: TEXT,
        enterSuccessZoneMaxCards: 1,
      });
      expect(definitions[0]?.cardCodes).toBeUndefined();
      const s = setup({ sourceCode: code });
      expect(s.enter().success).toBe(true);
      expect(s.session.state!.activeEffect?.effectText).toBe(TEXT);
    }
  });

  it('real RULES selection opens private top four after count 0 -> 1 and blocks settlement until finished', () => {
    const s = setup();
    expect(s.enter().success).toBe(true);
    expect(s.session.state!.players[0].successZone.cardIds).toEqual(['source']);
    expect(getEnterSuccessZoneEventsFromLog(s.session.state!)[0]?.successZoneCardCountAfter).toBe(
      1
    );
    expect(s.session.state!.activeEffect).toMatchObject({
      abilityId: ABILITY,
      inspectionCardIds: s.top.map((c) => c.instanceId),
      selectableCardIds: ['curly', 'straight'],
      skipSelectionLabel: '全部放置入休息室',
    });
    expect(
      s.session.executeCommand(createConfirmStepCommand(P1, SubPhase.RESULT_SETTLEMENT)).success
    ).toBe(false);
    const owner = s.session.getPlayerViewState(P1)!;
    const opponent = s.session.getPlayerViewState(P2)!;
    expect(owner.activeEffect?.selectableObjectIds).toHaveLength(2);
    expect(opponent.activeEffect?.selectableObjectIds).toBeUndefined();
    for (const c of s.top) {
      expect(owner.objects[createPublicObjectId(c.instanceId)]?.surface).toBe('FRONT');
      expect(opponent.objects[createPublicObjectId(c.instanceId)]?.surface).toBe('BACK');
    }
    expect(s.choose(null).success).toBe(true);
    expect(s.session.state!.activeEffect).toBeNull();
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual(s.top.map((c) => c.instanceId));
    expect(
      s.session.executeCommand(createConfirmStepCommand(P1, SubPhase.RESULT_SETTLEMENT)).success
    ).toBe(true);
    expect(s.session.state!.currentSubPhase).not.toBe(SubPhase.RESULT_SETTLEMENT);
  });

  it.each([CardType.LIVE, CardType.MEMBER])(
    'existing one %s success card -> count two does not queue or inspect',
    (type) => {
      const s = setup({ existing: [card('existing-card', type)] });
      const deckBefore = s.session.state!.players[0].mainDeck.cardIds;
      expect(s.enter().success).toBe(true);
      expect(s.session.state!.players[0].successZone.cardIds).toEqual(['existing-card', 'source']);
      expect(getEnterSuccessZoneEventsFromLog(s.session.state!)[0]?.successZoneCardCountAfter).toBe(
        2
      );
      expect(s.session.state!.activeEffect).toBeNull();
      expect(s.session.state!.pendingAbilities).toEqual([]);
      expect(s.session.state!.inspectionZone.cardIds).toEqual([]);
      expect(s.session.state!.players[0].mainDeck.cardIds).toEqual(deckBefore);
      expect(
        s.session.state!.actionHistory.some(
          (a) => a.type === 'TRIGGER_ABILITY' && a.payload.abilityId === ABILITY
        )
      ).toBe(false);
    }
  );

  it('LIVE success judgment without placement never starts the entry ability', () => {
    const s = setup();
    const game = emitGameEvent(s.session.state!, createLiveSuccessEvent(P1, ['source'], 2));
    const queued = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_SUCCESS]);
    expect(resolvePendingCardEffects(queued).gameState.activeEffect).toBeNull();
    expect(getEnterSuccessZoneEventsFromLog(queued)).toEqual([]);
  });

  it('reveals only the selected member and moves the remaining batch after authoritative dwell once', () => {
    const s = setup();
    s.enter();
    expect(s.choose('straight').success).toBe(true);
    const dwell = s.session.state!.activeEffect!;
    expect(dwell.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    expect(s.session.state!.players[0].hand.cardIds).toEqual([]);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual([]);
    expect(s.session.state!.inspectionZone.revealedCardIds).toEqual(['straight']);
    for (const player of [P1, P2]) {
      const view = s.session.getPlayerViewState(player)!;
      expect(view.activeEffect?.revealedObjectIds).toEqual([createPublicObjectId('straight')]);
      expect(view.objects[createPublicObjectId('straight')]?.surface).toBe('FRONT');
    }
    expect(s.session.getPlayerViewState(P2)!.objects[createPublicObjectId('curly')]?.surface).toBe(
      'BACK'
    );
    expect(
      s.session.executeCommand(
        createAutoAdvancePublicRevealCommand(
          P2,
          dwell.id,
          dwell.publicRevealAutoAdvanceAt!,
          dwell.publicRevealGeneration!
        )
      ).success
    ).toBe(false);
    s.setNow(dwell.publicRevealAutoAdvanceAt!);
    expect(
      s.session.executeCommand(
        createAutoAdvancePublicRevealCommand(
          P2,
          dwell.id,
          dwell.publicRevealAutoAdvanceAt!,
          'stale'
        )
      ).success
    ).toBe(false);
    expect(s.advance().success).toBe(true);
    expect(s.session.state!.players[0].hand.cardIds).toEqual(['straight']);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual([
      'curly',
      'other',
      'muse-live',
    ]);
    const events = s.session
      .state!.eventLog.map((e) => e.event)
      .filter((e) => e.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      fromZone: ZoneType.MAIN_DECK,
      toZone: ZoneType.WAITING_ROOM,
      cardInstanceIds: ['curly', 'other', 'muse-live'],
      cause: { sourceCardId: 'source', abilityId: ABILITY },
    });
    expect(
      s.session.executeCommand(
        createAutoAdvancePublicRevealCommand(
          P2,
          dwell.id,
          dwell.publicRevealAutoAdvanceAt!,
          dwell.publicRevealGeneration!
        )
      ).success
    ).toBe(false);
  });

  it.each([{ top: [] }, { top: [card('short-other', CardType.MEMBER, 'Aqours')] }])(
    'retains a real private confirmation with empty/no eligible short deck ($top)',
    ({ top }) => {
      const s = setup({ top });
      expect(s.enter().success).toBe(true);
      expect(s.session.state!.activeEffect).toMatchObject({
        abilityId: ABILITY,
        inspectionCardIds: top.map((c) => c.instanceId),
        selectableCardIds: [],
        skipSelectionLabel: top.length ? '全部放置入休息室' : '确认',
      });
      expect(s.choose(null).success).toBe(true);
      expect(s.session.state!.activeEffect).toBeNull();
      expect(s.session.state!.inspectionZone.cardIds).toEqual([]);
    }
  );

  it('rejects wrong player, wrong type/group, oversized and stale selections while retaining inspection', () => {
    const s = setup();
    s.enter();
    const effectId = s.session.state!.activeEffect!.id;
    for (const id of ['muse-live', 'other', 'missing']) expect(s.choose(id).success).toBe(false);
    expect(s.choose('curly', P2).success).toBe(false);
    expect(s.choose(null, P1, ['curly', 'straight']).success).toBe(false);
    s.mutate((g) => ({
      ...g,
      inspectionZone: {
        ...g.inspectionZone,
        cardIds: g.inspectionZone.cardIds.filter((id) => id !== 'curly'),
      },
    }));
    expect(s.choose('curly').success).toBe(false);
    expect(s.session.state!.activeEffect?.id).toBe(effectId);
    expect(s.session.state!.players[0].hand.cardIds).toEqual([]);
  });

  it('inspects only the available short deck and can reveal its one eligible member', () => {
    const s = setup({ top: [card('only-member')] });
    expect(s.enter().success).toBe(true);
    expect(s.session.state!.activeEffect?.inspectionCardIds).toEqual(['only-member']);
    expect(s.choose('only-member').success).toBe(true);
    expect(s.advance().success).toBe(true);
    expect(s.session.state!.players[0].hand.cardIds).toEqual(['only-member']);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('already triggered source leaving success zone does not cancel source-independent inspection', () => {
    const s = setup();
    s.enter();
    s.mutate((g) =>
      updatePlayer(g, P1, (p) => ({
        ...p,
        successZone: { ...p.successZone, cardIds: [] },
        waitingRoom: { ...p.waitingRoom, cardIds: ['source'] },
      }))
    );
    expect(s.choose('curly').success).toBe(true);
    expect(s.advance().success).toBe(true);
    expect(s.session.state!.players[0].hand.cardIds).toEqual(['curly']);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toContain('source');
  });

  it.each([0, 2])(
    'rechecks current success count %s when an entry count one is dispatched later',
    (currentCount) => {
      const s = setup({ sourceZone: ZoneType.HAND });
      const entered = placeHandLiveCardInSuccessZoneForPlayer(s.session.state!, P1, 'source')!;
      const extra = card('later-success', CardType.LIVE);
      let later = registerCards(entered, [extra]);
      later = updatePlayer(later, P1, (p) => ({
        ...p,
        successZone: {
          ...p.successZone,
          cardIds: currentCount === 0 ? [] : ['source', 'later-success'],
        },
        waitingRoom: { ...p.waitingRoom, cardIds: currentCount === 0 ? ['source'] : [] },
      }));
      const resolved = resolvePendingCardEffects(later).gameState;
      expect(getEnterSuccessZoneEventsFromLog(resolved)[0]?.successZoneCardCountAfter).toBe(1);
      if (currentCount === 0) {
        expect(resolved.activeEffect?.abilityId).toBe(ABILITY);
        expect(resolved.inspectionZone.cardIds).toHaveLength(4);
      } else {
        expect(resolved.activeEffect).toBeNull();
        expect(resolved.inspectionZone.cardIds).toEqual([]);
        expect(resolved.pendingAbilities).toEqual([]);
        expect(
          resolved.actionHistory.some(
            (action) => action.payload.step === 'SUCCESS_ZONE_CARD_COUNT_CONDITION_NOT_MET'
          )
        ).toBe(true);
      }
    }
  );

  it('Maki hand swap finishes the entire current ability before dispatching the entering LIVE', () => {
    const s = setup({ sourceZone: ZoneType.HAND, existing: [card('old-success')] });
    const maki = card('maki', CardType.MEMBER, 'μ’s', 'PL!-sd1-006-SD');
    s.mutate((g) => {
      let next = registerCards(g, [maki]);
      next = updatePlayer(next, P1, (p) => ({
        ...p,
        memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'maki', {
          face: FaceState.FACE_UP,
          orientation: OrientationState.ACTIVE,
        }),
      }));
      next = {
        ...next,
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.MAIN_FREE,
        pendingAbilities: [
          {
            id: 'maki-pending',
            abilityId: MAKI_ON_ENTER_ABILITY_ID,
            sourceCardId: 'maki',
            controllerId: P1,
            mandatory: true,
            timingId: TriggerCondition.ON_ENTER_STAGE,
            eventIds: [],
            sourceSlot: SlotPosition.CENTER,
          },
        ],
      };
      return resolvePendingCardEffects(next).gameState;
    });
    expect(s.choose('source').success).toBe(true);
    expect(s.session.state!.activeEffect?.abilityId).toBe(MAKI_ON_ENTER_ABILITY_ID);
    expect(s.session.state!.inspectionZone.cardIds).toEqual([]);
    expect(s.advance().success).toBe(true);
    expect(s.session.state!.activeEffect?.abilityId).toBe(MAKI_ON_ENTER_ABILITY_ID);
    expect(s.choose('old-success').success).toBe(true);
    expect(s.session.state!.activeEffect?.abilityId).toBe(ABILITY);
    expect(s.session.state!.players[0].hand.cardIds).toEqual(['old-success']);
    expect(getEnterSuccessZoneEventsFromLog(s.session.state!)[0]?.cause).toMatchObject({
      kind: 'CARD_EFFECT',
      sourceCardId: 'maki',
      abilityId: MAKI_ON_ENTER_ABILITY_ID,
      pendingAbilityId: 'maki-pending',
    });
    const actions = s.session.state!.actionHistory;
    const finish = actions.findIndex(
      (a) =>
        a.type === 'RESOLVE_ABILITY' &&
        a.payload.abilityId === MAKI_ON_ENTER_ABILITY_ID &&
        a.payload.step === 'FINISH'
    );
    const trigger = actions.findIndex(
      (a) => a.type === 'TRIGGER_ABILITY' && a.payload.abilityId === ABILITY
    );
    expect(finish).toBeGreaterThan(-1);
    expect(trigger).toBeGreaterThan(finish);
    expect(s.choose(null).success).toBe(true);
    expect(s.session.state!.activeEffect).toBeNull();
  });

  it('replacement records only the waiting-room LIVE actually entering, then resumes settlement', () => {
    const original = card('original', CardType.LIVE, "μ's", 'PL!-bp6-024-L');
    const s = setup({ sourceZone: ZoneType.WAITING_ROOM, original });
    expect(s.enter().success).toBe(true);
    expect(s.session.state!.activeEffect?.abilityId).toBe(
      BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID
    );
    expect(getEnterSuccessZoneEventsFromLog(s.session.state!)).toEqual([]);
    expect(s.choose('source').success).toBe(true);
    expect(s.session.state!.activeEffect?.abilityId).toBe(ABILITY);
    expect(getEnterSuccessZoneEventsFromLog(s.session.state!)).toMatchObject([
      {
        cardInstanceId: 'source',
        fromZone: ZoneType.WAITING_ROOM,
        successZoneCardCountAfter: 1,
        cause: {
          kind: 'CARD_EFFECT',
          sourceCardId: 'original',
          abilityId: BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID,
        },
      },
    ]);
    expect(s.session.state!.players[0].liveZone.cardIds).toEqual(['original']);
    expect(s.choose(null).success).toBe(true);
    expect(
      s.session.executeCommand(createConfirmStepCommand(P1, SubPhase.RESULT_SETTLEMENT)).success
    ).toBe(true);
  });

  it('FREE generic hand movement into success uses the same event and effect', () => {
    const s = setup({ sourceZone: ZoneType.HAND });
    s.mutate((g) => ({
      ...g,
      manualOperationMode: 'FREE',
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.MAIN_FREE,
    }));
    const moved = s.session.executeCommand(
      createMoveOwnedCardToZoneCommand(P1, 'source', ZoneType.HAND, ZoneType.SUCCESS_ZONE)
    );
    expect(moved.success, moved.error).toBe(true);
    expect(s.session.state!.activeEffect?.abilityId).toBe(ABILITY);
    expect(getEnterSuccessZoneEventsFromLog(s.session.state!)).toHaveLength(1);
  });

  it('declining replacement records ordinary LIVE placement without a card-effect cause', () => {
    const original = card('original', CardType.LIVE, "μ's", 'PL!-bp6-024-L');
    const s = setup({ sourceZone: ZoneType.WAITING_ROOM, original });
    expect(s.enter().success).toBe(true);
    expect(s.choose(null).success).toBe(true);
    const entries = getEnterSuccessZoneEventsFromLog(s.session.state!);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ cardInstanceId: 'original', fromZone: ZoneType.LIVE_ZONE });
    expect(entries[0]?.cause).toBeUndefined();
    expect(s.session.state!.activeEffect).toBeNull();
  });
});
