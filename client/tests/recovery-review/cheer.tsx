import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { GameBoard } from '@/components/game/GameBoard';
import { useGameStore } from '@/store/gameStore';
import { applyTheme } from '@/lib/theme';
import { prepareCheer } from './cheerFixture';
import { warmCheerAssets } from '@/components/game/cheerMotion';
import { CheerMotionContext } from '@/components/game/useCheerRevealMotion';
import './review.css';
import './cheer.css';

applyTheme('dark');
prepareCheer();
const store = () => useGameStore.getState();
function App() {
  const [ready, setReady] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [speed, setSpeed] = React.useState(0.5);
  const [enabled, setEnabled] = React.useState(true);
  const [message, setMessage] = React.useState('正在准备牌面素材…');
  const epoch = React.useRef(0);
  const cleanup = () => {
    epoch.current++;
  };
  React.useEffect(() => {
    let alive = true;
    warmCheerAssets()
      .then(() => {
        if (alive) {
          setReady(true);
          setMessage('点击“播放三张声援”，观察左侧应援/判定区。');
        }
      })
      .catch(() => {
        if (alive) setMessage('本地牌面素材未就绪，请刷新重试。');
      });
    return () => {
      alive = false;
      cleanup();
    };
  }, []);
  const reset = () => {
    cleanup();
    setBusy(false);
    prepareCheer();
    document
      .querySelector<HTMLButtonElement>(
        'button[aria-controls="judgment-panel"][aria-expanded="false"]'
      )
      ?.click();
    setMessage('已恢复初始局面，可以重新播放。');
  };
  const play = async (count = 3, liveCount = 1) => {
    cleanup();
    const run = epoch.current;
    flushSync(() => {
      prepareCheer(false, count, false, liveCount);
      setBusy(true);
    });
    document
      .querySelector<HTMLButtonElement>(
        'button[aria-controls="judgment-panel"][aria-expanded="false"]'
      )
      ?.click();
    setMessage('准备声援');
    await new Promise((r) => setTimeout(r, 380));
    if (run !== epoch.current) return;
    const errors: string[] = [];
    flushSync(() => {
      for (let i = 0; i < count; i++) {
        const result = store().revealCheerCard();
        if (!result.success) {
          errors.push('声援命令未执行');
          break;
        }
      }
    });
    if (errors.length) {
      cleanup();
      setBusy(false);
      setMessage(errors[0]);
      return;
    }
    if (!enabled) {
      setBusy(false);
      setMessage('原有效果：共享牌桌基础展示。');
      return;
    }
  };
  return (
    <>
      <header className="review-bar cheer-review-bar">
        <strong>声援 · 心数汇入</strong>
        <span className="cheer-preview-label">本地验收</span>
        <select
          aria-label="展示方式"
          value={enabled ? 'preview' : 'original'}
          onChange={(e) => {
            reset();
            setEnabled(e.target.value === 'preview');
          }}
        >
          <option value="preview">翻牌 + 心汇入</option>
          <option value="original">原有效果</option>
        </select>
        <select
          aria-label="播放速度"
          value={speed}
          onChange={(e) => {
            reset();
            setSpeed(Number(e.target.value));
          }}
        >
          <option value={0.5}>当前速度（原来的一半）</option>
          <option value={1}>原速度对比</option>
        </select>
        <button className="cheer-play" onClick={() => play(3)} disabled={!ready || busy}>
          播放三张声援
        </button>
        <button onClick={() => play(20)} disabled={!ready || busy}>
          播放二十张声援
        </button>
        <button onClick={() => play(20, 2)} disabled={!ready || busy}>
          两张 LIVE 整组判定
        </button>
        <button onClick={reset}>重新准备</button>
        <span role="status">{message}</span>
      </header>
      <main className="review-board">
        <CheerMotionContext.Provider
          value={{
            enabled,
            speed,
            phase: setMessage,
            done: () => {
              setBusy(false);
              setMessage('演示结束 · 可切换原速度或原有效果对比。');
            },
          }}
        >
          <GameBoard />
        </CheerMotionContext.Provider>
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
