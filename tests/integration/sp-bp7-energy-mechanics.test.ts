import { describe, expect, it, vi } from 'vitest';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addEnergyBelowMember,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import {
  SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP7_005_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_BLADE_ABILITY_ID,
  SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
  SP_BP7_006_LIVE_SUCCESS_ENERGY_RETURNED_SCORE_ABILITY_ID,
  SP_BP7_007_LIVE_START_RETURN_TWO_GAIN_THREE_BLADE_ABILITY_ID,
  SP_BP7_007_LIVE_SUCCESS_MORE_ENERGY_ACTIVATE_FIVE_ABILITY_ID,
  SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  moveEnergyZoneCardsToEnergyDeckByCardEffect,
  placeEnergyFromDeckToZoneByCardEffect,
} from '../../src/application/effects/energy';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  RuleActionType,
  ruleActionProcessor,
  type RuleActionResult,
} from '../../src/domain/rules/rule-actions';

const P1 = 'p1',
  P2 = 'p2';
const member = createCardInstance(
  {
    cardCode: 'PL!SP-bp7-005-SEC',
    name: '叶月恋',
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 2,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  },
  P1,
  'ren'
);
const energy = (id: string) =>
  createCardInstance({ cardCode: id, name: id, cardType: CardType.ENERGY }, P1, id);
const makeMember = (code: string, id: string, name = id) =>
  createCardInstance(
    {
      cardCode: code,
      name,
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost: 5,
      blade: 2,
      hearts: [createHeartIcon(HeartColor.RED, 1)],
    },
    P1,
    id
  );
