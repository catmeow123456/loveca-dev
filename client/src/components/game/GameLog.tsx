/**
 * 游戏日志面板
 * 左侧可展开/收起的侧边栏
 */

import { memo, useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useGameStore } from '@/store/gameStore';

export const GameLog = memo(function GameLog() {
  const logs = useGameStore((s) => s.ui.logs);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current && isExpanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isExpanded]);

  const typeColors = {
    info: 'text-slate-400',
    action: 'text-cyan-400',
    phase: 'text-amber-400',
    error: 'text-red-400',
  };

  return (
    <div className="fixed left-0 top-0 h-full z-50 flex">
      {/* 展开/收起按钮 */}
      <motion.button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'h-full w-8 flex items-center justify-center',
          'bg-slate-300/20 hover:bg-slate-200/20',
          'border-r border-slate-100/20',
          'text-slate-400 hover:text-white',
          'transition-colors'
        )}
        whileHover={{ width: 36 }}
        whileTap={{ scale: 0.95 }}
      >
        <motion.span
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-lg"
        >
          {isExpanded ? '◀' : '▶'}
        </motion.span>
      </motion.button>

      {/* 侧边栏内容 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="h-full bg-slate-600/95 border-r border-slate-700 overflow-hidden shadow-xl flex flex-col"
          >
            {/* 标题栏 */}
            <div className="flex-shrink-0 bg-slate-600 px-3 py-2 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-bold text-slate-200">📜 游戏日志</span>
              <span className="text-xs text-slate-400">{logs.length} 条</span>
            </div>

            {/* 日志内容 - 可滚动 */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-2 space-y-1 font-mono text-xs"
            >
              <AnimatePresence initial={false}>
                {logs.map((log) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className={cn(
                      'py-1 px-2 rounded',
                      'bg-slate-300/50',
                      typeColors[log.type]
                    )}
                  >
                    <div className="text-slate-300 text-[10px] mb-0.5">
                      {new Date(log.timestamp).toLocaleTimeString('zh-CN', {
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </div>
                    <div className="text-slate-300/70 break-words">{log.message}</div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {logs.length === 0 && (
                <div className="text-slate-600 text-center py-4">
                  暂无日志
                </div>
              )}
            </div>

            {/* 清空按钮 */}
            <div className="flex-shrink-0 p-2 border-t border-slate-700">
              <button
                onClick={() => {
                  // 这里可以添加清空日志的功能
                }}
                className="w-full text-xs text-slate-500 hover:text-slate-300 py-1 rounded bg-slate-800/50 hover:bg-slate-700/50 transition-colors"
              >
                点击展开按钮收起
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default GameLog;
