import {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type ImgHTMLAttributes,
} from 'react';
import { MotionConfig } from 'framer-motion';
import {
  applyDocumentPresentation,
  useAppPresentation,
  useTextPresentation,
} from '@/lib/appPresentation';
import './excel.css';

export function PresentationImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const textOnly = useTextPresentation();
  if (textOnly) return props.alt ? <span className="excel-image-label">{props.alt}</span> : null;
  return <img {...props} />;
}

export function WorksheetCover() {
  const restore = useAppPresentation((state) => state.setCovered);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus();
  }, []);
  return (
    <section className="worksheet-cover" aria-label="工作记录工作表">
      <header>
        <strong>工作簿</strong>
        <button ref={button} onClick={() => restore(false)}>
          返回工作区
        </button>
      </header>
      <div className="excel-formula">
        <span>A1</span>
        <span>事项</span>
      </div>
      <table className="excel-table">
        <thead>
          <tr>
            <th></th>
            <th>A</th>
            <th>B</th>
            <th>C</th>
            <th>D</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>1</th>
            <th>事项</th>
            <th>计划</th>
            <th>状态</th>
            <th>备注</th>
          </tr>
          {['资料整理', '文档核对', '清单更新', '归档检查'].map((name, index) => (
            <tr key={name}>
              <th>{index + 2}</th>
              <td>{name}</td>
              <td>本周</td>
              <td>待处理</td>
              <td>常规工作</td>
            </tr>
          ))}
          {Array.from({ length: 18 }, (_, index) => (
            <tr key={index}>
              <th>{index + 6}</th>
              <td>&nbsp;</td>
              <td></td>
              <td></td>
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
      <footer>工作记录</footer>
    </section>
  );
}

export function PresentationToolbar() {
  const { mode, shortcut, setCovered, setShortcut } = useAppPresentation();
  const [editing, setEditing] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState(shortcut);
  const [error, setError] = useState('');
  if (mode !== 'excel') return null;
  return (
    <div className="excel-toolbar">
      <strong>工作簿</strong>
      <button onClick={() => setCovered(true)}>遮挡工作区</button>
      <button onClick={() => setEditing(!editing)}>快捷键设置</button>
      <span className="excel-shortcut-hint">{shortcut.replace('Key', '')}</span>
      {editing && (
        <div className="excel-shortcut-editor">
          <label>
            遮挡组合键{' '}
            <input value={shortcutDraft} onChange={(e) => setShortcutDraft(e.target.value)} />
          </label>
          <button
            onClick={() => {
              if (setShortcut(shortcutDraft)) {
                setError('');
                setEditing(false);
              } else
                setError(
                  '使用两个或三个修饰键与字母，例如 Ctrl+Alt+KeyX；Ctrl+Alt+KeyE 已用于切换界面'
                );
            }}
          >
            应用
          </button>
          <span role="status">{error}</span>
        </div>
      )}
    </div>
  );
}

class PresentationErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="excel-error" role="alert">
        界面暂时无法显示。<button onClick={() => window.location.reload()}>重新加载</button>
      </div>
    ) : (
      this.props.children
    );
  }
}

export function PresentationRoot({ children }: { children: ReactNode }) {
  const { mode, covered } = useAppPresentation();
  const previousFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    applyDocumentPresentation();
    document.documentElement.dataset.presentationReady = 'true';
    if (!covered && previousFocus.current?.isConnected) previousFocus.current.focus();
  }, [mode, covered]);
  return (
    <MotionConfig
      skipAnimations={mode === 'excel' || covered}
      reducedMotion={mode === 'excel' || covered ? 'always' : 'user'}
      transition={mode === 'excel' ? { duration: 0 } : undefined}
    >
      <div
        id="app-surface"
        className={mode === 'excel' ? 'excel-app' : undefined}
        inert={covered}
        aria-hidden={covered || undefined}
        onFocusCapture={(event) => {
          if (!covered) previousFocus.current = event.target;
        }}
      >
        <PresentationToolbar />
        <PresentationErrorBoundary>{children}</PresentationErrorBoundary>
      </div>
      {covered && <WorksheetCover />}
    </MotionConfig>
  );
}
