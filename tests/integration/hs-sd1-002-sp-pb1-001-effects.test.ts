import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_SD1_002_LIVE_START_DISCARD_TWO_LOOK_TOP_MEMBER_HAND_GAIN_HEART_BLADE_ABILITY_ID,
  SP_PB1_001_LIVE_START_PAY_TWO_ENERGY_OR_DISCARD_TWO_ABILITY_ID,
  SP_PB1_001_LIVE_SUCCESS_PAY_SIX_ENERGY_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createHasunosoraMember(cardCode: string, name = cardCode, cost = 4): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createLiellaMember(cardCode: string, name = cardCode, cost = 4): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    unitName: 'Liella!',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createState(cards: readonly ReturnType<typeof createCardInstance>[]): GameState {
  return registerCards(createGameState('hs-sd1-002-sp-pb1-001', PLAYER1, 'P1', PLAYER2, 'P2'), cards);
}

function putCards(options: {
  readonly game: GameState;
  readonly hand?: readonly string[];
  readonly deck?: readonly string[];
  readonly energy?: readonly { readonly cardId: string; readonly orientation?: OrientationState }[];
  readonly stage?: readonly { readonly cardId: string; readonly slot: SlotPosition }[];
  readonly playerScore?: number;
}): GameState {
  return updatePlayer(
    {
      ...options.game,
      liveResolution: {
        ...options.game.liveResolution,
        performingPlayerId: PLAYER1,
        playerScores:
          options.playerScore === undefined
            ? options.game.liveResolution.playerScores
            : new Map([[PLAYER1, options.playerScore]]),
      },
    },
    PLAYER1,
    (player) => {
      let memberSlots = player.memberSlots;
      for (const stageMember of options.stage ?? []) {
        memberSlots = placeCardInSlot(memberSlots, stageMember.slot, stageMember.cardId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        });
      }
      return {
        ...player,
        hand: { ...player.hand, cardIds: [...(options.hand ?? [])] },
        mainDeck: { ...player.mainDeck, cardIds: [...(options.deck ?? [])] },
        energyZone: (options.energy ?? []).reduce(
          (zone, energy) =>
            addCardToStatefulZone(zone, energy.cardId, {
              orientation: energy.orientation ?? OrientationState.ACTIVE,
              face: FaceState.FACE_DOWN,
            }),
          { ...player.energyZone, cardIds: [], cardStates: new Map() }
        ),
        memberSlots,
      };
    }
  );
}

function pending(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition,
  suffix = 'pending'
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:${suffix}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`event-${suffix}`],
  };
}

function start(game: GameState, ability: PendingAbilityState): GameState {
  return resolvePendingCardEffects({ ...game, pendingAbilities: [ability] }).gameState;
}

function chooseOption(game: GameState, selectedOptionId: string): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    null,
    null,
    false,
    selectedOptionId
  );
}

function chooseCard(game: GameState, selectedCardId: string | null): GameState {
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, selectedCardId);
}

function chooseCards(game: GameState, selectedCardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    null,
    null,
    false,
    null,
    selectedCardIds
  );
}

function hasWaitingEvent(
  state: GameState,
  fromZone: ZoneType,
  cardIds: readonly string[]
): boolean {
  return state.eventLog.some(
    (entry) =>
      entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
      entry.event.fromZone === fromZone &&
      cardIds.every((cardId) => entry.event.cardInstanceIds?.includes(cardId) === true)
  );
}

function findHeartModifier(state: GameState, sourceCardId: string) {
  return state.liveResolution.liveModifiers.find(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.playerId === PLAYER1 &&
      modifier.sourceCardId === sourceCardId
  );
}

function findBladeModifier(state: GameState, sourceCardId: string) {
  return state.liveResolution.liveModifiers.find(
    (modifier) =>
      modifier.kind === 'BLADE' &&
      modifier.playerId === PLAYER1 &&
      modifier.sourceCardId === sourceCardId
  );
}

function createEnergyCards(count: number, prefix = 'energy'): ReturnType<typeof createCardInstance>[] {
  return Array.from({ length: count }, (_, index) =>
    createCardInstance(createLiellaMember(`PL!SP-test-${prefix}-${index}`), PLAYER1, `${prefix}-${index}`)
  );
}

