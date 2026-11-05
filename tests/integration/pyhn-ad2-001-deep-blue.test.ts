import { describe, expect, it } from 'vitest';
import { createNovember02DraftCard } from '../helpers/november-02-draft-effects';
import {
  P1,
  P2,
  gameWith,
  liveZone,
  start,
  sessionFor,
  setState,
} from '../helpers/modifier-workflow-fixtures';
import { emitGameEvent, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { createLiveStartEvent } from '../../src/domain/events/game-events';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PYHN_AD2_001_LIVE_START_DRAW_ONE_PLACE_HAND_TOP_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { CardType, TriggerCondition } from '../../src/shared/types/enums';
import {
  cardBelongsToGroup,
  getCardGroupIdentityKeys,
  getKnownCardGroupIdentityName,
} from '../../src/shared/utils/card-identity';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';

function setup(
  options: { deck?: readonly string[]; hand?: readonly string[]; waiting?: readonly string[] } = {}
) {
  const source = createNovember02DraftCard('PYHN-ad2-001', P1, 'source');
  const cards = ['draw', 'tail', 'hand', 'other'].map((id) =>
    createNovember02DraftCard('PL!-bp8-014', P1, id)
  );
  let game = liveZone(gameWith([source, ...cards]), source);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [...(options.deck ?? ['draw', 'tail'])] },
    hand: { ...player.hand, cardIds: [...(options.hand ?? ['hand'])] },
    waitingRoom: { ...player.waitingRoom, cardIds: [...(options.waiting ?? [])] },
  }));
  return { game, source };
}
function choose(session: ReturnType<typeof sessionFor>, cardId?: string, playerId = P1) {
  return session.executeCommand(
    createConfirmEffectStepCommand(playerId, session.state!.activeEffect!.id, cardId)
  );
}

