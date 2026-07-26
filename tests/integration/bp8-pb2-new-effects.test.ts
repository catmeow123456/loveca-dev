import { describe, expect, it } from 'vitest';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP8_001_AUTO_WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE_ABILITY_ID,
  N_BP8_002_ACTIVATED_WAITING_ROOM_PAY_ENERGY_BOTTOM_SELF_TARGET_YELLOW_HEART_ABILITY_ID,
  PL_BP8_005_AUTO_LEAVE_STAGE_BOTTOM_SELF_RECOVER_YELLOW_LIVE_DISCARD_ABILITY_ID,
  PL_BP8_005_LIVE_START_CHEER_HEART_COLORS_TO_YELLOW_ABILITY_ID,
  PL_PB2_001_LIVE_START_SUCCESS_MUSE_ICON_REWARDS_ABILITY_ID,
  PL_PB2_039_LIVE_START_SUCCESS_MUSE_TWO_CHEER_TEN_ABILITY_ID,
  PL_PB2_039_LIVE_SUCCESS_DISTINCT_MUSE_STAGE_CHEER_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type BladeHeartItem,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { getCheerCardEffectiveBladeHearts } from '../../src/domain/rules/live-modifiers';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { confirmIfConfirmOnly } from './confirm-only-pending';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';

const P1 = 'p1';
const P2 = 'p2';

function member(
  cardCode: string,
  instanceId: string,
  options: {
    readonly name?: string;
    readonly groups?: readonly string[];
    readonly bladeHearts?: readonly BladeHeartItem[];
  } = {}
) {
  const data: MemberCardData = {
    cardCode,
    name: options.name ?? instanceId,
    groupNames: options.groups ?? ["μ's"],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    bladeHearts: options.bladeHearts,
  };
  return createCardInstance(data, P1, instanceId);
}

function live(
  cardCode: string,
  instanceId: string,
  options: {
    readonly name?: string;
    readonly groups?: readonly string[];
    readonly score?: number;
    readonly requirement?: HeartColor;
    readonly bladeHearts?: readonly BladeHeartItem[];
  } = {}
) {
  const data: LiveCardData = {
    cardCode,
    name: options.name ?? instanceId,
    groupNames: options.groups ?? ["μ's"],
    cardType: CardType.LIVE,
    score: options.score ?? 1,
    requirements: createHeartRequirement(options.requirement ? { [options.requirement]: 1 } : {}),
    bladeHearts: options.bladeHearts,
  };
  return createCardInstance(data, P1, instanceId);
}

function energy(instanceId: string) {
  const data: EnergyCardData = {
    cardCode: `ENERGY-${instanceId}`,
    name: instanceId,
    cardType: CardType.ENERGY,
  };
  return createCardInstance(data, P1, instanceId);
}

function pending(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId,
    eventIds: [],
  };
}

function resolveSingle(
  game: GameState,
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition
): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending(abilityId, sourceCardId, timingId)],
  }).gameState;
}

