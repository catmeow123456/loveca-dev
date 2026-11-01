import { describe, expect, it } from 'vitest';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP8_011_ON_ENTER_LOWER_COST_RELAY_RECOVER_MIRACRA_LIVE_ABILITY_ID as ABILITY,
  HS_BP8_004_ACTIVATED_DISCARD_LOW_COST_HASUNOSORA_GAIN_ON_ENTER_ABILITY_ID as GINKO,
} from '../../src/application/card-effects/ability-ids';
import { getStageMemberLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import {
  getCopyableOnEnterDefinitions,
  getCurrentTemporaryOnEnterAbilityGrants,
  getTemporaryOnEnterAbilityInvocation,
  getHostEnterStageEventIds,
  getHostEnterStageMetadata,
} from '../../src/application/card-effects/runtime/temporary-on-enter-ability-grants';
import { getStageMemberDelegatableOnEnterDefinitions } from '../../src/application/card-effects/runtime/delegatable-definitions';
import {
  createCardInstance,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  CardType,
  GamePhase,
  HeartColor,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { getOctober31MemberData } from '../helpers/october-31-draft-effects';
import { sourceCardFixture } from '../helpers/card-effect-zone-fixture';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';

const P1 = 'p1',
  P2 = 'p2';
function setup(cost: number | null) {
  const actor = createCardInstance(sourceCardFixture('PL!HS-bp8-004-SEC')!, P1, 'actor');
  const template = createCardInstance(getOctober31MemberData('PL!HS-bp8-011'), P1, 'template');
  const replacement = createCardInstance(
    {
      ...template.data,
      cardCode: 'SYNTHETIC-REPLACEMENT',
      cost: 20,
      unitName: 'DOLLCHESTRA',
    } as MemberCardData,
    P1,
    'replacement'
  );
  const targets = ['target-1', 'target-2'].map((id) =>
    createCardInstance(
      {
        cardCode: `SYNTHETIC-${id}`,
        name: id,
        cardType: CardType.LIVE,
        score: 2,
        unitName: 'Mira-Cra Park!',
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      } as LiveCardData,
      P1,
      id
    )
  );
  let game = registerCards(createGameState('rurino-copy', P1, 'P1', P2, 'P2'), [
    actor,
    template,
    replacement,
    ...targets,
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: ['template'] },
    waitingRoom: {
      ...p.waitingRoom,
      cardIds: ['replacement', ...targets.map((c) => c.instanceId)],
    },
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'actor'),
  }));
  game = { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 };
  return emitGameEvent(
    game,
    createEnterStageEvent(
      'actor',
      ZoneType.HAND,
      SlotPosition.CENTER,
      P1,
      P1,
      cost === null
        ? undefined
        : {
            relayReplacements: [
              { cardId: 'replacement', slot: SlotPosition.CENTER, effectiveCost: cost },
            ],
          }
    )
  );
}
function gain(game: GameState) {
  const started = activateCardAbility(game, P1, 'actor', GINKO);
  return confirmActiveEffectStep(started, P1, started.activeEffect!.id, 'template');
}
function settle(game: GameState) {
  if (game.activeEffect?.abilityId === ABILITY)
    return confirmActiveEffectStepThroughPublicReveal(
      game,
      P1,
      game.activeEffect.id,
      game.activeEffect.selectableCardIds![0]
    );
  return game;
}
function delegate(game: GameState) {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      {
        id: 'ordinary-rurino-delegation',
        abilityId: ABILITY,
        sourceCardId: 'actor',
        sourceLifecycleId: getStageMemberLifecycleId(game, 'actor'),
        controllerId: P1,
        mandatory: true,
        timingId: TriggerCondition.ON_ENTER_STAGE,
        sourceSlot: SlotPosition.CENTER,
        eventIds: getHostEnterStageEventIds(game, 'actor'),
        metadata: getHostEnterStageMetadata(game, 'actor'),
        onEnterInvocation: getTemporaryOnEnterAbilityInvocation(game, P1, 'actor', ABILITY),
      },
    ],
  }).gameState;
}

describe('PL!HS-bp8-011 费用4 大泽瑠璃乃 / 吟子真实复制增量', () => {
  it('exposes exactly its ON_ENTER definition across all rarities', () => {
    for (const code of ['PL!HS-bp8-011-N', 'PL!HS-bp8-011-SEC'])
      expect(getCopyableOnEnterDefinitions(code).map((d) => d.abilityId)).toEqual([ABILITY]);
  });
  it('uses the real cost17 recipient and its entry history for free and later ordinary invocation', () => {
    let game = gain(setup(10));
    expect(game.activeEffect?.abilityId).toBe(ABILITY);
    expect(game.players[0].waitingRoom.cardIds).toContain('template');
    expect(getCurrentTemporaryOnEnterAbilityGrants(game, P1, 'actor')).toEqual([
      expect.objectContaining({
        abilityId: ABILITY,
        definitionSourceCardCode: 'PL!HS-bp8-011-N',
        hostCardId: 'actor',
      }),
    ]);
    expect(
      getStageMemberDelegatableOnEnterDefinitions('PL!HS-bp8-004-SEC', SlotPosition.CENTER, {
        game,
        controllerId: P1,
        sourceCardId: 'actor',
      }).map((d) => d.abilityId)
    ).toContain(ABILITY);
    game = settle(game);
    expect(game.players[0].hand.cardIds).toEqual(['target-1']);
    game = rehydrateAuthorityGameState(
      serializeReplayPayload(game, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
    );
    game = settle(delegate(game));
    expect(game.players[0].hand.cardIds).toEqual(['target-1', 'target-2']);
    expect(
      game.actionHistory.filter((a) => a.type === 'PAY_COST' && a.payload.abilityId === ABILITY)
    ).toEqual([]);
    expect(
      game.eventLog.filter(({ event }) => event.eventType === TriggerCondition.ON_ENTER_STAGE)
    ).toHaveLength(1);
  });
  it.each([null, 17, 18])(
    'does not invent or weaken the recipient relay condition for captured cost %s',
    (cost) => {
      let game = gain(setup(cost));
      expect(game.activeEffect).toBeNull();
      expect(game.players[0].hand.cardIds).toEqual([]);
      expect(game.players[0].waitingRoom.cardIds).toContain('template');
      game = delegate(game);
      expect(game.activeEffect).toBeNull();
      expect(game.players[0].hand.cardIds).toEqual([]);
    }
  );
});
