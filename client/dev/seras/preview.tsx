import { createRoot } from 'react-dom/client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { GameBoard } from '@/components/game/GameBoard';
import { BattleViewportShell } from '@/components/game/BattleViewportShell';
import { applyTheme } from '@/lib/theme';
import { setupSeras } from './fixture';
import { setupAi } from './aiFixture';
import { useGameStore } from '@/store/gameStore';
import { SlotPosition, ZoneType } from '@game/shared/types/enums';
import './preview.css';

applyTheme('dark');
const params = new URLSearchParams(location.search);
if (params.has('ai'))
  setupAi({
    ready: params.has('ready'),
    rare: params.has('rare') ? 'R' : 'SEC',
    opponent: params.has('opponent'),
    empty: params.has('empty'),
  });
else
  setupSeras({
    open: params.has('inspect'),
    entrance: params.has('entrance'),
    replay: params.has('izumi'),
    protection: params.has('protect'),
    replayPlain: params.has('plain'),
    opponent: params.has('opponent'),
    noTarget: params.has('empty'),
    lock: params.has('lock'),
    lockActive: params.has('active') || params.has('entry'),
    lockEntry: params.has('entry'),
  });
function App() {
  const [opponent, setOpponent] = useState(params.has('opponent'));
  const [reduced, setReduced] = useState(params.has('reduced'));
  const [lock, setLock] = useState(params.has('lock'));
  const [replay, setReplay] = useState(params.has('izumi'));
  const [protection, setProtection] = useState(params.has('protect'));
  const serasOnStage = useGameStore(
    (s) => s.getSeatMemberSlotCardId('FIRST', SlotPosition.CENTER) === 'seras'
  );
  const serasInHand = useGameStore(
    (s) => s.playerViewState?.table.zones.FIRST_HAND?.objectIds?.includes('obj_seras') ?? false
  );
  const [plain, setPlain] = useState(params.has('plain'));
  const freePlay = useGameStore((s) => s.freePlayEnabled);
  const canToggleIzumi = useGameStore(
    (s) =>
      s.playerViewState?.match.viewerSeat === 'FIRST' &&
      s.getSeatMemberSlotCardId('FIRST', SlotPosition.LEFT) === 'hand-izumi'
  );
  const toolbar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!toolbar.current) return;
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty(
        '--seras-qa-height',
        `${entry.target.getBoundingClientRect().height}px`
      );
    });
    observer.observe(toolbar.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    document.documentElement.dataset.previewReduced = String(reduced);
  }, [reduced]);
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <div className="seras-test-board">
        <BattleViewportShell>
          <GameBoard />
        </BattleViewportShell>
      </div>
      <aside ref={toolbar} className="seras-qa" aria-label="塞拉丝测试工具">
        <strong>
          {params.has('ai')
            ? '宫下爱 · 把爱分给你♡'
            : protection
              ? '桂城泉 · 白花守护'
              : replay
                ? '桂城泉 · 月下邀演'
                : '塞拉丝 · 幕间选曲'}
        </strong>
        {params.has('ai') ? (
          <>
            <button onClick={() => setupAi({ rare: params.has('rare') ? 'R' : 'SEC' })}>
              重置 · 自主登场
            </button>
            <button
              onClick={() => setupAi({ ready: true, rare: params.has('rare') ? 'R' : 'SEC' })}
            >
              重置 · 起动回手
            </button>
            <button onClick={() => setupAi({ ready: true, empty: true })}>无回收目标</button>
            <button onClick={() => setupAi({ rare: 'R' })}>验证 R 罕度</button>
            <label>
              <input
                type="checkbox"
                checked={reduced}
                onChange={(e) => setReduced(e.target.checked)}
              />
              减少动态
            </label>
            <span>
              拖爱到中间舞台；点爱发动起动，选能量，再从休息室选卡。可切自由模式反复移牌。
            </span>
            <a href="/?inspect">赛拉丝</a>
            <a href="/?izumi">桂城泉</a>
          </>
        ) : (
          <>
            <a href="/?ai">爱 SEC 测试</a>
            <button
              onClick={() => {
                setProtection(false);
                setLock(false);
                setReplay(false);
                setupSeras({ opponent });
              }}
            >
              重置 · 自由拖牌
            </button>
            <button
              onClick={() => {
                setProtection(false);
                setLock(false);
                setReplay(false);
                setOpponent(false);
                setupSeras({ entrance: true });
              }}
            >
              登场预览
            </button>
            <button
              onClick={() => {
                setProtection(false);
                setLock(false);
                setReplay(false);
                setupSeras({ open: true, opponent });
              }}
            >
              再次检视
            </button>
            <button
              onClick={() => {
                setProtection(false);
                setLock(true);
                setReplay(false);
                setOpponent(false);
                setupSeras({ lock: true });
              }}
            >
              封锁测试
            </button>
            <button
              onClick={() => {
                setProtection(false);
                setLock(true);
                setReplay(false);
                setOpponent(false);
                setupSeras({ lock: true, lockActive: true, lockEntry: true });
              }}
            >
              低费登场测试
            </button>
            {(lock || protection) && (
              <button
                disabled={!freePlay || opponent || !canToggleIzumi}
                onClick={() => {
                  useGameStore.getState().tapMember('hand-izumi', SlotPosition.LEFT);
                }}
              >
                泉横置／转正
              </button>
            )}
            <button
              onClick={() => {
                setProtection(false);
                setLock(false);
                setReplay(true);
                setPlain(false);
                setOpponent(false);
                setupSeras({ replay: true });
              }}
            >
              泉返场测试
            </button>
            <button
              onClick={() => {
                setProtection(true);
                setLock(false);
                setReplay(false);
                setOpponent(false);
                setupSeras({ protection: true });
              }}
            >
              泉保护测试
            </button>
            {protection && (
              <button
                disabled={!freePlay || opponent || (!serasOnStage && !serasInHand)}
                onClick={() => {
                  const store = useGameStore.getState();
                  if (serasOnStage)
                    store.movePublicCardToHand('seras', ZoneType.MEMBER_SLOT, SlotPosition.CENTER);
                  else store.playMemberToSlot('seras', SlotPosition.CENTER);
                }}
              >
                {serasOnStage ? '赛拉丝离场 · 解除保护' : '赛拉丝入场 · 开启保护'}
              </button>
            )}
            <details>
              <summary>测试选项</summary>
              <div>
                <button
                  onClick={() => {
                    setProtection(false);
                    setLock(false);
                    setReplay(true);
                    setPlain(true);
                    setOpponent(false);
                    setupSeras({ replay: true, replayPlain: true });
                  }}
                >
                  泉 · 普通返场
                </button>
                <button
                  onClick={() => {
                    setProtection(false);
                    setLock(false);
                    setReplay(false);
                    setupSeras({ open: true, noTarget: true, opponent });
                  }}
                >
                  没有可选 LIVE
                </button>
                <button
                  onClick={() => {
                    setOpponent(!opponent);
                    setupSeras({
                      open: !lock && !replay && !protection,
                      protection,
                      lock,
                      lockActive: lock,
                      replay,
                      replayPlain: plain,
                      opponent: !opponent,
                    });
                  }}
                >
                  {opponent ? '切回己方' : '查看对手视角'}
                </button>
                <button
                  onClick={() =>
                    setupSeras({
                      open: !lock && !replay && !protection,
                      protection,
                      lock,
                      replay,
                      replayPlain: plain,
                      rare: 'R',
                      opponent,
                    })
                  }
                >
                  验证 R 罕度
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={reduced}
                    onChange={(e) => setReduced(e.target.checked)}
                  />{' '}
                  减少动态
                </label>
                <p>
                  {protection
                    ? '自由模式。拖入赛拉丝或点入场／离场可反复观察白花；双方横置均不解除保护。此场景使用空牌库并省略人物演出，方便连续观察；普通对局不变。'
                    : replay
                      ? '点击左侧9费泉发动起动，弃1张手牌，再选中间成员返场。可用“泉返场测试”重置重播，或切换普通返场验证没有人物素材的目标。'
                      : lock
                        ? '自由模式下双击己方左侧的泉横置／转正，可反复解除、启用封锁。2费穗乃果、4费泉显示锁链；9费泉与没有起动能力的4费花帆不显示。也可拖走赛拉丝或泉，切规则模式验证起动限制。'
                        : '从手牌将13费赛拉丝拖至舞台。选牌、公开、加入手牌均走实际卡效；设置中可关闭专属动画。'}
                </p>
              </div>
            </details>
          </>
        )}
      </aside>
    </MotionConfig>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
