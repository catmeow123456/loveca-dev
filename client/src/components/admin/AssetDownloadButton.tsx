import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { saveAs } from 'file-saver';
import { apiClient, toApiClientError } from '@/lib/apiClient';

interface AssetDownloadButtonProps {
  readonly url: string;
  readonly filename?: string;
  readonly label?: string;
  readonly accessibleLabel: string;
  readonly authenticated?: boolean;
}

export function AssetDownloadButton({
  url,
  filename,
  label = '下载',
  accessibleLabel,
  authenticated = false,
}: AssetDownloadButtonProps) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setDownloading(true);
    setError(null);
    try {
      let blob: Blob;
      if (authenticated) {
        const response = await apiClient.getBlob(url);
        if (!response.data || response.error) {
          throw toApiClientError(response, '资源读取失败，请重试');
        }
        blob = response.data;
      } else {
        const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`资源读取失败（HTTP ${response.status}），请重试`);
        blob = await response.blob();
      }
      if (
        blob.size === 0 ||
        !/^(image\/|audio\/|application\/octet-stream(?:;|$))/iu.test(blob.type)
      ) {
        throw new Error('未读取到图片或音乐文件，请刷新目录后重试');
      }
      const sourceFilename =
        filename ??
        decodeURIComponent(
          new URL(url, window.location.href).pathname.split('/').at(-1) ?? 'asset'
        );
      const safeFilename = Array.from(sourceFilename)
        .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
        .join('')
        .replace(/[<>:"/\\|?*]/gu, '_')
        .replace(/[. ]+$/gu, '')
        .trim();
      saveAs(blob, safeFilename || 'asset');
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name !== 'TimeoutError' ? cause.message : '下载超时，请重试'
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="inline-flex max-w-full flex-col items-start">
      <button
        type="button"
        aria-label={accessibleLabel}
        aria-busy={downloading}
        disabled={downloading}
        onClick={() => void download()}
        className="inline-flex min-h-8 items-center gap-1.5 px-1 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--accent-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:cursor-wait disabled:opacity-50"
      >
        {downloading ? (
          <Loader2 size={13} className="animate-spin" aria-hidden="true" />
        ) : (
          <Download size={13} aria-hidden="true" />
        )}
        {downloading ? '下载中' : label}
      </button>
      {error ? (
        <p role="alert" className="max-w-64 text-[10px] leading-4 text-[var(--semantic-error)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
