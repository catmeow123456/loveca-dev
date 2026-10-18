import React from 'react';
import { createRoot } from 'react-dom/client';
import { GameBoard } from '@/components/game/GameBoard';
import { useGameStore } from '@/store/gameStore';
import { applyTheme } from '@/lib/theme';
import { prepareMiaEntranceScenario } from '../../../tests/helpers/mia-entrance-fixture';
import { createCardInstance } from '@game/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '@game/domain/entities/game';
import { FaceState, OrientationState } from '@game/shared/types/enums';
import './review.css';

applyTheme('dark');
const store = () => useGameStore.getState();
let fixture: ReturnType<typeof prepareMiaEntranceScenario>;
function prepare() {
  fixture = prepareMiaEntranceScenario({ session: store().gameSession });
  // Initial scene only: sideways neighbor, face-up LIVE and anonymous back.
  let state = registerCards(fixture.session.state!, [
    createCardInstance(fixture.cardData[2]!, 'p1', 'visible-live'),
    createCardInstance(fixture.cardData[2]!, 'p2', 'hidden-live'),
  ]);
  state = updatePlayer(state, 'p1', (p) => ({
    ...p,
    memberSlots: {
      ...p.memberSlots,
      cardStates: new Map(p.memberSlots.cardStates).set('neighbor-center', {
        face: FaceState.FACE_UP,
        orientation: OrientationState.WAITING,
      }),
    },
    liveZone: {
      ...p.liveZone,
      cardIds: ['visible-live'],
      cardStates: new Map([
        ['visible-live', { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE }],
      ]),
    },
  }));
  state = updatePlayer(state, 'p2', (p) => ({
    ...p,
    liveZone: {
      ...p.liveZone,
      cardIds: ['hidden-live'],
      cardStates: new Map([
        ['hidden-live', { face: FaceState.FACE_DOWN, orientation: OrientationState.ACTIVE }],
      ]),
    },
  }));
  (fixture.session as unknown as { authorityState: GameState }).authorityState = state;
  store().loadCardData(fixture.cardData);
  useGameStore.setState({ viewingPlayerId: 'p1', replaySession: null, remoteSession: null });
  store().syncState();
}
prepare();

function App() {
  const [message, setMessage] = React.useState(
    '普通登场检查落场；特殊登场同时检查既有米娅回流衔接。'
  );
  const play = (special: boolean) => {
    const result = special ? fixture.begin() : fixture.ordinary();
    const final = special && result.success ? fixture.confirm() : result;
    store().syncState();
    setMessage(final.success ? '已执行真实登场命令。' : `未执行：${final.error}`);
  };
  return (
    <>
      <header className="review-bar">
        <strong>二维落场 · 纹理与卡面受光</strong>
        <button onClick={() => play(false)}>普通登场</button>
        <button onClick={() => play(true)}>特殊登场（回流）</button>
        <button onClick={prepare}>重新准备</button>
        <button
          onClick={() => store().setViewingPlayer(store().viewingPlayerId === 'p1' ? 'p2' : 'p1')}
        >
          切换视角
        </button>
        <a href="/feedback.html">LIVE 数值反馈</a>
        <span role="status">{message}</span>
      </header>
      <main className="review-board">
        <GameBoard />
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
