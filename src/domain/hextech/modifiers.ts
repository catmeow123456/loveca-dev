import type { GameState, LiveModifierState } from '../entities/game.js';
import { getCardById, getPlayerById } from '../entities/game.js';
import { isLiveCardData, isMemberCardData, type HeartIcon } from '../entities/card.js';
import { HeartColor, SlotPosition, OrientationState } from '../../shared/types/enums.js';
import {
  getCardGroupIdentityKeys,
  cardNameMatchesAnyAlias,
  type GroupIdentityKey,
} from '../../shared/utils/card-identity.js';
import { getHextechDefinition } from './catalog.js';
import { getHextechAcquisitionStage, getHextechPerfectCheerScore } from './bonuses.js';

const CENTER_GROUP_HEART_BONUSES: Partial<Record<GroupIdentityKey, readonly HeartIcon[]>> = {
  muse: [
    { color: HeartColor.PINK, count: 1 },
    { color: HeartColor.YELLOW, count: 1 },
    { color: HeartColor.PURPLE, count: 1 },
  ],
  aqours: [
    { color: HeartColor.RED, count: 1 },
    { color: HeartColor.GREEN, count: 1 },
    { color: HeartColor.BLUE, count: 1 },
  ],
  liella: [
    { color: HeartColor.RED, count: 1 },
    { color: HeartColor.YELLOW, count: 1 },
    { color: HeartColor.PURPLE, count: 1 },
  ],
  hasunosora: [
    { color: HeartColor.PINK, count: 1 },
    { color: HeartColor.GREEN, count: 1 },
    { color: HeartColor.BLUE, count: 1 },
  ],
};

function hasThreeStageMembersInSameGroup(game: GameState, playerId: string): boolean {
  const player = getPlayerById(game, playerId);
  if (!player) return false;
  const groupKeys = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT].map((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return card && isMemberCardData(card.data) ? getCardGroupIdentityKeys(card.data) : [];
  });
  return groupKeys[0].some((key) => groupKeys[1].includes(key) && groupKeys[2].includes(key));
}

/** Match-long ownership is authoritative; LIVE cleanup must not erase these bonuses. */
export function collectHextechLiveModifiers(
  game: GameState,
  ordinaryModifiers: readonly LiveModifierState[]
): readonly LiveModifierState[] {
  return (game.hextech?.owned ?? []).flatMap((owned): LiveModifierState[] => {
    const effect = getHextechDefinition(owned.definitionId)?.effect;
    const source = {
      playerId: owned.playerId,
      sourceHextechInstanceId: owned.instanceId,
      abilityId: `hextech:${owned.definitionId}`,
    };
    switch (effect?.kind) {
      case 'HEART':
        return [{ ...source, kind: 'HEART', target: 'PLAYER', hearts: effect.hearts }];
      case 'BLADE':
        return [{ ...source, kind: 'BLADE', target: 'PLAYER', countDelta: effect.count }];
      case 'SCORE':
        return [{ ...source, kind: 'SCORE', countDelta: effect.count }];
      case 'SUCCESS_ZONE_RAINBOW_HEART': {
        const count = getPlayerById(game, owned.playerId)?.successZone.cardIds.length ?? 0;
        return count > 0
          ? [
              {
                ...source,
                kind: 'HEART',
                target: 'PLAYER',
                hearts: [{ color: HeartColor.RAINBOW, count }],
              },
            ]
          : [];
      }
      case 'THREE_SAME_GROUP_BLADE':
        return hasThreeStageMembersInSameGroup(game, owned.playerId)
          ? [{ ...source, kind: 'BLADE', target: 'PLAYER', countDelta: effect.count }]
          : [];
      case 'DECAYING_CHEER_COUNT': {
        const count = Math.max(0, effect.initialCount - (game.turnCount - owned.acquiredTurn));
        return count > 0 ? [{ ...source, kind: 'CHEER_COUNT', countDelta: count }] : [];
      }
      case 'GROWING_BLADE':
        return [
          {
            ...source,
            kind: 'BLADE',
            target: 'PLAYER',
            countDelta:
              getHextechAcquisitionStage(owned.acquiredTurn) + game.turnCount - owned.acquiredTurn,
          },
        ];
      case 'PERFECT_CHEER_SCORE': {
        const count = getHextechPerfectCheerScore(game, owned.playerId, ordinaryModifiers);
        return count > 0 ? [{ ...source, kind: 'SCORE', countDelta: count }] : [];
      }
      case 'WAITING_KANATA_SCORE_AND_REST': {
        const player = getPlayerById(game, owned.playerId);
        const hasKanata = Object.values(player?.memberSlots.slots ?? {}).some((id) => {
          const card = id ? getCardById(game, id) : null;
          return (
            !!id &&
            player?.memberSlots.cardStates.get(id)?.orientation === OrientationState.WAITING &&
            !!card &&
            isMemberCardData(card.data) &&
            cardNameMatchesAnyAlias(card.data, ['近江彼方', '近江 彼方', 'Konoe Kanata'])
          );
        });
        return hasKanata ? [{ ...source, kind: 'SCORE', countDelta: 2 }] : [];
      }
      case 'PAINTER_LIVE_REQUIREMENTS': {
        const player = getPlayerById(game, owned.playerId);
        return (player?.liveZone.cardIds ?? []).flatMap((liveCardId): LiveModifierState[] => {
          const card = getCardById(game, liveCardId);
          if (!card || !isLiveCardData(card.data)) return [];
          const printedColorCount = [...card.data.requirements.colorRequirements].filter(
            ([color, count]) =>
              count > 0 && color !== HeartColor.GRAY && color !== HeartColor.RAINBOW
          ).length;
          return [
            {
              ...source,
              kind: 'REQUIREMENT',
              liveCardId,
              modifiers: [
                {
                  color: HeartColor.RAINBOW,
                  countDelta: 0,
                  ...(printedColorCount >= 3 ? { clearGeneric: true as const } : {}),
                  addToEachRequiredColor: 1,
                },
              ],
              visibilityDependency: {
                kind: 'PLAYER_LIVE_ZONE_CONTENTS',
                playerId: owned.playerId,
              },
            },
          ];
        });
      }
      case 'CENTER_GROUP_BONUS': {
        const player = getPlayerById(game, owned.playerId);
        const centerId = player?.memberSlots.slots[SlotPosition.CENTER];
        const card = centerId ? getCardById(game, centerId) : null;
        if (!centerId || !card || !isMemberCardData(card.data)) return [];
        return getCardGroupIdentityKeys(card.data).flatMap((group): LiveModifierState[] => {
          if (group === 'nijigasaki') {
            return [
              {
                ...source,
                kind: 'BLADE',
                target: 'TARGET_MEMBER',
                targetMemberCardId: centerId,
                countDelta: 4,
              },
            ];
          }
          const hearts = CENTER_GROUP_HEART_BONUSES[group];
          return hearts
            ? [
                {
                  ...source,
                  kind: 'HEART',
                  target: 'TARGET_MEMBER',
                  targetMemberCardId: centerId,
                  hearts,
                },
              ]
            : [];
        });
      }
      default:
        return [];
    }
  });
}
