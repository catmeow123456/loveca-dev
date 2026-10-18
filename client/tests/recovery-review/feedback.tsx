import React from 'react';
import { createRoot } from 'react-dom/client';
import { GameBoard } from '@/components/game/GameBoard';
import { useGameStore } from '@/store/gameStore';
import { applyTheme } from '@/lib/theme';
import type { AnyCardData } from '@game/domain/entities/card';
import {
  EFFECT_FEEDBACK_SCENARIOS,
  prepareEffectFeedbackScenario,
  type FeedbackScenarioId,
} from '../../../tests/helpers/effect-feedback-fixture';
import { previewZoneFeedback } from './feedbackProbe';
import './review.css';

applyTheme('dark');
const store = () => useGameStore.getState();
type ReviewScenarioId = FeedbackScenarioId | 'zone';
const scenarios = [
  ...EFFECT_FEEDBACK_SCENARIOS.filter((s) =>
    ['heart', 'multi', 'mixed', 'self', 'score', 'requirement'].includes(s.id)
  ),
  { id: 'zone', name: 'LIVE 区域心／刀／分数（展示样例）' },
] as const;
let fixture: ReturnType<typeof prepareEffectFeedbackScenario>;
export function prepare(id: ReviewScenarioId, targetWaiting = false) {
  fixture = prepareEffectFeedbackScenario(
    id === 'zone' ? 'multi' : id,
    store().gameSession,
    undefined,
    { targetWaiting }
  );
  store().loadCardData(fixture.cards.map((card) => card.data as AnyCardData));
  useGameStore.setState({ viewingPlayerId: 'p1', replaySession: null, remoteSession: null });
  store().syncState();
}
prepare('heart');

function App() {
  const [selected, setSelected] = React.useState<ReviewScenarioId>('heart');
  const [targetWaiting, setTargetWaiting] = React.useState(false);
  const [message, setMessage] = React.useState('点击“演示一次”，或通过桌面原有按钮处理效果。');
  const [busy, setBusy] = React.useState(false);
  const epoch = React.useRef(0);
  const reset = (id = selected, waiting = targetWaiting) => {
    epoch.current++;
    setBusy(false);
    prepare(id, waiting);
  };
  React.useEffect(
    () => () => {
      epoch.current++;
    },
    []
  );
  const step = () => {
    if (selected === 'zone') {
      previewZoneFeedback();
      setMessage('区域级心／刀／分数的展示样例；实际卡效请选加分或需求减少场景。');
      return true;
    }
    const command = fixture.nextCommand();
    if (!command) return false;
    const result = fixture.session.executeCommand(command);
    store().syncState();
    setMessage(
      result.success ? '已通过真实命令结算，光效结束后保留实际加成。' : `未执行：${result.error}`
    );
    return result.success;
  };
  const play = async () => {
    reset();
    const run = epoch.current;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 300));
    for (let i = 0; i < 12 && epoch.current === run; i++) {
      const effect = fixture.session.state?.activeEffect;
      const deadline =
        effect?.publicCardSelectionAutoAdvanceAt ?? effect?.publicEffectChoiceAutoAdvanceAt;
      if (deadline) {
        await new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now()) + 60));
        if (epoch.current !== run || !fixture.session.state?.activeEffect) break;
      }
      if (!step() || selected === 'zone' || !fixture.session.state?.activeEffect) break;
      await new Promise((r) => setTimeout(r, 350));
    }
    if (epoch.current === run) setBusy(false);
  };
  return (
    <>
      <header className="review-bar">
        <strong>成员与 LIVE 数值反馈</strong>
        <select
          aria-label="验收场景"
          value={selected}
          onChange={(e) => {
            const next = e.target.value as ReviewScenarioId;
            setSelected(next);
            reset(next);
          }}
        >
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={targetWaiting}
            onChange={(e) => {
              setTargetWaiting(e.target.checked);
              reset(selected, e.target.checked);
            }}
          />
          横置左侧成员
        </label>
        <button onClick={play} disabled={busy}>
          演示一次
        </button>
        <button onClick={step} disabled={busy}>
          下一步
        </button>
        <button onClick={() => reset()}>重新准备</button>
        <button onClick={() => store().undoLastStep()}>撤销</button>
        <button
          onClick={() => store().setViewingPlayer(store().viewingPlayerId === 'p1' ? 'p2' : 'p1')}
        >
          切换视角
        </button>
        <a href="/activation.html?edge=flow">起动效果</a>
        <a href="/landing.html">落场效果</a>
        <span role="status">{message}</span>
      </header>
      <main className="review-board">
        <GameBoard />
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
