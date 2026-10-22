import { describe, expect, it } from 'vitest';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { N_BP8_026_LIVE_START_CONVERT_TARGET_RED_BLUE_TO_PURPLE_SCORE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { findCardAbilityDefinitionById } from '../../src/application/card-effects/definitions/lookup';
import {
  addHeartLiveModifierForSourceMember,
  getLiveCardScoreModifier,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import { updatePlayer } from '../../src/domain/entities/game';
import { removeCardFromSlot } from '../../src/domain/entities/zone';
import { HeartColor as H, SlotPosition } from '../../src/shared/types/enums';
import {
  P1,
  member,
  live,
  gameWith,
  stage,
  liveZone,
  start,
  sessionFor,
  setState,
} from '../helpers/modifier-workflow-fixtures';

const TEXT =
  '【LIVE开始时】选择存在于自己的舞台的1名『虹咲』的成员。LIVE结束时为止，该成员持有的[赤ハート]和[青ハート]，全部变为[紫ハート]。因此将大于等于５个HEART变为[紫ハート]的场合，此卡的分数＋１。';
function setup(count: number) {
  const song = live('PL!N-bp8-026-SECL', 'song');
  const target = member('TARGET', 'target', P1, {
    hearts: [
      { color: H.RED, count },
      { color: H.PURPLE, count: 7 },
    ],
  });
  return {
    song,
    target,
    session: sessionFor(
      start(liveZone(stage(gameWith([song, target]), [target]), song), song, ABILITY)
    ),
  };
}

describe('PL!N-bp8-026 分数6「Solitude Rain」 fixed conversion under the current user ruling', () => {
  it.each(['BEFORE_START', 'DURING_CHOICE'])(
    'still resolves the independent member conversion when the source leaves %s',
    (when) => {
      const { session, song } = setup(5);
      const sourceLeft = updatePlayer(session.state!, P1, (player) => ({
        ...player,
        liveZone: { ...player.liveZone, cardIds: [] },
      }));
      setState(
        session,
        when === 'BEFORE_START'
          ? start({ ...sourceLeft, activeEffect: null }, song, ABILITY)
          : sourceLeft
      );
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'target')
        ).success
      ).toBe(true);
      expect(
        getMemberEffectiveHeartIcons(session.state!, P1, 'target').filter(
          (heart) => heart.color === H.RED
        )
      ).toEqual([]);
      expect(getLiveCardScoreModifier(session.state!.liveResolution, song.instanceId)).toBe(0);
    }
  );
  it.each([4, 5])(
    'converts exactly the present red/blue Hearts and assesses the threshold immediately at %i',
    (count) => {
      const { session, song } = setup(count);
      expect(findCardAbilityDefinitionById(ABILITY)!.effectText).toBe(TEXT);
      expect(session.state!.activeEffect!.effectText).toBe(TEXT);
      expect(session.state!.activeEffect!.selectableCardIds).toEqual(['target']);
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'target')
        ).success
      ).toBe(true);
      expect(getLiveCardScoreModifier(session.state!.liveResolution, song.instanceId)).toBe(
        Number(count >= 5)
      );
      const current = getMemberEffectiveHeartIcons(session.state!, P1, 'target');
      expect(current.filter((h) => h.color === H.RED)).toEqual([]);
      expect(current.filter((h) => h.color === H.PURPLE).reduce((n, h) => n + h.count, 0)).toBe(
        7 + count
      );
      const gained = addHeartLiveModifierForSourceMember(session.state!, {
        abilityId: 'synthetic-heart-gain',
        playerId: P1,
        sourceCardId: 'target',
        hearts: [{ color: H.RED, count: 8 }],
      })!.gameState;
      expect(
        getMemberEffectiveHeartIcons(gained, P1, 'target').filter((h) => h.color === H.RED)
      ).toEqual([{ color: H.RED, count: 8 }]);
      expect(getLiveCardScoreModifier(gained.liveResolution, song.instanceId)).toBe(
        Number(count >= 5)
      );
    }
  );
  it('counts pre-existing member gain Hearts, and retains the immediate score after its target leaves', () => {
    const { session, song } = setup(3);
    setState(
      session,
      addHeartLiveModifierForSourceMember(session.state!, {
        abilityId: 'synthetic-heart-gain',
        playerId: P1,
        sourceCardId: 'target',
        hearts: [{ color: H.BLUE, count: 2 }],
      })!.gameState
    );
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'target')
      ).success
    ).toBe(true);
    expect(getLiveCardScoreModifier(session.state!.liveResolution, song.instanceId)).toBe(1);
    const after = updatePlayer(session.state!, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    expect(getLiveCardScoreModifier(after.liveResolution, song.instanceId)).toBe(1);
  });
  it('rejects an unoffered target and safely consumes a stale member selection', () => {
    const { session, song } = setup(5);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'other')
      ).success
    ).toBe(false);
    setState(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
      }))
    );
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'target')
      ).success
    ).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(getLiveCardScoreModifier(session.state!.liveResolution, song.instanceId)).toBe(0);
  });
});
