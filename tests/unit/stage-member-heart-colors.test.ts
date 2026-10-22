import { describe, expect, it } from 'vitest';
import { collectEffectiveStageMemberHeartColors } from '../../src/application/effects/stage-member-heart-colors';
import {
  addHeartLiveModifierForSourceMember,
  addLiveModifier,
} from '../../src/domain/rules/live-modifiers';
import { updatePlayer } from '../../src/domain/entities/game';
import { addMemberBelowMember } from '../../src/domain/entities/zone';
import { HeartColor as H, SlotPosition } from '../../src/shared/types/enums';
import { P1, P2, member, gameWith, stage } from '../helpers/modifier-workflow-fixtures';

describe('positive effective own-stage member Heart color union', () => {
  it('includes original replacement and member gains, but excludes below cards, opponents and PLAYER Hearts', () => {
    const own = member('OWN', 'own', P1, {
      hearts: [
        { color: H.RED, count: 2 },
        { color: H.GRAY, count: 0 },
      ],
    });
    const below = member('BELOW', 'below', P1, { hearts: [{ color: H.YELLOW, count: 1 }] });
    const other = member('OPPONENT', 'opponent', P2, { hearts: [{ color: H.PURPLE, count: 1 }] });
    let game = stage(stage(gameWith([own, below, other]), [own]), [other], P2);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(player.memberSlots, SlotPosition.LEFT, below.instanceId),
    }));
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: P1,
      memberCardId: own.instanceId,
      color: H.BLUE,
    });
    game = addHeartLiveModifierForSourceMember(game, {
      abilityId: 'synthetic-heart-gain',
      playerId: P1,
      sourceCardId: own.instanceId,
      hearts: [{ color: H.ORANGE, count: 1 }],
    })!.gameState;
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'PLAYER',
      playerId: P1,
      hearts: [{ color: H.GREEN, count: 1 }],
    });
    expect([...collectEffectiveStageMemberHeartColors(game, P1)]).toEqual([H.BLUE, H.ORANGE]);
    expect([
      ...collectEffectiveStageMemberHeartColors(game, P1, { includedColors: [H.BLUE] }),
    ]).toEqual([H.BLUE]);
    expect([
      ...collectEffectiveStageMemberHeartColors(game, P1, {
        memberCardIds: [below.instanceId, other.instanceId],
      }),
    ]).toEqual([]);
  });
});