describe('BP8 / PB2 new card-effect definitions', () => {
  it('registers all four base families and the exact activated UI body', () => {
    const rinDefinitions = getCardAbilityDefinitionsForCardCode('PL!-bp8-005-P');
    expect(rinDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilityId: PL_BP8_005_AUTO_LEAVE_STAGE_BOTTOM_SELF_RECOVER_YELLOW_LIVE_DISCARD_ABILITY_ID,
          category: CardAbilityCategory.AUTO,
          sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
          triggerCondition: TriggerCondition.ON_LEAVE_STAGE,
        }),
        expect.objectContaining({
          abilityId: PL_BP8_005_LIVE_START_CHEER_HEART_COLORS_TO_YELLOW_ABILITY_ID,
          category: CardAbilityCategory.LIVE_START,
        }),
      ])
    );
    expect(
      rinDefinitions.find(
        (definition) =>
          definition.abilityId === PL_BP8_005_LIVE_START_CHEER_HEART_COLORS_TO_YELLOW_ABILITY_ID
      )?.effectText
    ).toBe(
      '【LIVE开始时】LIVE结束时为止，因声援被公开的自己的卡片持有的[桃ハート]、[赤ハート]、[緑ハート]、[青ハート]、[紫ハート]、[ALLハート]，全部变为[黄ハート]。'
    );
    const honokaDefinition = getCardAbilityDefinitionsForCardCode('PL!-pb2-001-R').find(
      (definition) =>
        definition.abilityId === PL_PB2_001_LIVE_START_SUCCESS_MUSE_ICON_REWARDS_ABILITY_ID
    );
    expect(honokaDefinition?.effectText).toContain(
      '存在持有[ALLハート]的卡片的场合，LIVE结束时为止，获得[ALLハート]。'
    );
    expect(getCardAbilityDefinitionsForCardCode('PL!-pb2-039-L')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilityId: PL_PB2_039_LIVE_START_SUCCESS_MUSE_TWO_CHEER_TEN_ABILITY_ID,
        }),
        expect.objectContaining({
          abilityId: PL_PB2_039_LIVE_SUCCESS_DISTINCT_MUSE_STAGE_CHEER_SCORE_ABILITY_ID,
        }),
      ])
    );
    const kasumiDefinition = getCardAbilityDefinitionsForCardCode('PL!N-bp8-002-P').find(
      (definition) =>
        definition.abilityId ===
        N_BP8_002_ACTIVATED_WAITING_ROOM_PAY_ENERGY_BOTTOM_SELF_TARGET_YELLOW_HEART_ABILITY_ID
    );
    expect(kasumiDefinition?.sourceZone).toBe(CardAbilitySourceZone.WAITING_ROOM);
    expect(kasumiDefinition?.activatedUi?.text).toBe(
      '【起动】[E]将此卡放置于卡组底：LIVE结束时为止，存在于自己的舞台的1名『虹咲』的成员，获得[黄ハート]。此能力仅可在此卡存在于休息室的场合起动。'
    );
  });
});

