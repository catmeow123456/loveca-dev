import { useEffect, useState } from 'react';
import type { AiRecordedBillingResponse } from '@game/online/ai-battle-billing-types';
import { fetchAiRecordedBilling } from '@/lib/aiBattleClient';
import { AiBillingCost } from './AiBillingCost';

export function AiRecordedBilling({ matchId }: { readonly matchId: string }) {
  const [value, setValue] = useState<AiRecordedBillingResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetchAiRecordedBilling(matchId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setValue(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [matchId]);
  if (failed) return <p className="ai-billing-history">本局费用读取失败</p>;
  if (!value) return <p className="ai-billing-history">正在读取本局费用…</p>;
  return (
    <div className="ai-billing-history">
      {value.matchBilling ? (
        <>
          <AiBillingCost billing={value.matchBilling} label="本局" />
          <small>{value.matchBilling.model} · 北京人民币原价预估</small>
        </>
      ) : (
        <span>本局费用未记录</span>
      )}
    </div>
  );
}
