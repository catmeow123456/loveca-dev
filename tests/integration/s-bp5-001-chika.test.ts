import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { PL_S_BP5_001_ON_ENTER_RELAY_FROM_NO_ABILITY_DRAW_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, FaceState, HeartColor, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly cardText?: string;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    cardType: CardType.MEMBER,
    cost: options.cost ?? 10,
    blade: 1,
    hearts: [{ color: HeartColor.BLUE, count: 1 }],
    cardText: options.cardText,
  };
}

function pending(
  sourceCardId: string,
  relayReplacementCardIds: readonly string[],
  id = 's-bp5-001-pending'
): PendingAbilityState {
  return {
    id,
    abilityId: PL_S_BP5_001_ON_ENTER_RELAY_FROM_NO_ABILITY_DRAW_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`event:${id}`],
    sourceSlot: SlotPosition.CENTER,
    metadata: {
      relayReplacements: relayReplacementCardIds.map((cardId, index) => ({
        cardId,
        slot: index === 0 ? SlotPosition.CENTER : SlotPosition.LEFT,
        effectiveCost: 0,
      })),
    },
  };
}

function setup(options: {
  readonly replacementTexts?: readonly (string | undefined)[];
  readonly relayReplacementCardIds?: readonly string[];
  readonly sourceOnStage?: boolean;
} = {}): {
  readonly game: GameState;
  readonly sourceCardId: string;
  readonly drawCardId: string;
  readonly replacementCardIds: readonly string[];
} {
  const source = createCardInstance(
    member('PL!S-bp5-001-R＋', {
      name: '高海千歌',
      cardText: '【登场】从不持有能力的成员换手登场的场合，抽1张卡。',
    }),
    PLAYER1,
    'chika-source'
  );
  const replacementTexts = options.replacementTexts ?? [undefined];
  const replacements = replacementTexts.map((cardText, index) =>
    createCardInstance(
      member(`PL!S-replacement-${index}`, {
        name: `Replacement ${index}`,
        cardText,
      }),
      PLAYER1,
      `replacement-${index}`
    )
  );
  const drawCard = createCardInstance(member('PL!S-draw-card'), PLAYER1, 'draw-card');
  let game = registerCards(
    createGameState('s-bp5-001-chika', PLAYER1, 'P1', PLAYER2, 'P2'),
    [source, ...replacements, drawCard]
  );
  game = updatePlayer(game, PLAYER1, (player) => {
    const memberSlots =
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            face: FaceState.FACE_UP,
          });
    const waitingRoom = replacements.reduce(
      (zone, replacement) => addCardToZone(zone, replacement.instanceId),
      player.waitingRoom
    );
    return {
      ...player,
      memberSlots,
      waitingRoom,
      mainDeck: addCardToZone(player.mainDeck, drawCard.instanceId),
    };
  });
  const replacementCardIds =
    options.relayReplacementCardIds ?? replacements.map((replacement) => replacement.instanceId);

  return {
    game: {
      ...game,
      pendingAbilities: [pending(source.instanceId, replacementCardIds)],
    },
    sourceCardId: source.instanceId,
    drawCardId: drawCard.instanceId,
    replacementCardIds,
  };
}

function resolve(game: GameState): GameState {
  const resolved = resolvePendingCardEffects(game).gameState;
  expect(resolved.activeEffect).toBeNull();
  return resolved;
}

function latestPayload(game: GameState): Record<string, unknown> | undefined {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          PL_S_BP5_001_ON_ENTER_RELAY_FROM_NO_ABILITY_DRAW_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!S-bp5-001 高海千歌', () => {
  it('draws one when relayed from a strict no-ability member', () => {
    const { game, drawCardId, replacementCardIds } = setup();

    const resolved = resolve(game);

    expect(resolved.players[0].hand.cardIds).toEqual([drawCardId]);
    expect(latestPayload(resolved)).toMatchObject({
      step: 'DRAW_ONE_FROM_NO_ABILITY_RELAY_REPLACEMENT',
      relayReplacementCardIds: replacementCardIds,
      noAbilityRelayReplacementCardIds: replacementCardIds,
      drawnCardIds: [drawCardId],
    });
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('does not draw for non-relay pending metadata', () => {
    const { game, drawCardId } = setup({ relayReplacementCardIds: [] });

    const resolved = resolve(game);

    expect(resolved.players[0].hand.cardIds).not.toContain(drawCardId);
    expect(latestPayload(resolved)).toMatchObject({
      step: 'CHECK_NO_ABILITY_RELAY_REPLACEMENT',
      reason: 'NOT_RELAY_ENTER',
    });
  });

  it('does not draw when the relay replacement has continuous or on-enter ability text', () => {
    for (const cardText of ['【常时】此成员获得[BLADE]。', '【登场】抽1张卡。']) {
      const { game, drawCardId } = setup({ replacementTexts: [cardText] });

      const resolved = resolve(game);

      expect(resolved.players[0].hand.cardIds).not.toContain(drawCardId);
      expect(latestPayload(resolved)).toMatchObject({
        reason: 'NO_STRICT_NO_ABILITY_REPLACEMENT',
        noAbilityRelayReplacementCardIds: [],
      });
    }
  });

  it('draws only once for double relay when at least one replacement has no ability', () => {
    const { game, drawCardId, replacementCardIds } = setup({
      replacementTexts: [undefined, '【常时】此成员获得[BLADE]。'],
    });

    const resolved = resolve(game);

    expect(resolved.players[0].hand.cardIds).toEqual([drawCardId]);
    expect(latestPayload(resolved)).toMatchObject({
      relayReplacementCardIds: replacementCardIds,
      noAbilityRelayReplacementCardIds: [replacementCardIds[0]],
      drawnCardIds: [drawCardId],
    });
  });

  it('continues safely as no-op when the source has left stage', () => {
    const { game, sourceCardId, drawCardId } = setup();
    const sourceRemoved = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: addCardToZone(player.waitingRoom, sourceCardId),
    }));

    const resolved = resolve(sourceRemoved);

    expect(resolved.players[0].hand.cardIds).not.toContain(drawCardId);
    expect(latestPayload(resolved)).toMatchObject({
      reason: 'SOURCE_NOT_ON_STAGE',
    });
    expect(resolved.pendingAbilities).toEqual([]);
  });
});
