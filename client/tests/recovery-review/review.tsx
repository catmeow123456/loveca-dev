import React from 'react';
import { createRoot } from 'react-dom/client';
import { GameBoard } from '@/components/game/GameBoard';
import { useGameStore } from '@/store/gameStore';
import { applyTheme } from '@/lib/theme';
import {
  prepareRecoveryScenario,
  type RecoveryScenario,
} from '../../../tests/helpers/recovery-animation-fixture';
import './review.css';

applyTheme('dark');
const store = () => useGameStore.getState();
let fixture: ReturnType<typeof prepareRecoveryScenario>;
function prepare(scenario: RecoveryScenario) {
  fixture = prepareRecoveryScenario(scenario, store().gameSession);
  store().loadCardData(fixture.cardData);
  useGameStore.setState({ viewingPlayerId: 'p1', replaySession: null, remoteSession: null });
  store().syncState();
}
prepare('single');
function App() {
  const view = useGameStore((s) => s.playerViewState);
  const [scenario, setScenario] = React.useState<RecoveryScenario>('single');
  const [result, setResult] = React.useState('使用桌面原有卡效按钮，或点击下一步。');
  const step = (illegal = false) => {
    const command = fixture.nextCommand(illegal);
    const outcome = fixture.session.executeCommand(command);
    store().syncState();
    setResult(outcome.success ? '已执行真实命令' : `未执行：${outcome.error}`);
  };
  return (
    <>
      <header className="review-bar">
        <strong>二维休息室回收</strong>
        <select
          aria-label="验收场景"
          value={scenario}
          onChange={(e) => {
            const value = e.target.value as RecoveryScenario;
            setScenario(value);
            prepare(value);
          }}
        >
          <option value="single">中须霞 · 单张回收</option>
          <option value="multiple">百生吟子 · 双张回收</option>
          <option value="no-target">中须霞 · 无目标</option>
        </select>
        <button onClick={() => step()}>下一步</button>
        <button onClick={() => step(true)}>尝试非法选择</button>
        <button
          onClick={() => {
            const r = store().undoLastStep();
            setResult(r.success ? '已撤销' : (r.error ?? '不可撤销'));
          }}
        >
          撤销上一步
        </button>
        <button onClick={() => prepare(scenario)}>重新准备</button>
        <button
          onClick={() => store().setViewingPlayer(store().viewingPlayerId === 'p1' ? 'p2' : 'p1')}
        >
          切换视角
        </button>
        <span role="status" aria-label="验收结果">
          {result} · 序号 {view?.match.seq} · {view?.match.viewerSeat}
        </span>
      </header>
      <main className="review-board">
        <GameBoard />
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
