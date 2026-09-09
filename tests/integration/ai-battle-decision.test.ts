import { describe, expect, it } from 'vitest';
import { GameCommandType } from '../../src/application/game-commands';
import type { CardInstance, LiveCardData } from '../../src/domain/entities/card';
import { createHeartRequirement } from '../../src/domain/entities/card';
import { getActiveEnergyIds } from '../../src/domain/entities/zone';
import { buildAiBattleDecision, parseAiBattleResponse } from '../../src/server/ai-battle/decision';
import {
  CardType,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';
import { createPublicObjectId } from '../../src/online/projector';
import {
  HANAYO_ACTIVATED_ABILITY_ID,
  PB1_019_ACTIVATED_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  getAiFallbackSelection,
  getAiMechanicalSelection,
} from '../../src/server/ai-battle/policy';
import { readFrozenGreenHasunosoraDeck, readFrozenMuseDeck } from '../helpers/ai-curated-decks';
import { placeEnergyFromDeckToZone } from '../../src/application/effects/energy';
import { summarizeAiSelfResources } from '../../src/server/ai-battle/visible-resources';

import {
  P1,
  P2,
  slots,
  member,
  setup,
  decision,
  submit,
  replaceHand,
  stage,
} from '../helpers/ai-battle-fixture';

describe('AI ordinary decisions through authoritative commands', () => {
  it.each([P1, P2])(
    'waits for public selection display and lets %s advance exactly once',
    (advancingPlayer) => {
      const { session, advanceTime } = setup();
      const source = stage(session, member('PL!-sd1-002-SD', 2), SlotPosition.LEFT);
      const current = decision(session);
      const activate = current.input.space.candidates.find((c) => c.effectText)!;
      submit(session, current, { kind: 'ACTION', actionRef: activate.ref });
      const effectId = session.state!.activeEffect!.id;
      expect(
        session.executeCommand({
          type: GameCommandType.CONFIRM_EFFECT_STEP,
          playerId: P1,
          timestamp: 1000,
          effectId,
          selectedCardId: source,
        }).success
      ).toBe(true);
      const query = () =>
        buildAiBattleDecision(
          session.state!,
          advancingPlayer,
          session.getPlayerViewState(advancingPlayer)!
        );
      const waiting = query();
      expect(waiting.kind).toBe('WAITING_FOR_TIME');
      if (waiting.kind !== 'WAITING_FOR_TIME') throw new Error('Expected public display');
      const gateCommand = {
        type: GameCommandType.CONFIRM_EFFECT_STEP as const,
        playerId: advancingPlayer,
        timestamp: waiting.deadlineAt,
        effectId: session.state!.activeEffect!.id,
        publicCardSelectionAutoAdvanceAt: waiting.deadlineAt,
      };
      expect(session.executeCommand(gateCommand).success).toBe(false);
      expect(session.state!.players[0].waitingRoom.cardIds).toContain(source);
      advanceTime(waiting.deadlineAt - 1001);
      expect(query().kind).toBe('WAITING_FOR_TIME');
      advanceTime(1);
      const ready = decision(session, advancingPlayer);
      const selection = getAiMechanicalSelection(ready)!;
      expect(selection).not.toBeNull();
      const command = ready.toCommand(selection, waiting.deadlineAt);
      expect(command).toEqual(gateCommand);
      expect(session.executeCommand(command).success).toBe(true);
      expect(session.state!.players[0].hand.cardIds).toContain(source);
      expect(session.state!.players[0].waitingRoom.cardIds).not.toContain(source);
      expect(session.executeCommand(command).success).toBe(false);
      expect(session.state!.players[0].hand.cardIds.filter((id) => id === source)).toHaveLength(1);
    }
  );

  it('uses deterministic ordinary fallback without randomness or turning end-phase into a mechanical decision', () => {
    for (const main of [false, true]) {
      const { session, randomCalls } = setup(main);
      const current = decision(session);
      const before = globalThis.structuredClone(session.state);
      const calls = randomCalls();
      expect(getAiMechanicalSelection(current)).toBeNull();
      const fallback = getAiFallbackSelection(current);
      expect(getAiFallbackSelection(current)).toEqual(fallback);
      expect(session.state).toEqual(before);
      expect(randomCalls()).toBe(calls);
      const command = submit(session, current, fallback);
      expect(command.type).toBe(main ? GameCommandType.END_PHASE : GameCommandType.MULLIGAN);
      if (command.type === GameCommandType.MULLIGAN) expect(command.cardIdsToMulligan).toEqual([]);
    }
  });

  it('expresses and executes every starting-hand subset, including keep-all', () => {
    const initial = setup(false);
    const handSize = initial.session.state!.players[0].hand.cardIds.length;
    for (let mask = 0; mask < 2 ** handSize; mask++) {
      const { session } = setup(false);
      const current = decision(session);
      const before = [...session.state!.players[0].hand.cardIds];
      const refs = current.input.space.candidates
        .filter((_, i) => mask & (1 << i))
        .map((c) => c.ref);
      const command = submit(session, current, { kind: 'CARDS', cardRefs: refs });
      expect(command.type).toBe(GameCommandType.MULLIGAN);
      expect(session.state!.players[0].hand.cardIds).toHaveLength(handSize);
      const kept = before.filter((_, i) => !(mask & (1 << i)));
      expect(session.state!.players[0].hand.cardIds).toEqual(expect.arrayContaining(kept));
      expect(buildAiBattleDecision(session.state!, P1).kind).toBe('WAITING_FOR_PLAYER');
      expect(decision(session, P2).input.purpose).toBe('MULLIGAN');
    }
  });

  it('matches an independently enumerated finite play space and pays each quoted cost', () => {
    // Three active energy; left is an old cost-2 member, center entered this turn.
    for (const cost of [1, 3, 5, 6]) {
      const { session } = setup();
      replaceHand(session, [member('ORDINARY', cost)]);
      stage(session, member('OLD', 2), SlotPosition.LEFT);
      const center = stage(session, member('NEW', 8), SlotPosition.CENTER);
      Object.assign(session.state!.players[0], { movedToStageThisTurn: [center] });
      const current = decision(session);
      const energy = getActiveEnergyIds(session.state!.players[0].energyZone).length;
      const expected = slots.filter(
        (slot) =>
          slot !== SlotPosition.CENTER &&
          (slot === SlotPosition.LEFT ? Math.max(0, cost - 2) : cost) <= energy
      );
      const plays = current.input.space.candidates.filter((c) => c.targetSlot);
      expect(plays.map((c) => c.targetSlot)).toEqual(expected);
      for (const slot of expected) {
        const copy = setup();
        const [copyId] = replaceHand(copy.session, [member('ORDINARY', cost)]);
        const copyLeft = stage(copy.session, member('OLD', 2), SlotPosition.LEFT);
        const copyCenter = stage(copy.session, member('NEW', 8), SlotPosition.CENTER);
        Object.assign(copy.session.state!.players[0], { movedToStageThisTurn: [copyCenter] });
        const d = decision(copy.session);
        const action = d.input.space.candidates.find((c) => c.targetSlot === slot)!;
        const beforeEnergy = getActiveEnergyIds(copy.session.state!.players[0].energyZone);
        submit(copy.session, d, { kind: 'ACTION', actionRef: action.ref });
        const after = copy.session.state!.players[0];
        expect(after.memberSlots.slots[slot]).toBe(copyId);
        expect(getActiveEnergyIds(after.energyZone)).toHaveLength(
          beforeEnergy.length - action.energyCost!
        );
        if (slot === SlotPosition.LEFT) expect(after.waitingRoom.cardIds).toContain(copyLeft);
        expect(
          decision(copy.session).input.space.candidates.some((c) => c.targetSlot === slot)
        ).toBe(false);
      }
    }
  });

  it('uses dynamic hand cost excluding the incoming card itself and current relay cost', () => {
    const { session } = setup();
    const [id] = replaceHand(session, [
      member('LL-bp2-001-R+', 20),
      ...Array.from({ length: 17 }, (_, i) => member(`OTHER-${i}`, 30)),
    ]);
    const current = decision(session);
    const action = current.input.space.candidates.find(
      (c) => c.objectId === createPublicObjectId(id!) && c.targetSlot === SlotPosition.RIGHT
    )!;
    expect(action.energyCost).toBe(3);
    expect(current.input.space.candidates.at(-1)!.description).toContain(
      `${action.ref}（登场支付 3，剩余 0 能量）`
    );
    submit(session, current, { kind: 'ACTION', actionRef: action.ref });
    expect(getActiveEnergyIds(session.state!.players[0].energyZone)).toHaveLength(0);
    expect(session.state!.players[0].memberSlots.slots.RIGHT).toBe(id);
  });

  it.each(['PLAY', 'END'] as const)(
    'quotes the green T4 development budget while preserving the legal %s choice',
    (choice) => {
      const { session, randomCalls } = setup();
      const cards = readFrozenGreenHasunosoraDeck().deck.mainDeck;
      const frozenMember = (code: string) => {
        const card = cards.find((item) => item.cardCode === code)!;
        if (card.cardType !== CardType.MEMBER) throw Error('Expected frozen member');
        return card;
      };
      Object.assign(session.state!, { turnCount: 4 });
      Object.assign(
        session.state!,
        placeEnergyFromDeckToZone(session.state!, P1, 4, OrientationState.ACTIVE)!.gameState
      );
      const [incomingId] = replaceHand(session, [frozenMember('PL!HS-sd1-012-SD')]);
      stage(session, frozenMember('PL!HS-PR-014-RM'), SlotPosition.LEFT);
      const center = stage(session, frozenMember('PL!HS-sd1-006-SD'), SlotPosition.CENTER);
      Object.assign(session.state!.players[0], { movedToStageThisTurn: [center] });
      const before = globalThis.structuredClone(session.state);
      const calls = randomCalls();
      const current = decision(session);
      const plays = current.input.space.candidates.filter((c) => c.targetSlot);
      expect(plays.map((c) => c.targetSlot)).toEqual([SlotPosition.LEFT, SlotPosition.RIGHT]);
      const fill = plays.find((c) => c.targetSlot === SlotPosition.RIGHT)!;
      const end = current.input.space.candidates.at(-1)!;
      expect(fill.energyCost).toBe(4);
      expect(fill.description).toContain('舞台顶层成员印刷总费用变化 +4');
      expect(fill.description).toContain('能量 7→3');
      expect(fill.description).toContain(
        '成员数 2→3，印刷总费用 17→21，HEART 8→10，活跃 BLADE 6→7'
      );
      expect(plays[0]!.description).toContain(
        '成员数 2→2，印刷总费用 17→19，HEART 8→9，活跃 BLADE 6→6'
      );
      expect(end.description).toContain(`${fill.ref}（登场支付 4，剩余 3 能量）`);
      expect(end.description).toContain(`${plays[0]!.ref}（登场支付 2，剩余 5 能量）`);
      expect(session.state).toEqual(before);
      expect(randomCalls()).toBe(calls);
      expect(getAiMechanicalSelection(current)).toBeNull();
      const command = submit(session, current, {
        kind: 'ACTION',
        actionRef: choice === 'PLAY' ? fill.ref : end.ref,
      });
      const resources = summarizeAiSelfResources(session.getPlayerViewState(P1)!, 'FIRST');
      expect(resources).toMatchObject({
        activeEnergyCount: choice === 'PLAY' ? 3 : 7,
        stageHeartTotal: choice === 'PLAY' ? 10 : 8,
        activeMemberBladeTotal: choice === 'PLAY' ? 7 : 6,
      });
      expect(resources.stageMembers.reduce((total, m) => total + m.printedCost!, 0)).toBe(
        choice === 'PLAY' ? 21 : 17
      );
      expect(session.state!.players[0].memberSlots.slots.RIGHT).toBe(
        choice === 'PLAY' ? incomingId : null
      );
      expect(command.type).toBe(
        choice === 'PLAY' ? GameCommandType.PLAY_MEMBER_TO_SLOT : GameCommandType.END_PHASE
      );
    }
  );

  it('binds same-name member plays to their own frozen text and preserves zero-cost replacement consequences', () => {
    const { session } = setup();
    const cards = readFrozenMuseDeck().deck.mainDeck;
    const vanilla = cards.find((card) => card.cardCode === 'PL!-sd1-013-SD')!;
    const searcher = cards.find((card) => card.cardCode === 'PL!-sd1-004-SD')!;
    if (vanilla.cardType !== CardType.MEMBER || searcher.cardType !== CardType.MEMBER)
      throw new Error('Expected the frozen member pair');
    expect(vanilla.nameJp).toBe(searcher.nameJp);
    expect(vanilla.cardTextJp).toBeFalsy();
    expect(searcher.cardTextJp).toBeTruthy();
    const [vanillaId, searcherId] = replaceHand(session, [vanilla, searcher]);
    const oldVanilla = stage(session, vanilla, SlotPosition.RIGHT);
    stage(session, searcher, SlotPosition.LEFT);
    const current = decision(session);
    const play = current.input.space.candidates.find(
      (candidate) =>
        candidate.objectId === createPublicObjectId(vanillaId!) &&
        candidate.targetSlot === SlotPosition.RIGHT
    )!;
    const searchPlay = current.input.space.candidates.find(
      (candidate) =>
        candidate.objectId === createPublicObjectId(searcherId!) &&
        candidate.targetSlot === SlotPosition.LEFT
    )!;
    expect(play.description).toContain(vanilla.cardCode);
    expect(play.description).toContain('未提供，不得假设有登场能力');
    expect(play.description).not.toContain(searcher.cardTextJp!);
    expect(searchPlay.description).toContain(searcher.cardCode);
    expect(searchPlay.description).toContain(searcher.cardTextJp!);
    expect(play.energyCost).toBe(0);
    const energy = getActiveEnergyIds(session.state!.players[0].energyZone);
    submit(session, current, { kind: 'ACTION', actionRef: play.ref });
    const player = session.state!.players[0];
    expect(player.hand.cardIds).toEqual([searcherId]);
    expect(player.waitingRoom.cardIds).toContain(oldVanilla);
    expect(player.memberSlots.slots.RIGHT).toBe(vanillaId);
    expect(getActiveEnergyIds(player.energyZone)).toEqual(energy);
    expect(session.state!.activeEffect).toBeNull();
    expect(
      decision(session).input.space.candidates.some(
        (candidate) => candidate.targetSlot === SlotPosition.RIGHT
      )
    ).toBe(false);
  });

  it.each([
    {
      slot: SlotPosition.LEFT,
      cost: 2,
      hearts: 7,
      blades: 5,
      delta: 'HEART 0（PINK 0、YELLOW +1、PURPLE -1）／BLADE +1',
    },
    {
      slot: SlotPosition.CENTER,
      cost: 7,
      hearts: 9,
      blades: 6,
      delta: 'HEART +2（PINK +1、YELLOW +1、PURPLE 0）／BLADE +2',
    },
  ])(
    'compares the T4 ordinary relay at $slot and executes its quoted payment',
    ({ slot, cost, hearts, blades, delta }) => {
      const { session } = setup();
      const cards = readFrozenMuseDeck().deck.mainDeck;
      const frozenMember = (code: string) => {
        const card = cards.find((item) => item.cardCode === code)!;
        if (card.cardType !== CardType.MEMBER) throw Error('Expected frozen member');
        return card;
      };
      Object.assign(session.state!, { turnCount: 4 });
      Object.assign(
        session.state!,
        placeEnergyFromDeckToZone(session.state!, P1, 4, OrientationState.ACTIVE)!.gameState
      );
      const [incomingId] = replaceHand(session, [frozenMember('PL!-sd1-001-SD')]);
      const left = stage(session, frozenMember('PL!-sd1-006-SD'), SlotPosition.LEFT);
      const center = stage(session, frozenMember('PL!-sd1-012-SD'), SlotPosition.CENTER);
      const right = stage(session, frozenMember('PL!-sd1-002-SD'), SlotPosition.RIGHT);
      const resources = () => summarizeAiSelfResources(session.getPlayerViewState(P1)!, 'FIRST');
      expect(resources()).toMatchObject({
        stageHeartTotal: 7,
        activeMemberBladeTotal: 4,
        activeEnergyCount: 7,
        successfulLiveCount: 0,
      });
      const before = globalThis.structuredClone(session.state);
      const current = decision(session);
      const plays = current.input.space.candidates.filter((c) => c.targetSlot);
      expect(plays.map((c) => c.targetSlot)).toEqual([SlotPosition.LEFT, SlotPosition.CENTER]);
      const action = plays.find((c) => c.targetSlot === slot)!;
      expect(action.description).toContain(delta);
      expect(action.description).toContain(`能量 7→${7 - cost}`);
      expect(action.description).toContain(`HEART 7→${hearts}，活跃 BLADE 4→${blades}`);
      expect(action.energyCost).toBe(cost);
      expect(action.replacedObjectIds).toEqual([
        createPublicObjectId(slot === SlotPosition.LEFT ? left : center),
      ]);
      expect(session.state).toEqual(before);
      submit(session, current, { kind: 'ACTION', actionRef: action.ref });
      expect(resources()).toMatchObject({
        stageHeartTotal: hearts,
        activeMemberBladeTotal: blades,
        activeEnergyCount: 7 - cost,
        successfulLiveCount: 0,
      });
      expect(session.state!.players[0].memberSlots.slots[slot]).toBe(incomingId);
      expect(session.state!.players[0].memberSlots.slots.RIGHT).toBe(right);
      expect(session.state!.players[0].waitingRoom.cardIds).toContain(
        slot === SlotPosition.LEFT ? left : center
      );
    }
  );

  it('does not subtract a waiting replaced member from the active BLADE subtotal', () => {
    const { session } = setup();
    replaceHand(session, [member('INCOMING', 4)]);
    const old = stage(session, { ...member('OLD', 9), blade: 3 }, SlotPosition.LEFT);
    Object.assign(session.state!.players[0].memberSlots.cardStates.get(old)!, {
      orientation: OrientationState.WAITING,
    });
    const current = decision(session);
    const play = current.input.space.candidates.find((c) => c.targetSlot === SlotPosition.LEFT)!;
    expect(play.description).toContain('活跃 BLADE 0→1');
    expect(play.description).toContain('印刷总费用 9→4');
    expect(play.energyCost).toBe(0);
    submit(session, current, { kind: 'ACTION', actionRef: play.ref });
    expect(summarizeAiSelfResources(session.getPlayerViewState(P1)!, 'FIRST')).toMatchObject({
      activeMemberBladeTotal: 1,
      activeEnergyCount: 3,
    });
  });

  it('executes self-sacrifice through the registered workflow and retains the target window', () => {
    const { session } = setup();
    const id = stage(session, member('PL!-sd1-002-SD', 2), SlotPosition.LEFT);
    const current = decision(session);
    const action = current.input.space.candidates.find((c) => c.effectText)!;
    const command = submit(session, current, { kind: 'ACTION', actionRef: action.ref });
    expect(command).toMatchObject({
      type: GameCommandType.ACTIVATE_ABILITY,
      cardId: id,
      abilityId: PB1_019_ACTIVATED_ABILITY_ID,
    });
    expect(session.state!.players[0].memberSlots.slots.LEFT).toBeNull();
    expect(session.state!.players[0].waitingRoom.cardIds).toContain(id);
    expect(session.state!.activeEffect?.selectableCardIds).toContain(id);
    const target = decision(session);
    expect(target.input.space.kind).toBe('CARDS');
    expect(target.input.space.candidates.map((candidate) => candidate.objectId)).toContain(
      createPublicObjectId(id)
    );
    expect(() =>
      parseAiBattleResponse(target, JSON.stringify({ selection: { kind: 'CARDS', cardRefs: [] } }))
    ).toThrow();
  });

  it.each(['SD', 'FUTURE'])(
    'excludes unpayable activations and consumed per-source per-turn uses (%s)',
    (rarity) => {
      const { session } = setup();
      const id = stage(session, member(`PL!-sd1-008-${rarity}`, 4), SlotPosition.LEFT);
      const current = decision(session);
      const action = current.input.space.candidates.find((c) => c.effectText)!;
      submit(session, current, { kind: 'ACTION', actionRef: action.ref });
      expect(
        session.state!.actionHistory.some(
          (a) => a.type === 'PAY_COST' && a.payload.abilityId === HANAYO_ACTIVATED_ABILITY_ID
        )
      ).toBe(true);
      expect(getActiveEnergyIds(session.state!.players[0].energyZone)).toHaveLength(1);
      expect(decision(session).input.space.candidates.some((c) => c.effectText)).toBe(false);
      const second = stage(session, member(`PL!-sd1-008-${rarity}`, 4), SlotPosition.RIGHT);
      expect(second).not.toBe(id);
      expect(decision(session).input.space.candidates.some((c) => c.effectText)).toBe(false);
      for (const state of session.state!.players[0].energyZone.cardStates.values())
        Object.assign(state, { orientation: OrientationState.ACTIVE });
      const next = decision(session);
      expect(
        next.input.space.candidates.filter((c) => c.effectText).map((c) => c.objectId)
      ).toEqual([createPublicObjectId(second)]);
    }
  );

  it('keeps two granted copies on one source distinct and executes the selected instance', () => {
    for (const selectedIndex of [0, 1]) {
      const { session } = setup();
      const host = stage(session, member('PL!SP-pb2-005-R', 20), SlotPosition.CENTER);
      const player = session.state!.players[0];
      const below = player.mainDeck.cardIds.slice(0, 2);
      Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(2) });
      Object.assign(player.memberSlots.memberBelow, { CENTER: below });
      for (const id of below)
        (session.state!.cardRegistry as Map<string, CardInstance>).set(id, {
          ...session.state!.cardRegistry.get(id)!,
          data: { ...member('PL!SP-bp4-015-N', 2), groupNames: ['Liella!'] },
        });
      const current = decision(session);
      const activations = current.input.space.candidates.filter((c) => c.effectText);
      expect(activations).toHaveLength(2);
      expect(activations.map((c) => c.objectId)).toEqual([
        createPublicObjectId(host),
        createPublicObjectId(host),
      ]);
      const commands = activations.map((c) =>
        current.toCommand({ kind: 'ACTION', actionRef: c.ref }, 1000)
      );
      expect(commands[0]).not.toEqual(commands[1]);
      const command = submit(session, current, {
        kind: 'ACTION',
        actionRef: activations[selectedIndex]!.ref,
      });
      expect(command.type).toBe(GameCommandType.ACTIVATE_ABILITY);
      expect(session.state!.players[0].memberSlots.slots.CENTER).toBeNull();
      expect(session.state!.players[0].waitingRoom.cardIds).toEqual(
        expect.arrayContaining([host, ...below])
      );
      if (command.type === GameCommandType.ACTIVATE_ABILITY) {
        expect(command.abilityInstanceId).toBeDefined();
        expect(session.state!.activeEffect?.abilityInstanceId).toBe(command.abilityInstanceId);
      }
    }
  });

  it('sets any hand card, enforces the actual count, permits only current facedown withdrawal', () => {
    const { session } = setup();
    const stageMember = stage(session, member('STAGE-KEPT', 3), SlotPosition.LEFT);
    const initialHandCount = session.state!.players[0].hand.cardIds.length;
    Object.assign(session.state!, {
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
      waitingPlayerId: null,
    });
    for (let i = 0; i < 3; i++) {
      const current = decision(session);
      const action = current.input.space.candidates.find(
        (c) =>
          current.toCommand({ kind: 'ACTION', actionRef: c.ref }, 1000).type ===
          GameCommandType.SET_LIVE_CARD
      )!;
      expect(action).toBeDefined();
      submit(session, current, { kind: 'ACTION', actionRef: action.ref });
    }
    const full = decision(session);
    const commands = full.input.space.candidates.map((c) =>
      full.toCommand({ kind: 'ACTION', actionRef: c.ref }, 1000)
    );
    expect(commands.filter((c) => c.type === GameCommandType.SET_LIVE_CARD)).toHaveLength(0);
    expect(commands.filter((c) => c.type === GameCommandType.UNSET_LIVE_CARD)).toHaveLength(3);
    const unset = full.input.space.candidates[0]!;
    submit(session, full, { kind: 'ACTION', actionRef: unset.ref });
    expect(session.state!.players[0].liveZone.cardIds).toHaveLength(2);
    const next = decision(session);
    expect(
      next.input.space.candidates.some(
        (c) =>
          next.toCommand({ kind: 'ACTION', actionRef: c.ref }, 1000).type ===
          GameCommandType.SET_LIVE_CARD
      )
    ).toBe(true);
    const finish = next.input.space.candidates.at(-1)!;
    expect(finish.description).toContain('本次已盖 2 张，确认后抽 2 张');
    const deckCount = session.state!.players[0].mainDeck.cardIds.length;
    submit(session, next, { kind: 'ACTION', actionRef: finish.ref });
    expect(session.state!.players[0].hand.cardIds).toHaveLength(initialHandCount);
    expect(session.state!.players[0].mainDeck.cardIds).toHaveLength(deckCount - 2);
    expect(session.state!.players[0].memberSlots.slots.LEFT).toBe(stageMember);
    expect(buildAiBattleDecision(session.state!, P1).kind).toBe('WAITING_FOR_PLAYER');
    expect(decision(session, P2).input.purpose).toBe('LIVE_SET');
  });

  it('does not mutate authority, consume randomness, or retain mutable projected references', () => {
    const { session, randomCalls } = setup();
    const before = globalThis.structuredClone(session.state);
    const calls = randomCalls();
    const current = decision(session);
    const serialized = JSON.stringify(current.input);
    for (const candidate of current.input.space.candidates)
      current.toCommand({ kind: 'ACTION', actionRef: candidate.ref }, 1000);
    expect(session.state).toEqual(before);
    expect(randomCalls()).toBe(calls);
    const end = current.input.space.candidates.at(-1)!;
    submit(session, current, { kind: 'ACTION', actionRef: end.ref });
    expect(JSON.stringify(current.input)).toBe(serialized);
  });

  it('preserves identical model material when only hidden identities and unknown deck order change', () => {
    const { session } = setup();
    const before = decision(session).input;
    const changed = globalThis.structuredClone(session.state!);
    for (const player of changed.players)
      Object.assign(player.mainDeck, { cardIds: [...player.mainDeck.cardIds].reverse() });
    const secret: LiveCardData = {
      cardCode: 'SECRET-LIVE',
      name: 'secret',
      cardType: CardType.LIVE,
      score: 99,
      requirements: createHeartRequirement({}),
    };
    for (const id of changed.players[1].hand.cardIds)
      (changed.cardRegistry as Map<string, CardInstance>).set(id, {
        ...changed.cardRegistry.get(id)!,
        data: secret,
      });
    const result = buildAiBattleDecision(changed, P1);
    expect(result.kind).toBe('DECISION');
    if (result.kind === 'DECISION') expect(result.decision.input).toEqual(before);
    expect(JSON.stringify(before)).not.toContain('SECRET-LIVE');
  });

  it('rejects wrong kind, unknown reference, duplicate cards, extra fields and prose', () => {
    const current = decision(setup(false).session);
    const ref = current.input.space.candidates[0]!.ref;
    for (const value of [
      { selection: { kind: 'ACTION', actionRef: 'a1' } },
      { selection: { kind: 'CARDS', cardRefs: ['missing'] } },
      { selection: { kind: 'CARDS', cardRefs: [ref, ref] } },
      { selection: { kind: 'CARDS', cardRefs: [], playerId: P2 } },
      { selection: { kind: 'CARDS', cardRefs: [] }, command: 'SURRENDER' },
    ])
      expect(() => parseAiBattleResponse(current, JSON.stringify(value))).toThrow();
    expect(() => parseAiBattleResponse(current, '```json\n{}\n```')).toThrow();
    expect(() => current.toCommand({ kind: 'CARDS', cardRefs: [ref, ref] }, 1000)).toThrow();
  });
});
