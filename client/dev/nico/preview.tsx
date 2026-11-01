import { createRoot } from 'react-dom/client';
import { useLayoutEffect, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { GameBoard } from '@/components/game/GameBoard';
import { BattleViewportShell } from '@/components/game/BattleViewportShell';
import { applyTheme } from '@/lib/theme';
import { NicoEvidencePlayback } from '@/components/game/nico-effects/NicoEvidencePlayback';
import { previewCue, setupNico } from './fixture';
import './preview.css';
applyTheme('dark');
setupNico();
const cue = previewCue();
function App() {
  const [reduced, setReduced] = useState(new URLSearchParams(location.search).has('reduced'));
  const [shot, setShot] = useState<{ at?: number; speed: number; id: number } | null>(null);
  const bar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!bar.current) return;
    const o = new ResizeObserver(([e]) =>
      document.documentElement.style.setProperty(
        '--nico-qa-height',
        `${e.target.getBoundingClientRect().height}px`
      )
    );
    o.observe(bar.current);
    return () => o.disconnect();
  }, []);
  const reset = (options = {}) => {
    setShot(null);
    setupNico(options);
  };
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <div className="nico-test-board">
        <BattleViewportShell>
          <GameBoard />
        </BattleViewportShell>
      </div>
      {shot && (
        <NicoEvidencePlayback
          key={shot.id}
          cue={cue}
          reduced={reduced}
          holdAt={shot.at}
          timeScale={shot.speed}
          onDone={() => setShot(null)}
        />
      )}
      <aside className="nico-qa" ref={bar} aria-label="妮可测试工具">
        <strong>妮可 · 名侦探的线索收藏</strong>
        <button onClick={() => reset()}>重置对局</button>
        <button onClick={() => setShot({ speed: 1, id: Date.now() })}>重播镜头</button>
        <button onClick={() => setShot({ speed: 0.3, id: Date.now() })}>慢放镜头</button>
        <details>
          <summary>测试选项</summary>
          <div>
            <button onClick={() => setShot({ at: 588, speed: 1, id: Date.now() })}>
              定格 · 放大镜
            </button>
            <button onClick={() => setShot({ at: 1152, speed: 1, id: Date.now() })}>
              定格 · 蝴蝶结
            </button>
            <button onClick={() => setShot(null)}>关闭镜头</button>
            <button onClick={() => reset({ duplicate: true })}>已有2费线索</button>
            <button onClick={() => reset({ rarity: 'R+' })}>R+全罕度测试</button>
            <button onClick={() => reset({ handEntry: true })}>从手牌拖妮可登场</button>
            <label>
              <input
                type="checkbox"
                checked={reduced}
                onChange={(e) => setReduced(e.target.checked)}
              />{' '}
              减少动态
            </label>
            <p>
              点击舞台妮可，发动起动，支付两能量后选择手牌成员。绘里与凛都是2费，可比较重复费用；真姬9费、希7费。每回合两次，可重置反复测试。镜头重播不改变对局。
            </p>
          </div>
        </details>
        <span>点击妮可 → 发动起动 → 选择成员；正常拖牌、阶段操作均可用。</span>
      </aside>
    </MotionConfig>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