describe('PL!-bp8-005-P 费用2「星空凛」', () => {
  it('optionally bottoms self through the central event, publicly recovers a yellow LIVE, then discards', () => {
    const rin = member('PL!-bp8-005-P', 'rin', { name: '星空凛' });
    const yellowLive = live('YELLOW-LIVE', 'yellow-live', {
      requirement: HeartColor.YELLOW,
    });
    const filler = member('FILLER', 'filler');
    let game = registerCards(createGameState('bp8-005-auto', P1, 'P1', P2, 'P2'), [
      rin,
      yellowLive,
      filler,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [rin.instanceId, yellowLive.instanceId],
      },
      hand: { ...player.hand, cardIds: [filler.instanceId] },
    }));

    game = resolveSingle(
      game,
      PL_BP8_005_AUTO_LEAVE_STAGE_BOTTOM_SELF_RECOVER_YELLOW_LIVE_DISCARD_ABILITY_ID,
      rin.instanceId,
      TriggerCondition.ON_LEAVE_STAGE
    );
    expect(game.activeEffect).toMatchObject({
      selectableOptions: [{ id: 'activate', label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    game = confirmActiveEffectStep(
      game,
      P1,
      game.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'activate'
    );
    expect(game.players[0].mainDeck.cardIds).toEqual([rin.instanceId]);
    expect(game.activeEffect).toMatchObject({
      stepId: 'PL_BP8_005_SELECT_YELLOW_REQUIREMENT_LIVE',
      selectableCardIds: [yellowLive.instanceId],
      selectableCardVisibility: 'PUBLIC',
      sourceCardDisplayCode: 'PL!-bp8-005-P',
    });
    const ownerView = projectPlayerViewState(game, P1);
    const opponentView = projectPlayerViewState(game, P2);
    const sourceObjectId = createPublicObjectId(rin.instanceId);
    expect(ownerView.activeEffect?.sourceCardDisplayCode).toBe('PL!-bp8-005-P');
    expect(opponentView.activeEffect?.sourceCardDisplayCode).toBe('PL!-bp8-005-P');
    expect(ownerView.objects[sourceObjectId]).toMatchObject({ surface: 'BACK' });
    expect(ownerView.objects[sourceObjectId]?.frontInfo).toBeUndefined();
    expect(opponentView.objects[sourceObjectId]).toBeUndefined();
    game = confirmActiveEffectStepThroughPublicReveal(
      game,
      P1,
      game.activeEffect!.id,
      yellowLive.instanceId
    );
    expect(game.activeEffect).toMatchObject({
      stepId: 'PL_BP8_005_SELECT_HAND_TO_DISCARD',
      selectableCardIds: [filler.instanceId, yellowLive.instanceId],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      sourceCardDisplayCode: 'PL!-bp8-005-P',
    });
    game = confirmActiveEffectStep(game, P1, game.activeEffect!.id, filler.instanceId);

    expect(game.activeEffect).toBeNull();
    expect(game.players[0].hand.cardIds).toEqual([yellowLive.instanceId]);
    expect(game.players[0].waitingRoom.cardIds).toEqual([filler.instanceId]);
    expect(
      game.eventLog
        .map(({ event }) => event)
        .find(
          (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
        )
    ).toMatchObject({ movedCardIds: [rin.instanceId] });
  });

  it('applies the shared cheer-heart replacement while the member remains on stage', () => {
    const rin = member('PL!-bp8-005-P', 'rin-live-start', { name: '星空凛' });
    const cheer = live('RIN-CHEER', 'rin-cheer', {
      bladeHearts: [
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PINK },
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.RED },
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.YELLOW },
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GREEN },
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.BLUE },
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PURPLE },
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW },
        { effect: BladeHeartEffect.DRAW },
        { effect: BladeHeartEffect.SCORE },
      ],
    });
    let game = registerCards(createGameState('bp8-005-live-start', P1, 'P1', P2, 'P2'), [
      rin,
      cheer,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, rin.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = resolveSingle(
      game,
      PL_BP8_005_LIVE_START_CHEER_HEART_COLORS_TO_YELLOW_ABILITY_ID,
      rin.instanceId,
      TriggerCondition.ON_LIVE_START
    );
    expect(game.activeEffect?.effectText).toBe(
      '【LIVE开始时】LIVE结束时为止，因声援被公开的自己的卡片持有的[桃ハート]、[赤ハート]、[緑ハート]、[青ハート]、[紫ハート]、[ALLハート]，全部变为[黄ハート]。'
    );
    game = confirmIfConfirmOnly(game, P1);

    expect(game.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
        abilityId: PL_BP8_005_LIVE_START_CHEER_HEART_COLORS_TO_YELLOW_ABILITY_ID,
        fromColors: [
          HeartColor.PINK,
          HeartColor.RED,
          HeartColor.GREEN,
          HeartColor.BLUE,
          HeartColor.PURPLE,
          HeartColor.RAINBOW,
        ],
        toColor: HeartColor.YELLOW,
      })
    );
    expect(getCheerCardEffectiveBladeHearts(game, P1, cheer.instanceId)).toEqual([
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.YELLOW },
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.YELLOW },
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.YELLOW },
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.YELLOW },
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.YELLOW },
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.YELLOW },
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.YELLOW },
      { effect: BladeHeartEffect.DRAW },
      { effect: BladeHeartEffect.SCORE },
    ]);
  });
});

