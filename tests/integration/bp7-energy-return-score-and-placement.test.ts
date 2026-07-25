import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_BP7_023_LIVE_START_RETURN_ONE_ENERGY_DIFFERENCE_SCORE_ABILITY_ID,
  SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP7_027_LIVE_START_RETURN_ONE_ENERGY_LEAD_SCORE_ABILITY_ID,
  SP_BP7_027_LIVE_SUCCESS_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const SOURCE_ID = 'source-live';
const S_CARD_CODE = 'PL!S-bp7-023-L';
const SP_CARD_CODE = 'PL!SP-bp7-027-L';
const S_EFFECT_TEXT =
  '【LIVE开始时】自己的舞台上存在大于等于2名『Aqours』的成员的场合，可以将自己的1张能量放置入能量卡组。如此做时，对方的能量比自己多1张的场合，此卡的[スコア]+1。多大于等于2张的场合，改为[スコア]+2。';
const SP_START_EFFECT_TEXT =
  '【LIVE开始时】可以将存在于能量卡区的1张能量放置入能量卡组：自己的能量比对方多的场合，此卡的[スコア]+1。';
const SP_SUCCESS_EFFECT_TEXT =
  '【LIVE成功时】从自己的能量卡组，将1张能量卡以待机状态放置于能量区。那张能量卡，在下个回合的活跃阶段不会变为活跃状态。';
const SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

interface StartSetupOptions {
  readonly cardCode?: string;
  readonly abilityId?: string;
  readonly ownEnergyOrientations?: readonly OrientationState[];
  readonly opponentEnergyCount?: number;
  readonly aqoursStageCount?: number;
  readonly aqoursBelowCount?: number;
  readonly markedEnergyIndexes?: readonly number[];
  readonly sourceInLiveZone?: boolean;
  readonly sourceOwnerId?: string;
}

function liveData(cardCode: string, name: string, score: number): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function memberData(cardCode: string, name: string, groupNames: readonly string[]): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function energy(cardId: string, ownerId: string) {
  return createCardInstance(
    { cardCode: cardId, name: cardId, cardType: CardType.ENERGY },
    ownerId,
    cardId
  );
}

function pending(
  abilityId: string,
  timingId: TriggerCondition,
  id = `${abilityId}:pending`
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId: SOURCE_ID,
    controllerId: P1,
    mandatory: true,
    timingId,
    eventIds: [],
  };
}

