import React from 'react';
import { createRoot } from 'react-dom/client';
import { GameBoard } from '@/components/game/GameBoard';
import {
  AbilityActivationStyleContext,
  type AbilityActivationStyle,
} from '@/components/game/AbilityActivationMotion';
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
  const [edgeStyle, setEdgeStyle] = React.useState<AbilityActivationStyle>(() => {
    const requested = new URLSearchParams(window.location.search).get('edge');
    return requested === 'ink' || requested === 'flow-original' || requested === 'flow'
      ? requested
      : 'rainbow';
  });
  return (
    <>
      <header className="review-bar">
        <strong>起动 · 边缘特效对比</strong>
        <select
          aria-label="边缘特效"
          value={edgeStyle}
          onChange={(e) => {
            const nextStyle = e.target.value as AbilityActivationStyle;
            const url = new URL(window.location.href);
            url.searchParams.set('edge', nextStyle);
            window.history.replaceState(null, '', url);
            setEdgeStyle(nextStyle);
            prepare();
          }}
        >
          <option value="rainbow">七彩流光 · 新版</option>
          <option value="flow">沿边流光 · 1.5 倍速</option>
          <option value="flow-original">沿边流光 · 原速</option>
          <option value="ink">当前墨染 · 保留版</option>
        </select>
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
        <span>相同浮起 · 1 秒</span>
        <span role="status">
          {view?.activeEffect
            ? '已进入真实卡效处理'
            : '点击卡牌，再点击牌上方的起动效果。切换特效会自动重新准备，可反复对比。'}
        </span>
      </header>
      <main className="review-board">
        <AbilityActivationStyleContext.Provider value={edgeStyle}>
          <GameBoard />
        </AbilityActivationStyleContext.Provider>
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