describe('PL!-pb2-001-R 费用22「高坂穗乃果」', () => {
  it('resolves SCORE, ALL and DRAW success-zone branches independently', () => {
    const honoka = member('PL!-pb2-001-R', 'honoka', { name: '高坂穗乃果' });
    const scoreLive = live('MUSE-SCORE', 'muse-score', {
      bladeHearts: [{ effect: BladeHeartEffect.SCORE }],
    });
    const allLive = live('MUSE-ALL', 'muse-all', {
      bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }],
    });
    const drawLive = live('MUSE-DRAW', 'muse-draw', {
      bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
    });
    const recovery = member('MUSE-RECOVERY', 'muse-recovery', { name: '南琴梨' });
    let game = registerCards(createGameState('pb2-001', P1, 'P1', P2, 'P2'), [
      honoka,
      scoreLive,
      allLive,
      drawLive,
      recovery,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, honoka.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      successZone: {
        ...player.successZone,
        cardIds: [scoreLive.instanceId, allLive.instanceId, drawLive.instanceId],
      },
      waitingRoom: addCardToStatefulZone(player.waitingRoom, recovery.instanceId),
    }));
    game = resolveSingle(
      game,
      PL_PB2_001_LIVE_START_SUCCESS_MUSE_ICON_REWARDS_ABILITY_ID,
      honoka.instanceId,
      TriggerCondition.ON_LIVE_START
    );
    expect(game.activeEffect).toMatchObject({
      selectableCardIds: [recovery.instanceId],
      selectableCardVisibility: 'PUBLIC',
    });
    game = confirmActiveEffectStepThroughPublicReveal(
      game,
      P1,
      game.activeEffect!.id,
      recovery.instanceId
    );

    expect(game.players[0].hand.cardIds).toContain(recovery.instanceId);
    expect(game.liveResolution.playerScores.get(P1)).toBe(1);
    expect(game.liveResolution.liveModifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'SCORE',
          abilityId: PL_PB2_001_LIVE_START_SUCCESS_MUSE_ICON_REWARDS_ABILITY_ID,
          countDelta: 1,
        }),
        expect.objectContaining({
          kind: 'HEART',
          abilityId: PL_PB2_001_LIVE_START_SUCCESS_MUSE_ICON_REWARDS_ABILITY_ID,
          hearts: [{ color: HeartColor.RAINBOW, count: 1 }],
        }),
      ])
    );
  });

  it('uses mapped icon tokens in the no-recovery confirmation preview', () => {
    const honoka = member('PL!-pb2-001-R', 'honoka-all-heart-copy', { name: '高坂穗乃果' });
    const scoreLive = live('MUSE-SCORE-COPY', 'muse-score-copy', {
      bladeHearts: [{ effect: BladeHeartEffect.SCORE }],
    });
    const allHeartLive = live('MUSE-ALL-HEART', 'muse-all-heart-copy', {
      bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }],
    });
    const drawLive = live('MUSE-DRAW-COPY', 'muse-draw-copy', {
      bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
    });
    let game = registerCards(createGameState('pb2-001-all-heart-copy', P1, 'P1', P2, 'P2'), [
      honoka,
      scoreLive,
      allHeartLive,
      drawLive,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, honoka.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      successZone: {
        ...player.successZone,
        cardIds: [scoreLive.instanceId, allHeartLive.instanceId, drawLive.instanceId],
      },
    }));

    game = resolveSingle(
      game,
      PL_PB2_001_LIVE_START_SUCCESS_MUSE_ICON_REWARDS_ABILITY_ID,
      honoka.instanceId,
      TriggerCondition.ON_LIVE_START
    );

    expect(game.activeEffect?.effectText).toContain(
      '存在持有[ALLハート]的卡片的场合，LIVE结束时为止，获得[ALLハート]。'
    );
    expect(game.activeEffect?.effectText).toContain('[スコア]存在、[ALLハート]存在、[ドロー]存在');
  });
});

