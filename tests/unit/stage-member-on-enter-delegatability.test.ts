import { describe, expect, it, vi } from 'vitest';
import { getStageMemberDelegatableOnEnterDefinitions } from '../../src/application/card-effects/runtime/delegatable-definitions';
import { startDelegatedAbilitySequence } from '../../src/application/card-effects/runtime/delegated-ability-sequence';
import { registerPendingAbilityStarterHandler } from '../../src/application/card-effects/runtime/starter-registry';
import { createCardInstance } from '../../src/domain/entities/card';
import {
  addAction,
  createGameState,
  registerCards,
  updatePlayer,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { CardType, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const CASES = [
  'PL!S-pb1-001-R',
  'PL!S-pb1-002-R',
  'PL!S-bp5-004-R',
] as const;

function scenario(cardCode: string) {
  const card = createCardInstance(
    { cardCode, name: cardCode, cardType: CardType.MEMBER, cost: 1, blade: 1, hearts: [] },
    'p1',
    `member:${cardCode}`
  );
  let game = registerCards(createGameState(`delegate:${cardCode}`, 'p1', 'P1', 'p2', 'P2'), [card]);
  game = updatePlayer(game, 'p1', (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, card.instanceId),
  }));
  const definition = getStageMemberDelegatableOnEnterDefinitions(
    cardCode,
    SlotPosition.CENTER
  )[0];
  expect(definition).toBeDefined();
  const ability: PendingAbilityState = {
    id: `pending:${cardCode}`,
    abilityId: definition.abilityId,
    sourceCardId: card.instanceId,
    controllerId: 'p1',
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`synthetic:${cardCode}`],
    sourceSlot: SlotPosition.CENTER,
  };
  return { game, ability };
}

describe('current stage-member ON_ENTER delegatability', () => {
  it.each(CASES)('queries %s through the narrow PLAYED_MEMBER/STAGE_MEMBER compatibility boundary', (cardCode) => {
    expect(
      getStageMemberDelegatableOnEnterDefinitions(cardCode, SlotPosition.CENTER)
    ).toHaveLength(1);
  });

  it('skips a valid definition with no registered starter and completes its continuation', () => {
    const { game, ability } = scenario(CASES[0]);
    const done = startDelegatedAbilitySequence(
      game,
      {
        id: 'missing-starter-sequence',
        controllerId: 'p1',
        parentAbilityId: 'parent',
        parentSourceCardId: 'parent-source',
        parentEffectId: 'parent-pending',
        orderedResolution: false,
        abilities: [ability],
      },
      vi.fn((state) => state)
    );
    expect(done.delegatedAbilitySequence).toBeNull();
    expect(done.actionHistory.map((action) => action.payload.step)).toEqual([
      'DELEGATED_ABILITY_STARTER_MISSING',
      'DELEGATED_ABILITY_SEQUENCE_COMPLETE',
    ]);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      skippedPendingAbilityIds: [ability.id],
      skippedAbilityIds: [ability.abilityId],
    });
  });

  it.each(CASES)('treats action-only %s delegation as no progress and completes safely', (cardCode) => {
    const { game, ability } = scenario(cardCode);
    registerPendingAbilityStarterHandler(ability.abilityId, (state) => state);
    const delegate = vi.fn((state) =>
      addAction(state, 'RESOLVE_ABILITY', 'p1', { step: 'TEST_DELEGATE_PROGRESS' })
    );
    const done = startDelegatedAbilitySequence(
      game,
      {
        id: `legal-sequence:${cardCode}`,
        controllerId: 'p1',
        parentAbilityId: 'parent',
        parentSourceCardId: 'parent-source',
        parentEffectId: 'parent-pending',
        orderedResolution: false,
        abilities: [ability],
      },
      delegate
    );
    expect(delegate).toHaveBeenCalledOnce();
    expect(done.delegatedAbilitySequence).toBeNull();
    expect(done.actionHistory.at(-2)?.payload).toMatchObject({
      step: 'DELEGATED_ABILITY_NO_PROGRESS',
      delegatedPendingAbilityId: ability.id,
      delegatedAbilityId: ability.abilityId,
    });
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'DELEGATED_ABILITY_SEQUENCE_COMPLETE',
      resolvedPendingAbilityIds: [],
      resolvedAbilityIds: [],
      skippedPendingAbilityIds: [ability.id],
      skippedAbilityIds: [ability.abilityId],
    });
  });

  it('turns a registered starter with no delegate progress into an audited skip', () => {
    const { game, ability } = scenario(CASES[1]);
    registerPendingAbilityStarterHandler(ability.abilityId, (state) => state);
    const done = startDelegatedAbilitySequence(
      game,
      {
        id: 'no-progress-sequence',
        controllerId: 'p1',
        parentAbilityId: 'parent',
        parentSourceCardId: 'parent-source',
        parentEffectId: 'parent-pending',
        orderedResolution: false,
        abilities: [ability],
      },
      (state) => state
    );
    expect(done.delegatedAbilitySequence).toBeNull();
    expect(done.actionHistory.at(-2)?.payload).toMatchObject({
      step: 'DELEGATED_ABILITY_NO_PROGRESS',
      delegatedPendingAbilityId: ability.id,
      delegatedAbilityId: ability.abilityId,
    });
  });
});
