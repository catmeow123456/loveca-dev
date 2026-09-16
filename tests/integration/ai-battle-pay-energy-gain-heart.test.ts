import { describe, expect, it } from 'vitest';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID,
  PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID as SHIZUKU_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { GameCommandType, type GameCommand } from '../../src/application/game-commands';
import type { GameSession } from '../../src/application/game-session';
import type { MemberCardData } from '../../src/domain/entities/card';
import { getActiveEnergyIds } from '../../src/domain/entities/zone';
import {
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import { createPublicObjectId } from '../../src/online/projector';
import {
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { buildAiBattleDecision, parseAiBattleResponse } from '../../src/server/ai-battle/decision';
import { getAiMechanicalSelection } from '../../src/server/ai-battle/policy';
import { readFrozenBluePurpleDeck } from '../helpers/ai-curated-decks';
import { P1, P2, setup, stage, member, decision, submit } from '../helpers/ai-battle-fixture';

const shizuku = readFrozenBluePurpleDeck().deck.mainDeck.find((card) =>
  card.cardCode.startsWith('PL!N-bp1-003-')
) as MemberCardData;
const colors = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
];

function pending(sourceCardId: string, abilityId = SHIZUKU_ABILITY_ID) {
  return {
    id: `pending:${sourceCardId}`,
    sourceCardId,
    abilityId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [],
  };
}

function setupHeart(
  options: { rarity?: string; activeEnergy?: number; marked?: boolean; costTwo?: boolean } = {}
) {
  const fixture = setup();
  const data = options.costTwo
    ? member('PL!N-sd1-010-SD')
    : { ...shizuku, cardCode: `PL!N-bp1-003-${options.rarity ?? 'P+'}` };
  const source = stage(fixture.session, data, SlotPosition.CENTER);
  const abilityId = options.costTwo
    ? N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID
    : SHIZUKU_ABILITY_ID;
  const game = fixture.session.state!;
  const player = game.players[0];
  const energyIds = player.energyZone.cardIds;
  energyIds.forEach((id, index) =>
    Object.assign(player.energyZone.cardStates.get(id)!, {
      orientation:
        index < (options.activeEnergy ?? 3) ? OrientationState.ACTIVE : OrientationState.WAITING,
    })
  );
  if (options.marked)
    Object.assign(game, {
      energyActivePhaseSkips: [
        {
          playerId: P1,
          energyCardId: energyIds[1]!,
          sourceCardId: source,
          abilityId: 'test-energy-marker',
        },
      ],
    });
  Object.assign(game, { pendingAbilities: [pending(source, abilityId)] });
  Object.assign(game, resolvePendingCardEffects(game).gameState);
  return { ...fixture, source, energyIds, abilityId };
}

type EffectCommand = Extract<GameCommand, { type: GameCommandType.CONFIRM_EFFECT_STEP }>;
function optionActions(session: GameSession) {
  const current = decision(session);
  expect(current.input.space.kind).toBe('ACTION');
  return {
    current,
    choices: current.input.space.candidates.map((candidate) => ({
      candidate,
      command: current.toCommand(
        { kind: 'ACTION', actionRef: candidate.ref },
        1000
      ) as EffectCommand,
    })),
  };
}

function chooseOption(session: GameSession, optionId?: string) {
  const { current, choices } = optionActions(session);
  const choice = choices.find(({ command }) =>
    optionId === undefined
      ? command.selectedCardId === null
      : command.selectedOptionId === optionId || command.selectedEffectOptionIds?.[0] === optionId
  );
  expect(choice).toBeDefined();
  return submit(session, current, { kind: 'ACTION', actionRef: choice!.candidate.ref });
}

function finishDisplay(fixture: ReturnType<typeof setupHeart>) {
  const gate = buildAiBattleDecision(
    fixture.session.state!,
    P2,
    fixture.session.getPlayerViewState(P2)!
  );
  expect(gate.kind).toBe('WAITING_FOR_TIME');
  fixture.advanceTime(10_000);
  const current = decision(fixture.session, P2);
  expect(current.input.purpose).toBe('PUBLIC_DISPLAY');
  submit(fixture.session, current, getAiMechanicalSelection(current)!);
}

function heartCount(session: GameSession, source: string, color: HeartColor) {
  return getMemberEffectiveHeartIcons(
    session.state!,
    P1,
    source,
    collectLiveModifiers(session.state!)
  )
    .filter((heart) => heart.color === color)
    .reduce((sum, heart) => sum + heart.count, 0);
}

describe('AI pay energy and gain Heart through authority commands', () => {
  it.each(
    colors.map((color, index) => ({
      color,
      rarity: ['P', 'P+', 'P＋', 'R+', 'SEC', 'TEST'][index]!,
    }))
  )(
    'pays before choosing $color and resolves after public display ($rarity)',
    ({ color, rarity }) => {
      const f = setupHeart({ rarity });
      const other = stage(f.session, member(), SlotPosition.LEFT);
      const initialHearts = heartCount(f.session, f.source, color);
      const otherHearts = heartCount(f.session, other, color);
      const before = structuredClone(f.session.state);
      const randomCalls = f.randomCalls();
      const { choices } = optionActions(f.session);
      expect(
        choices.map(({ command }) => command.selectedOptionId ?? command.selectedCardId)
      ).toEqual(['pay', null]);
      expect(f.session.state).toEqual(before);
      expect(f.randomCalls()).toBe(randomCalls);
      chooseOption(f.session, 'pay');
      expect(getActiveEnergyIds(f.session.state!.players[0].energyZone)).toEqual(
        f.energyIds.slice(1)
      );
      const choosing = optionActions(f.session);
      expect(choosing.choices.map(({ command }) => command.selectedEffectOptionIds)).toEqual(
        colors.map((value) => [value])
      );
      expect(getAiMechanicalSelection(choosing.current)).toBeNull();
      const unpaidReward = f.session.state;
      for (const selectedEffectOptionIds of [
        undefined,
        [],
        [HeartColor.RAINBOW],
        [HeartColor.PINK, HeartColor.BLUE],
      ]) {
        expect(
          f.session.executeCommand({
            type: GameCommandType.CONFIRM_EFFECT_STEP,
            playerId: P1,
            timestamp: 1000,
            effectId: unpaidReward!.activeEffect!.id,
            selectedEffectOptionIds,
          }).success
        ).toBe(false);
        expect(f.session.state).toBe(unpaidReward);
      }
      chooseOption(f.session, color);
      expect(heartCount(f.session, f.source, color)).toBe(initialHearts);
      finishDisplay(f);
      expect(heartCount(f.session, f.source, color)).toBe(initialHearts + 1);
      expect(heartCount(f.session, other, color)).toBe(otherHearts);
      expect(getActiveEnergyIds(f.session.state!.players[0].energyZone)).toEqual(
        f.energyIds.slice(1)
      );
      expect(f.session.state!.activeEffect).toBeNull();
    }
  );

  it.each([0, 1, 3])(
    'can decline without paying or gaining Heart with %s active energy',
    (activeEnergy) => {
      const f = setupHeart({ activeEnergy });
      const before = structuredClone(f.session.state!.players[0].energyZone);
      const { choices } = optionActions(f.session);
      expect(choices).toHaveLength(activeEnergy === 0 ? 1 : 2);
      chooseOption(f.session);
      expect(f.session.state!.players[0].energyZone).toEqual(before);
      expect(f.session.state!.liveResolution.liveModifiers).toEqual([]);
      expect(f.session.state!.activeEffect).toBeNull();
    }
  );

  it.each([false, true])(
    'selects exact special energy, pays once and resumes the reward (costTwo=%s)',
    (costTwo) => {
      const f = setupHeart({ marked: true, costTwo });
      const color = costTwo ? HeartColor.GREEN : HeartColor.BLUE;
      const initialHearts = heartCount(f.session, f.source, color);
      chooseOption(f.session, 'pay');
      const current = decision(f.session);
      const count = costTwo ? 2 : 1;
      expect(current.input.space).toMatchObject({
        kind: 'CARDS',
        min: count,
        max: count,
        canSkip: false,
      });
      expect(current.input.space.candidates.map((candidate) => candidate.objectId)).toEqual(
        f.energyIds.map(createPublicObjectId)
      );
      expect(getActiveEnergyIds(f.session.state!.players[0].energyZone)).toEqual(f.energyIds);
      const refs = current.input.space.candidates.map((candidate) => candidate.ref);
      for (const cardRefs of [[], [refs[0]!, refs[0]!], ['unknown-energy']]) {
        expect(() =>
          parseAiBattleResponse(current, JSON.stringify({ selection: { kind: 'CARDS', cardRefs } }))
        ).toThrow();
      }
      submit(f.session, current, { kind: 'CARDS', cardRefs: refs.slice(1, count + 1) });
      expect(getActiveEnergyIds(f.session.state!.players[0].energyZone)).toEqual(
        f.energyIds.filter((_, index) => index === 0 || index > count)
      );
      if (!costTwo) {
        chooseOption(f.session, color);
        finishDisplay(f);
      }
      expect(heartCount(f.session, f.source, color)).toBe(initialHearts + 1);
      expect(f.session.state!.activeEffect).toBeNull();
    }
  );

  it('rejects stale special energy and allows a remaining legal choice', () => {
    const f = setupHeart({ marked: true });
    chooseOption(f.session, 'pay');
    const current = decision(f.session);
    const refs = current.input.space.candidates.map((candidate) => candidate.ref);
    const command = current.toCommand({ kind: 'CARDS', cardRefs: [refs[1]!] }, 1000);
    Object.assign(f.session.state!.players[0].energyZone.cardStates.get(f.energyIds[1]!)!, {
      orientation: OrientationState.WAITING,
    });
    const before = f.session.state;
    expect(f.session.executeCommand(command).success).toBe(false);
    expect(f.session.state).toBe(before);
    submit(f.session, current, { kind: 'CARDS', cardRefs: [refs[0]!] });
    chooseOption(f.session, HeartColor.BLUE);
    finishDisplay(f);
    expect(f.session.state!.activeEffect).toBeNull();
    expect(getActiveEnergyIds(f.session.state!.players[0].energyZone)).toEqual([f.energyIds[2]]);
  });

  it('continues the next pending ability only after the chosen Heart finishes displaying', () => {
    const f = setupHeart();
    const other = stage(f.session, shizuku, SlotPosition.LEFT);
    Object.assign(f.session.state!, { pendingAbilities: [pending(other)] });
    chooseOption(f.session, 'pay');
    chooseOption(f.session, HeartColor.PURPLE);
    expect(f.session.state!.activeEffect!.sourceCardId).toBe(f.source);
    expect(f.session.state!.pendingAbilities).toContainEqual(pending(other));
    finishDisplay(f);
    expect(f.session.state!.activeEffect).toMatchObject({
      sourceCardId: other,
      stepId: 'N_BP1_003_PAY_ONE_ENERGY',
    });
    chooseOption(f.session);
    expect(f.session.state!.activeEffect).toBeNull();
    expect(f.session.state!.pendingAbilities).toEqual([]);
  });
});
