import { useMemo, useState, type KeyboardEvent } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { ExternalLink, History, Loader2 } from 'lucide-react';
import type { ArchiveNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import {
  HANDLE_IDS,
  resolveArchiveSourceForNode,
} from '../../utils/osintGraph';

export function ArchiveNode({ id, data, selected }: NodeProps<ArchiveNodeData>) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const isChecking = useCanvasStore((state) =>
    Boolean(state.checkingArchiveIds[id]),
  );
  const updateArchiveNodeData = useCanvasStore(
    (state) => state.updateArchiveNodeData,
  );
  const runArchiveForNode = useCanvasStore((state) => state.runArchiveForNode);

  const [error, setError] = useState<string | null>(null);

  const resolvedSource = useMemo(
    () => resolveArchiveSourceForNode(id, nodes, edges),
    [id, nodes, edges],
  );

  const snapshots = data.snapshots ?? [];
  const placeholderUrl =
    resolvedSource?.suggestedUrl || 'e.g. example.com or https://site.org/page';

  const handleCheckArchive = async () => {
    setError(null);
    const outcome = await runArchiveForNode(id);
    if (!outcome.ok && outcome.error) {
      setError(outcome.error);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleCheckArchive();
    }
  };

  return (
    <div
      data-testid={`archive-node-${id}`}
      data-has-source={resolvedSource ? 'true' : 'false'}
      data-snapshot-count={String(snapshots.length)}
      className={`relative w-88 rounded-xl border bg-white transition-shadow duration-150 ${
        selected
          ? 'border-neutral-900 shadow-md'
          : 'border-neutral-200/90 shadow-sm'
      }`}
    >
      {/* Left Input Handle accepting ChatNode or OcrNode text */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.ARCHIVE_IN}
        aria-label={`URL source input for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header */}
      <div className="border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <History className="h-4 w-4 shrink-0 text-[#ff4d4d]" />
            <h3 className="truncate text-sm font-semibold text-neutral-900">
              {data.title}
            </h3>
          </div>
          {snapshots.length > 0 && !isChecking && (
            <span className="font-mono-tabular shrink-0 text-[11px] font-medium text-neutral-500">
              {snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-neutral-500">
          {resolvedSource
            ? `Source: ${resolvedSource.summaryLabel}`
            : 'Direct URL or connect Chat / OCR node'}
        </p>
      </div>

      {/* Body */}
      <div className="space-y-3 p-3.5">
        <div className="nodrag space-y-2">
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label
                htmlFor={`archive-url-${id}`}
                className="text-[11px] font-medium text-neutral-600"
              >
                Target URL / Domain
              </label>
              {resolvedSource?.suggestedUrl && !data.urlInput.trim() && (
                <span className="font-mono-tabular max-w-44 truncate text-[10px] text-[#d93838]">
                  Detected: {resolvedSource.suggestedUrl}
                </span>
              )}
            </div>
            <input
              id={`archive-url-${id}`}
              type="text"
              value={data.urlInput}
              onChange={(e) => {
                setError(null);
                updateArchiveNodeData(id, { urlInput: e.target.value });
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholderUrl}
              spellCheck={false}
              data-testid={`archive-url-input-${id}`}
              className="font-mono-tabular w-full rounded-lg border border-neutral-200 bg-neutral-50/70 px-2.5 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:outline-none"
            />
          </div>

          <button
            type="button"
            disabled={isChecking}
            onClick={() => void handleCheckArchive()}
            data-testid={`archive-check-btn-${id}`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 cursor-pointer"
          >
            {isChecking ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#ff4d4d]" />
                <span>Checking Wayback Machine...</span>
              </>
            ) : (
              <span>Check Archive</span>
            )}
          </button>
        </div>

        {/* Inline Error */}
        {error && (
          <div
            data-testid={`archive-error-${id}`}
            className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-2 text-xs text-red-700"
          >
            {error}
          </div>
        )}

        {/* Snapshots List */}
        {snapshots.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>Wayback Snapshots</span>
              <span>Click to open</span>
            </div>
            <ol
              data-testid={`archive-snapshots-${id}`}
              className="nodrag nowheel max-h-60 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200/80 bg-[#fafafa]"
            >
              {snapshots.map((snap, idx) => (
                <li key={`${snap.timestamp}-${idx}`}>
                  <a
                    href={snap.snapshotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`archive-link-${id}-${idx}`}
                    aria-label={`Open Wayback snapshot from ${snap.formattedDate}`}
                    className="group flex items-start justify-between gap-2 px-2.5 py-2 text-xs text-neutral-800 transition-colors hover:bg-white hover:text-neutral-950 focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono-tabular font-semibold text-neutral-900">
                          {snap.formattedDate}
                        </span>
                        <span className="font-mono-tabular rounded bg-neutral-200/80 px-1 py-0.5 text-[10px] font-medium text-neutral-700">
                          {snap.statusCode}
                        </span>
                      </div>
                      <p className="font-mono-tabular mt-0.5 truncate text-[11px] text-neutral-500">
                        {snap.originalUrl}
                      </p>
                    </div>
                    <ExternalLink
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400 transition-colors group-hover:text-[#ff4d4d]"
                      aria-hidden="true"
                    />
                  </a>
                </li>
              ))}
            </ol>
          </div>
        ) : data.lastCheckedUrl ? (
          <div
            data-testid={`archive-empty-results-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-5 text-center text-xs text-neutral-500"
          >
            No Wayback Machine snapshots found for &ldquo;{data.lastCheckedUrl}&rdquo;.
          </div>
        ) : (
          <div
            data-testid={`archive-ready-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-5 text-center text-xs text-neutral-400"
          >
            Enter a URL or connect a Chat / OCR node, then click Check Archive to retrieve Wayback Machine snapshots.
          </div>
        )}
      </div>
    </div>
  );
}
