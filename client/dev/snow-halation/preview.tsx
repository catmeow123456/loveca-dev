import { createRoot } from 'react-dom/client';
import { useLayoutEffect, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { GameBoard } from '@/components/game/GameBoard';
import { BattleViewportShell } from '@/components/game/BattleViewportShell';
import { useGameStore } from '@/store/gameStore';
import { applyTheme } from '@/lib/theme';
import { prepareSnowPreviewImages, setupSnow, type SnowScenario } from './fixture';
import './preview.css';
applyTheme('dark');
const scenarios: Record<SnowScenario, string> = {
  six: '6张授予 · 成功',
  five: '5张授予 · 不加分',
  native: '5张授予＋1张原生橙',
  double: '两张歌曲 · 顺序发动',
  failure: 'LIVE失败',
  recolor: '授予后改成紫色',
};
function App() {
  const view = useGameStore((s) => s.playerViewState);
  const [scenario, setScenario] = useState<SnowScenario>('six');
  const [reduced, setReduced] = useState(new URLSearchParams(location.search).has('reduced'));
  const bar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!bar.current) return;
    const observer = new ResizeObserver(([entry]) =>
      document.documentElement.style.setProperty(
        '--snow-qa-height',
        `${entry.target.getBoundingClientRect().height}px`
      )
    );
    observer.observe(bar.current);
    return () => observer.disconnect();
  }, []);
  const reset = (next = scenario) => {
    setScenario(next);
    setupSnow(next);
  };
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <div className="snow-test-board">
        <BattleViewportShell>
          <GameBoard />
        </BattleViewportShell>
      </div>
      <aside ref={bar} className="snow-qa" aria-label="Snow halation 测试工具">
        <div className="snow-qa-row">
          <strong>Snow halation</strong>
          <button onClick={() => reset()}>重置测试局</button>
          <details>
            <summary>测试选项</summary>
            <div className="snow-options">
              <label>
                场景
                <select
                  aria-label="测试场景"
                  value={scenario}
                  onChange={(e) => reset(e.target.value as SnowScenario)}
                >
                  {Object.entries(scenarios).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => {
                  const s = useGameStore.getState();
                  s.setViewingPlayer(view?.match.viewerSeat === 'FIRST' ? 'p2' : 'p1');
                }}
              >
                切换双方视角
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={reduced}
                  onChange={(e) => {
                    setReduced(e.target.checked);
                  }}
                />
                减少动态
              </label>
              <p>
                声援时观察橙边、凝心与跳心；成功加分沿用普通反馈。六张与五张场景仅改变初始牌序；失败场景预设成员灰心，改色场景预设紫色替换。
              </p>
            </div>
          </details>
        </div>
        <span>双方 Live Start! → 拖歌曲到 LIVE 区 → 确认放置 → 发动开始效果 → 声援时点亮橙心</span>
      </aside>
    </MotionConfig>
  );
}
prepareSnowPreviewImages().then(
  () => {
    setupSnow();
    createRoot(document.getElementById('root')!).render(<App />);
  },
  () => {
    document.getElementById('root')!.textContent = '歌曲卡图未能加载，请刷新后重试。';
  }
);
