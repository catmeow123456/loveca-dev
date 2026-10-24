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
  capturePresentationShortcut,
  PRESENTATION_MODE_SHORTCUT,
  useAppPresentation,
  useTextPresentation,
} from '@/lib/appPresentation';
import { ExcelRibbon, ExcelRibbonTabs } from './ExcelRibbon';
import { ExcelViewMenu } from './ExcelViewMenu';
import { WorksheetCover } from './WorksheetCover';
import './excel.css';

export function PresentationImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const textOnly = useTextPresentation();
  if (textOnly) return props.alt ? <span className="excel-image-label">{props.alt}</span> : null;
  return <img {...props} />;
}

export function PresentationToolbar() {
  const { mode, covered, excelTheme, shortcut, setExcelTheme, setCovered, setShortcut } =
    useAppPresentation();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const shortcutButton = useRef<HTMLButtonElement>(null);
  const recorder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editing || mode !== 'excel' || covered) return;
    recorder.current?.focus();
    const close = () => {
      setEditing(false);
      shortcutButton.current?.focus();
    };
    const release = capturePresentationShortcut((event) => {
      if (event.repeat || event.isComposing || event.keyCode === 229) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (
        event.target instanceof HTMLButtonElement &&
        ['Enter', ' '].includes(event.key) &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.stopImmediatePropagation();
        return;
      }
      // Tab can still reach Cancel, but recorded keys must never reach game handlers.
      if (event.key !== 'Tab') event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        close();
        return;
      }
      if (['Control', 'Alt', 'Shift', 'Meta', 'Tab'].includes(event.key)) return;
      const candidate = [
        event.ctrlKey && 'Ctrl',
        event.altKey && 'Alt',
        event.shiftKey && 'Shift',
        event.metaKey && 'Meta',
        event.code,
      ]
        .filter(Boolean)
        .join('+');
      if (candidate === PRESENTATION_MODE_SHORTCUT) {
        setError('Ctrl+Alt+E 已用于切换普通／表格界面，请换一个组合。');
      } else if (setShortcut(candidate)) {
        setNotice(`遮挡快捷键已设为 ${candidate.replace('Key', '')}`);
        close();
      } else {
        setError('请同时按住两个或三个修饰键，再按一个字母键。');
      }
    });
    const cancelOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !recorder.current?.contains(event.target) &&
        !shortcutButton.current?.contains(event.target)
      )
        setEditing(false);
    };
    const cancelOnBlur = () => setEditing(false);
    document.addEventListener('pointerdown', cancelOutside);
    window.addEventListener('blur', cancelOnBlur);
    return () => {
      release();
      document.removeEventListener('pointerdown', cancelOutside);
      window.removeEventListener('blur', cancelOnBlur);
    };
  }, [editing, mode, covered, setShortcut]);
  if (mode !== 'excel') return null;
  return (
    <div className="excel-toolbar">
      <div className="excel-toolbar-top">
        <ExcelRibbonTabs viewMenu={<ExcelViewMenu />} />
        <div className="excel-toolbar-actions">
          <button
            type="button"
            aria-pressed={excelTheme === 'dark'}
            onClick={() => setExcelTheme(excelTheme === 'dark' ? 'light' : 'dark')}
          >
            夜间模式
          </button>
          <button
            title={`遮挡／恢复：${shortcut.replace('Key', '')}`}
            onClick={() => setCovered(true)}
          >
            遮挡工作区
          </button>
          <button
            ref={shortcutButton}
            aria-expanded={editing}
            aria-controls="excel-shortcut-recorder"
            title={`当前：${shortcut.replace('Key', '')}；点击后按新组合键`}
            onClick={() => {
              setEditing(!editing);
              setError('');
              setNotice('');
            }}
          >
            遮挡快捷键
          </button>
        </div>
      </div>
      <ExcelRibbon />
      {editing && (
        <div
          ref={recorder}
          id="excel-shortcut-recorder"
          className="excel-shortcut-editor"
          role="group"
          aria-label="录制遮挡快捷键"
          tabIndex={-1}
        >
          <strong>请直接按下新的组合键</strong>
          <p>用于遮挡／恢复工作区，当前为 {shortcut.replace('Key', '')}。</p>
          <p>
            按住两个或三个修饰键（Ctrl、Alt、Shift、Command），再按字母。Mac 的 Alt 对应 Option。
          </p>
          <p>按下即保存；Esc 取消。切换界面仍用 Ctrl+Alt+E。</p>
          <p role="status">{error}</p>
          <button
            onClick={() => {
              setEditing(false);
              shortcutButton.current?.focus();
            }}
          >
            取消
          </button>
        </div>
      )}
      <span className="sr-only" role="status">
        {notice}
      </span>
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