function pending(
  abilityId: string,
  sourceCardId: string,
  timing: TriggerCondition,
  id = abilityId
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: timing,
    eventIds: [],
    sourceSlot: SlotPosition.CENTER,
  };
}
function start(game: GameState, ability: PendingAbilityState) {
  return resolvePendingCardEffects({ ...game, pendingAbilities: [ability] }).gameState;
}
function command(game: GameState, option?: string, cardId?: string, cardIds?: readonly string[]) {
  const session = createGameSession();
  (session as unknown as { authorityState: GameState }).authorityState = game;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      game.activeEffect!.id,
      cardId,
      undefined,
      undefined,
      option,
      cardIds
    )
  );
  expect(result.success, JSON.stringify(result)).toBe(true);
  confirmPublicSelectionIfNeeded(session);
  return session.state!;
}
function commandResolveInOrder(game: GameState) {
  const session = createGameSession();
  (session as unknown as { authorityState: GameState }).authorityState = game;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(P1, game.activeEffect!.id, undefined, undefined, true)
  );
  expect(result.success).toBe(true);
  return result.gameState;
}
function tryCommand(game: GameState, cardId?: string, cardIds?: readonly string[]) {
  const session = createGameSession();
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      game.activeEffect!.id,
      cardId,
      undefined,
      undefined,
      undefined,
      cardIds
    )
  );
}
function setupMeiActivationScenario(options: {
  waitingCount: number;
  markedIndices?: readonly number[];
  opponentEnergyCount?: number;
}) {
  const mei = makeMember('PL!SP-bp7-007-SEC', `activation-mei-${options.waitingCount}`);
  const own = Array.from({ length: options.waitingCount }, (_, index) =>
    energy(`activation-own-${options.waitingCount}-${index}`)
  );
  const opponent = Array.from({ length: options.opponentEnergyCount ?? 0 }, (_, index) =>
    createCardInstance(
      { cardCode: `OPP-ENE-${index}`, name: `OPP-ENE-${index}`, cardType: CardType.ENERGY },
      P2,
      `activation-opponent-${options.waitingCount}-${index}`
    )
  );
  let game = registerCards(createGameState('mei-activation', P1, 'P1', P2, 'P2'), [
    mei,
    ...own,
    ...opponent,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    energyZone: own.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, mei.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    energyZone: opponent.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
  }));
  game = {
    ...game,
    energyActivePhaseSkips: (options.markedIndices ?? []).map((index) => ({
      playerId: P1,
      energyCardId: own[index]!.instanceId,
      sourceCardId: mei.instanceId,
      abilityId: 'marker',
    })),
  };
  return { game, mei, own };
}
describe('bp7 energy mechanics linkage', () => {
  it('dispatches a new batch rule-action return through check timing and triggers Ren only once', () => {
    const returned = [energy('rule-return-1'), energy('rule-return-2')];
    const placed = energy('rule-placement');
    const source = makeMember('PL!SP-bp7-005-SEC', 'rule-ren');
    let game = registerCards(createGameState('rule-return', P1, 'P1', P2, 'P2'), [
      source,
      placed,
      ...returned,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      energyDeck: { ...player.energyDeck, cardIds: [placed.instanceId] },
      energyZone: returned.reduce(
        (zone, card) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    const action: RuleActionResult = {
      type: RuleActionType.ILLEGAL_CARD,
      executed: true,
      affectedPlayerId: P1,
      description: 'return two energy from energy zone',
      movedCards: returned.map((card) => ({
        cardId: card.instanceId,
        from: ZoneType.ENERGY_ZONE,
        to: ZoneType.ENERGY_DECK,
      })),
    };
    const collect = vi
      .spyOn(ruleActionProcessor, 'collectPendingRuleActions')
      .mockReturnValueOnce([action])
      .mockReturnValue([]);
    const service = new GameService();
    game = service.executeCheckTiming(game).gameState;
    collect.mockRestore();

    const returnEvents = game.eventLog
      .map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_ENERGY_MOVED_TO_DECK);
    expect(returnEvents).toHaveLength(1);
    expect(returnEvents[0]).toMatchObject({
      movedEnergyCardIds: returned.map((card) => card.instanceId),
      cause: { kind: 'RULE_ACTION', playerId: P1 },
    });
    expect(game.players[0].energyZone.cardIds).toContain(placed.instanceId);
    expect(game.energyActivePhaseSkips).toEqual([
      expect.objectContaining({ playerId: P1, energyCardId: placed.instanceId }),
    ]);
    expect(
      game.actionHistory.filter(
        (actionEntry) =>
          actionEntry.payload.abilityId ===
            SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID &&
          actionEntry.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(1);

    game = service.executeCheckTiming(game).gameState;
    expect(
      game.actionHistory.filter(
        (actionEntry) =>
          actionEntry.payload.abilityId ===
            SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID &&
          actionEntry.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(1);
  });

  it('does not dispatch an energy-below rule return as an energy-zone return trigger', () => {
    const source = makeMember('PL!SP-bp7-005-SEC', 'below-rule-ren');
    const below = energy('below-rule-energy');
    let game = registerCards(createGameState('below-rule-return', P1, 'P1', P2, 'P2'), [
      source,
      below,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: addEnergyBelowMember(
        placeCardInSlot(player.memberSlots, SlotPosition.SIDE_LEFT, source.instanceId),
        SlotPosition.CENTER,
        below.instanceId
      ),
    }));
    game = new GameService().executeCheckTiming(game).gameState;
    expect(game.players[0].energyDeck.cardIds).toContain(below.instanceId);
    expect(
      game.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_MOVED_TO_DECK
      )
    ).toHaveLength(0);
    expect(
      game.actionHistory.filter(
        (entry) =>
          entry.payload.abilityId ===
          SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID
      )
    ).toHaveLength(0);
  });

  it('returns two energy as one event, triggers Ren once, places one marked energy, then triggers the own-placement ability once', () => {
    const e1 = energy('e1'),
      e2 = energy('e2'),
      deck = energy('deck');
    let game = registerCards(createGameState('g', P1, 'P1', P2, 'P2'), [member, e1, e2, deck]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      energyDeck: { ...p.energyDeck, cardIds: [deck.instanceId] },
      energyZone: addCardToStatefulZone(
        addCardToStatefulZone(p.energyZone, e1.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        e2.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, member.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    const moved = moveEnergyZoneCardsToEnergyDeckByCardEffect(
      game,
      P1,
      [e1.instanceId, e2.instanceId],
      { kind: 'CARD_EFFECT', playerId: P1, sourceCardId: 'cost-source', abilityId: 'cost' },
      { exactCount: 2 }
    )!;
    game = enqueueTriggeredCardEffects(
      moved.gameState,
      [TriggerCondition.ON_ENERGY_MOVED_TO_DECK],
      {
        energyMovedToDeckEvents: [moved.energyMovedEvent!],
      }
    );
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENERGY_MOVED_TO_DECK], {
      energyMovedToDeckEvents: [moved.energyMovedEvent!],
    });
    expect(game.pendingAbilities).toHaveLength(1);
    game = resolvePendingCardEffects(game).gameState;
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENERGY_MOVED_TO_DECK], {
      energyMovedToDeckEvents: [moved.energyMovedEvent!],
    });
    expect(game.pendingAbilities).toHaveLength(0);
    expect(game.players[0].energyZone.cardIds).toEqual([deck.instanceId]);
    expect(game.energyActivePhaseSkips?.map((x) => x.energyCardId)).toEqual([deck.instanceId]);
    expect(
      game.eventLog.filter((x) => x.event.eventType === TriggerCondition.ON_ENERGY_MOVED_TO_DECK)
    ).toHaveLength(1);
    expect(
      game.eventLog.filter(
        (x) => x.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )
    ).toHaveLength(1);
    expect(
      game.actionHistory.filter(
        (x) => x.type === 'RESOLVE_ABILITY' && x.payload.conditionMet === true
      )
    ).toHaveLength(1);
  });
  it('limits Ren turn2 after three real card-effect placement events', () => {
    const e1 = energy('limit-e1'),
      e2 = energy('limit-e2'),
      e3 = energy('limit-e3');
    let game = registerCards(createGameState('limits', P1, 'P1', P2, 'P2'), [member, e1, e2, e3]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      energyDeck: { ...p.energyDeck, cardIds: [e1.instanceId, e2.instanceId, e3.instanceId] },
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, member.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    for (let i = 0; i < 3; i++) {
      const placement = placeEnergyFromDeckToZoneByCardEffect(
        game,
        P1,
        1,
        OrientationState.WAITING,
        { kind: 'CARD_EFFECT', playerId: P1, sourceCardId: 'external', abilityId: `external-${i}` }
      );
      expect(placement).not.toBeNull();
      game = enqueueTriggeredCardEffects(placement!.gameState, [
        TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT,
      ]);
      if (i < 2) {
        expect(
          game.pendingAbilities.filter(
            (ability) =>
              ability.abilityId ===
              SP_BP7_005_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_BLADE_ABILITY_ID
          )
        ).toHaveLength(1);
        game = resolvePendingCardEffects(game).gameState;
      } else {
        expect(
          game.pendingAbilities.filter(
            (ability) =>
              ability.abilityId ===
              SP_BP7_005_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_BLADE_ABILITY_ID
          )
        ).toHaveLength(0);
      }
    }
    expect(
      game.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )
    ).toHaveLength(3);
    const uses = game.actionHistory.filter(
      (x) =>
        x.payload.abilityId === SP_BP7_005_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_BLADE_ABILITY_ID &&
        x.payload.step === 'ABILITY_USE'
    );
    expect(uses).toHaveLength(2);
    expect(
      game.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === SP_BP7_005_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_BLADE_ABILITY_ID
      )
    ).toHaveLength(2);
  });
  it('consumes Ren shared turn1 when the energy deck is empty', () => {
    const source = makeMember('PL!SP-bp7-005-SEC', 'empty-ren');
    const e1 = energy('empty-return-energy');
    let game = registerCards(createGameState('empty-turn1', P1, 'P1', P2, 'P2'), [source, e1]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      energyDeck: { ...player.energyDeck, cardIds: [] },
      energyZone: addCardToStatefulZone(player.energyZone, e1.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = start(
      game,
      pending(
        SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID,
        source.instanceId,
        TriggerCondition.ON_ENTER_STAGE,
        'empty-enter'
      )
    );
    expect(game.players[0].energyZone.cardIds).toEqual([e1.instanceId]);
    expect(
      game.actionHistory.filter(
        (action) =>
          action.payload.abilityId ===
            SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(1);
    const moved = moveEnergyZoneCardsToEnergyDeckByCardEffect(game, P1, [e1.instanceId], {
      kind: 'CARD_EFFECT',
      playerId: P1,
      sourceCardId: 'return',
      abilityId: 'return',
    })!;
    game = enqueueTriggeredCardEffects(moved.gameState, [TriggerCondition.ON_ENERGY_MOVED_TO_DECK]);
    expect(
      game.pendingAbilities.filter(
        (ability) =>
          ability.abilityId === SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID
      )
    ).toHaveLength(0);
  });
  it('does not trigger Ren turn2 when the opponent effect places energy for the player', () => {
    const source = makeMember('PL!SP-bp7-005-SEC', 'opponent-effect-ren');
    const e1 = energy('opponent-effect-energy');
    let game = registerCards(createGameState('opponent-effect', P1, 'P1', P2, 'P2'), [source, e1]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      energyDeck: { ...player.energyDeck, cardIds: [e1.instanceId] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    const placement = placeEnergyFromDeckToZoneByCardEffect(game, P1, 1, OrientationState.WAITING, {
      kind: 'CARD_EFFECT',
      playerId: P2,
      sourceCardId: 'opponent-source',
      abilityId: 'opponent',
    })!;
    game = enqueueTriggeredCardEffects(placement.gameState, [
      TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT,
    ]);
    expect(
      game.pendingAbilities.filter(
        (ability) =>
          ability.abilityId === SP_BP7_005_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_BLADE_ABILITY_ID
      )
    ).toHaveLength(0);
  });
  it('keeps optional activation for equivalent energy, supports skip, and opens concrete selection only for mixed marker state', () => {
    const kinako = makeMember('PL!SP-bp7-006-SEC', 'kinako'),
      target = makeMember('T', 'target');
    const e1 = energy('k-e1'),
      e2 = energy('k-e2');
    let game = registerCards(createGameState('k', P1, 'P1', P2, 'P2'), [kinako, target, e1, e2]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: [target.instanceId] },
      energyZone: addCardToStatefulZone(
        addCardToStatefulZone(p.energyZone, e1.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        e2.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, kinako.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = start(
      game,
      pending(
        SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
        kinako.instanceId,
        TriggerCondition.ON_ENTER_STAGE
      )
    );
    expect(game.activeEffect?.selectableOptions).toEqual([{ id: 'activate', label: '发动' }]);
    expect(game.activeEffect?.confirmSelectionLabel).toBe('发动');
    expect(game.activeEffect?.skipSelectionLabel).toBe('不发动');
    const skipped = command(game);
    expect(skipped.players[0].energyZone.cardIds).toHaveLength(2);
    const mixed = start(
      {
        ...game,
        activeEffect: null,
        pendingAbilities: [],
        energyActivePhaseSkips: [
          { playerId: P1, energyCardId: e2.instanceId, sourceCardId: 's', abilityId: 'a' },
        ],
      },
      pending(
        SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
        kinako.instanceId,
        TriggerCondition.ON_ENTER_STAGE,
        'mixed'
      )
    );
    expect(mixed.activeEffect?.selectableCardIds).toEqual([e1.instanceId, e2.instanceId]);
    expect(mixed.activeEffect?.selectionLabel).toBe('选择要放回能量卡组的能量');
    expect(mixed.activeEffect?.confirmSelectionLabel).toBe('支付费用');
    const allMarked = start(
      {
        ...game,
        activeEffect: null,
        pendingAbilities: [],
        energyActivePhaseSkips: [
          { playerId: P1, energyCardId: e1.instanceId, sourceCardId: 's', abilityId: 'a' },
          { playerId: P1, energyCardId: e2.instanceId, sourceCardId: 's', abilityId: 'a' },
        ],
      },
      pending(
        SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
        kinako.instanceId,
        TriggerCondition.ON_ENTER_STAGE,
        'all-marked'
      )
    );
    expect(allMarked.activeEffect?.selectableCardIds).toEqual([e1.instanceId, e2.instanceId]);
    expect(allMarked.activeEffect?.selectionLabel).toBe('选择要放回能量卡组的能量');
  });
  it('consumes Kinako pending without a window when energy or a legal Liella target is missing', () => {
    const kinako = makeMember('PL!SP-bp7-006-SEC', 'missing-kinako');
    const target = makeMember('MISSING-TARGET', 'missing-target-card');
    const e1 = energy('missing-energy-card');
    let noEnergy = registerCards(createGameState('no-energy', P1, 'P1', P2, 'P2'), [
      kinako,
      target,
    ]);
    noEnergy = updatePlayer(noEnergy, P1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [target.instanceId] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kinako.instanceId),
    }));
    noEnergy = start(
      noEnergy,
      pending(
        SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
        kinako.instanceId,
        TriggerCondition.ON_ENTER_STAGE,
        'no-energy'
      )
    );
    expect(noEnergy.activeEffect).toBeNull();
    let noTarget = registerCards(createGameState('no-target', P1, 'P1', P2, 'P2'), [kinako, e1]);
    noTarget = updatePlayer(noTarget, P1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, e1.instanceId),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kinako.instanceId),
    }));
    noTarget = start(
      noTarget,
      pending(
        SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
        kinako.instanceId,
        TriggerCondition.ON_ENTER_STAGE,
        'no-target'
      )
    );
    expect(noTarget.activeEffect).toBeNull();
  });
  it('rejects illegal Kinako energy and waiting-room selections without paying or advancing', () => {
    const kinako = makeMember('PL!SP-bp7-006-SEC', 'illegal-kinako');
    const target = makeMember('LEGAL-TARGET', 'legal-target');
    const e1 = energy('illegal-e1'),
      e2 = energy('illegal-e2');
    let game = registerCards(createGameState('illegal-006', P1, 'P1', P2, 'P2'), [
      kinako,
      target,
      e1,
      e2,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [target.instanceId] },
      energyZone: addCardToStatefulZone(
        addCardToStatefulZone(player.energyZone, e1.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        e2.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kinako.instanceId),
    }));
    game = {
      ...game,
      energyActivePhaseSkips: [
        {
          playerId: P1,
          energyCardId: e2.instanceId,
          sourceCardId: kinako.instanceId,
          abilityId: 'marker',
        },
      ],
    };
    game = start(
      game,
      pending(
        SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
        kinako.instanceId,
        TriggerCondition.ON_ENTER_STAGE,
        'illegal-006'
      )
    );
    const invalidEnergy = tryCommand(game, 'missing-energy');
    expect(invalidEnergy.success).toBe(false);
    expect(invalidEnergy.gameState.players[0].energyZone.cardIds).toHaveLength(2);
    game = command(game, undefined, e1.instanceId);
    const invalidTarget = tryCommand(game, 'missing-target');
    expect(invalidTarget.success).toBe(false);
    expect(invalidTarget.gameState.players[0].hand.cardIds).not.toContain('missing-target');
  });
  it('does not pay Kinako cost when the source leaves after the window opens', () => {
    const kinako = makeMember('PL!SP-bp7-006-SEC', 'stale-window-kinako');
    const target = makeMember('STALE-TARGET', 'stale-target');
    const e1 = energy('stale-window-energy');
    let game = registerCards(createGameState('stale-window', P1, 'P1', P2, 'P2'), [
      kinako,
      target,
      e1,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [target.instanceId] },
      energyZone: addCardToStatefulZone(player.energyZone, e1.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kinako.instanceId),
    }));
    game = start(
      game,
      pending(
        SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
        kinako.instanceId,
        TriggerCondition.ON_ENTER_STAGE,
        'stale-window'
      )
    );
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    game = command(game, 'activate');
    expect(game.players[0].energyZone.cardIds).toEqual([e1.instanceId]);
  });
  it('pays Kinako cost through one event, recovers a Liella member, and rejects stale source before payment', () => {
    const kinako = makeMember('PL!SP-bp7-006-SEC', 'kinako2'),
      target = makeMember('T2', 'target2');
    const e1 = energy('k2-e1');
    let game = registerCards(createGameState('k2', P1, 'P1', P2, 'P2'), [kinako, target, e1]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: [target.instanceId] },
      energyZone: addCardToStatefulZone(p.energyZone, e1.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, kinako.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = start(
      game,
      pending(
        SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
        kinako.instanceId,
        TriggerCondition.ON_ENTER_STAGE
      )
    );
    game = command(game, 'activate');
    expect(game.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    game = command(game, undefined, target.instanceId);
    expect(game.players[0].hand.cardIds).toContain(target.instanceId);
    expect(
      game.eventLog.filter((x) => x.event.eventType === TriggerCondition.ON_ENERGY_MOVED_TO_DECK)
    ).toHaveLength(1);
    let stale = start(
      updatePlayer(game, P1, (p) => ({
        ...p,
        energyZone: addCardToStatefulZone(p.energyZone, e1.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        memberSlots: {
          ...p.memberSlots,
          slots: { ...p.memberSlots.slots, [SlotPosition.CENTER]: null },
        },
      })),
      pending(
        SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
        kinako.instanceId,
        TriggerCondition.ON_ENTER_STAGE,
        'stale'
      )
    );
    expect(stale.activeEffect).toBeNull();
  });
  it('triggers Ren once through the complete Kinako return workflow', () => {
    const kinako = makeMember('PL!SP-bp7-006-SEC', 'link-kinako');
    const ren = makeMember('PL!SP-bp7-005-SEC', 'link-ren');
    const target = makeMember('LINK-TARGET', 'link-target');
    const e1 = energy('link-energy');
    let game = registerCards(createGameState('link-006-005', P1, 'P1', P2, 'P2'), [
      kinako,
      ren,
      target,
      e1,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [target.instanceId] },
      energyZone: addCardToStatefulZone(player.energyZone, e1.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kinako.instanceId),
        SlotPosition.LEFT,
        ren.instanceId
      ),
    }));
    game = start(
      game,
      pending(
        SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
        kinako.instanceId,
        TriggerCondition.ON_ENTER_STAGE,
        'link-006'
      )
    );
    game = command(game, 'activate');
    game = command(game, undefined, target.instanceId);
    expect(
      game.actionHistory.filter(
        (action) =>
          action.payload.abilityId ===
            SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(1);
    expect(game.players[0].energyZone.cardIds).toEqual([e1.instanceId]);
  });

  it('scores for this-turn energy-zone return only and ignores an older-turn event', () => {
    const kinako = makeMember('PL!SP-bp7-006-SEC', 'score-kinako');
    const e1 = energy('score-energy');
    let game = registerCards(createGameState('score', P1, 'P1', P2, 'P2'), [kinako, e1]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, e1.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kinako.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = moveEnergyZoneCardsToEnergyDeckByCardEffect(game, P1, [e1.instanceId], {
      kind: 'CARD_EFFECT',
      playerId: P1,
      sourceCardId: 'source',
      abilityId: 'return',
    })!.gameState;
    game = start(
      game,
      pending(
        SP_BP7_006_LIVE_SUCCESS_ENERGY_RETURNED_SCORE_ABILITY_ID,
        kinako.instanceId,
        TriggerCondition.ON_LIVE_SUCCESS,
        'score-current'
      )
    );
    expect(game.activeEffect?.effectText).toContain('本回合发生过自己的能量从能量区返回能量卡组');
    expect(game.activeEffect?.effectText).toContain('条件满足，实际[スコア]+1');
    expect(game.liveResolution.liveModifiers.some((x) => x.kind === 'SCORE')).toBe(false);
    game = command(game);
    expect(game.liveResolution.liveModifiers.some((x) => x.kind === 'SCORE')).toBe(true);
    const nextTurn = { ...game, turnCount: game.turnCount + 1, activeEffect: null };
    let resolved = start(
      nextTurn,
      pending(
        SP_BP7_006_LIVE_SUCCESS_ENERGY_RETURNED_SCORE_ABILITY_ID,
        kinako.instanceId,
        TriggerCondition.ON_LIVE_SUCCESS,
        'score-old'
      )
    );
    expect(resolved.activeEffect?.effectText).toContain('条件未满足，实际不增加分数');
    resolved = command(resolved);
    const payload = resolved.actionHistory
      .filter((x) => x.payload.pendingAbilityId === 'score-old')
      .at(-1)?.payload;
    expect(payload).toMatchObject({ conditionMet: false, scoreBonus: 0 });
  });
  it('shows Kinako dynamic confirm-only when manually selected from a LIVE success queue', () => {
    const kinako = makeMember('PL!SP-bp7-006-SEC', 'manual-score-kinako');
    const mei = makeMember('PL!SP-bp7-007-SEC', 'manual-score-mei');
    const e1 = energy('manual-score-energy');
    let game = registerCards(createGameState('manual-score', P1, 'P1', P2, 'P2'), [
      kinako,
      mei,
      e1,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, e1.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kinako.instanceId),
        SlotPosition.LEFT,
        mei.instanceId
      ),
    }));
    game = moveEnergyZoneCardsToEnergyDeckByCardEffect(game, P1, [e1.instanceId], {
      kind: 'CARD_EFFECT',
      playerId: P1,
      sourceCardId: 'return',
      abilityId: 'return',
    })!.gameState;
    game = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(
          SP_BP7_006_LIVE_SUCCESS_ENERGY_RETURNED_SCORE_ABILITY_ID,
          kinako.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS,
          'manual-score-006'
        ),
        pending(
          SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
          mei.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS,
          'manual-score-007'
        ),
      ],
    }).gameState;
    game = command(game, undefined, kinako.instanceId);
    expect(game.activeEffect?.effectText).toContain('条件满足，实际[スコア]+1');
    expect(game.liveResolution.liveModifiers.some((modifier) => modifier.kind === 'SCORE')).toBe(
      false
    );
    game = command(game);
    expect(game.liveResolution.liveModifiers.some((modifier) => modifier.kind === 'SCORE')).toBe(
      true
    );
  });
  it('resolves Kinako score automatically in ordered resolution', () => {
    const kinako = makeMember('PL!SP-bp7-006-SEC', 'ordered-score-kinako');
    const mei = makeMember('PL!SP-bp7-007-SEC', 'ordered-score-mei');
    const e1 = energy('ordered-score-energy');
    let game = registerCards(createGameState('ordered-score', P1, 'P1', P2, 'P2'), [
      kinako,
      mei,
      e1,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, e1.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kinako.instanceId),
        SlotPosition.LEFT,
        mei.instanceId
      ),
    }));
    game = moveEnergyZoneCardsToEnergyDeckByCardEffect(game, P1, [e1.instanceId], {
      kind: 'CARD_EFFECT',
      playerId: P1,
      sourceCardId: 'return',
      abilityId: 'return',
    })!.gameState;
    game = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(
          SP_BP7_006_LIVE_SUCCESS_ENERGY_RETURNED_SCORE_ABILITY_ID,
          kinako.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS,
          'ordered-score-006'
        ),
        pending(
          SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
          mei.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS,
          'ordered-score-007'
        ),
      ],
    }).gameState;
    game = commandResolveInOrder(game);
    expect(game.activeEffect).toBeNull();
    expect(game.liveResolution.liveModifiers.some((modifier) => modifier.kind === 'SCORE')).toBe(
      true
    );
  });
  it('places two marked energy in one event and activates up to five waiting energy even when marked', () => {
    const mei = makeMember('PL!SP-bp7-007-SEC', 'mei');
    const kinako = makeMember('PL!SP-bp7-006-SEC', 'mei-chain-kinako');
    const recoveryTarget = makeMember('PL!SP-bp7-005-SEC', 'mei-chain-target');
    const cards = Array.from({ length: 7 }, (_, i) => energy(`m-e${i}`));
    let game = registerCards(createGameState('m', P1, 'P1', P2, 'P2'), [
      mei,
      kinako,
      recoveryTarget,
      ...cards,
    ]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      energyDeck: { ...p.energyDeck, cardIds: cards.slice(0, 2).map((x) => x.instanceId) },
      waitingRoom: { ...p.waitingRoom, cardIds: [recoveryTarget.instanceId] },
      memberSlots: placeCardInSlot(
        placeCardInSlot(p.memberSlots, SlotPosition.CENTER, mei.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.LEFT,
        kinako.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    game = start(
      game,
      pending(
        SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
        mei.instanceId,
        TriggerCondition.ON_LIVE_SUCCESS
      )
    );
    expect(game.activeEffect?.stepText).toBe('确认后结算此效果。');
    expect(game.players[0].energyZone.cardIds).toHaveLength(0);
    game = command(game);
    expect(game.players[0].energyZone.cardIds).toHaveLength(2);
    expect(game.energyActivePhaseSkips).toHaveLength(2);
    expect(
      game.eventLog.filter(
        (x) => x.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )
    ).toHaveLength(1);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      energyZone: cards.slice(2, 6).reduce(
        (z, c) =>
          addCardToStatefulZone(z, c.instanceId, {
            orientation: OrientationState.WAITING,
            face: FaceState.FACE_UP,
          }),
        p.energyZone
      ),
    }));
    game = start(
      game,
      pending(
        SP_BP7_007_LIVE_SUCCESS_MORE_ENERGY_ACTIVATE_FIVE_ABILITY_ID,
        mei.instanceId,
        TriggerCondition.ON_LIVE_SUCCESS,
        'activate'
      )
    );
    expect(game.activeEffect?.selectionLabel).toBe('选择要变为活跃的能量');
    expect(game.activeEffect?.confirmSelectionLabel).toBe('变为活跃');
    expect(game.activeEffect?.canSkipSelection).toBe(false);
    const selected = game.activeEffect!.selectableCardIds!.slice(0, 5);
    game = command(game, undefined, undefined, selected);
    expect(
      game.players[0].energyZone.cardIds.filter(
        (id) =>
          game.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
      )
    ).toHaveLength(5);
    expect(
      selected.every(
        (id) =>
          game.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
      )
    ).toBe(true);
    game = start(
      game,
      pending(
        SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
        kinako.instanceId,
        TriggerCondition.ON_ENTER_STAGE,
        'mei-chain-kinako-return'
      )
    );
    expect(game.energyActivePhaseSkips).toHaveLength(2);
    expect(game.activeEffect?.selectableCardIds).toEqual(
      game.players[0].energyZone.cardIds
    );
    expect(game.activeEffect?.selectionLabel).toBe('选择要放回能量卡组的能量');
    expect(
      game.players[0].energyZone.cardStates.get(game.players[0].energyZone.cardIds[5]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(game.energyActivePhaseSkips).toHaveLength(2);
  });
  it('marks only the energy actually placed when Mei energy deck has fewer than two cards', () => {
    const mei = makeMember('PL!SP-bp7-007-SEC', 'mei-short-deck');
    const e1 = energy('mei-short-energy');
    let game = registerCards(createGameState('mei-short', P1, 'P1', P2, 'P2'), [mei, e1]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      energyDeck: { ...player.energyDeck, cardIds: [e1.instanceId] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, mei.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = start(
      game,
      pending(
        SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
        mei.instanceId,
        TriggerCondition.ON_LIVE_SUCCESS,
        'short-place'
      )
    );
    expect(game.players[0].energyZone.cardIds).toHaveLength(0);
    game = command(game);
    expect(game.players[0].energyZone.cardIds).toEqual([e1.instanceId]);
    expect(game.energyActivePhaseSkips?.map((skip) => skip.energyCardId)).toEqual([e1.instanceId]);
  });
  it('resolves two Mei placement pending abilities in ordered mode without confirm-only windows', () => {
    const first = makeMember('PL!SP-bp7-007-SEC', 'ordered-mei-1');
    const second = makeMember('PL!SP-bp7-007-SEC', 'ordered-mei-2');
    const cards = Array.from({ length: 4 }, (_, index) => energy(`ordered-energy-${index}`));
    let game = registerCards(createGameState('ordered-place', P1, 'P1', P2, 'P2'), [
      first,
      second,
      ...cards,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      energyDeck: { ...player.energyDeck, cardIds: cards.map((card) => card.instanceId) },
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.RIGHT,
        second.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    game = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(
          SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
          first.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS,
          'ordered-first'
        ),
        pending(
          SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
          second.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS,
          'ordered-second'
        ),
      ],
    }).gameState;
    expect(game.activeEffect?.canResolveInOrder).toBe(true);
    game = commandResolveInOrder(game);
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].energyZone.cardIds).toHaveLength(4);
  });
  it('shows confirm-only before manually selected Mei placement pending resolves', () => {
    const first = makeMember('PL!SP-bp7-007-SEC', 'manual-mei-1');
    const second = makeMember('PL!SP-bp7-007-SEC', 'manual-mei-2');
    const cards = Array.from({ length: 4 }, (_, index) => energy(`manual-energy-${index}`));
    let game = registerCards(createGameState('manual-place', P1, 'P1', P2, 'P2'), [
      first,
      second,
      ...cards,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      energyDeck: { ...player.energyDeck, cardIds: cards.map((card) => card.instanceId) },
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
        SlotPosition.RIGHT,
        second.instanceId
      ),
    }));
    game = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(
          SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
          first.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS,
          'manual-first'
        ),
        pending(
          SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
          second.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS,
          'manual-second'
        ),
      ],
    }).gameState;
    game = command(game, undefined, first.instanceId);
    expect(game.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(game.players[0].energyZone.cardIds).toHaveLength(0);
    game = command(game);
    expect(game.players[0].energyZone.cardIds).toHaveLength(2);
  });
  it('shows dynamic confirmation and activates none when Mei has no more energy than the opponent', () => {
    const scenario = setupMeiActivationScenario({ waitingCount: 3, opponentEnergyCount: 3 });
    let game = start(
      scenario.game,
      pending(
        SP_BP7_007_LIVE_SUCCESS_MORE_ENERGY_ACTIVATE_FIVE_ABILITY_ID,
        scenario.mei.instanceId,
        TriggerCondition.ON_LIVE_SUCCESS,
        'condition-false'
      )
    );
    expect(game.activeEffect?.effectText).toContain('当前自己能量3张，对方能量3张');
    expect(game.activeEffect?.effectText).toContain('条件未满足，实际将0张能量变为活跃状态');
    game = command(game);
    expect(
      game.players[0].energyZone.cardIds.filter(
        (id) =>
          game.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
      )
    ).toHaveLength(0);
  });
  it('automatically activates all fewer-than-five waiting energy after confirmation', () => {
    const scenario = setupMeiActivationScenario({ waitingCount: 4 });
    let game = start(
      scenario.game,
      pending(
        SP_BP7_007_LIVE_SUCCESS_MORE_ENERGY_ACTIVATE_FIVE_ABILITY_ID,
        scenario.mei.instanceId,
        TriggerCondition.ON_LIVE_SUCCESS,
        'activate-four'
      )
    );
    expect(game.activeEffect?.effectText).toContain('条件满足，实际将4张能量变为活跃状态');
    game = command(game);
    expect(
      game.players[0].energyZone.cardIds.filter(
        (id) =>
          game.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
      )
    ).toHaveLength(4);
  });
  it('automatically activates five when more-than-five candidates are equivalent', () => {
    const scenario = setupMeiActivationScenario({ waitingCount: 6 });
    let game = start(
      scenario.game,
      pending(
        SP_BP7_007_LIVE_SUCCESS_MORE_ENERGY_ACTIVATE_FIVE_ABILITY_ID,
        scenario.mei.instanceId,
        TriggerCondition.ON_LIVE_SUCCESS,
        'activate-five-equivalent'
      )
    );
    expect(game.activeEffect?.selectableCardIds).toBeUndefined();
    expect(game.activeEffect?.effectText).toContain('条件满足，实际将5张能量变为活跃状态');
    game = command(game);
    expect(
      game.players[0].energyZone.cardIds.filter(
        (id) =>
          game.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
      )
    ).toHaveLength(5);
  });
  it('keeps Mei live-start cost optional and emits one batch event for two energy', () => {
    const mei = makeMember('PL!SP-bp7-007-SEC', 'mei2');
    const e1 = energy('ml-e1'),
      e2 = energy('ml-e2');
    let game = registerCards(createGameState('ml', P1, 'P1', P2, 'P2'), [mei, e1, e2]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      energyZone: addCardToStatefulZone(
        addCardToStatefulZone(p.energyZone, e1.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        e2.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, mei.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = start(
      game,
      pending(
        SP_BP7_007_LIVE_START_RETURN_TWO_GAIN_THREE_BLADE_ABILITY_ID,
        mei.instanceId,
        TriggerCondition.ON_LIVE_START
      )
    );
    expect(game.activeEffect?.selectableOptions).toEqual([{ id: 'activate', label: '发动' }]);
    expect(game.activeEffect?.confirmSelectionLabel).toBe('发动');
    game = command(game, 'activate');
    expect(
      game.eventLog.filter((x) => x.event.eventType === TriggerCondition.ON_ENERGY_MOVED_TO_DECK)
    ).toHaveLength(1);
    expect(
      game.liveResolution.liveModifiers.some((x) => x.kind === 'BLADE' && x.countDelta === 3)
    ).toBe(true);
  });
  it('handles insufficient and mixed-marker Mei LIVE start energy costs', () => {
    const mei = makeMember('PL!SP-bp7-007-SEC', 'mixed-live-start-mei');
    const cards = [energy('mixed-live-e1'), energy('mixed-live-e2'), energy('mixed-live-e3')];
    let game = registerCards(createGameState('mixed-live-start', P1, 'P1', P2, 'P2'), [
      mei,
      ...cards,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      energyZone: cards.reduce(
        (zone, card) => addCardToStatefulZone(zone, card.instanceId),
        player.energyZone
      ),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, mei.instanceId),
    }));
    game = {
      ...game,
      energyActivePhaseSkips: [
        {
          playerId: P1,
          energyCardId: cards[2].instanceId,
          sourceCardId: mei.instanceId,
          abilityId: 'marker',
        },
      ],
    };
    game = start(
      game,
      pending(
        SP_BP7_007_LIVE_START_RETURN_TWO_GAIN_THREE_BLADE_ABILITY_ID,
        mei.instanceId,
        TriggerCondition.ON_LIVE_START,
        'mixed-live-start'
      )
    );
    expect(game.activeEffect?.selectionLabel).toBe('选择要放回能量卡组的能量');
    expect(game.activeEffect?.confirmSelectionLabel).toBe('支付费用');
    game = command(game, undefined, undefined, [cards[0].instanceId, cards[2].instanceId]);
    expect(game.players[0].energyDeck.cardIds).toEqual([cards[0].instanceId, cards[2].instanceId]);
    expect(
      game.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_MOVED_TO_DECK
      )
    ).toHaveLength(1);
    let insufficient = updatePlayer(game, P1, (player) => ({
      ...player,
      energyZone: { ...player.energyZone, cardIds: [cards[1].instanceId] },
    }));
    insufficient = start(
      { ...insufficient, activeEffect: null, pendingAbilities: [] },
      pending(
        SP_BP7_007_LIVE_START_RETURN_TWO_GAIN_THREE_BLADE_ABILITY_ID,
        mei.instanceId,
        TriggerCondition.ON_LIVE_START,
        'insufficient-live-start'
      )
    );
    expect(insufficient.activeEffect).toBeNull();
  });
});
