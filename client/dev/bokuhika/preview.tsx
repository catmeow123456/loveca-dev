import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import { GameBoard } from '@/components/game/GameBoard';
import { applyTheme } from '@/lib/theme';
import { BokuhikaScene } from '@/components/game/song-animation/BokuhikaScene';
import { setup } from './fixture';
import {
  bokuhikaSongImage,
  bokuhikaPortraitImage,
} from '@/components/game/song-animation/bokuhikaAssets';
import {
  BOKUHIKA_CAST,
  BOKUHIKA_SUCCESS_DURATION,
  type BokuhikaContribution,
  type BokuhikaMemberId,
} from '@/components/game/song-animation/bokuhikaCast';
import './preview.css';
const params = new URLSearchParams(location.search);
applyTheme('dark');
function App() {
  const [elapsed, setElapsed] = useState(0),
    [active, setActive] = useState(false),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [loaded, setLoaded] = useState(false);
  const [reduced, setReduced] = useState(
    params.has('reduced') || matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [serial, setSerial] = useState(0),
    [opponent, setOpponent] = useState(false);
  const time = useRef(0);
  const [members, setMembers] = useState<readonly BokuhikaMemberId[]>([
    'honoka',
    'eli',
    'kotori',
    'rin',
    'hanayo',
    'nico',
  ]);
  const [contribution, setContribution] = useState<BokuhikaContribution>({
    members,
    scoreBonus: members.length,
  });
  const duration = BOKUHIKA_SUCCESS_DURATION;
  const start = (result: BokuhikaContribution) => {
    time.current = 0;
    setElapsed(0);
    setLoaded(false);
    setActive(true);
    setPlaying(true);
    setContribution(result);
    setSerial((n) => n + 1);
  };
  useEffect(() => {
    if (!playing || !loaded) return;
    let frame = 0,
      last = performance.now();
    const tick = (now: number) => {
      time.current = Math.min(duration, time.current + (now - last) * speed);
      last = now;
      setElapsed(time.current);
      if (time.current >= duration) {
        setPlaying(false);
        setActive(false);
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, loaded, speed, duration]);
  const stop = () => {
    setPlaying(false);
    setActive(false);
  };
  const reset = (ready: boolean, multiple = false) => {
    stop();
    setup(ready, opponent, multiple);
  };
  const seek = (n: number) => {
    setContribution({ members, scoreBonus: members.length });
    time.current = n;
    setElapsed(n);
    setPlaying(false);
    setActive(true);
  };
  return (
    <div className="song-test-window">
      <div className="song-board" inert={active || undefined}>
        <GameBoard />
      </div>
      <div className="song-qa" aria-label="歌曲预览工具">
        <div className="song-qa-main">
          <strong>僕光 · 舞台试作</strong>
          <button onClick={() => start({ members, scoreBonus: members.length })}>
            重播歌曲演出
          </button>
          <button onClick={stop} disabled={!active}>
            跳过
          </button>
          <details>
            <summary>测试控制</summary>
            <div className="song-qa-controls">
              <button onClick={() => reset(false)}>重置 · 自由拖牌</button>
              <button onClick={() => reset(true)}>准备 LIVE 阵容</button>
              <button onClick={() => reset(true, true)}>准备双 LIVE · 选择顺序</button>
              <button
                onClick={() => {
                  stop();
                  const next = !opponent;
                  setOpponent(next);
                  setup(false, next);
                }}
              >
                切换{opponent ? '己方' : '对手'}视角
              </button>
              <label>
                速度{' '}
                <select
                  aria-label="播放速度"
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                >
                  <option value={1}>1×</option>
                  <option value={0.5}>0.5×</option>
                  <option value={0.25}>0.25×</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={reduced}
                  onChange={(e) => {
                    stop();
                    setReduced(e.target.checked);
                  }}
                />
                减少动态
              </label>
              <button
                onClick={() => {
                  if (!active) start({ members, scoreBonus: members.length });
                  else setPlaying((p) => !p);
                }}
              >
                {playing ? '暂停' : '播放'}
              </button>
              <label className="song-scrub">
                定格{' '}
                <input
                  aria-label="动画时间"
                  type="range"
                  min={0}
                  max={BOKUHIKA_SUCCESS_DURATION}
                  step={10}
                  value={elapsed}
                  onChange={(e) => seek(Number(e.target.value))}
                />
                <output>{Math.round(elapsed)}ms</output>
              </label>
              <div className="song-frames">
                <button onClick={() => seek(480)}>花苞</button>
                <button onClick={() => seek(1050)}>展开</button>
                <button onClick={() => seek(1950)}>盛开</button>
                <button onClick={() => seek(2450)}>汇光</button>
              </div>
              <fieldset className="song-cast-options">
                <legend>仅重播用的计入成员 · +{members.length}</legend>
                {BOKUHIKA_CAST.map((m) => (
                  <label key={m.id}>
                    <input
                      type="checkbox"
                      checked={members.includes(m.id)}
                      onChange={(e) => {
                        stop();
                        setMembers((prev) =>
                          e.target.checked ? [...prev, m.id] : prev.filter((id) => id !== m.id)
                        );
                      }}
                    />
                    {m.label}
                  </label>
                ))}
                <button
                  onClick={() => {
                    stop();
                    setMembers(BOKUHIKA_CAST.map((m) => m.id));
                  }}
                >
                  全员
                </button>
                <button
                  onClick={() => {
                    stop();
                    setMembers([]);
                  }}
                >
                  清空
                </button>
              </fieldset>
              <p>
                牌桌可自由拖牌、发动效果和推进阶段。选择「准备 LIVE 阵容」后，推进到 LIVE
                卡设置阶段，将歌曲拖入 LIVE 区。
              </p>
              <p>
                实际 LIVE
                成功效果选到本曲时先播放莲花，结束或跳过后再点击「继续处理」结算；重播勾选不改变对局或分数。
              </p>
            </div>
          </details>
        </div>
      </div>
      {active && (
        <>
          <BokuhikaScene
            key={serial}
            imageUrl={bokuhikaSongImage}
            elapsed={elapsed}
            reducedMotion={reduced}
            contribution={contribution}
            portraitUrl={bokuhikaPortraitImage}
            onReady={() => setLoaded(true)}
          />
          <button className="song-skip" onClick={stop}>
            跳过演出
          </button>
        </>
      )}
    </div>
  );
}
if (params.has('wide'))
  createRoot(document.getElementById('root')!).render(
    <iframe
      title="1600px 对战预览"
      src={`${location.pathname}?embedded=1`}
      style={{
        width: 1600,
        height: 900,
        border: 0,
        transform: `scale(${Math.min(window.innerWidth / 1600, window.innerHeight / 900)})`,
        transformOrigin: 'top left',
      }}
    />
  );
else if (params.has('narrow'))
  createRoot(document.getElementById('root')!).render(
    <iframe
      title="390px 对战预览"
      src={`${location.pathname}?embedded=1`}
      style={{
        width: 390,
        height: 844,
        maxWidth: '100vw',
        border: 0,
        display: 'block',
        margin: '0 auto',
      }}
    />
  );
else {
  setup();
  createRoot(document.getElementById('root')!).render(<App />);
}
