import type { ReactNode } from 'react';
import { PageHeader } from '@/components/common';

interface AdminPageHeaderProps {
  readonly title: ReactNode;
  readonly category: '内容与平台' | '卡牌与规则' | '对局与赛季';
  readonly onBack: () => void;
  readonly actions?: ReactNode;
}

export function AdminPageHeader({ title, category, onBack, actions }: AdminPageHeaderProps) {
  return (
    <PageHeader
      title={title}
      description={category}
      onBack={onBack}
      backLabel="返回管理中心"
      right={actions}
    />
  );
}
