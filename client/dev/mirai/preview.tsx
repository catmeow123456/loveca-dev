import { createRoot } from 'react-dom/client';
import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { MotionConfig } from 'framer-motion';
import { GameBoard } from '@/components/game/GameBoard';
import { BattleViewportShell } from '@/components/game/BattleViewportShell';
import { applyTheme } from '@/lib/theme';
import { EffectImageCache } from '@/lib/effectImageCache';
import { MiraiReturnPlayback } from '@/components/game/song-animation/mirai-return/MiraiReturnPlayback';
import { setupMirai, previewSource } from './fixture';
import './preview.css';
applyTheme('dark');
setupMirai();
function App() {
  const [reduced, setReduced] = useState(new URLSearchParams(location.search).has('reduced'));
  const [shot, setShot] = useState<{ at?: number; speed: number; id: number } | null>(null);
  const bar = useRef<HTMLElement>(null),
    images = useMemo(() => new EffectImageCache(), []),
    source = useMemo(previewSource, []);
  useEffect(() => () => images.clear(), [images]);
  useLayoutEffect(() => {
    if (!bar.current) return;
    const o = new ResizeObserver(([e]) =>
      document.documentElement.style.setProperty(
        '--mirai-qa-height',
        `${e.target.getBoundingClientRect().height}px`
      )
    );
    o.observe(bar.current);
    return () => o.disconnect();
  }, []);
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <div className="mirai-test-board">
        <BattleViewportShell>
          <GameBoard />
        </BattleViewportShell>
      </div>
      {shot && (
        <MiraiReturnPlayback
          key={shot.id}
          source={source}
          images={images}
          reduced={reduced}
          holdAt={shot.at}
          timeScale={shot.speed}
          onDone={() => setShot(null)}
        />
      )}
      <aside className="mirai-qa" ref={bar} aria-label="未来音测试工具">
        <strong>未来音 · 九音归途</strong>
        <button
          onClick={() => {
            setShot(null);
            setupMirai();
          }}
        >
          重置对局
        </button>
        <button onClick={() => setShot({ speed: 1, id: Date.now() })}>重播镜头</button>
        <button onClick={() => setShot({ speed: 0.35, id: Date.now() })}>慢放镜头</button>
        <details>
          <summary>测试选项</summary>
          <div>
            <button onClick={() => setShot({ at: 760, speed: 1, id: Date.now() })}>
              定格 · 卡牌化音符
            </button>
            <button onClick={() => setShot({ at: 1430, speed: 1, id: Date.now() })}>
              定格 · 旋律归底
            </button>
            <button
              onClick={() => {
                setShot(null);
                setupMirai({ duplicate: true });
              }}
            >
              同名成员场景
            </button>
            <button
              onClick={() => {
                setShot(null);
                setupMirai({ empty: true });
              }}
            >
              不足九张场景
            </button>
            <button
              onClick={() => {
                setShot(null);
                setupMirai({ mixed: true });
              }}
            >
              混团声援场景
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
              镜头预览不改变对局。实际触发：结束主阶段，拖 LIVE 到 LIVE
              区，确认放置并公开，选择未来音效果、选择九张成员并确认。夏美效果可选择不发动。
            </p>
          </div>
        </details>
        <span>
          主阶段 → LIVE 放置 → 拖入未来音 → 公开 → 选九张成员。可用右下角自由模式自主移牌。
        </span>
      </aside>
    </MotionConfig>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
