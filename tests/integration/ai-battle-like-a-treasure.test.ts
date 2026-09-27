import { describe, expect, it } from 'vitest';
import { GameCommandType } from '../../src/application/game-commands';
import { N_BP7_006_ACTIVATED_PAY_ENERGY_INSPECT_TOP_FOUR_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { createGameSession } from '../../src/application/game-session';
import type { AnyCardData, CardInstance, MemberCardData } from '../../src/domain/entities/card';
import { getActiveEnergyIds } from '../../src/domain/entities/zone';
import {
  CardType,
  FaceState,
  GameEndReason,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';
import {
  buildAiBattleDecision,
  materializeAiDecisionCommands,
  parseAiBattleResponse,
} from '../../src/server/ai-battle/decision';
import { getAiMechanicalSelection } from '../../src/server/ai-battle/policy';
import { createPublicObjectId } from '../../src/online/projector';
import { readFrozenLikeATreasureDeck } from '../helpers/ai-curated-decks';
import { chooseAiTestSelection } from '../helpers/ai-battle-test-policy';
import { P1, P2, setup, stage, replaceHand, decision, submit } from '../helpers/ai-battle-fixture';

const cards = readFrozenLikeATreasureDeck().deck.mainDeck;
function card(base: string): AnyCardData {
  const found = cards.find((value) => value.cardCode.startsWith(`${base}-`));
  if (!found) throw new Error(`Missing Like a Treasure card: ${base}`);
  return found;
}

function specialFixture(energyCount = 6) {
  const f = setup();
  const oldId = stage(f.session, card('PL!N-pb1-030') as MemberCardData, SlotPosition.CENTER);
  const [sourceId] = replaceHand(f.session, [card('PL!N-bp7-011')]);
  const game = f.session.state!;
  const player = game.players[0];
  const [waitingMember, waitingLive] = player.mainDeck.cardIds.slice(0, 2);
  const registry = game.cardRegistry as Map<string, CardInstance>;
  registry.set(waitingMember!, { ...registry.get(waitingMember!)!, data: card('PL!HS-PR-021') });
  registry.set(waitingLive!, { ...registry.get(waitingLive!)!, data: card('PL!N-bp7-031') });
  Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(2) });
  Object.assign(player.waitingRoom, { cardIds: [waitingMember!, waitingLive!] });
  const energies = [...player.energyZone.cardIds, ...player.energyDeck.cardIds].slice(
    0,
    energyCount
  );
  Object.assign(player.energyZone, {
    cardIds: energies,
    cardStates: new Map(
      energies.map((id) => [id, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }])
    ),
  });
  Object.assign(player.energyDeck, {
    cardIds: player.energyDeck.cardIds.filter((id) => !energies.includes(id)),
  });
  return {
    ...f,
    sourceId: sourceId!,
    oldId,
    waitingMember: waitingMember!,
    waitingLive: waitingLive!,
  };
}