describe('PYHN-ad2-001 分数6「Deep Blue」draw one, then place one hand card on top', () => {
  it.each(['hand', 'draw'])(
    'draws once and lets the controller put %s on top through the actual LIVE_START trigger',
    (chosen) => {
      const { game } = setup();
      const event = createLiveStartEvent(P1, ['source']);
      const queued = enqueueTriggeredCardEffects(
        emitGameEvent(game, event),
        [TriggerCondition.ON_LIVE_START],
        { liveStartEvents: [event] }
      );
      expect(queued.pendingAbilities).toHaveLength(1);
      expect(queued.pendingAbilities[0].abilityId).toBe(ABILITY);
      const session = sessionFor(resolvePendingCardEffects(queued).gameState);
      expect(session.state!.activeEffect).toMatchObject({
        effectText: '【LIVE开始时】抽１张卡，将１张手牌放置于卡组顶。',
        selectableCardIds: ['hand', 'draw'],
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        confirmSelectionLabel: '放置于卡组顶',
        canSkipSelection: false,
      });
      expect(session.state!.players[0].mainDeck.cardIds).toEqual(['tail']);
      expect(choose(session, chosen).success).toBe(true);
      expect(session.state!.players[0].mainDeck.cardIds).toEqual([chosen, 'tail']);
      expect(session.state!.players[0].hand.cardIds).toEqual(
        chosen === 'hand' ? ['draw'] : ['hand']
      );
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.pendingAbilities).toEqual([]);
    }
  );
  it('keeps the selected hand private for the opponent and in public projection', () => {
    const { game, source } = setup();
    const opened = start(game, source, ABILITY);
    const own = projectPlayerViewState(opened, P1);
    const other = projectPlayerViewState(opened, P2);
    expect(own.activeEffect?.selectableObjectIds).toEqual(
      ['hand', 'draw'].map(createPublicObjectId)
    );
    expect(other.activeEffect?.selectableObjectIds).toBeUndefined();
    expect(JSON.stringify(own)).toContain('星空凛');
    expect(JSON.stringify(other)).not.toContain('星空凛');
    expect(JSON.stringify(other)).not.toContain(createPublicObjectId('hand'));
    expect(JSON.stringify(other)).not.toContain(createPublicObjectId('draw'));
  });
  it('rejects decline, wrong player, forged cards and mixed input without moving cards or drawing twice', () => {
    const { game, source } = setup();
    const session = sessionFor(start(game, source, ABILITY));
    const before = session.state!;
    expect(choose(session).success).toBe(false);
    expect(choose(session, 'other').success).toBe(false);
    expect(choose(session, 'hand', P2).success).toBe(false);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          session.state!.activeEffect!.id,
          'hand',
          undefined,
          undefined,
          undefined,
          ['draw']
        )
      ).success
    ).toBe(false);
    expect(session.state!.players[0].hand.cardIds).toEqual(before.players[0].hand.cardIds);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['tail']);
    expect(choose(session, 'draw').success).toBe(true);
  });
  it('rejects a stale hand card without partially moving another card', () => {
    const { game, source } = setup();
    const session = sessionFor(start(game, source, ABILITY));
    setState(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: ['draw'] },
        waitingRoom: { ...player.waitingRoom, cardIds: ['hand'] },
      }))
    );
    expect(choose(session, 'hand').success).toBe(false);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['tail']);
    expect(choose(session, 'draw').success).toBe(true);
  });
  it('still puts an existing hand card on top when no card can be drawn', () => {
    const { game, source } = setup({ deck: [], hand: ['hand'] });
    const session = sessionFor(start(game, source, ABILITY));
    expect(session.state!.activeEffect?.selectableCardIds).toEqual(['hand']);
    expect(choose(session, 'hand').success).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['hand']);
  });
  it('confirms a no-interaction empty draw/hand once and continues without a fake selection', () => {
    const { game, source } = setup({ deck: [], hand: [] });
    const session = sessionFor(start(game, source, ABILITY));
    expect(session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(choose(session).success).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players[0].mainDeck.cardIds).toEqual([]);
  });
  it('refreshes the main deck during the one-card draw, then returns the actual drawn card', () => {
    const { game, source } = setup({ deck: [], hand: [], waiting: ['draw'] });
    const session = sessionFor(start(game, source, ABILITY));
    expect(session.state!.players[0].hand.cardIds).toEqual(['draw']);
    expect(choose(session, 'draw').success).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['draw']);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual([]);
  });
  it('completes the source-independent player action when the already triggered LIVE left its zone', () => {
    const { game, source } = setup();
    const left = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [], cardStates: new Map() },
      waitingRoom: { ...player.waitingRoom, cardIds: ['source'] },
    }));
    const session = sessionFor(start(left, source, ABILITY));
    expect(session.state!.players[0].hand.cardIds).toEqual(['hand', 'draw']);
    expect(choose(session, 'hand').success).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['hand', 'tail']);
  });
  it('finishes each complete draw-and-return before continuing to the next LIVE-start pending', () => {
    const { game } = setup();
    const second = createNovember02DraftCard('PYHN-ad2-001', P1, 'second');
    const withSecond = liveZone(
      { ...game, cardRegistry: new Map([...game.cardRegistry, [second.instanceId, second]]) },
      second
    );
    const event = createLiveStartEvent(P1, ['source', 'second']);
    const queued = enqueueTriggeredCardEffects(
      emitGameEvent(withSecond, event),
      [TriggerCondition.ON_LIVE_START],
      { liveStartEvents: [event] }
    );
    const session = sessionFor(resolvePendingCardEffects(queued).gameState);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          true
        )
      ).success
    ).toBe(true);
    expect(session.state!.activeEffect?.sourceCardId).toBe('source');
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['tail']);
    expect(session.state!.pendingAbilities).toHaveLength(1);
    expect(choose(session, 'hand').success).toBe(true);
    expect(session.state!.activeEffect?.sourceCardId).toBe('second');
    expect(session.state!.activeEffect?.selectableCardIds).toEqual(['draw', 'hand']);
    expect(choose(session, 'draw').success).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['draw', 'tail']);
  });
  it('recognizes Aqours in hand, deck, waiting room, live, success and cheer without mutating printed group data', () => {
    const { game, source } = setup();
    expect(source.data.groupNames).toBeUndefined();
    for (const zone of [
      'hand',
      'mainDeck',
      'waitingRoom',
      'liveZone',
      'successZone',
      'resolutionZone',
    ]) {
      const state: GameState =
        zone === 'resolutionZone'
          ? {
              ...game,
              resolutionZone: {
                ...game.resolutionZone,
                cardIds: ['source'],
                revealedCardIds: ['source'],
              },
            }
          : updatePlayer(game, P1, (player) => ({
              ...player,
              [zone]: { ...player[zone as 'hand'], cardIds: ['source'] },
            }));
      const data = state.cardRegistry.get('source')!.data;
      expect(data.cardType).toBe(CardType.LIVE);
      expect(cardBelongsToGroup(data, 'Aqours')).toBe(true);
      expect(getKnownCardGroupIdentityName(data)).toBe('Aqours');
      expect(getCardGroupIdentityKeys(data)).toEqual(['aqours']);
    }
  });
});