describe('PL!-pb2-039-L 分数9「我们是合而为一的光芒」', () => {
  it('adds ten cheer from two successful Muse cards', () => {
    const source = live('PL!-pb2-039-L', 'bokuhika', {
      name: '僕たちはひとつの光',
      score: 9,
    });
    const successA = live('SUCCESS-A', 'success-a');
    const successB = live('SUCCESS-B', 'success-b');
    let game = registerCards(createGameState('pb2-039-start', P1, 'P1', P2, 'P2'), [
      source,
      successA,
      successB,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [source.instanceId] },
      successZone: {
        ...player.successZone,
        cardIds: [successA.instanceId, successB.instanceId],
      },
    }));
    game = confirmIfConfirmOnly(
      resolveSingle(
        game,
        PL_PB2_039_LIVE_START_SUCCESS_MUSE_TWO_CHEER_TEN_ABILITY_ID,
        source.instanceId,
        TriggerCondition.ON_LIVE_START
      ),
      P1
    );

    expect(game.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'CHEER_COUNT',
        countDelta: 10,
        abilityId: PL_PB2_039_LIVE_START_SUCCESS_MUSE_TWO_CHEER_TEN_ABILITY_ID,
      })
    );
  });

  it('counts unique Muse names across stage and moved-out cheer facts for score', () => {
    const source = live('PL!-pb2-039-L', 'bokuhika-score', {
      name: '僕たちはひとつの光',
      score: 9,
    });
    const stageHonoka = member('STAGE-HONOKA', 'stage-honoka', { name: '高坂穂乃果' });
    const stageUmi = member('STAGE-UMI', 'stage-umi', { name: '園田海未' });
    const cheerHonoka = member('CHEER-HONOKA', 'cheer-honoka', { name: '高坂穂乃果' });
    const cheerKotori = member('CHEER-KOTORI', 'cheer-kotori', { name: '南ことり' });
    let game = registerCards(createGameState('pb2-039-success', P1, 'P1', P2, 'P2'), [
      source,
      stageHonoka,
      stageUmi,
      cheerHonoka,
      cheerKotori,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [source.instanceId] },
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, stageHonoka.instanceId),
        SlotPosition.CENTER,
        stageUmi.instanceId
      ),
    }));
    game = emitGameEvent(
      game,
      createCheerEvent(P1, [cheerHonoka.instanceId, cheerKotori.instanceId], 2, {
        automated: true,
      })
    );
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        firstPlayerCheerCardIds: [cheerHonoka.instanceId, cheerKotori.instanceId],
      },
    };
    game = confirmIfConfirmOnly(
      resolveSingle(
        game,
        PL_PB2_039_LIVE_SUCCESS_DISTINCT_MUSE_STAGE_CHEER_SCORE_ABILITY_ID,
        source.instanceId,
        TriggerCondition.ON_LIVE_SUCCESS
      ),
      P1
    );

    expect(game.liveResolution.playerScores.get(P1)).toBe(3);
    expect(game.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'SCORE',
        liveCardId: source.instanceId,
        countDelta: 3,
        abilityId: PL_PB2_039_LIVE_SUCCESS_DISTINCT_MUSE_STAGE_CHEER_SCORE_ABILITY_ID,
      })
    );
  });
});