function setupLiveStart(options: StartSetupOptions = {}): GameState {
  const cardCode = options.cardCode ?? S_CARD_CODE;
  const abilityId =
    options.abilityId ??
    (cardCode === S_CARD_CODE
      ? S_BP7_023_LIVE_START_RETURN_ONE_ENERGY_DIFFERENCE_SCORE_ABILITY_ID
      : SP_BP7_027_LIVE_START_RETURN_ONE_ENERGY_LEAD_SCORE_ABILITY_ID);
  const source = createCardInstance(
    liveData(
      cardCode,
      cardCode === S_CARD_CODE ? '夜空是否全然知晓？' : 'What a Wonderful Dream!!',
      cardCode === S_CARD_CODE ? 4 : 5
    ),
    options.sourceOwnerId ?? P1,
    SOURCE_ID
  );
  const ownEnergies = (options.ownEnergyOrientations ?? [OrientationState.ACTIVE]).map(
    (orientation, index) => ({ orientation, card: energy(`own-energy-${index}`, P1) })
  );
  const opponentEnergies = Array.from({ length: options.opponentEnergyCount ?? 0 }, (_, index) =>
    energy(`opponent-energy-${index}`, P2)
  );
  const stageMembers = Array.from({ length: options.aqoursStageCount ?? 0 }, (_, index) =>
    createCardInstance(
      memberData(`AQOURS-${index}`, `Aqours ${index}`, ['Aqours']),
      P1,
      `aqours-stage-${index}`
    )
  );
  const belowMembers = Array.from({ length: options.aqoursBelowCount ?? 0 }, (_, index) =>
    createCardInstance(
      memberData(`AQOURS-BELOW-${index}`, `Aqours Below ${index}`, ['Aqours']),
      P1,
      `aqours-below-${index}`
    )
  );
  let game = registerCards(createGameState('bp7-energy-start', P1, 'P1', P2, 'P2'), [
    source,
    ...ownEnergies.map(({ card }) => card),
    ...opponentEnergies,
    ...stageMembers,
    ...belowMembers,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone:
      options.sourceInLiveZone === false
        ? player.liveZone
        : { ...player.liveZone, cardIds: [source.instanceId] },
    energyZone: ownEnergies.reduce(
      (zone, { card, orientation }) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    memberSlots: {
      ...stageMembers.reduce(
        (slots, member, index) =>
          placeCardInSlot(slots, SLOTS[index]!, member.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        player.memberSlots
      ),
      memberBelow: {
        ...player.memberSlots.memberBelow,
        [SlotPosition.LEFT]: belowMembers.map(({ instanceId }) => instanceId),
      },
    },
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    energyZone: opponentEnergies.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
  }));
  return {
    ...game,
    pendingAbilities: [pending(abilityId, TriggerCondition.ON_LIVE_START)],
    energyActivePhaseSkips: (options.markedEnergyIndexes ?? []).map((index) => ({
      playerId: P1,
      energyCardId: ownEnergies[index]!.card.instanceId,
      sourceCardId: 'marker-source',
      abilityId: 'marker-ability',
    })),
  };
}

function setupLiveSuccess(
  energyDeckCount: number,
  pendingIds: readonly string[] = ['sp-success-pending']
): GameState {
  const source = createCardInstance(
    liveData(SP_CARD_CODE, 'What a Wonderful Dream!!', 5),
    P1,
    SOURCE_ID
  );
  const energyDeck = Array.from({ length: energyDeckCount }, (_, index) =>
    energy(`deck-energy-${index}`, P1)
  );
  let game = registerCards(createGameState('bp7-energy-success', P1, 'P1', P2, 'P2'), [
    source,
    ...energyDeck,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: { ...player.liveZone, cardIds: [source.instanceId] },
    energyDeck: { ...player.energyDeck, cardIds: energyDeck.map(({ instanceId }) => instanceId) },
  }));
  return {
    ...game,
    pendingAbilities: pendingIds.map((id) =>
      pending(
        SP_BP7_027_LIVE_SUCCESS_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
        TriggerCondition.ON_LIVE_SUCCESS,
        id
      )
    ),
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirm(
  game: GameState,
  options: {
    readonly selectedOptionId?: string | null;
    readonly selectedCardIds?: readonly string[];
    readonly resolveInOrder?: boolean;
  } = {}
): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    null,
    null,
    options.resolveInOrder === true,
    options.selectedOptionId ?? null,
    options.selectedCardIds
  );
}

function scoreBonus(game: GameState, abilityId: string): number {
  return game.liveResolution.liveModifiers
    .filter(
      (modifier) =>
        modifier.kind === 'SCORE' &&
        modifier.sourceCardId === SOURCE_ID &&
        modifier.abilityId === abilityId
    )
    .reduce((sum, modifier) => sum + (modifier.kind === 'SCORE' ? modifier.countDelta : 0), 0);
}

function events(game: GameState, trigger: TriggerCondition) {
  return game.eventLog.filter(({ event }) => event.eventType === trigger);
}

