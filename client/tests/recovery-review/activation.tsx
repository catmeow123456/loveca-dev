import React from 'react';
import { createRoot } from 'react-dom/client';
import { GameBoard } from '@/components/game/GameBoard';
import { useGameStore } from '@/store/gameStore';
import { applyTheme } from '@/lib/theme';
import {
  prepareAbilityActivationScenario,
  type ActivationScenario,
} from '../../../tests/helpers/ability-activation-fixture';
import './review.css';
applyTheme('dark');
const store = () => useGameStore.getState();
let scenario: ActivationScenario = 'stage';
export function prepare() {
  const fixture = prepareAbilityActivationScenario(scenario, store().gameSession);
  store().loadCardData(fixture.cardData);
  useGameStore.setState({ viewingPlayerId: 'p1', replaySession: null, remoteSession: null });
  store().syncState();
}
prepare();
function App() {
  const view = useGameStore((s) => s.playerViewState);
  const [selected, setSelected] = React.useState<ActivationScenario>('stage');
  return (
    <>
      <header className="review-bar">
        <strong>起动 · 水墨波纹</strong>
        <select
          aria-label="起动来源"
          value={selected}
          onChange={(e) => {
            scenario = e.target.value as ActivationScenario;
            setSelected(scenario);
            prepare();
          }}
        >
          <option value="stage">舞台 · 4费 中须霞</option>
          <option value="hand">手牌 · 2费 安养寺姬芽</option>
          <option value="waiting">休息室 · 2费 中须霞</option>
        </select>
        <button onClick={prepare}>重新准备</button>
        <button onClick={() => store().undoLastStep()}>撤销</button>
        <button
          onClick={() => store().setViewingPlayer(store().viewingPlayerId === 'p1' ? 'p2' : 'p1')}
        >
          切换视角
        </button>
        <span role="status">
          {view?.activeEffect
            ? '已进入真实卡效处理'
            : '点击场景对应的卡牌，再点击牌上方的起动效果。'}
        </span>
      </header>
      <main className="review-board">
        <GameBoard />
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