describe('Like a Treasure uses existing authoritative AI windows', () => {
  it.each([1, 2])(
    'finishes a deterministic mirror game through visible decisions (seed %i)',
    (seed) => {
      let now = 1000;
      let random = seed;
      const session = createGameSession({
        now: () => now,
        randomInt: (max) => {
          random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
          return random % max;
        },
      });
      session.createGame(`treasure-${seed}`, P1, 'AI 1', P2, 'AI 2');
      const deck = readFrozenLikeATreasureDeck().deck;
      expect(session.initializeGame(deck, deck).success).toBe(true);
      for (let step = 0; step < 1600 && !session.state!.isEnded; step++) {
        const queries = [P1, P2].map((id) =>
          buildAiBattleDecision(session.state!, id, session.getPlayerViewState(id)!)
        );
        const unsupported = queries.find((query) => query.kind === 'UNSUPPORTED');
        expect(unsupported, JSON.stringify(unsupported)).toBeUndefined();
        const next = queries.find((query) => query.kind === 'DECISION');
        if (next?.kind === 'DECISION') {
          const selection =
            getAiMechanicalSelection(next.decision) ?? chooseAiTestSelection(next.decision.input);
          for (const command of materializeAiDecisionCommands(next.decision, selection, now)) {
            const result = session.executeCommand(command);
            expect(result.success, result.error).toBe(true);
          }
          now += 10;
        } else {
          const waiting = queries.find((query) => query.kind === 'WAITING_FOR_TIME');
          if (waiting?.kind !== 'WAITING_FOR_TIME') throw new Error(JSON.stringify(queries));
          now = waiting.deadlineAt;
        }
      }
      expect(session.state!.isEnded).toBe(true);
      expect([GameEndReason.VICTORY_CONDITION, GameEndReason.DRAW]).toContain(
        session.state!.endInfo?.reason
      );
    },
    30_000
  );
  it.each([
    ...new Map(
      cards
        .filter((value) => value.cardType === CardType.MEMBER)
        .map((value) => [value.cardCode, value])
    ).values(),
  ])(
    'queries the MAIN window with $cardCode on stage without an unregistered activation',
    (source) => {
      const f = setup();
      stage(f.session, source as MemberCardData, SlotPosition.CENTER);
      expect(buildAiBattleDecision(f.session.state!, P1).kind).toBe('DECISION');
    }
  );
  it('quotes normal and discounted relay separately, then confirms the chosen procedure without another model call', () => {
    const f = specialFixture();
    const before = globalThis.structuredClone(f.session.state!);
    const randomCalls = f.randomCalls();
    const current = decision(f.session);
    expect(f.session.state).toEqual(before);
    expect(f.randomCalls()).toBe(randomCalls);
    const plays = current.input.space.candidates.filter(
      (candidate) => candidate.targetSlot === SlotPosition.CENTER
    );
    expect(plays.map((candidate) => candidate.energyCost).sort()).toEqual([4, 6]);
    const discounted = plays.find((candidate) => candidate.energyCost === 4)!;
    submit(f.session, current, { kind: 'ACTION', actionRef: discounted.ref });
    expect(f.session.state!.players[0].hand.cardIds).toContain(f.sourceId);
    expect(buildAiBattleDecision(f.session.state!, P2).kind).toBe('WAITING_FOR_PLAYER');
    const confirmation = decision(f.session);
    expect(confirmation.input.purpose).toBe('EFFECT_CONFIRM');
    const selection = getAiMechanicalSelection(confirmation)!;
    expect(selection).not.toBeNull();
    expect(() =>
      parseAiBattleResponse(
        confirmation,
        JSON.stringify({ selection: { kind: 'ACTION', actionRef: 'invented' } })
      )
    ).toThrow();
    const command = submit(f.session, confirmation, selection);
    const after = f.session.state!.players[0];
    expect(after.memberSlots.slots[SlotPosition.CENTER]).toBe(f.sourceId);
    expect(getActiveEnergyIds(after.energyZone)).toHaveLength(2);
    expect(after.mainDeck.cardIds).toContain(f.waitingMember);
    expect(after.waitingRoom.cardIds).toEqual(expect.arrayContaining([f.waitingLive, f.oldId]));
    expect(after.waitingRoom.cardIds).not.toContain(f.waitingMember);
    expect(f.session.executeCommand(command).success).toBe(false);
  });

  it('offers the special relay when ordinary relay is unaffordable, and removes it below its actual cost', () => {
    for (const [energy, expected] of [
      [4, [4]],
      [3, []],
    ] as const) {
      const f = specialFixture(energy);
      const current = decision(f.session);
      expect(
        current.input.space.candidates
          .filter((candidate) => candidate.targetSlot)
          .map((candidate) => candidate.energyCost)
      ).toEqual(expected);
    }
  });

  it('allows ordinary relay to preserve waiting members and fails closed on an incomplete private projection', () => {
    const f = specialFixture();
    const current = decision(f.session);
    const ordinary = current.input.space.candidates.find(
      (candidate) => candidate.energyCost === 6
    )!;
    submit(f.session, current, { kind: 'ACTION', actionRef: ordinary.ref });
    expect(f.session.state!.players[0].waitingRoom.cardIds).toContain(f.waitingMember);
    expect(getActiveEnergyIds(f.session.state!.players[0].energyZone)).toHaveLength(0);

    const other = specialFixture();
    const begin = decision(other.session);
    submit(other.session, begin, {
      kind: 'ACTION',
      actionRef: begin.input.space.candidates.find((c) => c.energyCost === 4)!.ref,
    });
    const view = other.session.getPlayerViewState(P1)!;
    const stripped = { ...view, objects: { ...view.objects } };
    delete stripped.objects[createPublicObjectId(other.waitingMember)];
    expect(buildAiBattleDecision(other.session.state!, P1, stripped)).toMatchObject({
      kind: 'UNSUPPORTED',
    });
  });

  it('offers both Kanata activations through the generic activation query', () => {
    const f = setup();
    const source = stage(f.session, card('PL!N-bp7-006') as MemberCardData, SlotPosition.CENTER);
    const current = decision(f.session);
    const activations = current.input.space.candidates.filter((candidate) => {
      if (candidate.objectId !== createPublicObjectId(source)) return false;
      return (
        current.toCommand({ kind: 'ACTION', actionRef: candidate.ref }, 1000).type ===
        GameCommandType.ACTIVATE_ABILITY
      );
    });
    expect(activations).toHaveLength(2);
  });

  it('exposes and executes waiting-room Kasumi revival through legal selections', () => {
    const f = setup();
    replaceHand(f.session, [card('PL!HS-PR-021')]);
    const game = f.session.state!;
    const player = game.players[0];
    const id = player.mainDeck.cardIds[0]!;
    Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(1) });
    Object.assign(player.waitingRoom, { cardIds: [id] });
    const registry = game.cardRegistry as Map<string, CardInstance>;
    registry.set(id, { ...registry.get(id)!, data: card('PL!N-bp1-002') });
    const current = decision(f.session);
    const action = current.input.space.candidates.find(
      (candidate) => candidate.objectId === createPublicObjectId(id)
    )!;
    expect(action).toBeDefined();
    submit(f.session, current, { kind: 'ACTION', actionRef: action.ref });
    const discard = decision(f.session);
    submit(f.session, discard, {
      kind: 'CARDS',
      cardRefs: [discard.input.space.candidates[0]!.ref],
    });
    const slot = decision(f.session);
    expect(slot.input.space.candidates.map((candidate) => candidate.targetSlot)).toEqual([
      SlotPosition.LEFT,
      SlotPosition.CENTER,
      SlotPosition.RIGHT,
    ]);
    const view = f.session.getPlayerViewState(P1)!;
    expect(
      buildAiBattleDecision(f.session.state!, P1, {
        ...view,
        activeEffect: { ...view.activeEffect!, selectableSlots: [SlotPosition.LEFT] },
      }).kind
    ).toBe('UNSUPPORTED');
    submit(f.session, slot, { kind: 'ACTION', actionRef: slot.input.space.candidates[0]!.ref });
    expect(f.session.state!.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(id);
    expect(getActiveEnergyIds(f.session.state!.players[0].energyZone)).toHaveLength(1);
    const inspection = decision(f.session);
    expect(inspection.input.space.kind).toBe('CARDS');
    submit(f.session, inspection, {
      kind: 'CARDS',
      cardRefs: inspection.input.space.candidates.map((candidate) => candidate.ref).reverse(),
    });
    expect(f.session.state!.activeEffect).toBeNull();
  });

  it('keeps Kanata top-four inspection private and executes a complete ordered selection', () => {
    const f = setup();
    stage(f.session, card('PL!N-bp7-006') as MemberCardData, SlotPosition.CENTER);
    const top = f.session.state!.players[0].mainDeck.cardIds.slice(0, 4);
    const current = decision(f.session);
    const activation = current.input.space.candidates.find((candidate) => {
      const command = current.toCommand({ kind: 'ACTION', actionRef: candidate.ref }, 1000);
      return (
        command.type === GameCommandType.ACTIVATE_ABILITY &&
        command.abilityId === N_BP7_006_ACTIVATED_PAY_ENERGY_INSPECT_TOP_FOUR_ABILITY_ID
      );
    })!;
    submit(f.session, current, { kind: 'ACTION', actionRef: activation.ref });
    expect(getActiveEnergyIds(f.session.state!.players[0].energyZone)).toHaveLength(2);
    expect(buildAiBattleDecision(f.session.state!, P2).kind).toBe('WAITING_FOR_PLAYER');
    const opponent = f.session.getPlayerViewState(P2)!;
    for (const id of top)
      expect(opponent.objects[createPublicObjectId(id)]?.frontInfo).toBeUndefined();
    const inspection = decision(f.session);
    expect(inspection.input.space).toMatchObject({ kind: 'CARDS', min: 4, max: 4 });
    expect(() =>
      parseAiBattleResponse(
        inspection,
        JSON.stringify({
          selection: { kind: 'CARDS', cardRefs: [inspection.input.space.candidates[0]!.ref] },
        })
      )
    ).toThrow();
    const order = [...inspection.input.space.candidates].reverse();
    submit(f.session, inspection, {
      kind: 'CARDS',
      cardRefs: order.map((candidate) => candidate.ref),
    });
    expect(
      f.session.state!.players[0].mainDeck.cardIds.slice(0, 4).map(createPublicObjectId)
    ).toEqual(order.map((candidate) => candidate.objectId));
    expect(f.session.state!.inspectionContext).toBeNull();
    expect(f.session.state!.activeEffect).toBeNull();
  });
});