describe('bp7 energy batch base-card definitions', () => {
  it('registers base-family LIVE-card definitions with token-compatible public text', () => {
    expect(getCardAbilityDefinitionsForCardCode(S_CARD_CODE)).toEqual([
      expect.objectContaining({
        abilityId: S_BP7_023_LIVE_START_RETURN_ONE_ENERGY_DIFFERENCE_SCORE_ABILITY_ID,
        baseCardCodes: ['PL!S-bp7-023'],
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.LIVE_CARD,
        triggerCondition: TriggerCondition.ON_LIVE_START,
        queued: true,
        implemented: true,
        effectText: S_EFFECT_TEXT,
      }),
    ]);
    expect(getCardAbilityDefinitionsForCardCode(SP_CARD_CODE)).toEqual([
      expect.objectContaining({
        abilityId: SP_BP7_027_LIVE_START_RETURN_ONE_ENERGY_LEAD_SCORE_ABILITY_ID,
        effectText: SP_START_EFFECT_TEXT,
      }),
      expect.objectContaining({
        abilityId: SP_BP7_027_LIVE_SUCCESS_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
        effectText: SP_SUCCESS_EFFECT_TEXT,
      }),
    ]);
    expect(getCardAbilityDefinitionsForCardCode('PL!S-bp7-023-P')).toHaveLength(1);
    expect(getCardAbilityDefinitionsForCardCode('PL!S-bp7-023-SECL')).toHaveLength(1);
    expect(getCardAbilityDefinitionsForCardCode('PL!SP-bp7-027-P')).toHaveLength(2);
    expect(getCardAbilityDefinitionsForCardCode('PL!S-bp7-024-L')).toEqual([]);
    expect(getCardAbilityDefinitionsForCardCode('PL!SP-bp7-028-L')).not.toContainEqual(
      expect.objectContaining({
        abilityId: SP_BP7_027_LIVE_START_RETURN_ONE_ENERGY_LEAD_SCORE_ABILITY_ID,
      })
    );
  });
});