describe('PL!HS-sd1-002 and PL!SP-pb1-001 effects', () => {
  describe('PL!HS-sd1-002-SD', () => {
    it('can skip discarding and consumes the pending effect', () => {
      const source = createCardInstance(
        createHasunosoraMember('PL!HS-sd1-002-SD', '村野さやか', 11),
        PLAYER1,
        'sayaka-source'
      );
      const hand = [
        createCardInstance(createLiellaMember('hand-a'), PLAYER1, 'hand-a'),
        createCardInstance(createLiellaMember('hand-b'), PLAYER1, 'hand-b'),
      ];
      const state = start(
        putCards({
          game: createState([source, ...hand]),
          hand: hand.map((card) => card.instanceId),
          stage: [{ cardId: source.instanceId, slot: SlotPosition.CENTER }],
        }),
        pending(
          HS_SD1_002_LIVE_START_DISCARD_TWO_LOOK_TOP_MEMBER_HAND_GAIN_HEART_BLADE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        )
      );

      const skipped = chooseCards(state, []);

      expect(skipped.activeEffect).toBeNull();
      expect(skipped.pendingAbilities).toEqual([]);
      expect(skipped.players[0]!.hand.cardIds).toEqual(hand.map((card) => card.instanceId));
      expect(skipped.liveResolution.liveModifiers).toEqual([]);
    });

    it('discards 2, takes a Hasunosora member from top 5, moves the rest to waiting, and grants blue Heart plus BLADE', () => {
      const source = createCardInstance(
        createHasunosoraMember('PL!HS-sd1-002-SD', '村野さやか', 11),
        PLAYER1,
        'sayaka-source'
      );
      const triggerSource = createCardInstance(
        createHasunosoraMember('PL!HS-pb1-003-R', '大沢瑠璃乃'),
        PLAYER1,
        'hand-waiting-trigger-source'
      );
      const hand = [
        createCardInstance(createLiellaMember('discard-a'), PLAYER1, 'discard-a'),
        createCardInstance(createLiellaMember('discard-b'), PLAYER1, 'discard-b'),
      ];
      const selected = createCardInstance(
        createHasunosoraMember('PL!HS-test-selected', '日野下花帆'),
        PLAYER1,
        'selected-hasun'
      );
      const rest = [
        createCardInstance(createLiellaMember('top-rest-a'), PLAYER1, 'top-rest-a'),
        createCardInstance(createLiellaMember('top-rest-b'), PLAYER1, 'top-rest-b'),
        createCardInstance(createLiellaMember('top-rest-c'), PLAYER1, 'top-rest-c'),
        createCardInstance(createLiellaMember('top-rest-d'), PLAYER1, 'top-rest-d'),
      ];
      const state = start(
        putCards({
          game: createState([source, triggerSource, ...hand, selected, ...rest]),
          hand: hand.map((card) => card.instanceId),
          deck: [selected.instanceId, ...rest.map((card) => card.instanceId)],
          stage: [
            { cardId: triggerSource.instanceId, slot: SlotPosition.LEFT },
            { cardId: source.instanceId, slot: SlotPosition.CENTER },
          ],
        }),
        pending(
          HS_SD1_002_LIVE_START_DISCARD_TWO_LOOK_TOP_MEMBER_HAND_GAIN_HEART_BLADE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        )
      );

      const afterDiscard = chooseCards(state, hand.map((card) => card.instanceId));
      expect(afterDiscard.activeEffect?.inspectionCardIds).toEqual([
        selected.instanceId,
        ...rest.map((card) => card.instanceId),
      ]);

      const resolved = chooseCard(afterDiscard, selected.instanceId);

      expect(resolved.players[0]!.hand.cardIds).toEqual([selected.instanceId]);
      expect(resolved.players[0]!.waitingRoom.cardIds).toEqual([
        ...hand.map((card) => card.instanceId),
        ...rest.map((card) => card.instanceId),
      ]);
      expect(resolved.inspectionZone.cardIds).toEqual([]);
      expect(hasWaitingEvent(resolved, ZoneType.HAND, hand.map((card) => card.instanceId))).toBe(true);
      expect(hasWaitingEvent(resolved, ZoneType.MAIN_DECK, rest.map((card) => card.instanceId))).toBe(true);
      expect(findHeartModifier(resolved, source.instanceId)).toMatchObject({
        kind: 'HEART',
        target: 'SOURCE_MEMBER',
        hearts: [{ color: HeartColor.BLUE, count: 1 }],
      });
      expect(findBladeModifier(resolved, source.instanceId)).toMatchObject({
        kind: 'BLADE',
        countDelta: 1,
      });
    });

    it('does not grant Heart or BLADE when the revealed member is not Hasunosora', () => {
      const source = createCardInstance(
        createHasunosoraMember('PL!HS-sd1-002-SD', '村野さやか', 11),
        PLAYER1,
        'sayaka-source'
      );
      const hand = [
        createCardInstance(createLiellaMember('discard-a'), PLAYER1, 'discard-a'),
        createCardInstance(createLiellaMember('discard-b'), PLAYER1, 'discard-b'),
      ];
      const selected = createCardInstance(
        createLiellaMember('PL!SP-test-selected', '澁谷かのん'),
        PLAYER1,
        'selected-liella'
      );
      const state = start(
        putCards({
          game: createState([source, ...hand, selected]),
          hand: hand.map((card) => card.instanceId),
          deck: [selected.instanceId],
          stage: [{ cardId: source.instanceId, slot: SlotPosition.CENTER }],
        }),
        pending(
          HS_SD1_002_LIVE_START_DISCARD_TWO_LOOK_TOP_MEMBER_HAND_GAIN_HEART_BLADE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        )
      );

      const resolved = chooseCard(chooseCards(state, hand.map((card) => card.instanceId)), selected.instanceId);

      expect(resolved.players[0]!.hand.cardIds).toEqual([selected.instanceId]);
      expect(resolved.liveResolution.liveModifiers).toEqual([]);
    });

    it('moves all inspected cards to waiting when no member is selected and handles fewer than 5 deck cards', () => {
      const source = createCardInstance(
        createHasunosoraMember('PL!HS-sd1-002-SD', '村野さやか', 11),
        PLAYER1,
        'sayaka-source'
      );
      const hand = [
        createCardInstance(createLiellaMember('discard-a'), PLAYER1, 'discard-a'),
        createCardInstance(createLiellaMember('discard-b'), PLAYER1, 'discard-b'),
      ];
      const topCards = [
        createCardInstance(createHasunosoraMember('PL!HS-top-member'), PLAYER1, 'top-member'),
        createCardInstance(createLiellaMember('PL!SP-top-member'), PLAYER1, 'top-other'),
      ];
      const state = start(
        putCards({
          game: createState([source, ...hand, ...topCards]),
          hand: hand.map((card) => card.instanceId),
          deck: topCards.map((card) => card.instanceId),
          stage: [{ cardId: source.instanceId, slot: SlotPosition.CENTER }],
        }),
        pending(
          HS_SD1_002_LIVE_START_DISCARD_TWO_LOOK_TOP_MEMBER_HAND_GAIN_HEART_BLADE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        )
      );

      const resolved = chooseCard(chooseCards(state, hand.map((card) => card.instanceId)), null);

      expect(resolved.players[0]!.hand.cardIds).toEqual([]);
      expect(resolved.players[0]!.waitingRoom.cardIds).toEqual([
        ...hand.map((card) => card.instanceId),
        ...topCards.map((card) => card.instanceId),
      ]);
      expect(hasWaitingEvent(resolved, ZoneType.MAIN_DECK, topCards.map((card) => card.instanceId))).toBe(true);
      expect(resolved.liveResolution.liveModifiers).toEqual([]);
    });

    it('no-ops without enough hand cards and does not leave a pending effect stuck', () => {
      const source = createCardInstance(
        createHasunosoraMember('PL!HS-sd1-002-SD', '村野さやか', 11),
        PLAYER1,
        'sayaka-source'
      );
      const state = start(
        putCards({
          game: createState([source]),
          hand: [],
          stage: [{ cardId: source.instanceId, slot: SlotPosition.CENTER }],
        }),
        pending(
          HS_SD1_002_LIVE_START_DISCARD_TWO_LOOK_TOP_MEMBER_HAND_GAIN_HEART_BLADE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        )
      );

      expect(state.activeEffect).toBeNull();
      expect(state.pendingAbilities).toEqual([]);
      expect(state.actionHistory.at(-1)?.payload).toMatchObject({
        step: 'NO_OP_NOT_ENOUGH_HAND_TO_DISCARD',
      });
    });
  });

  describe('PL!SP-pb1-001', () => {
    it('LIVE start pays 2 active energy and does not discard hand', () => {
      const source = createCardInstance(
        createLiellaMember('PL!SP-pb1-001-PR', '澁谷かのん', 11),
        PLAYER1,
        'kanon-source'
      );
      const hand = [
        createCardInstance(createLiellaMember('hand-a'), PLAYER1, 'hand-a'),
        createCardInstance(createLiellaMember('hand-b'), PLAYER1, 'hand-b'),
      ];
      const energy = createEnergyCards(2, 'start-pay-energy');
      const state = start(
        putCards({
          game: createState([source, ...hand, ...energy]),
          hand: hand.map((card) => card.instanceId),
          energy: energy.map((card) => ({ cardId: card.instanceId })),
          stage: [{ cardId: source.instanceId, slot: SlotPosition.CENTER }],
        }),
        pending(
          SP_PB1_001_LIVE_START_PAY_TWO_ENERGY_OR_DISCARD_TWO_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        )
      );

      const resolved = chooseOption(state, 'pay');

      expect(resolved.players[0]!.hand.cardIds).toEqual(hand.map((card) => card.instanceId));
      for (const card of energy) {
        expect(resolved.players[0]!.energyZone.cardStates.get(card.instanceId)?.orientation).toBe(
          OrientationState.WAITING
        );
      }
      expect(resolved.activeEffect).toBeNull();
      expect(resolved.pendingAbilities).toEqual([]);
    });

    it('LIVE start discards 2 hand cards when not paying and enqueues waiting-room triggers', () => {
      const source = createCardInstance(
        createLiellaMember('PL!SP-pb1-001-R', '澁谷かのん', 11),
        PLAYER1,
        'kanon-source'
      );
      const triggerSource = createCardInstance(
        createHasunosoraMember('PL!HS-pb1-003-R', '大沢瑠璃乃'),
        PLAYER1,
        'hand-waiting-trigger-source'
      );
      const hand = [
        createCardInstance(createLiellaMember('hand-a'), PLAYER1, 'hand-a'),
        createCardInstance(createLiellaMember('hand-b'), PLAYER1, 'hand-b'),
        createCardInstance(createLiellaMember('hand-c'), PLAYER1, 'hand-c'),
      ];
      const energy = createEnergyCards(2, 'start-decline-energy');
      const state = start(
        putCards({
          game: createState([source, triggerSource, ...hand, ...energy]),
          hand: hand.map((card) => card.instanceId),
          energy: energy.map((card) => ({ cardId: card.instanceId })),
          stage: [
            { cardId: triggerSource.instanceId, slot: SlotPosition.LEFT },
            { cardId: source.instanceId, slot: SlotPosition.CENTER },
          ],
        }),
        pending(
          SP_PB1_001_LIVE_START_PAY_TWO_ENERGY_OR_DISCARD_TWO_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        )
      );

      const selectDiscard = chooseOption(state, 'discard');
      const discarded = hand.slice(0, 2).map((card) => card.instanceId);
      const resolved = chooseCards(selectDiscard, discarded);

      expect(resolved.players[0]!.hand.cardIds).toEqual([hand[2]!.instanceId]);
      expect(resolved.players[0]!.waitingRoom.cardIds).toEqual(discarded);
      expect(hasWaitingEvent(resolved, ZoneType.HAND, discarded)).toBe(true);
    });

    it('LIVE start forces the discard path when energy is insufficient and discards actual available hand count', () => {
      const source = createCardInstance(
        createLiellaMember('PL!SP-pb1-001-P＋', '澁谷かのん', 11),
        PLAYER1,
        'kanon-source'
      );
      const hand = [createCardInstance(createLiellaMember('lonely-hand'), PLAYER1, 'lonely-hand')];
      const energy = createEnergyCards(1, 'start-short-energy');
      const resolved = start(
        putCards({
          game: createState([source, ...hand, ...energy]),
          hand: hand.map((card) => card.instanceId),
          energy: energy.map((card) => ({ cardId: card.instanceId })),
          stage: [{ cardId: source.instanceId, slot: SlotPosition.CENTER }],
        }),
        pending(
          SP_PB1_001_LIVE_START_PAY_TWO_ENERGY_OR_DISCARD_TWO_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        )
      );

      expect(resolved.activeEffect).toBeNull();
      expect(resolved.players[0]!.hand.cardIds).toEqual([]);
      expect(resolved.players[0]!.waitingRoom.cardIds).toEqual([hand[0]!.instanceId]);
      expect(hasWaitingEvent(resolved, ZoneType.HAND, [hand[0]!.instanceId])).toBe(true);
    });

    it('LIVE start with no energy and no hand consumes pending without getting stuck', () => {
      const source = createCardInstance(
        createLiellaMember('PL!SP-pb1-001-R', '澁谷かのん', 11),
        PLAYER1,
        'kanon-source'
      );
      const resolved = start(
        putCards({
          game: createState([source]),
          hand: [],
          energy: [],
          stage: [{ cardId: source.instanceId, slot: SlotPosition.CENTER }],
        }),
        pending(
          SP_PB1_001_LIVE_START_PAY_TWO_ENERGY_OR_DISCARD_TWO_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        )
      );

      expect(resolved.activeEffect).toBeNull();
      expect(resolved.pendingAbilities).toEqual([]);
      expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
        step: 'FORCE_DISCARD_NO_HAND',
      });
    });

    it('LIVE success pays 6 active energy, writes SCORE +1, and refreshes playerScores', () => {
      const source = createCardInstance(
        createLiellaMember('PL!SP-pb1-001-PR', '澁谷かのん', 11),
        PLAYER1,
        'kanon-source'
      );
      const energy = createEnergyCards(6, 'success-energy');
      const state = start(
        putCards({
          game: createState([source, ...energy]),
          energy: energy.map((card) => ({ cardId: card.instanceId })),
          stage: [{ cardId: source.instanceId, slot: SlotPosition.CENTER }],
          playerScore: 3,
        }),
        pending(
          SP_PB1_001_LIVE_SUCCESS_PAY_SIX_ENERGY_SCORE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS
        )
      );

      const resolved = chooseOption(state, 'pay');

      expect(resolved.liveResolution.liveModifiers).toContainEqual({
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        sourceCardId: source.instanceId,
        abilityId: SP_PB1_001_LIVE_SUCCESS_PAY_SIX_ENERGY_SCORE_ABILITY_ID,
      });
      expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(4);
      for (const card of energy) {
        expect(resolved.players[0]!.energyZone.cardStates.get(card.instanceId)?.orientation).toBe(
          OrientationState.WAITING
        );
      }
    });

    it('LIVE success can decline payment and no-ops without enough energy', () => {
      const source = createCardInstance(
        createLiellaMember('PL!SP-pb1-001-R', '澁谷かのん', 11),
        PLAYER1,
        'kanon-source'
      );
      const energy = createEnergyCards(6, 'success-decline-energy');
      const declineState = start(
        putCards({
          game: createState([source, ...energy]),
          energy: energy.map((card) => ({ cardId: card.instanceId })),
          stage: [{ cardId: source.instanceId, slot: SlotPosition.CENTER }],
          playerScore: 2,
        }),
        pending(
          SP_PB1_001_LIVE_SUCCESS_PAY_SIX_ENERGY_SCORE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS,
          'decline'
        )
      );

      const declined = chooseOption(declineState, 'decline');
      expect(declined.liveResolution.liveModifiers).toEqual([]);
      expect(declined.liveResolution.playerScores.get(PLAYER1)).toBe(2);

      const shortEnergy = createEnergyCards(5, 'success-short-energy');
      const noOp = start(
        putCards({
          game: createState([source, ...shortEnergy]),
          energy: shortEnergy.map((card) => ({ cardId: card.instanceId })),
          stage: [{ cardId: source.instanceId, slot: SlotPosition.CENTER }],
          playerScore: 2,
        }),
        pending(
          SP_PB1_001_LIVE_SUCCESS_PAY_SIX_ENERGY_SCORE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS,
          'short'
        )
      );
      expect(noOp.activeEffect).toBeNull();
      expect(noOp.liveResolution.liveModifiers).toEqual([]);
      expect(noOp.liveResolution.playerScores.get(PLAYER1)).toBe(2);
      for (const card of shortEnergy) {
        expect(noOp.players[0]!.energyZone.cardStates.get(card.instanceId)?.orientation).toBe(
          OrientationState.ACTIVE
        );
      }
    });
  });
});
