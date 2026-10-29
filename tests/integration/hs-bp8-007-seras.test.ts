import { describe, expect, it } from 'vitest';
import { createCardInstance } from '../../src/domain/entities/card';
import {
  activateCardAbility,
  getActivatedAbilityUiConfigs,
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import {
  HS_BP8_007_ON_ENTER_LOOK_TOP_FIVE_PURPLE_REQUIREMENT_LIVE_ABILITY_ID as ABILITY,
  PB1_019_ACTIVATED_ABILITY_ID as RECOVER,
  HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID as LEGACY_ENERGY,
} from '../../src/application/card-effects/ability-ids';
import { CardAbilitySourceZone } from '../../src/application/card-effects/ability-definition-types';
import { getGrantedActivatedAbilityDefinitions } from '../../src/application/card-effects/runtime/granted-member-below-abilities';
import { isStageMemberActivatedAbilityProhibited } from '../../src/domain/rules/member-activated-ability-prohibitions';
import { addMemberCostLiveModifierForMember } from '../../src/domain/rules/live-modifiers';
import { updatePlayer, registerCards, type GameState } from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { createGameSession } from '../../src/application/game-session';
import { createActivateAbilityCommand } from '../../src/application/game-commands';
import { projectPlayerViewState, createPublicObjectId } from '../../src/online/projector';
import {
  HeartColor,
  CardType,
  FaceState,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { createOctober29DraftCard } from '../helpers/october-29-draft-effects';
import {
  P1,
  P2,
  syntheticMember,
  syntheticLive,
  gameWith,
  stage,
  start,
  choose,
} from '../helpers/edelnote-effect-fixture';

function setup() {
  const source = createOctober29DraftCard('PL!HS-bp8-007', P1, 'source');
  const cards = [
    syntheticLive('purple'),
    syntheticLive('green', HeartColor.GREEN),
    syntheticMember('member'),
    syntheticLive('purple2'),
    syntheticMember('last'),
  ];
  let game = stage(gameWith([source, ...cards]), 'source');
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    mainDeck: { ...p.mainDeck, cardIds: cards.map((card) => card.instanceId) },
  }));
  return game;
}

