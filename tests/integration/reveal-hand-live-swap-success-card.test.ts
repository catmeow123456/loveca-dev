import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartRequirement,
  type AnyCardData,
  type CardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  MAKI_ON_ENTER_ABILITY_ID,
  PL_PB2_014_ON_ENTER_REVEAL_LILY_WHITE_LIVE_SWAP_SUCCESS_CARD_ABILITY_ID,
  BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import { addSuccessLivePlacementRestrictionUntilLiveEnd } from '../../src/domain/rules/success-live-placement';
import { createPublicObjectId } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const RIN = PL_PB2_014_ON_ENTER_REVEAL_LILY_WHITE_LIVE_SWAP_SUCCESS_CARD_ABILITY_ID;
const RIN_TEXT =
  '【登场】可以将手牌的1张『lily white』的LIVE卡公开：将存在于自己的成功LIVE卡区的1张卡片加入手牌。如此做时，将因此公开的卡片放置于自己的成功LIVE卡区。';
const MAKI_TEXT =
  '【登场】可以将1张手牌中的LIVE卡公开：将1张自己的成功LIVE卡区中的卡片加入手牌。如此做的场合，将因此公开的卡放置入自己的成功LIVE卡区。';

function card(
  id: string,
  code: string,
  type = CardType.LIVE,
  unitName = '「lilywhite」',
  owner = P1
) {
  const common = { cardCode: code, name: code, groupNames: ['μ’s'], unitName };
  const data: AnyCardData =
    type === CardType.LIVE
      ? { ...common, cardType: CardType.LIVE, score: 1, requirements: createHeartRequirement({}) }
      : {
          ...common,
          cardType: CardType.MEMBER,
          cost: code.startsWith('PL!-pb2-014') ? 11 : 9,
          blade: 2,
          hearts: [],
        };
  return createCardInstance(data, owner, id);
}

function setup(
  options: {
    maki?: boolean;
    hand?: CardInstance[];
    success?: CardInstance[];
    waiting?: CardInstance[];
    secondPending?: boolean;
  } = {}
) {
  const abilityId = options.maki ? MAKI_ON_ENTER_ABILITY_ID : RIN;
  const source = card(
    'source',
    options.maki ? 'PL!-sd1-006-UNSEEN' : 'PL!-pb2-014-UNSEEN',
    CardType.MEMBER
  );
  const hand = options.hand ?? [card('hand-live', 'PL!-test-live')];
  const success = options.success ?? [card('success-card', 'PL!-success-member', CardType.MEMBER)];
  const waiting = options.waiting ?? [];
  const secondSource = card('second-source', 'PL!-sd1-006-SD', CardType.MEMBER);
  // Both decks remain nonempty so check timing does not introduce unrelated refresh rules.
  const padding1 = card('p1-deck', 'PL!-padding');
  const padding2 = card('p2-deck', 'PL!-padding', CardType.LIVE, '', P2);
  let game = registerCards(createGameState('success-card-swap', P1, 'P1', P2, 'P2'), [
    source,
    ...hand,
    ...success,
    ...waiting,
    secondSource,
    padding1,
    padding2,
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: hand.map((c) => c.instanceId) },
    successZone: { ...p.successZone, cardIds: success.map((c) => c.instanceId) },
    waitingRoom: { ...p.waitingRoom, cardIds: waiting.map((c) => c.instanceId) },
    mainDeck: { ...p.mainDeck, cardIds: [padding1.instanceId] },
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, P2, (p) => ({
    ...p,
    mainDeck: { ...p.mainDeck, cardIds: [padding2.instanceId] },
  }));
  const pending: PendingAbilityState = {
    id: 'swap-pending',
    abilityId,
    sourceCardId: source.instanceId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-source'],
    sourceSlot: SlotPosition.CENTER,
  };
  game = { ...game, pendingAbilities: [pending] };
  game = resolvePendingCardEffects(game).gameState;
  if (options.secondPending) {
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.LEFT, secondSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      pendingAbilities: [
        ...game.pendingAbilities,
        {
          ...pending,
          id: 'second-pending',
          abilityId: MAKI_ON_ENTER_ABILITY_ID,
          sourceCardId: secondSource.instanceId,
          sourceSlot: SlotPosition.LEFT,
          eventIds: ['second-enter'],
        },
      ],
    };
  }
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
  function choose(id: string | null) {
    return session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, id)
    );
  }
  function advance(playerId = P2) {
    const effect = session.state!.activeEffect!;
    now = effect.publicRevealAutoAdvanceAt!;
    return session.executeCommand(
      createAutoAdvancePublicRevealCommand(playerId, effect.id, now, effect.publicRevealGeneration!)
    );
  }
  function mutate(fn: (state: GameState) => GameState) {
    (session as unknown as { authorityState: GameState }).authorityState = fn(session.state!);
  }
  return {
    session,
    choose,
    advance,
    mutate,
    setNow: (value: number) => {
      now = value;
    },
    abilityId,
  };
}

