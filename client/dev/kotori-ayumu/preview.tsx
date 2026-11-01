import { createRoot } from 'react-dom/client';
import { useLayoutEffect, useRef, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { GameBoard } from '@/components/game/GameBoard';
import { BattleViewportShell } from '@/components/game/BattleViewportShell';
import { applyTheme } from '@/lib/theme';
import { useGameStore } from '@/store/gameStore';
import { MovementPreview } from './MovementPreview';
import { type CareEffectKind } from '@/lib/kotoriAyumuEffects';
import { previewCue, setupCare, type Scene } from './fixture';
import './preview.css';
applyTheme('dark');
setupCare();
function App() {
  const sourceOnStage = useGameStore((s) =>
    Object.values(s.playerViewState?.table.zones ?? {}).some((z) =>
      Object.values(z.slotMap ?? {}).includes('obj_source')
    )
  );
  const [scene, setScene] = useState<Scene>('kotori');
  const [reduced, setReduced] = useState(new URLSearchParams(location.search).has('reduced'));
  const [kind, setKind] = useState<CareEffectKind>('KOTORI_KEEP');
  const [shot, setShot] = useState<{
    at?: number;
    speed: number;
    id: number;
    cue: ReturnType<typeof previewCue>;
  } | null>(null);
  const bar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!bar.current) return;
    const o = new ResizeObserver(([e]) =>
      document.documentElement.style.setProperty(
        '--care-qa-height',
        `${e.target.getBoundingClientRect().height}px`
      )
    );
    o.observe(bar.current);
    return () => o.disconnect();
  }, []);
  const reset = (next = scene, rarity = 'SEC', fromHand = false) => {
    setShot(null);
    setScene(next);
    setKind(
      next.startsWith('kotori') ? 'KOTORI_KEEP' : next === 'ayumu' ? 'AYUMU_GIVE' : 'AYUMU_RETURN'
    );
    setupCare(next, rarity, fromHand);
  };
  const replay = (speed = 1, at?: number) =>
    setShot({ speed, at, id: Date.now(), cue: previewCue(kind) });
  return (
    <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>
      <div className="care-test-board">
        <BattleViewportShell>
          <GameBoard />
        </BattleViewportShell>
      </div>
      {shot && (
        <MovementPreview
          key={shot.id}
          cue={shot.cue}
          reduced={reduced}
          holdAt={shot.at}
          timeScale={shot.speed}
          onDone={() => setShot(null)}
        />
      )}
      <aside className="care-qa" ref={bar} aria-label="小鸟与步梦测试工具">
        <strong>心意赠礼</strong>
        <button onClick={() => reset('kotori')}>小鸟起动</button>
        <button onClick={() => reset('ayumu', 'SEC', true)}>步梦下置</button>
        <button onClick={() => reset('ayumu-live')}>步梦LIVE成功</button>
        <button onClick={() => reset(scene, 'SEC', scene === 'ayumu')}>重置</button>
        <button disabled={!sourceOnStage} onClick={() => replay()}>
          {sourceOnStage ? '重播镜头' : '先拖步梦登场'}
        </button>
        <details>
          <summary>测试选项</summary>
          <div>
            <label>
              镜头{' '}
              <select value={kind} onChange={(e) => setKind(e.target.value as CareEffectKind)}>
                {scene.startsWith('kotori') ? (
                  <>
                    <option value="KOTORI_INSPECT">小鸟 · 检视</option>
                    <option value="KOTORI_KEEP">小鸟 · 心意小笺</option>
                  </>
                ) : (
                  <>
                    <option value="AYUMU_GIVE">步梦 · 赠礼</option>
                    <option value="AYUMU_RETURN">步梦 · 回收</option>
                  </>
                )}
              </select>
            </label>
            <button disabled={!sourceOnStage} onClick={() => replay(0.3)}>
              慢放镜头
            </button>
            <button disabled={!sourceOnStage} onClick={() => replay(1, 600)}>
              定格 · 600ms
            </button>
            <button onClick={() => setShot(null)}>关闭镜头</button>
            <button onClick={() => reset(scene, 'R', scene === 'ayumu')}>R全罕度测试</button>
            <button onClick={() => reset('ayumu')}>步梦舞台镜头预览</button>
            <button onClick={() => reset('kotori-relay')}>双小鸟常时标记</button>
            <label>
              <input
                type="checkbox"
                checked={reduced}
                onChange={(e) => setReduced(e.target.checked)}
              />{' '}
              减少动态
            </label>
            <p>
              小鸟：点击舞台小鸟发动起动，弃1张后检视选牌。双小鸟场景：右侧待机 μ’s
              成员只显示一枚爱心，可正常换手验证。步梦下置：将手牌步梦拖到中央，再选择分配能量。LIVE场景从成功效果窗口开始，选择成员及下方能量，再完成抽弃。重播只看镜头，不改变规则。
            </p>
          </div>
        </details>
      </aside>
    </MotionConfig>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
