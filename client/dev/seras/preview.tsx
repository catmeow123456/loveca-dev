import { createRoot } from 'react-dom/client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { GameBoard } from '@/components/game/GameBoard';
import { BattleViewportShell } from '@/components/game/BattleViewportShell';
import { applyTheme } from '@/lib/theme';
import { setupSeras } from './fixture';
import { useGameStore } from '@/store/gameStore';
import { SlotPosition } from '@game/shared/types/enums';
import './preview.css';

applyTheme('dark');
const params = new URLSearchParams(location.search);
setupSeras({
  open: params.has('inspect'),
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
        <strong>塞拉丝 · 幕间选曲</strong>
        <button
          onClick={() => {
            setLock(false);
            setupSeras({ opponent });
          }}
        >
          重置 · 自由拖牌
        </button>
        <button
          onClick={() => {
            setLock(false);
            setupSeras({ open: true, opponent });
          }}
        >
          再次检视
        </button>
        <button
          onClick={() => {
            setLock(true);
            setOpponent(false);
            setupSeras({ lock: true });
          }}
        >
          封锁测试
        </button>
        <button
          onClick={() => {
            setLock(true);
            setOpponent(false);
            setupSeras({ lock: true, lockActive: true, lockEntry: true });
          }}
        >
          低费登场测试
        </button>
        {lock && (
          <button
            disabled={!freePlay || opponent || !canToggleIzumi}
            onClick={() => {
              useGameStore.getState().tapMember('hand-izumi', SlotPosition.LEFT);
            }}
          >
            泉横置／转正
          </button>
        )}
        <details>
          <summary>测试选项</summary>
          <div>
            <button onClick={() => setupSeras({ open: true, noTarget: true, opponent })}>
              没有可选 LIVE
            </button>
            <button
              onClick={() => {
                setOpponent(!opponent);
                setupSeras({ open: !lock, lock, lockActive: lock, opponent: !opponent });
              }}
            >
              {opponent ? '切回己方' : '查看对手视角'}
            </button>
            <button onClick={() => setupSeras({ open: !lock, lock, rare: 'R', opponent })}>
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
              {lock
                ? '自由模式下双击己方左侧的泉横置／转正，可反复解除、启用封锁。2费穗乃果、4费泉显示锁链；9费泉与没有起动能力的4费花帆不显示。也可拖走赛拉丝或泉，切规则模式验证起动限制。'
                : '从手牌将13费赛拉丝拖至舞台。选牌、公开、加入手牌均走实际卡效；设置中可关闭专属动画。'}
            </p>
          </div>
        </details>
      </aside>
    </MotionConfig>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
