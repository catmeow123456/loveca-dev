import { createRoot } from 'react-dom/client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import type { PlayerViewState } from '@game/online';
import { GameBoard } from '@/components/game/GameBoard';
import { BattleViewportShell } from '@/components/game/BattleViewportShell';
import {
  SolitudeRainPlayback,
  type SolitudeRainFrameStats,
} from '@/components/game/song-animation/solitude-rain/SolitudeRainPlayback';
import { EffectImageCache } from '@/lib/effectImageCache';
import { getSolitudeRain, type SolitudeRainPresentation } from '@/lib/solitudeRain';
import { useGameStore } from '@/store/gameStore';
import { applyTheme } from '@/lib/theme';
import { setupRain } from './fixture';
import './preview.css';
applyTheme('dark');
setupRain();
function App() {
  const [frameStats, setFrameStats] = useState<SolitudeRainFrameStats | null>(null);
  const view = useGameStore((s) => s.playerViewState);
  const [count, setCount] = useState(5),
    [multiple, setMultiple] = useState(false);
  const [reduced, setReduced] = useState(new URLSearchParams(location.search).has('reduced'));
  const [last, setLast] = useState<PlayerViewState['match']['entrance']>();
  const [shot, setShot] = useState<{
    source: SolitudeRainPresentation;
    at?: number;
    speed: number;
    id: number;
  } | null>(null);
  const images = useMemo(() => new EffectImageCache(), []),
    bar = useRef<HTMLElement>(null);
  useEffect(() => () => images.clear(), [images]);
  useEffect(() => {
    if (view?.match.entrance?.solitudeRain) setLast(view.match.entrance);
  }, [view]);
  useLayoutEffect(() => {
    if (!bar.current) return;
    const observer = new ResizeObserver(([e]) =>
      document.documentElement.style.setProperty(
        '--rain-qa-height',
        `${e.target.getBoundingClientRect().height}px`
      )
    );
    observer.observe(bar.current);
    return () => observer.disconnect();
  }, []);
  const replay = (speed = 1, at?: number) => {
    if (!view || !last || view.match.entrance) return;
    const source = getSolitudeRain({ ...view, match: { ...view.match, entrance: last } });
    if (source) {
      setFrameStats(null);
      setShot({ source, at, speed, id: Date.now() });
    }
  };
  const reset = (n = count, multi = multiple) => {
    setShot(null);
    setFrameStats(null);
    setLast(undefined);
    setCount(n);
    setMultiple(multi);
    setupRain(n, multi);
  };
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <div className="rain-test-board">
        <BattleViewportShell>
          <GameBoard />
        </BattleViewportShell>
      </div>
      {shot && (
        <SolitudeRainPlayback
          key={shot.id}
          source={shot.source}
          images={images}
          reduced={reduced}
          holdAt={shot.at}
          timeScale={shot.speed}
          onFrameStats={shot.speed === 1 && !reduced ? setFrameStats : undefined}
          onDone={() => setShot(null)}
        />
      )}
      <aside className="rain-qa" ref={bar} aria-label="Solitude Rain 测试工具">
        <strong>Solitude Rain · 雨幕追光</strong>
        <button onClick={() => reset()}>重置对局</button>
        <button disabled={!last || !!view?.match.entrance} onClick={() => replay()}>
          重播上次结果
        </button>
        <button disabled={!last || !!view?.match.entrance} onClick={() => replay(0.3)}>
          慢放
        </button>
        {shot && <button onClick={() => setShot(null)}>关闭镜头</button>}
        <details>
          <summary>测试选项</summary>
          <div>
            <label>
              初始红蓝 HEART{' '}
              <select value={count} onChange={(e) => reset(Number(e.target.value))}>
                <option value={0}>0</option>
                <option value={4}>4</option>
                <option value={5}>5</option>
              </select>{' '}
              ＋原有紫心 7
            </label>
            <label>
              <input
                type="checkbox"
                checked={multiple}
                onChange={(e) => reset(count, e.target.checked)}
              />{' '}
              两张 LIVE／顺序发动
            </label>
            <label>
              <input
                type="checkbox"
                checked={reduced}
                onChange={(e) => setReduced(e.target.checked)}
              />{' '}
              减少动态
            </label>
            <button
              onClick={() =>
                useGameStore
                  .getState()
                  .setViewingPlayer(view?.match.viewerSeat === 'FIRST' ? 'p2' : 'p1')
              }
            >
              切换双方视角
            </button>
            <button disabled={!last} onClick={() => replay(1, 480)}>
              定格 · 雨幕
            </button>
            <button disabled={!last} onClick={() => replay(1, 830)}>
              定格 · 收拢
            </button>
            <button disabled={!last} onClick={() => replay(1, 1160)}>
              定格 · 合色
            </button>
            <button disabled={!last} onClick={() => replay(1, 1650)}>
              定格 · 结算反馈
            </button>
            {frameStats && (
              <output aria-label="最近播放帧耗时">
                正常重播采样 {frameStats.frames} 帧；帧间隔中位{' '}
                {frameStats.medianIntervalMs.toFixed(1)}ms，P95{' '}
                {frameStats.p95IntervalMs.toFixed(1)}ms，最长 {frameStats.maxIntervalMs.toFixed(1)}
                ms；绘制 P95 {frameStats.p95DrawMs.toFixed(1)}ms，最长{' '}
                {frameStats.maxDrawMs.toFixed(1)}ms；超过 25ms 的间隔 {frameStats.slowFrames} 次。
              </output>
            )}
            <p>
              开始时雫与彼方各有 {count} 个红蓝心及 7
              个紫心（测试初始修正）。先完成真实选择，再用重播、慢放或定格查看该次结果。
            </p>
          </div>
        </details>
        <span>双方各点 Live Start! → 拖 LIVE 到空位 → 确认放置、公开 → 点选雫或彼方完成转换</span>
      </aside>
    </MotionConfig>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