describe('PL!N-bp8-002-P 费用17「中须霞」', () => {
  it('uses common special-energy selection, bottoms self through the central event, and grants yellow Heart', () => {
    const kasumi = member('PL!N-bp8-002-P', 'kasumi', {
      name: '中须霞',
      groups: ['虹ヶ咲'],
    });
    const target = member('NIJI-TARGET', 'niji-target', {
      groups: ['虹ヶ咲'],
    });
    const energies = [energy('energy-0'), energy('energy-1')];
    let game = registerCards(createGameState('bp8-002', P1, 'P1', P2, 'P2'), [
      kasumi,
      target,
      ...energies,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: addCardToStatefulZone(player.waitingRoom, kasumi.instanceId),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, target.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      energyZone: energies.reduce(
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
      currentPhase: GamePhase.MAIN_PHASE,
      activePlayerIndex: 0,
      energyActivePhaseSkips: [
        {
          playerId: P1,
          energyCardId: energies[1]!.instanceId,
          sourceCardId: 'special-source',
          abilityId: 'special-energy',
        },
      ],
    };

    game = activateCardAbility(
      game,
      P1,
      kasumi.instanceId,
      N_BP8_002_ACTIVATED_WAITING_ROOM_PAY_ENERGY_BOTTOM_SELF_TARGET_YELLOW_HEART_ABILITY_ID
    );
    expect(game.activeEffect).toMatchObject({
      stepId: 'N_BP8_002_SELECT_NIJIGASAKI_MEMBER_TARGET',
      selectableCardIds: [target.instanceId],
    });
    game = confirmActiveEffectStep(game, P1, game.activeEffect!.id, target.instanceId);
    expect(game.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      selectableCardIds: energies.map((card) => card.instanceId),
      minSelectableCards: 1,
      maxSelectableCards: 1,
    });
    game = confirmActiveEffectStep(game, P1, game.activeEffect!.id, energies[1]!.instanceId);

    expect(game.activeEffect).toBeNull();
    expect(game.players[0].mainDeck.cardIds).toEqual([kasumi.instanceId]);
    expect(game.players[0].energyZone.cardStates.get(energies[1]!.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(game.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'HEART',
        targetMemberCardId: target.instanceId,
        abilityId:
          N_BP8_002_ACTIVATED_WAITING_ROOM_PAY_ENERGY_BOTTOM_SELF_TARGET_YELLOW_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      })
    );
    expect(
      game.eventLog
        .map(({ event }) => event)
        .find(
          (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
        )
    ).toMatchObject({ movedCardIds: [kasumi.instanceId] });
  });

  it('really enqueues the existing Kaho AUTO from the shared waiting-room-to-deck event', () => {
    const kasumi = member('PL!N-bp8-002-P', 'kasumi-kaho-link', {
      name: '中须霞',
      groups: ['虹ヶ咲'],
    });
    const target = member('NIJI-TARGET-LINK', 'niji-target-link', {
      groups: ['虹ヶ咲'],
    });
    const kaho = member('PL!HS-bp8-001-P', 'kaho-link', {
      name: '日野下花帆',
      groups: ['莲之空'],
    });
    const activeEnergy = energy('link-energy');
    let game = registerCards(createGameState('bp8-002-kaho-link', P1, 'P1', P2, 'P2'), [
      kasumi,
      target,
      kaho,
      activeEnergy,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: addCardToStatefulZone(player.waitingRoom, kasumi.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, kaho.instanceId),
        SlotPosition.CENTER,
        target.instanceId
      ),
      energyZone: addCardToStatefulZone(player.energyZone, activeEnergy.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.MAIN_PHASE,
      activePlayerIndex: 0,
    };
    game = activateCardAbility(
      game,
      P1,
      kasumi.instanceId,
      N_BP8_002_ACTIVATED_WAITING_ROOM_PAY_ENERGY_BOTTOM_SELF_TARGET_YELLOW_HEART_ABILITY_ID
    );
    game = confirmActiveEffectStep(game, P1, game.activeEffect!.id, target.instanceId);

    expect(
      game.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            HS_BP8_001_AUTO_WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE_ABILITY_ID
      )
    ).toBe(true);
    game = resolvePendingCardEffects(game).gameState;
    if (
      game.activeEffect?.abilityId ===
      HS_BP8_001_AUTO_WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE_ABILITY_ID
    ) {
      game = confirmActiveEffectStep(game, P1, game.activeEffect.id);
    }
    game = resolvePendingCardEffects(game).gameState;
    expect(game.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'BLADE',
        sourceCardId: kaho.instanceId,
        countDelta: 3,
        abilityId: HS_BP8_001_AUTO_WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE_ABILITY_ID,
      })
    );
  });
});