describe('reveal hand LIVE then recover success-zone card shared family', () => {
  it('keeps the complete exported Maki paragraph across printed and unknown rarities', () => {
    for (const cardCode of ['PL!-sd1-006-SD', 'PL!-sd1-006-UNSEEN']) {
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode).filter(
        (definition) => definition.abilityId === MAKI_ON_ENTER_ABILITY_ID
      );
      expect(definitions).toHaveLength(1);
      expect(definitions[0].baseCardCodes).toEqual(['PL!-sd1-006']);
      expect(definitions[0].cardCodes).toBeUndefined();
      expect(definitions[0].effectText).toBe(MAKI_TEXT);
    }
    expect(setup({ maki: true }).session.state!.activeEffect!.effectText).toBe(MAKI_TEXT);
  });

  it('keeps the complete Rin text, unit selector, private candidates, and optional reveal cost', () => {
    const s = setup({
      hand: [
        card('lily', 'PL!-lily'),
        card('bibi', 'PL!-bibi', CardType.LIVE, 'BiBi'),
        card('member', 'PL!-member', CardType.MEMBER),
        card('wrong-owner', 'PL!-lily-other', CardType.LIVE, 'lily white', P2),
      ],
    });
    expect(s.session.state!.activeEffect).toMatchObject({
      effectText: RIN_TEXT,
      selectableCardIds: ['lily'],
      selectionLabel: '请选择要公开的手牌『lily white』LIVE卡',
      confirmSelectionLabel: '公开',
      skipSelectionLabel: '不发动',
    });
    expect(s.session.getPlayerViewState(P1)!.activeEffect?.selectableObjectIds).toHaveLength(1);
    expect(s.session.getPlayerViewState(P2)!.activeEffect?.selectableObjectIds).toBeUndefined();
    expect(s.choose('bibi').success).toBe(false);
    expect(s.choose(null).success).toBe(true);
    expect(s.session.state!.activeEffect).toBeNull();
    expect(s.session.state!.players[0].hand.cardIds).toEqual([
      'lily',
      'bibi',
      'member',
      'wrong-owner',
    ]);
  });

  it.each([false, true])(
    'reveals to both sides before taking a non-LIVE success card and completing once (maki=%s)',
    (maki) => {
      const s = setup({ maki });
      expect(s.choose('hand-live').success).toBe(true);
      const dwell = s.session.state!.activeEffect!;
      expect(dwell.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
      expect(dwell.selectableCardIds).toBeUndefined();
      expect(dwell.confirmSelectionLabel).toBeUndefined();
      expect(dwell.canSkipSelection).toBeUndefined();
      for (const playerId of [P1, P2]) {
        const view = s.session.getPlayerViewState(playerId)!;
        expect(view.activeEffect).toMatchObject({
          revealedObjectIds: [createPublicObjectId('hand-live')],
          publicRevealAutoAdvanceAt: 12_000,
          publicRevealGeneration: dwell.publicRevealGeneration,
        });
        expect(view.objects[createPublicObjectId('hand-live')]).toMatchObject({ surface: 'FRONT' });
      }
      expect(s.session.state!.players[0].hand.cardIds).toEqual(['hand-live']);
      expect(s.session.state!.players[0].successZone.cardIds).toEqual(['success-card']);
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
      s.setNow(12_000);
      expect(
        s.session.executeCommand(
          createAutoAdvancePublicRevealCommand(P1, dwell.id, 12_000, 'stale-generation')
        ).success
      ).toBe(false);
      expect(s.advance(maki ? P1 : P2).success).toBe(true);
      expect(s.session.state!.activeEffect).toMatchObject({
        stepId: maki ? 'MAKI_SELECT_SUCCESS_LIVE' : 'PL_PB2_014_SELECT_SUCCESS_CARD',
        selectableCardIds: ['success-card'],
        selectionLabel: '选择要加入手牌的成功LIVE卡区卡片',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
      });
      expect(s.choose(null).success).toBe(false);
      expect(s.choose('success-card').success).toBe(true);
      expect(s.session.state!.activeEffect).toBeNull();
      expect(s.session.state!.players[0].hand.cardIds).toEqual(['success-card']);
      expect(s.session.state!.players[0].successZone.cardIds).toEqual(['hand-live']);
      expect(
        s.session
          .state!.eventLog.filter(({ event }) => event.eventType === TriggerCondition.ON_ENTER_HAND)
          .map(({ event }) => event)
      ).toEqual([
        expect.objectContaining({
          cardInstanceId: 'success-card',
          fromZone: ZoneType.SUCCESS_ZONE,
          toZone: ZoneType.HAND,
        }),
      ]);
      expect(
        s.session.executeCommand(
          createAutoAdvancePublicRevealCommand(P1, dwell.id, 12_000, dwell.publicRevealGeneration!)
        ).success
      ).toBe(false);
      expect(
        s.session.state!.actionHistory.filter(
          (a) => a.payload.abilityId === s.abilityId && a.payload.step === 'FINISH'
        )
      ).toHaveLength(1);
    }
  );

  it('still pays reveal with no success target and continues the other pending only after dwell', () => {
    const s = setup({ success: [], secondPending: true });
    expect(s.choose('hand-live').success).toBe(true);
    expect(s.session.state!.pendingAbilities.map((p) => p.id)).toContain('second-pending');
    expect(s.session.state!.activeEffect!.abilityId).toBe(RIN);
    expect(s.advance().success).toBe(true);
    expect(s.session.state!.activeEffect!.abilityId).toBe(MAKI_ON_ENTER_ABILITY_ID);
    expect(s.session.state!.players[0].hand.cardIds).toEqual(['hand-live']);
    expect(s.session.state!.players[0].successZone.cardIds).toEqual([]);
    expect(s.choose(null).success).toBe(true);
    expect(s.session.state!.pendingAbilities).toEqual([]);
  });

  it('recomputes success targets after dwell and finishes when they disappeared', () => {
    const s = setup();
    expect(s.choose('hand-live').success).toBe(true);
    s.mutate((g) =>
      updatePlayer(g, P1, (p) => ({
        ...p,
        successZone: { ...p.successZone, cardIds: [] },
        waitingRoom: { ...p.waitingRoom, cardIds: ['success-card'] },
      }))
    );
    expect(s.advance().success).toBe(true);
    expect(s.session.state!.activeEffect).toBeNull();
    expect(s.session.state!.players[0].hand.cardIds).toEqual(['hand-live']);
  });

  it('rejects a stale hand cost without revealing or progressing', () => {
    const s = setup();
    s.mutate((g) =>
      updatePlayer(g, P1, (p) => ({
        ...p,
        hand: { ...p.hand, cardIds: [] },
        waitingRoom: { ...p.waitingRoom, cardIds: ['hand-live'] },
      }))
    );
    const before = s.session.state;
    expect(s.choose('hand-live').success).toBe(false);
    expect(s.session.state).toBe(before);
    expect(s.session.state!.activeEffect!.revealedCardIds).toBeUndefined();
  });

  it('does not place the revealed card if the chosen success card became stale', () => {
    const s = setup();
    s.choose('hand-live');
    s.advance();
    s.mutate((g) =>
      updatePlayer(g, P1, (p) => ({
        ...p,
        successZone: { ...p.successZone, cardIds: [] },
        waitingRoom: { ...p.waitingRoom, cardIds: ['success-card'] },
      }))
    );
    s.choose('success-card');
    expect(s.session.state!.activeEffect).toBeNull();
    expect(s.session.state!.players[0].hand.cardIds).toEqual(['hand-live']);
    expect(
      s.session.state!.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_ENTER_HAND
      )
    ).toEqual([]);
  });

  it('still recovers the success card if the already-revealed hand card left hand', () => {
    const s = setup();
    s.choose('hand-live');
    s.advance();
    s.mutate((g) =>
      updatePlayer(g, P1, (p) => ({
        ...p,
        hand: { ...p.hand, cardIds: [] },
        waitingRoom: { ...p.waitingRoom, cardIds: ['hand-live'] },
      }))
    );
    expect(s.choose('success-card').success).toBe(true);
    expect(s.session.state!.players[0].hand.cardIds).toEqual(['success-card']);
    expect(s.session.state!.players[0].successZone.cardIds).toEqual([]);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual(['hand-live']);
  });

  it.each(['card', 'tied-score'])(
    'checks %s placement prohibition after reveal and legal recovery',
    (kind) => {
      const s = setup({
        hand: [card('forbidden', kind === 'card' ? 'PL!S-bp2-024-L' : 'PL!-ordinary')],
      });
      if (kind === 'tied-score')
        s.mutate((g) =>
          addSuccessLivePlacementRestrictionUntilLiveEnd(g, {
            playerId: P1,
            sourceCardId: 'source',
            abilityId: 'test:tie',
          })
        );
      expect(s.session.state!.activeEffect!.selectableCardIds).toEqual(['forbidden']);
      expect(s.choose('forbidden').success).toBe(true);
      expect(s.advance().success).toBe(true);
      expect(s.choose('success-card').success).toBe(true);
      expect(s.session.state!.players[0].hand.cardIds).toEqual(['forbidden', 'success-card']);
      expect(s.session.state!.players[0].successZone.cardIds).toEqual([]);
    }
  );

  it.each([false, true])(
    'returns success card before replacement, preserves parent pending, and supports decline=%s',
    (decline) => {
      const s = setup({
        maki: true,
        hand: [card('crossroads', 'PL!-bp6-024-L')],
        waiting: [card('replacement', 'PL!-replacement')],
        secondPending: true,
      });
      s.choose('crossroads');
      s.advance();
      expect(s.choose('success-card').success).toBe(true);
      expect(s.session.state!.activeEffect!.abilityId).toBe(
        BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID
      );
      expect(s.session.state!.players[0].hand.cardIds).toEqual(['crossroads', 'success-card']);
      expect(s.session.state!.players[0].successZone.cardIds).toEqual([]);
      expect(s.session.state!.pendingAbilities.map((p) => p.id)).toContain('second-pending');
      expect(s.choose(decline ? null : 'replacement').success).toBe(true);
      expect(s.session.state!.players[0].successZone.cardIds).toEqual([
        decline ? 'crossroads' : 'replacement',
      ]);
      expect(s.session.state!.players[0].hand.cardIds).toEqual(
        decline ? ['success-card'] : ['crossroads', 'success-card']
      );
      expect(s.session.state!.activeEffect!.id).toBe('second-pending');
      const entryEvents = s.session.state!.eventLog
        .map(({ event }) => event)
        .filter((event) => event.eventType === TriggerCondition.ON_ENTER_SUCCESS_ZONE);
      expect(entryEvents).toHaveLength(1);
      expect(entryEvents[0]).toMatchObject({
        cardInstanceId: decline ? 'crossroads' : 'replacement',
        fromZone: decline ? ZoneType.HAND : ZoneType.WAITING_ROOM,
        cause: decline
          ? {
              kind: 'CARD_EFFECT',
              sourceCardId: 'source',
              abilityId: MAKI_ON_ENTER_ABILITY_ID,
              pendingAbilityId: 'swap-pending',
            }
          : {
              kind: 'CARD_EFFECT',
              sourceCardId: 'crossroads',
              abilityId: BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID,
            },
      });
      expect(
        s.session.state!.actionHistory.filter(
          (a) => a.payload.pendingAbilityId === 'swap-pending' && a.payload.step === 'FINISH'
        )
      ).toHaveLength(1);
      expect(
        s.session.state!.eventLog.filter(
          ({ event }) => event.eventType === TriggerCondition.ON_ENTER_HAND
        )
      ).toHaveLength(1);
    }
  );

  it('revalidates a replacement card and revealed original without duplicating the completed recovery', () => {
    const s = setup({
      maki: true,
      hand: [card('crossroads', 'PL!-bp6-024-L')],
      waiting: [card('replacement', 'PL!-replacement')],
    });
    s.choose('crossroads');
    s.advance();
    s.choose('success-card');
    s.mutate((g) =>
      updatePlayer(g, P1, (p) => ({
        ...p,
        waitingRoom: { ...p.waitingRoom, cardIds: [] },
        mainDeck: { ...p.mainDeck, cardIds: [...p.mainDeck.cardIds, 'replacement'] },
      }))
    );
    expect(s.choose('replacement').success).toBe(false);
    expect(s.session.state!.players[0].hand.cardIds).toEqual(['crossroads', 'success-card']);
    s.mutate((g) =>
      updatePlayer(g, P1, (p) => ({
        ...p,
        hand: { ...p.hand, cardIds: ['success-card'] },
        waitingRoom: { ...p.waitingRoom, cardIds: ['crossroads'] },
      }))
    );
    expect(s.choose(null).success).toBe(true);
    expect(s.session.state!.players[0].successZone.cardIds).toEqual([]);
    expect(s.session.state!.players[0].hand.cardIds).toEqual(['success-card']);
  });
});