describe('PL!HS-bp8-007 费用13「赛拉丝·柳田·利林费尔德」', () => {
  it('privately inspects five, reveals only a purple-requirement LIVE and groups the remaining four', () => {
    const state = start(setup(), ABILITY);
    expect(state.activeEffect?.selectableCardIds).toEqual(['purple', 'purple2']);
    for (const id of ['purple', 'green', 'member', 'purple2', 'last']) {
      expect(projectPlayerViewState(state, P1).objects[createPublicObjectId(id)].surface).toBe(
        'FRONT'
      );
      expect(projectPlayerViewState(state, P2).objects[createPublicObjectId(id)].surface).toBe(
        'BACK'
      );
    }
    expect(choose(state, 'green')).toBe(state);
    expect(choose(state, 'member')).toBe(state);
    const reveal = choose(state, 'purple');
    expect(reveal.inspectionZone.revealedCardIds).toEqual(['purple']);
    expect(reveal.players[0].hand.cardIds).toEqual([]);
    const done = confirmActiveEffectStep(reveal, P1, reveal.activeEffect!.id);
    expect(done.players[0].hand.cardIds).toEqual(['purple']);
    expect(done.players[0].waitingRoom.cardIds).toEqual(['green', 'member', 'purple2', 'last']);
    const events = done.eventLog.filter(
      ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
    );
    expect(events).toHaveLength(1);
    expect(events[0].event).toMatchObject({
      fromZone: ZoneType.MAIN_DECK,
      cardInstanceIds: ['green', 'member', 'purple2', 'last'],
    });
  });

  it.each(['decline', 'no-target', 'short'])(
    'preserves the private inspection before %s completion',
    (mode) => {
      let game = setup();
      if (mode !== 'decline')
        game = updatePlayer(game, P1, (p) => ({
          ...p,
          mainDeck: { ...p.mainDeck, cardIds: mode === 'short' ? ['purple'] : ['green', 'member'] },
        }));
      const state = start(game, ABILITY);
      expect(state.activeEffect?.inspectionCardIds?.length).toBe(
        mode === 'decline' ? 5 : mode === 'short' ? 1 : 2
      );
      const done = choose(state, null);
      expect(done.activeEffect).toBeNull();
      expect(done.players[0].hand.cardIds).toEqual([]);
      expect(done.players[0].waitingRoom.cardIds).toHaveLength(
        mode === 'decline' ? 5 : mode === 'short' ? 1 : 2
      );
    }
  );

  it('rejects a selected card moved outside the inspection', () => {
    const state = start(setup(), ABILITY);
    const stale = {
      ...state,
      inspectionZone: {
        ...state.inspectionZone,
        cardIds: state.inspectionZone.cardIds.filter((id) => id !== 'purple'),
      },
    };
    expect(choose(stale, 'purple')).toBe(stale);
  });

  it('blocks both players effective-cost<=4 sources, while ACTIVE Izumi must share the Seras controller', () => {
    let game = registerCards(setup(), [
      createOctober29DraftCard('PL!HS-bp8-008', P1, 'izumi'),
      syntheticMember('low'),
      syntheticMember('enemy', {}, P2),
    ]);
    game = stage(
      stage(stage(game, 'izumi', SlotPosition.LEFT), 'low', SlotPosition.RIGHT),
      'enemy',
      SlotPosition.LEFT,
      P2
    );
    expect(isStageMemberActivatedAbilityProhibited(game, P1, 'low')).toBe(true);
    expect(isStageMemberActivatedAbilityProhibited(game, P2, 'enemy')).toBe(true);
    expect(isStageMemberActivatedAbilityProhibited(game, P1, 'source')).toBe(false);
    const increased = addMemberCostLiveModifierForMember(game, {
      playerId: P1,
      memberCardId: 'low',
      sourceCardId: 'source',
      abilityId: 'test-cost',
      countDelta: 1,
    })!.gameState;
    expect(isStageMemberActivatedAbilityProhibited(increased, P1, 'low')).toBe(false);
    game = stage(game, 'izumi', SlotPosition.LEFT, P1, OrientationState.WAITING);
    expect(isStageMemberActivatedAbilityProhibited(game, P1, 'low')).toBe(false);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.LEFT),
    }));
    game = registerCards(game, [createOctober29DraftCard('PL!HS-bp8-008', P2, 'opponent-izumi')]);
    game = stage(game, 'opponent-izumi', SlotPosition.CENTER, P2);
    expect(isStageMemberActivatedAbilityProhibited(game, P1, 'low')).toBe(false);
  });

  it('rejects native and granted direct commands before payment and updates UI from the same rule', () => {
    let game = registerCards(setup(), [
      createOctober29DraftCard('PL!HS-bp8-008', P1, 'izumi'),
      syntheticMember('nico', { cardCode: 'PL!-pb2-027-N', name: '矢澤にこ', cost: 2 }),
      syntheticMember('host', {
        cardCode: 'LL-bp8-001-R',
        name: '矢澤にこ & 宮下愛 & セラス 柳田 リリエンフェルト',
        cost: 15,
      }),
      syntheticMember('below', { cardCode: 'PL!-pb2-027-N', name: '矢澤にこ', cost: 2 }),
    ]);
    game = stage(stage(game, 'izumi', SlotPosition.LEFT), 'nico', SlotPosition.RIGHT);
    expect(
      getActivatedAbilityUiConfigs('PL!-pb2-027-N', CardAbilitySourceZone.STAGE_MEMBER, {
        game,
        playerId: P1,
        sourceCardId: 'nico',
      })
    ).toEqual([]);
    expect(
      projectPlayerViewState(game, P1).objects[createPublicObjectId('nico')]
        .activatedAbilityUiConfigs
    ).toEqual([]);
    expect(activateCardAbility(game, P1, 'nico', RECOVER)).toBe(game);
    const session = createGameSession();
    (session as unknown as { authorityState: GameState }).authorityState = game;
    expect(session.executeCommand(createActivateAbilityCommand(P1, 'nico', RECOVER)).success).toBe(
      false
    );
    expect(session.state!.actionHistory).toEqual(game.actionHistory);

    game = stage(game, 'host', SlotPosition.RIGHT);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: addMemberBelowMember(p.memberSlots, SlotPosition.RIGHT, 'below'),
    }));
    const granted = getGrantedActivatedAbilityDefinitions(game, P1, 'host').find(
      (entry) => entry.definition.abilityId === RECOVER
    )!;
    expect(granted).toBeDefined();
    expect(isStageMemberActivatedAbilityProhibited(game, P1, 'host')).toBe(false);
    game = addMemberCostLiveModifierForMember(game, {
      playerId: P1,
      memberCardId: 'host',
      sourceCardId: 'source',
      abilityId: 'test-cost',
      countDelta: -11,
    })!.gameState;
    expect(
      projectPlayerViewState(game, P1).objects[createPublicObjectId('host')]
        .activatedAbilityUiConfigs
    ).toEqual([]);
    expect(activateCardAbility(game, P1, 'host', RECOVER, granted.abilityInstanceId)).toBe(game);
    (session as unknown as { authorityState: GameState }).authorityState = game;
    expect(
      session.executeCommand(
        createActivateAbilityCommand(P1, 'host', RECOVER, granted.abilityInstanceId)
      ).success
    ).toBe(false);
    expect(
      session.executeCommand(
        createActivateAbilityCommand(P1, 'host', RECOVER, `${granted.abilityInstanceId}-forged`)
      ).success
    ).toBe(false);
    expect(start(game, ABILITY).activeEffect?.abilityId).toBe(ABILITY);
  });

  it('allows an already started special-energy payment to resume when the prohibition appears afterwards', () => {
    const source = syntheticMember('legacy', {
      cardCode: 'PL!HS-bp1-002-RM',
      name: '村野さやか',
      cost: 11,
      groupNames: ['蓮ノ空'],
    });
    const energies = ['e1', 'e2', 'e3'].map((id) =>
      createCardInstance(
        { cardCode: `SYNTHETIC-${id}`, name: id, cardType: CardType.ENERGY },
        P1,
        id
      )
    );
    let game = stage(
      gameWith([
        source,
        syntheticMember('target', { cost: 2, groupNames: ['蓮ノ空'] }),
        ...energies,
      ]),
      'legacy'
    );
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: ['target'] },
      energyZone: energies.reduce(
        (zone, card) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        p.energyZone
      ),
    }));
    game = {
      ...game,
      energyActivePhaseSkips: [
        { playerId: P1, energyCardId: 'e1', sourceCardId: 'marker', abilityId: 'marker' },
      ],
    };
    game = addMemberCostLiveModifierForMember(game, {
      playerId: P1,
      memberCardId: 'legacy',
      sourceCardId: 'legacy',
      abilityId: 'test-cost',
      countDelta: -7,
    })!.gameState;
    const opened = activateCardAbility(game, P1, 'legacy', LEGACY_ENERGY);
    expect(opened.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    game = registerCards(opened, [
      createOctober29DraftCard('PL!HS-bp8-007', P1, 'seras-lock'),
      createOctober29DraftCard('PL!HS-bp8-008', P1, 'izumi-lock'),
    ]);
    game = stage(stage(game, 'seras-lock', SlotPosition.LEFT), 'izumi-lock', SlotPosition.RIGHT);
    expect(isStageMemberActivatedAbilityProhibited(game, P1, 'legacy')).toBe(true);
    const resumed = choose(game, undefined, undefined, ['e2', 'e3']);
    expect(resumed.activeEffect?.stepId).toBe('HS_BP1_002_SELECT_WAITING_ROOM_MEMBER_TO_PLAY');
    expect(resumed.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(resumed.players[0].energyZone.cardStates.get('e1')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(resumed.players[0].energyZone.cardStates.get('e2')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(choose(resumed, 'target').players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      'target'
    );
  });
});
