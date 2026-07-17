import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
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
import { getLiveCardRequirementModifiers } from '../../src/domain/rules/live-modifiers';
import { applyHeartRequirementModifiers } from '../../src/domain/rules/live-requirement-modifiers';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { PL_N_PB1_042_LIVE_START_SAME_NAME_NIJIGASAKI_REDUCE_REQUIREMENT_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const NIJI_WORK = 'ラブライブ！虹ヶ咲学園スクールアイドル同好会';

function eternalizeLove(): LiveCardData {
  return {
    cardCode: 'PL!N-pb1-042-L',
    name: 'Eternalize Love!!',
    groupNames: [NIJI_WORK],
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 12 }),
  };
}

function member(options: {
  readonly cardCode: string;
  readonly name: string;
  readonly groupNames?: readonly string[];
  readonly workNames?: readonly string[];
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name,
    groupNames: options.groupNames,
    workNames: options.workNames,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setup(
  members: readonly ReturnType<typeof createCardInstance>[],
  sourceCount = 1
): {
  readonly game: GameState;
  readonly sources: readonly ReturnType<typeof createCardInstance>[];
} {
  const sources = Array.from({ length: sourceCount }, (_, index) =>
    createCardInstance(eternalizeLove(), P1, `eternalize-${index}`)
  );
  let game = registerCards(createGameState('n-pb1-042', P1, 'P1', P2, 'P2'), [
    ...sources,
    ...members,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: sources.reduce(
      (zone, source) => addCardToStatefulZone(zone, source.instanceId),
      player.liveZone
    ),
    memberSlots: members.reduce(
      (slots, card, index) =>
        placeCardInSlot(
          slots,
          [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!,
          card.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
        ),
      player.memberSlots
    ),
  }));
  return { game, sources };
}

function check(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function confirm(game: GameState): GameState {
  expect(game.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id);
}

function modifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'REQUIREMENT' &&
      modifier.abilityId ===
        PL_N_PB1_042_LIVE_START_SAME_NAME_NIJIGASAKI_REDUCE_REQUIREMENT_ABILITY_ID
  );
}

const FAQ_CASES = [
  {
    label: 'Karin with LL-bp4-001-R+',
    single: member({
      cardCode: 'PL!N-pb1-016-R',
      name: '朝香果林',
      groupNames: [NIJI_WORK],
    }),
    composite: member({
      cardCode: 'LL-bp4-001-R＋',
      name: '絢瀬絵里&朝香果林&葉月 恋',
      workNames: [
        'ラブライブ！\nラブライブ！虹ヶ咲学園スクールアイドル同好会\nラブライブ！スーパースター!!',
      ],
    }),
    sharedName: '朝香果林',
  },
  {
    label: 'Rina with LL-bp3-001-R+',
    single: member({
      cardCode: 'PL!N-pb1-021-R',
      name: '天王寺璃奈',
      groupNames: [NIJI_WORK],
    }),
    composite: member({
      cardCode: 'LL-bp3-001-R＋',
      name: '園田海未&津島善子&天王寺璃奈',
      workNames: [
        'ラブライブ！\nラブライブ！サンシャイン!!\nラブライブ！虹ヶ咲学園スクールアイドル同好会',
      ],
    }),
    sharedName: '天王寺璃奈',
  },
] as const;

describe('PL!N-pb1-042 Eternalize Love!! conditional live modifier', () => {
  it.each(FAQ_CASES)(
    'locks FAQ Q204 production data: $label',
    ({ single, composite, sharedName }) => {
      const scenario = setup([
        createCardInstance(single, P1, `${single.cardCode}-instance`),
        createCardInstance(composite, P1, `${composite.cardCode}-instance`),
      ]);
      const preview = check(scenario.game);
      expect(preview.activeEffect).toMatchObject({
        abilityId: PL_N_PB1_042_LIVE_START_SAME_NAME_NIJIGASAKI_REDUCE_REQUIREMENT_ABILITY_ID,
        sourceCardId: scenario.sources[0]!.instanceId,
      });
      expect(preview.activeEffect?.effectText).toContain(`当前共享姓名：${sharedName}`);
      expect(preview.activeEffect?.effectText).toContain('满足条件，实际减少3个必要[無ハート]');
      expect(preview.activeEffect?.effectText).not.toMatch(/source|pending|modifier|resolver|来源/);
      const resolved = confirm(preview);
      expect(modifiers(resolved)).toEqual([
        {
          kind: 'REQUIREMENT',
          liveCardId: scenario.sources[0]!.instanceId,
          modifiers: [{ color: HeartColor.RAINBOW, countDelta: -3 }],
          sourceCardId: scenario.sources[0]!.instanceId,
          abilityId: PL_N_PB1_042_LIVE_START_SAME_NAME_NIJIGASAKI_REDUCE_REQUIREMENT_ABILITY_ID,
        },
      ]);
      expect(
        getLiveCardRequirementModifiers(resolved.liveResolution, scenario.sources[0]!.instanceId)
      ).toEqual([{ color: HeartColor.RAINBOW, countDelta: -3 }]);
      const effectiveRequirement = applyHeartRequirementModifiers(
        scenario.sources[0]!.data.requirements,
        getLiveCardRequirementModifiers(resolved.liveResolution, scenario.sources[0]!.instanceId)
      );
      expect(effectiveRequirement.colorRequirements.get(HeartColor.RAINBOW)).toBe(9);
      expect(effectiveRequirement.totalRequired).toBe(9);
    }
  );

  it.each([
    {
      label: 'two different cards without a shared name',
      cards: [
        member({ cardCode: 'PL!N-karin', name: '朝香果林', groupNames: [NIJI_WORK] }),
        member({ cardCode: 'PL!N-rina', name: '天王寺璃奈', groupNames: [NIJI_WORK] }),
      ],
    },
    {
      label: 'one multi-name member by itself',
      cards: [FAQ_CASES[0].composite],
    },
    {
      label: 'same displayed name but one member lacks Nijigasaki identity',
      cards: [
        member({ cardCode: 'PL!N-karin', name: '朝香果林', groupNames: [NIJI_WORK] }),
        member({ cardCode: 'PL!S-fake-karin', name: '朝香果林', groupNames: ['Aqours'] }),
      ],
    },
  ])('does not reduce for $label', ({ cards }) => {
    const scenario = setup(
      cards.map((card, index) => createCardInstance(card, P1, `negative-${index}`))
    );
    const preview = check(scenario.game);
    expect(preview.activeEffect?.effectText).toContain('当前共享姓名：无');
    expect(preview.activeEffect?.effectText).toContain('未满足条件，实际不减少必要[無ハート]');
    expect(modifiers(confirm(preview))).toEqual([]);
  });

  it('uses different cardIds across all three slots and finds a shared name outside adjacent slots', () => {
    const left = createCardInstance(FAQ_CASES[1].single, P1, 'three-left');
    const middle = createCardInstance(
      member({ cardCode: 'PL!N-middle', name: '上原歩夢', groupNames: [NIJI_WORK] }),
      P1,
      'three-middle'
    );
    const right = createCardInstance(FAQ_CASES[1].composite, P1, 'three-right');
    const resolved = confirm(check(setup([left, middle, right]).game));
    expect(modifiers(resolved)).toHaveLength(1);
  });

  it('replaces repeated resolution, clears a stale source result, and preserves source isolation', () => {
    const members = [
      createCardInstance(FAQ_CASES[0].single, P1, 'repeat-single'),
      createCardInstance(FAQ_CASES[0].composite, P1, 'repeat-composite'),
    ];
    const scenario = setup(members, 2);
    const checked = check(scenario.game);
    const ordered = confirmActiveEffectStep(
      checked,
      P1,
      checked.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(modifiers(ordered)).toHaveLength(2);
    expect(new Set(modifiers(ordered).map((modifier) => modifier.sourceCardId))).toEqual(
      new Set(scenario.sources.map((source) => source.instanceId))
    );

    const repeatedPending: PendingAbilityState = {
      id: 'eternalize-repeat',
      abilityId: PL_N_PB1_042_LIVE_START_SAME_NAME_NIJIGASAKI_REDUCE_REQUIREMENT_ABILITY_ID,
      sourceCardId: scenario.sources[0]!.instanceId,
      controllerId: P1,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_START,
    };
    const repeated = confirm(
      resolvePendingCardEffects({ ...ordered, pendingAbilities: [repeatedPending] }).gameState
    );
    expect(modifiers(repeated)).toHaveLength(2);

    const stalePreview = resolvePendingCardEffects({
      ...repeated,
      pendingAbilities: [{ ...repeatedPending, id: 'eternalize-stale' }],
    }).gameState;
    const stale = updatePlayer(stalePreview, P1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, scenario.sources[0]!.instanceId),
    }));
    const staleResolved = confirm(stale);
    expect(modifiers(staleResolved)).toHaveLength(1);
    expect(modifiers(staleResolved)[0]).toMatchObject({
      sourceCardId: scenario.sources[1]!.instanceId,
    });
  });

  it('opens a confirm-only bridge before a manually selected pending in a multi-ability window', () => {
    const scenario = setup(
      [
        createCardInstance(FAQ_CASES[0].single, P1, 'manual-single'),
        createCardInstance(FAQ_CASES[0].composite, P1, 'manual-composite'),
      ],
      2
    );
    const checked = check(scenario.game);
    const manual = confirmActiveEffectStep(
      checked,
      P1,
      checked.activeEffect!.id,
      scenario.sources[1]!.instanceId
    );
    expect(manual.activeEffect).toMatchObject({
      sourceCardId: scenario.sources[1]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(modifiers(manual)).toEqual([]);
  });

  it('clears the old requirement modifier when the shared-name condition is lost before confirmation', () => {
    const single = createCardInstance(FAQ_CASES[0].single, P1, 'lost-single');
    const composite = createCardInstance(FAQ_CASES[0].composite, P1, 'lost-composite');
    const scenario = setup([single, composite]);
    const first = confirm(check(scenario.game));
    const pending: PendingAbilityState = {
      id: 'eternalize-condition-lost',
      abilityId: PL_N_PB1_042_LIVE_START_SAME_NAME_NIJIGASAKI_REDUCE_REQUIREMENT_ABILITY_ID,
      sourceCardId: scenario.sources[0]!.instanceId,
      controllerId: P1,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_START,
    };
    const preview = resolvePendingCardEffects({ ...first, pendingAbilities: [pending] }).gameState;
    const changed = updatePlayer(preview, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, null),
    }));
    const resolved = confirm(changed);
    expect(modifiers(resolved)).toEqual([]);
  });
});
