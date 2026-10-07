import type { ReactNode } from 'react';
import { PageHeader } from '@/components/common';

interface AdminPageHeaderProps {
  readonly title: ReactNode;
  readonly category: '内容与平台' | '卡牌与规则' | '对局与赛季';
  readonly onBack: () => void;
  readonly actions?: ReactNode;
  readonly backLabel?: string;
}

export function AdminPageHeader({
  title,
  category,
  onBack,
  actions,
  backLabel = '返回管理中心',
}: AdminPageHeaderProps) {
  return (
    <PageHeader
      title={title}
      description={category}
      onBack={onBack}
      backLabel={backLabel}
      right={actions}
    />
  );
}
