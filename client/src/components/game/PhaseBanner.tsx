/**
 * 阶段提示横幅
 * 在阶段切换时显示全屏提示
 */

import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';

export const PhaseBanner = memo(function PhaseBanner() {
  const showBanner = useGameStore((s) => s.ui.showPhaseBanner);
  const bannerText = useGameStore((s) => s.ui.phaseBannerText);

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="fixed inset-0 flex items-center justify-center z-[1000] pointer-events-none"
        >
          <motion.div
            initial={{ y: 50 }}
            animate={{ y: 0 }}
            exit={{ y: -50 }}
            className="bg-slate-900/95 px-12 py-6 rounded-2xl border-2 border-rose-500 shadow-2xl"
          >
            <motion.h1
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="text-3xl font-bold text-white text-center tracking-wider"
              style={{
                textShadow: '0 0 20px rgba(233, 69, 96, 0.5)',
              }}
            >
              {bannerText}
            </motion.h1>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default PhaseBanner;
