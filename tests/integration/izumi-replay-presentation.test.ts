import { describe, expect, it } from 'vitest';
import { prepareIzumiReplay } from '../helpers/izumi-replay-fixture';
import { getIzumiReplaySource } from '../../client/src/lib/izumiReplay';
import { collectSpecialEffectImageUrls } from '../../client/src/lib/specialEffectPreload';
import {
  OrientationState,
  SlotPosition,
  CardType,
  TriggerCondition,
} from '../../src/shared/types/enums';
import {
  createConfirmEffectStepCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import { getOctober29DraftCard } from '../helpers/october-29-draft-effects';
import type { DeckConfig } from '../../src/application/game-service';
import { removeCardFromSlot } from '../../src/domain/entities/zone';
import { updatePlayer } from '../../src/domain/entities/game';

describe('9费泉：成功原槽返场后接入共享演出', () => {
  it.each([0, 1] as const)(
    '玩家%s：原子离场返场，双方确认后只检视一次且对手看不到牌面',
    (owner) => {
      const f = prepareIzumiReplay({ owner });
      expect(f.replay().success).toBe(true);
      const pending = f.session.state!.entranceRuntime!.pending!;
      expect(pending.cardIds).toEqual(['partner']);
      expect(pending.izumiReplay).toMatchObject({
        sourceCardId: 'izumi',
        targetCardId: 'partner',
        slot: SlotPosition.CENTER,
        previousOrientation: OrientationState.WAITING,
      });
      expect(f.player().memberSlots.slots.CENTER).toBe('partner');
      expect(f.player().memberSlots.cardStates.get('partner')?.orientation).toBe(
        OrientationState.ACTIVE
      );
      expect(f.player().waitingRoom.cardIds).toEqual(['discard']);
      expect(f.session.state!.activeEffect).toBeNull();
      expect(
        f.session.state!.eventLog.filter(
          ({ event }) => event.eventType === TriggerCondition.ON_ENTER_STAGE
        )
      ).toHaveLength(1);
      for (const seat of [f.owner, f.other]) {
        const view = f.session.getPlayerViewState(seat)!;
        expect(getIzumiReplaySource(view, (code) => code)?.target.objectId).toBe('obj_partner');
        expect(JSON.stringify(view.match.entrance)).not.toContain('private-deck');
      }
      const ownerView = f.session.getPlayerViewState(f.owner)!;
      expect(collectSpecialEffectImageUrls(ownerView, (code) => code, false)).toEqual(
        expect.arrayContaining(['PL!HS-bp8-008-SEC', 'PL!HS-bp8-007-SEC'])
      );
      expect(f.ack().success).toBe(true);
      expect(f.session.state!.activeEffect).toBeNull();
      expect(f.ack(f.other).success).toBe(true);
      expect(f.session.state!.activeEffect?.inspectionCardIds).toHaveLength(5);
      const effect = f.session.state!.activeEffect!;
      for (const id of effect.inspectionCardIds!)
        expect(
          f.session.getPlayerViewState(f.other)!.objects[`obj_${id}`]?.frontInfo
        ).toBeUndefined();
      expect(f.ack(f.owner, pending.id).success).toBe(false);
      expect(f.confirm(null).success).toBe(true);
      expect(f.player().waitingRoom.cardIds).toHaveLength(6);
      expect(f.session.state!.entranceRuntime!.pending).toBeNull();
      f.session.restoreRuntimeState({
        authorityState: f.session.state!,
        currentPublicSeq: f.session.getCurrentPublicEventSeq(),
      });
      expect(f.session.getPlayerViewState(f.owner)!.match.entrance).toBeUndefined();
    }
  );
  it.each(['SEC', 'R', 'PP'])(
    '%s：无人物素材的另一张泉照常返场，不生成额外登场或重复费用',
    (rare) => {
      const f = prepareIzumiReplay({ plain: true, rare, mode: 'LOCAL' });
      expect(f.replay().success).toBe(true);
      expect(f.session.getPlayerViewState(f.owner)!.match.entrance?.izumiReplay).toBeTruthy();
      expect(f.ack().success).toBe(true);
      expect(f.session.state!.entranceRuntime!.pending).toBeNull();
      expect(f.player().waitingRoom.cardIds).toEqual(['discard']);
      expect(f.session.state!.actionHistory.filter((a) => a.type === 'PAY_COST')).toHaveLength(1);
      expect(f.session.state!.activeEffect).toBeNull();
    }
  );
  it('不发动、无目标及非法目标不出现返场演出', () => {
    const skipped = prepareIzumiReplay();
    skipped.start();
    skipped.confirm(null);
    expect(skipped.session.state!.entranceRuntime!.pending).toBeNull();
    expect(skipped.player().hand.cardIds).toEqual(['discard']);
    const empty = prepareIzumiReplay({ noTarget: true });
    empty.start();
    empty.confirm('discard');
    expect(empty.session.state!.entranceRuntime!.pending).toBeNull();
    expect(empty.player().waitingRoom.cardIds).toEqual(['discard']);
    const invalid = prepareIzumiReplay();
    invalid.start();
    invalid.confirm('discard');
    expect(invalid.confirm('izumi').success).toBe(false);
    expect(invalid.session.state!.entranceRuntime!.pending).toBeNull();
  });
  it('超时只续接一次；公开对象失效时前端拒绝过期目标', () => {
    const f = prepareIzumiReplay();
    f.replay();
    const pending = f.session.state!.entranceRuntime!.pending!;
    f.setNow(pending.deadlineAt);
    expect(f.session.expireCardEntrance()).toBe(true);
    const active = f.session.state!.activeEffect;
    expect(active?.inspectionCardIds).toHaveLength(5);
    expect(f.session.expireCardEntrance()).toBe(false);
    expect(f.ack(f.owner, pending.id).success).toBe(false);
    expect(f.session.state!.activeEffect).toBe(active);
    const moved = prepareIzumiReplay();
    moved.replay();
    const state = updatePlayer(moved.session.state!, moved.owner, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
    }));
    moved.session.restoreRuntimeState({
      authorityState: state,
      currentPublicSeq: moved.session.getCurrentPublicEventSeq(),
    });
    expect(
      getIzumiReplaySource(moved.session.getPlayerViewState(moved.owner)!, (code) => code)
    ).toBeUndefined();
  });
  it.each(['SOLITAIRE', 'ONLINE'] as const)(
    '服务层%s的公开快照与认证ACK沿用原等待席位',
    async (mode) => {
      const service = new OnlineMatchService({ recorder: null, now: () => 1000 });
      const deck: DeckConfig = {
        mainDeck: [
          ...Array.from({ length: 48 }, () => getOctober29DraftCard('PL!HS-bp8-008')),
          ...Array.from({ length: 12 }, () => getOctober29DraftCard('PL!HS-bp8-023')),
        ],
        energyDeck: Array.from({ length: 12 }, (_, i) => ({
          cardType: CardType.ENERGY,
          cardCode: `E${i}`,
          name: '能量',
        })),
      };
      const pointValidation = { pointTableVersion: 'test', pointTotal: 0, pointLimit: 9 };
      const match = await service.createMatch({
        roomCode: `izumi-${mode}`,
        matchMode: mode,
        automationGameMode: mode === 'SOLITAIRE' ? 'SOLITAIRE' : 'ONLINE',
        originKind: mode === 'SOLITAIRE' ? 'SOLITAIRE' : 'ONLINE',
        first: { userId: 'first', displayName: '先攻', deck, pointValidation },
        second: { userId: 'second', displayName: '后攻', deck, pointValidation },
      });
      const f = prepareIzumiReplay({}, match.session);
      f.replay();
      const snapshot = await service.getMatchSnapshot(match.matchId, 'first');
      if (!snapshot || !('playerViewState' in snapshot)) throw new Error('Missing match view');
      const wait = snapshot.playerViewState.match.entrance!;
      expect(wait.izumiReplay?.targetObjectId).toBe('obj_partner');
      const finish = (user: string) =>
        service.executeCommand(match.matchId, user, {
          type: GameCommandType.ACK_CARD_ENTRANCE,
          playerId: 'ignored',
          entranceId: wait.id,
          timestamp: 1000,
        });
      expect((await finish('first'))?.success).toBe(true);
      if (mode === 'ONLINE') {
        expect(match.session.state!.activeEffect).toBeNull();
        expect((await finish('second'))?.success).toBe(true);
      }
      expect(match.session.state!.entranceRuntime!.pending).toBeNull();
      expect(match.session.state!.activeEffect?.inspectionCardIds).toHaveLength(5);
      expect(
        (
          await service.executeCommand(
            match.matchId,
            'first',
            createConfirmEffectStepCommand('ignored', match.session.state!.activeEffect!.id, null)
          )
        )?.success
      ).toBe(true);
      expect(f.player().waitingRoom.cardIds).toHaveLength(6);
    }
  );
});