describe('PL!S-bp7-023-L 分数4「夜空是否全然知晓？」', () => {
  it('counts only top-level Aqours for the gate and uses conditional confirm-only when unmet', () => {
    const game = start(setupLiveStart({ aqoursStageCount: 1, aqoursBelowCount: 1 }));
    expect(game.activeEffect).toEqual(
      expect.objectContaining({
        abilityId: S_BP7_023_LIVE_START_RETURN_ONE_ENERGY_DIFFERENCE_SCORE_ABILITY_ID,
        stepText: '确认后结算此效果。',
        metadata: expect.objectContaining({ confirmOnlyPendingAbility: true }),
      })
    );
    expect(game.activeEffect?.effectText).toContain('当前自己舞台『Aqours』成员1名，未满足条件');
    const done = confirm(game);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].energyZone.cardIds).toEqual(['own-energy-0']);
    expect(events(done, TriggerCondition.ON_ENERGY_MOVED_TO_DECK)).toHaveLength(0);
  });

  it('opens the standard optional return window, supports decline, and uses entity-action copy', () => {
    const game = start(setupLiveStart({ aqoursStageCount: 2 }));
    expect(game.activeEffect).toEqual(
      expect.objectContaining({
        effectText: S_EFFECT_TEXT,
        stepId: 'LIVE_START_RETURN_ONE_ENERGY_COMPARE_SCORE',
        stepText: '可以将1张能量放回能量卡组并发动此效果。',
        selectableOptions: [{ id: 'activate', label: '发动' }],
        confirmSelectionLabel: '发动',
        skipSelectionLabel: '不发动',
      })
    );
    const done = confirm(game);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].energyZone.cardIds).toEqual(['own-energy-0']);
    expect(
      scoreBonus(done, S_BP7_023_LIVE_START_RETURN_ONE_ENERGY_DIFFERENCE_SCORE_ABILITY_ID)
    ).toBe(0);
  });

  it('uses confirm-only and consumes the pending when the gate passes but no energy can be returned', () => {
    const opened = start(setupLiveStart({ aqoursStageCount: 2, ownEnergyOrientations: [] }));
    expect(opened.activeEffect).toEqual(
      expect.objectContaining({
        abilityId: S_BP7_023_LIVE_START_RETURN_ONE_ENERGY_DIFFERENCE_SCORE_ABILITY_ID,
        stepText: '确认后结算此效果。',
        metadata: expect.objectContaining({ confirmOnlyPendingAbility: true }),
      })
    );
    expect(opened.activeEffect?.effectText).toContain(
      '当前自己舞台『Aqours』成员2名，满足条件；当前没有可以放回的能量，无法发动，实际[スコア]+0'
    );

    const done = confirm(opened);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(events(done, TriggerCondition.ON_ENERGY_MOVED_TO_DECK)).toHaveLength(0);
  });

  it('uses exact special-energy selection and rejects illegal, duplicate, and stale input', () => {
    const game = start(
      setupLiveStart({
        aqoursStageCount: 2,
        ownEnergyOrientations: [OrientationState.ACTIVE, OrientationState.WAITING],
        markedEnergyIndexes: [1],
      })
    );
    expect(game.activeEffect).toEqual(
      expect.objectContaining({
        selectableCardIds: ['own-energy-1', 'own-energy-0'],
        selectionLabel: '选择要放回能量卡组的能量',
        confirmSelectionLabel: '放回能量卡组',
        minSelectableCards: 1,
        maxSelectableCards: 1,
      })
    );
    expect(confirm(game, { selectedOptionId: 'forged' })).toBe(game);
    expect(confirm(game, { selectedCardIds: ['missing-energy'] })).toBe(game);
    expect(confirm(game, { selectedCardIds: ['own-energy-1', 'own-energy-1'] })).toBe(game);

    const stale = updatePlayer(game, P1, (player) => ({
      ...player,
      energyZone: removeCardFromStatefulZone(player.energyZone, 'own-energy-1'),
    }));
    expect(confirm(stale, { selectedCardIds: ['own-energy-1'] })).toBe(stale);
  });

  it.each([
    [1, 0],
    [2, 1],
    [3, 2],
  ] as const)(
    'compares after returning energy when opponent has %s and applies score bonus %s',
    (opponentEnergyCount, expectedBonus) => {
      const game = confirm(
        start(
          setupLiveStart({
            aqoursStageCount: 2,
            ownEnergyOrientations: [OrientationState.ACTIVE, OrientationState.WAITING],
            opponentEnergyCount,
          })
        ),
        { selectedOptionId: 'activate' }
      );
      expect(game.players[0].energyZone.cardIds).toEqual(['own-energy-0']);
      expect(game.players[0].energyDeck.cardIds).toEqual(['own-energy-1']);
      expect(
        scoreBonus(game, S_BP7_023_LIVE_START_RETURN_ONE_ENERGY_DIFFERENCE_SCORE_ABILITY_ID)
      ).toBe(expectedBonus);
      expect(game.liveResolution.playerScores.get(P1)).toBe(expectedBonus);
      expect(game.actionHistory.at(-1)?.payload).toEqual(
        expect.objectContaining({
          ownEnergyCount: 1,
          opponentEnergyCount,
          scoreBonus: expectedBonus,
          movedEnergyCardIds: ['own-energy-1'],
        })
      );
      expect(events(game, TriggerCondition.ON_ENERGY_MOVED_TO_DECK)).toHaveLength(1);
    }
  );

  it('publishes one exact return event and queues an existing observer exactly once', () => {
    const observer = createCardInstance(
      memberData('PL!SP-bp7-005-SEC', '葉月恋', ['Liella!']),
      P1,
      'energy-return-observer'
    );
    let prepared = registerCards(setupLiveStart({ aqoursStageCount: 2, opponentEnergyCount: 1 }), [
      observer,
    ]);
    prepared = updatePlayer(prepared, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, observer.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));

    const game = confirm(start(prepared), { selectedOptionId: 'activate' });
    const returnEvents = events(game, TriggerCondition.ON_ENERGY_MOVED_TO_DECK);
    expect(returnEvents).toHaveLength(1);
    expect(returnEvents[0]?.event).toMatchObject({
      playerId: P1,
      movedEnergyCardIds: ['own-energy-0'],
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: SOURCE_ID,
        abilityId: S_BP7_023_LIVE_START_RETURN_ONE_ENERGY_DIFFERENCE_SCORE_ABILITY_ID,
      },
    });
    const observerTriggers = game.actionHistory.filter(
      (action) =>
        action.type === 'TRIGGER_ABILITY' &&
        action.payload.abilityId === SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID
    );
    expect(observerTriggers).toHaveLength(1);
    expect(observerTriggers[0]?.payload.pendingAbilityId).toContain(returnEvents[0]?.event.eventId);
    expect(new Set(observerTriggers.map((action) => action.payload.pendingAbilityId)).size).toBe(1);
  });

  it('replaces its score modifier when the same exact source resolves twice', () => {
    const first = confirm(
      start(
        setupLiveStart({
          aqoursStageCount: 2,
          ownEnergyOrientations: [
            OrientationState.ACTIVE,
            OrientationState.ACTIVE,
            OrientationState.ACTIVE,
          ],
          opponentEnergyCount: 3,
        })
      ),
      { selectedOptionId: 'activate' }
    );
    expect(
      scoreBonus(first, S_BP7_023_LIVE_START_RETURN_ONE_ENERGY_DIFFERENCE_SCORE_ABILITY_ID)
    ).toBe(1);

    const repeated = {
      ...first,
      pendingAbilities: [
        pending(
          S_BP7_023_LIVE_START_RETURN_ONE_ENERGY_DIFFERENCE_SCORE_ABILITY_ID,
          TriggerCondition.ON_LIVE_START,
          'repeat-b'
        ),
      ],
    };
    const done = confirm(start(repeated), { selectedOptionId: 'activate' });

    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(
      done.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.sourceCardId === SOURCE_ID &&
          modifier.abilityId === S_BP7_023_LIVE_START_RETURN_ONE_ENERGY_DIFFERENCE_SCORE_ABILITY_ID
      )
    ).toHaveLength(1);
    expect(
      scoreBonus(done, S_BP7_023_LIVE_START_RETURN_ONE_ENERGY_DIFFERENCE_SCORE_ABILITY_ID)
    ).toBe(2);
    expect(done.liveResolution.playerScores.get(P1)).toBe(2);
  });

  it('does not move energy when the source becomes stale before confirmation', () => {
    const opened = start(setupLiveStart({ aqoursStageCount: 2 }));
    const stale = updatePlayer(opened, P1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [] },
    }));
    const game = confirm(stale, { selectedOptionId: 'activate' });
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].energyZone.cardIds).toEqual(['own-energy-0']);
    expect(game.players[0].energyDeck.cardIds).toEqual([]);
    expect(events(game, TriggerCondition.ON_ENERGY_MOVED_TO_DECK)).toHaveLength(0);
  });
});

