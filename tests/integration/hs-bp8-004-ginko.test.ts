import { describe, expect, it } from 'vitest';
import {
  HS_BP8_004_ON_ENTER_DRAW_RELAY_KAHO_DRAW_ONE_ABILITY_ID as ON_ENTER,
  HS_BP8_004_ACTIVATED_DISCARD_LOW_COST_HASUNOSORA_GAIN_ON_ENTER_ABILITY_ID as ACTIVATED,
} from '../../src/application/card-effects/ability-ids';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import { clearPreviousStageMemberInstanceState } from '../../src/application/effects/member-state';
import { getStageMemberDelegatableOnEnterDefinitions } from '../../src/application/card-effects/runtime/delegatable-definitions';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  getHostEnterStageEventIds,
  getHostEnterStageMetadata,
} from '../../src/application/card-effects/runtime/temporary-on-enter-ability-grants';
import {
  getCurrentTemporaryOnEnterAbilityGrants,
  getTemporaryOnEnterAbilityInvocation,
} from '../../src/application/card-effects/runtime/temporary-on-enter-ability-grants';
import {
  getAbilityTemplateCardCode,
  isAbilityActivationCostWaived,
} from '../../src/application/card-effects/runtime/on-enter-ability-invocation';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  gameWithCards,
  member,
  live,
  P1,
  P2,
  sourceCardFixture,
} from '../helpers/card-effect-zone-fixture';

function setup(sourceCode = 'PL!HS-PR-001-PR', relaySourceCode = 'PL!HS-bp1-001-P') {
  const host = member('ginko', { cardCode: 'PL!HS-bp8-004-SEC' });
  const source =
    sourceCardFixture(sourceCode)?.cardType === CardType.MEMBER
      ? member('copy-source', { cardCode: sourceCode })
      : member('copy-source', { cardCode: sourceCode, groupNames: ['Aqours'], cost: 1 });
  const relaySource = member('relay-source', { cardCode: relaySourceCode });
  const deck = Array.from({ length: 12 }, (_, i) => member(`deck-${i}`));
  const energy = Array.from({ length: 17 }, (_, i) =>
    createCardInstance(
      { cardCode: `energy-${i}`, name: 'Energy', cardType: CardType.ENERGY },
      P1,
      `energy-${i}`
    )
  );
  let game = registerCards(
    gameWithCards([host, source, relaySource, ...deck, live('waiting-live')]),
    energy
  );
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['ginko', 'copy-source'] },
    waitingRoom: { ...p.waitingRoom, cardIds: ['waiting-live'] },
    mainDeck: { ...p.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'relay-source', {
      face: FaceState.FACE_UP,
      orientation: OrientationState.ACTIVE,
    }),
    energyZone: {
      ...p.energyZone,
      cardIds: energy.map((card) => card.instanceId),
      cardStates: new Map(
        energy.map((card) => [
          card.instanceId,
          { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE },
        ])
      ),
    },
  }));
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
    waitingForInput: false,
    waitingPlayerId: null,
    manualOperationMode: 'RULES',
  };
  const session = createGameSession({ cardEntrance: 'LOCAL' });
  session.createGame('ginko-rules', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}
function play(session: ReturnType<typeof setup>) {
  const result = session.executeCommand(
    createPlayMemberToSlotCommand(P1, 'ginko', SlotPosition.CENTER, {
      relayMode: 'SINGLE',
      relayReplacementSlots: [SlotPosition.CENTER],
    })
  );
  expect(result.success, result.error).toBe(true);
  const entrance = session.state!.entranceRuntime?.pending;
  if (entrance)
    expect(
      session.executeCommand({
        type: GameCommandType.ACK_CARD_ENTRANCE,
        playerId: P1,
        entranceId: entrance.id,
        timestamp: Date.now(),
      }).success
    ).toBe(true);
}
function activate(session: ReturnType<typeof setup>) {
  const result = session.executeCommand(createActivateAbilityCommand(P1, 'ginko', ACTIVATED));
  expect(result.success, result.error).toBe(true);
  expect(session.state!.activeEffect?.abilityId).toBe(ACTIVATED);
}
function pay(session: ReturnType<typeof setup>) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'copy-source')
  );
  expect(result.success, result.error).toBe(true);
}