describe('PL!SP-bp7-027-L 分数5「What a Wonderful Dream!!」', () => {
  it('uses confirm-only and consumes the LIVE_START pending when no energy can be returned', () => {
    const opened = start(
      setupLiveStart({
        cardCode: SP_CARD_CODE,
        abilityId: SP_BP7_027_LIVE_START_RETURN_ONE_ENERGY_LEAD_SCORE_ABILITY_ID,
        ownEnergyOrientations: [],
      })
    );
    expect(opened.activeEffect).toEqual(
      expect.objectContaining({
        abilityId: SP_BP7_027_LIVE_START_RETURN_ONE_ENERGY_LEAD_SCORE_ABILITY_ID,
        effectText: expect.stringContaining(SP_START_EFFECT_TEXT),
        stepText: '确认后结算此效果。',
        metadata: expect.objectContaining({ confirmOnlyPendingAbility: true }),
      })
    );
    expect(opened.activeEffect?.effectText).toContain(
      '当前没有可以放回的能量，无法发动，实际[スコア]+0'
    );

    const done = confirm(opened);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(events(done, TriggerCondition.ON_ENERGY_MOVED_TO_DECK)).toHaveLength(0);
  });

  it.each([
    [3, 1, 1],
    [2, 2, 0],
  ] as const)(
    'compares post-return own/opponent energy %s/%s and applies score bonus %s',
    (ownBeforeReturn, opponentEnergyCount, expectedBonus) => {
      const game = confirm(
        start(
          setupLiveStart({
            cardCode: SP_CARD_CODE,
            abilityId: SP_BP7_027_LIVE_START_RETURN_ONE_ENERGY_LEAD_SCORE_ABILITY_ID,
            ownEnergyOrientations: Array.from(
              { length: ownBeforeReturn },
              () => OrientationState.ACTIVE
            ),
            opponentEnergyCount,
          })
        ),
        { selectedOptionId: 'activate' }
      );
      expect(game.players[0].energyZone.cardIds).toHaveLength(ownBeforeReturn - 1);
      expect(scoreBonus(game, SP_BP7_027_LIVE_START_RETURN_ONE_ENERGY_LEAD_SCORE_ABILITY_ID)).toBe(
        expectedBonus
      );
      expect(game.liveResolution.playerScores.get(P1)).toBe(expectedBonus);
    }
  );

  it('shows confirm-only for a single LIVE_SUCCESS pending and resolves one exact placement', () => {
    const opened = start(setupLiveSuccess(1));
    expect(opened.activeEffect).toEqual(
      expect.objectContaining({
        abilityId: SP_BP7_027_LIVE_SUCCESS_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
        effectText: SP_SUCCESS_EFFECT_TEXT,
        stepText: '确认后结算此效果。',
        metadata: expect.objectContaining({ confirmOnlyPendingAbility: true }),
      })
    );
    expect(opened.players[0].energyZone.cardIds).toEqual([]);

    const game = confirm(opened);
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].energyZone.cardIds).toEqual(['deck-energy-0']);
    expect(game.players[0].energyZone.cardStates.get('deck-energy-0')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(game.energyActivePhaseSkips).toEqual([
      {
        playerId: P1,
        energyCardId: 'deck-energy-0',
        sourceCardId: SOURCE_ID,
        abilityId: SP_BP7_027_LIVE_SUCCESS_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
      },
    ]);
    const placementEvents = events(game, TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT);
    expect(placementEvents).toHaveLength(1);
    expect(placementEvents[0]?.event).toMatchObject({
      placedEnergyCardIds: ['deck-energy-0'],
      orientation: OrientationState.WAITING,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: SOURCE_ID,
        abilityId: SP_BP7_027_LIVE_SUCCESS_PLACE_SKIPPED_WAITING_ENERGY_ABILITY_ID,
      },
    });
  });

  it('resolves safely with an empty energy deck and produces no event or marker', () => {
    const game = confirm(start(setupLiveSuccess(0)));
    expect(game.players[0].energyZone.cardIds).toEqual([]);
    expect(game.energyActivePhaseSkips).toEqual([]);
    expect(events(game, TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT)).toHaveLength(0);
  });

  it('uses confirm-only when manually selected and auto-resolves a same ordered batch', () => {
    const orderWindow = start(setupLiveSuccess(2, ['manual-a', 'manual-b']));
    expect(orderWindow.activeEffect?.selectableOptions).toEqual([
      expect.objectContaining({ id: 'manual-a' }),
      expect.objectContaining({ id: 'manual-b' }),
    ]);
    const manual = confirm(orderWindow, { selectedOptionId: 'manual-b' });
    expect(manual.activeEffect).toEqual(
      expect.objectContaining({
        id: 'manual-b',
        metadata: expect.objectContaining({ confirmOnlyPendingAbility: true }),
      })
    );
    expect(manual.players[0].energyZone.cardIds).toEqual([]);

    const orderedWindow = start(setupLiveSuccess(2, ['ordered-a', 'ordered-b']));
    const done = confirm(orderedWindow, { resolveInOrder: true });
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].energyZone.cardIds).toEqual(['deck-energy-0', 'deck-energy-1']);
    expect(events(done, TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT)).toHaveLength(2);
    expect(done.energyActivePhaseSkips).toHaveLength(2);
  });

  it('consumes the marker at the next own Active Phase and activates on the following one', () => {
    const placed = confirm(start(setupLiveSuccess(1)));
    const service = new GameService();
    const skippedActive = service.advancePhase({
      ...placed,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    });
    expect(skippedActive.success).toBe(true);
    expect(skippedActive.gameState.energyActivePhaseSkips).toEqual([]);
    expect(
      skippedActive.gameState.players[0].energyZone.cardStates.get('deck-energy-0')?.orientation
    ).toBe(OrientationState.WAITING);

    const followingActive = service.advancePhase({
      ...skippedActive.gameState,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    });
    expect(followingActive.success).toBe(true);
    expect(
      followingActive.gameState.players[0].energyZone.cardStates.get('deck-energy-0')?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('does not place energy after the exact source leaves the LIVE zone', () => {
    const opened = start(setupLiveSuccess(1));
    const stale = updatePlayer(opened, P1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [] },
    }));
    const game = confirm(stale);
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].energyDeck.cardIds).toEqual(['deck-energy-0']);
    expect(game.energyActivePhaseSkips).toEqual([]);
    expect(events(game, TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT)).toHaveLength(0);
  });
});