describe('PL!HS-bp8-004 费用17「百生吟子」', () => {
  it.each([
    ['PL!HS-bp1-001-P', 2],
    ['PL!HS-bp1-006-P', 1],
  ] as const)(
    'uses a real RULES play/relay command and draws from actual Kaho identity (%s)',
    (relayCode, count) => {
      const session = setup('PL!HS-PR-001-PR', relayCode);
      play(session);
      expect(session.manualOperationMode).toBe('RULES');
      expect(session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe('ginko');
      expect(
        [...session.state!.players[0].energyZone.cardStates.values()].filter(
          (state) => state.orientation === OrientationState.WAITING
        )
      ).toHaveLength(6);
      expect(session.state!.players[0].hand.cardIds).toEqual([
        'copy-source',
        ...Array.from({ length: count }, (_, i) => `deck-${i}`),
      ]);
      const event = session.state!.eventLog.find(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_STAGE && event.cardInstanceId === 'ginko'
      )?.event;
      expect(event).toMatchObject({
        fromZone: ZoneType.HAND,
        relayReplacements: [expect.objectContaining({ cardId: 'relay-source', effectiveCost: 11 })],
      });
      expect(session.state!.actionHistory).toContainEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            abilityId: ON_ENTER,
            relayedFromKaho: count === 2,
            requestedDrawCount: count,
          }),
        })
      );
    }
  );
  it('pays and consumes turn once even if the discarded card is not a qualifying Hasunosora member', () => {
    const session = setup('SYNTHETIC-INELIGIBLE-AQOURS');
    play(session);
    activate(session);
    pay(session);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain('copy-source');
    expect(session.state!.activeEffect).toBeNull();
    expect(getCurrentTemporaryOnEnterAbilityGrants(session.state!, P1, 'ginko')).toEqual([]);
    expect(
      session.state!.actionHistory.filter(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === ACTIVATED
      )
    ).toHaveLength(1);
    expect(
      session.state!.actionHistory.filter(
        (action) => action.payload.abilityId === ACTIVATED && action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(1);
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, 'ginko', ACTIVATED)).success
    ).toBe(false);
  });
  it('grants before immediately invoking without the copied discard cost and retains host identity through inspection', () => {
    const session = setup();
    play(session);
    activate(session);
    pay(session);
    const effect = session.state!.activeEffect!;
    expect(effect.abilityId).toBe('PL!-sd1:discard-one-look-top-take-one');
    expect(effect.inspectionCardIds).toHaveLength(3);
    expect(effect.sourceCardId).toBe('ginko');
    expect(getAbilityTemplateCardCode(session.state!, effect)).toBe('PL!HS-PR-001-PR');
    expect(isAbilityActivationCostWaived(effect)).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual(['deck-0', 'deck-1']);
    expect((session.state!.cardRegistry.get('ginko')!.data as MemberCardData).cost).toBe(17);
    expect(session.state!.cardRegistry.get('ginko')!.data.name).toBe('百生吟子');
    expect(getCurrentTemporaryOnEnterAbilityGrants(session.state!, P1, 'ginko')).toHaveLength(1);
    expect(
      session.state!.actionHistory.filter(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === effect.abilityId
      )
    ).toEqual([]);
    expect(
      getStageMemberDelegatableOnEnterDefinitions('PL!HS-bp8-004-SEC', SlotPosition.CENTER, {
        game: session.state!,
        controllerId: P1,
        sourceCardId: 'ginko',
      }).map((definition) => definition.abilityId)
    ).toContain(effect.abilityId);
    const later = getTemporaryOnEnterAbilityInvocation(
      session.state!,
      P1,
      'ginko',
      effect.abilityId
    )!;
    expect(isAbilityActivationCostWaived({ onEnterInvocation: later })).toBe(false);
    for (const player of [P1, P2]) {
      const view = JSON.stringify(projectPlayerViewState(session.state!, player));
      expect(view).not.toContain('definitionSourceCardCode');
      expect(view).not.toContain(later.grantId);
    }
  });
  it('retains per-template configuration for a shared ability ID (top three versus top five)', () => {
    const session = setup('PL!HS-bp2-010-N');
    play(session);
    activate(session);
    pay(session);
    expect(session.state!.activeEffect?.abilityId).toBe('PL!-sd1:discard-one-look-top-take-one');
    expect(session.state!.activeEffect?.inspectionCardIds).toHaveLength(5);
    expect(session.state!.activeEffect?.onEnterInvocation?.definitionSourceCardCode).toBe(
      'PL!HS-bp2-010-N'
    );
  });
  it('round-trips the current authority checkpoint with grant and invocation identity intact', () => {
    const session = setup();
    play(session);
    activate(session);
    pay(session);
    const original = session.state!;
    const restoredState = rehydrateAuthorityGameState(
      serializeReplayPayload(original, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
    );
    const restored = createGameSession();
    restored.restoreRuntimeState({ authorityState: restoredState, currentPublicSeq: 0 });
    expect(restored.state!.activeEffect?.onEnterInvocation).toEqual(
      original.activeEffect!.onEnterInvocation
    );
    expect(restored.state!.activeEffect?.sourceLifecycleId).toBe(
      original.activeEffect!.sourceLifecycleId
    );
    expect(getCurrentTemporaryOnEnterAbilityGrants(restored.state!, P1, 'ginko')).toEqual(
      getCurrentTemporaryOnEnterAbilityGrants(original, P1, 'ginko')
    );
    const selected = restored.state!.activeEffect!.selectableCardIds![0]!;
    const result = restored.executeCommand(
      createConfirmEffectStepCommand(P1, restored.state!.activeEffect!.id, selected)
    );
    expect(result.success, result.error).toBe(true);
    expect(restored.state!.players[0].hand.cardIds).toContain(selected);
  });
  it('clears grants on departure, does not resurrect them on reentry and also clears at actual LIVE end', () => {
    const session = setup();
    play(session);
    activate(session);
    pay(session);
    const game = { ...session.state!, activeEffect: null };
    const cleared = clearPreviousStageMemberInstanceState(game, P1, 'ginko');
    expect(getCurrentTemporaryOnEnterAbilityGrants(cleared, P1, 'ginko')).toEqual([]);
    const reentered = emitGameEvent(
      game,
      createEnterStageEvent('ginko', ZoneType.HAND, SlotPosition.CENTER, P1, P1)
    );
    expect(getCurrentTemporaryOnEnterAbilityGrants(reentered, P1, 'ginko')).toEqual([]);
    expect(
      new GameService()
        .finalizeLiveResult(game)
        .gameState.liveResolution.liveModifiers.filter(
          (modifier) => modifier.kind === 'ON_ENTER_ABILITY_GRANT'
        )
    ).toEqual([]);
  });
  it('keeps paid discard when the host becomes a new object before the payment resolves', () => {
    const session = setup();
    play(session);
    activate(session);
    const reentered = emitGameEvent(
      session.state!,
      createEnterStageEvent('ginko', ZoneType.HAND, SlotPosition.CENTER, P1, P1)
    );
    (session as unknown as { authorityState: GameState }).authorityState = reentered;
    pay(session);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain('copy-source');
    expect(getCurrentTemporaryOnEnterAbilityGrants(session.state!, P1, 'ginko')).toEqual([]);
    expect(session.state!.activeEffect).toBeNull();
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, 'ginko', ACTIVATED)).success
    ).toBe(true);
  });
  it('also pays for a real cost-under-thirteen Hasunosora card that has no ON_ENTER ability', () => {
    const session = setup('PL!HS-bp8-013-N');
    play(session);
    activate(session);
    pay(session);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain('copy-source');
    expect(getCurrentTemporaryOnEnterAbilityGrants(session.state!, P1, 'ginko')).toEqual([]);
    expect(session.state!.activeEffect).toBeNull();
  });
  it('ordinary later invocation uses the same template and pays the copied discard cost normally', () => {
    const session = setup();
    play(session);
    activate(session);
    pay(session);
    const first = session.state!.activeEffect!;
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, first.id, first.selectableCardIds![0]!)
      ).success
    ).toBe(true);
    const game = session.state!;
    const invocation = getTemporaryOnEnterAbilityInvocation(game, P1, 'ginko', first.abilityId)!;
    const sourceLifecycleId = getCurrentTemporaryOnEnterAbilityGrants(game, P1, 'ginko')[0]!
      .hostLifecycleId;
    const later = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        {
          id: 'ordinary-delegation',
          abilityId: first.abilityId,
          sourceCardId: 'ginko',
          sourceLifecycleId,
          controllerId: P1,
          mandatory: true,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          sourceSlot: SlotPosition.CENTER,
          eventIds: getHostEnterStageEventIds(game, 'ginko'),
          metadata: getHostEnterStageMetadata(game, 'ginko'),
          onEnterInvocation: invocation,
        },
      ],
    }).gameState;
    expect(later.inspectionZone.cardIds).toEqual([]);
    expect(later.activeEffect).toMatchObject({
      sourceCardId: 'ginko',
      onEnterInvocation: {
        definitionSourceCardCode: 'PL!HS-PR-001-PR',
        waiveActivationCosts: false,
      },
      selectableCardIds: game.players[0].hand.cardIds,
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
    });
  });
  it('uses host cost seventeen and real relay facts for a copied lower-cost-Cerise condition', () => {
    const session = setup('PL!HS-bp2-007-P');
    play(session);
    activate(session);
    pay(session);
    expect(session.state!.activeEffect).toMatchObject({
      sourceCardId: 'ginko',
      selectableCardIds: ['waiting-live'],
      onEnterInvocation: { definitionSourceCardCode: 'PL!HS-bp2-007-P' },
    });
  });
  it('does not replace real hand-entry facts with a later stage-slot movement event', () => {
    const session = setup('PL!HS-PR-038-PR');
    play(session);
    activate(session);
    const movedSlots = updatePlayer(session.state!, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        SlotPosition.RIGHT,
        'ginko',
        { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE }
      ),
    }));
    const moved = emitGameEvent(
      movedSlots,
      createEnterStageEvent('ginko', ZoneType.MEMBER_SLOT, SlotPosition.RIGHT, P1, P1)
    );
    (session as unknown as { authorityState: GameState }).authorityState = moved;
    const enterEventCount = moved.eventLog.filter(
      ({ event }) => event.eventType === TriggerCondition.ON_ENTER_STAGE
    ).length;
    pay(session);
    expect(
      session.state!.liveResolution.liveModifiers.filter((modifier) => modifier.kind === 'HEART')
    ).toEqual([]);
    expect(
      session.state!.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_ENTER_STAGE
      )
    ).toHaveLength(enterEventCount);
    expect(getCurrentTemporaryOnEnterAbilityGrants(session.state!, P1, 'ginko')).toHaveLength(1);
    expect(getHostEnterStageMetadata(session.state!, 'ginko')?.fromZone).toBe(ZoneType.HAND);
  });
});
