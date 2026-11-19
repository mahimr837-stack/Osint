import { useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  UserSearch,
  XCircle,
} from 'lucide-react';
import type { PivotNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import { HANDLE_IDS, resolvePivotSourceForNode } from '../../utils/osintGraph';

export function PivotNode({ id, data, selected }: NodeProps<PivotNodeData>) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const isPivoting = useCanvasStore(
    (state) => Boolean(state.pivotingNodeIds[id]),
  );
  const updatePivotNodeData = useCanvasStore(
    (state) => state.updatePivotNodeData,
  );
  const runPivotForNode = useCanvasStore((state) => state.runPivotForNode);

  const [error, setError] = useState<string | null>(null);

  const resolvedSource = useMemo(
    () => resolvePivotSourceForNode(id, nodes, edges),
    [id, nodes, edges],
  );

  const results = data.results ?? [];
  const foundCount = results.filter((item) => item.exists).length;
  const effectiveUsername =
    data.usernameInput !== ''
      ? data.usernameInput
      : (resolvedSource?.suggestedUsername ?? '');

  const handlePivot = async () => {
    setError(null);
    const result = await runPivotForNode(id);
    if (!result.ok && result.error) {
      setError(result.error);
    }
  };

  return (
    <div
      data-testid={`pivot-node-${id}`}
      data-has-source={resolvedSource ? 'true' : 'false'}
      data-result-count={String(results.length)}
      data-checked-username={data.lastCheckedUsername ?? ''}
      className={`relative w-88 rounded-xl border bg-white transition-shadow duration-150 ${
        selected
          ? 'border-neutral-900 shadow-md'
          : 'border-neutral-200/90 shadow-sm'
      }`}
    >
      {/* Left Input Handle accepting OcrNode or ChatNode */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.PIVOT_IN}
        aria-label={`Text source input for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header */}
      <div className="border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <UserSearch className="h-4 w-4 shrink-0 text-[#ff4d4d]" />
            <h3 className="truncate text-sm font-semibold text-neutral-900">
              {data.title}
            </h3>
          </div>
          {results.length > 0 && !isPivoting && (
            <span className="font-mono-tabular shrink-0 text-[11px] font-medium text-neutral-500">
              {foundCount}/{results.length} found
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-neutral-500">
          {resolvedSource
            ? `Source: ${resolvedSource.summaryLabel}`
            : 'No OcrNode or ChatNode connected'}
        </p>
      </div>

      {/* Body */}
      <div className="space-y-3 p-3.5">
        <div className="nodrag space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor={`pivot-username-${id}`}
              className="text-[11px] font-medium text-neutral-600"
            >
              Target Username
            </label>
            <span className="truncate text-[11px] text-neutral-400">
              GitHub · Instagram · Reddit
            </span>
          </div>

          <input
            id={`pivot-username-${id}`}
            type="text"
            value={effectiveUsername}
            onChange={(e) => {
              setError(null);
              updatePivotNodeData(id, { usernameInput: e.target.value });
            }}
            placeholder="Auto-extracted from OCR or Chat..."
            data-testid={`pivot-username-input-${id}`}
            className="font-mono-tabular w-full rounded-lg border border-neutral-200 bg-neutral-50/70 px-2.5 py-1.5 text-xs font-medium text-neutral-900 placeholder:font-sans placeholder:font-normal placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:outline-none"
          />

          <button
            type="button"
            disabled={isPivoting}
            onClick={() => {
              void handlePivot();
            }}
            data-testid={`pivot-run-btn-${id}`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            {isPivoting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#ff4d4d]" />
                <span>Checking Platforms...</span>
              </>
            ) : (
              <span>Pivot</span>
            )}
          </button>
        </div>

        {/* Inline Error */}
        {error && (
          <div
            data-testid={`pivot-error-${id}`}
            className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-2 text-xs text-red-700"
          >
            {error}
          </div>
        )}

        {/* Platform Existence List or Empty / Ready States */}
        {!resolvedSource && results.length === 0 ? (
          <div
            data-testid={`pivot-empty-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-6 text-center text-xs text-neutral-400"
          >
            Connect an OcrNode or ChatNode to check username presence across GitHub, Instagram, and Reddit.
          </div>
        ) : resolvedSource && !resolvedSource.hasText && results.length === 0 ? (
          <div
            data-testid={`pivot-pending-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-6 text-center text-xs text-neutral-500"
          >
            Connected source has no text yet. Run upstream OCR extraction or chat analysis first.
          </div>
        ) : results.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>Platform Checks</span>
              {data.lastCheckedUsername && (
                <span className="font-mono-tabular truncate text-neutral-500">
                  @{data.lastCheckedUsername}
                </span>
              )}
            </div>
            <ul
              data-testid={`pivot-results-list-${id}`}
              className="nodrag nowheel divide-y divide-neutral-100 rounded-lg border border-neutral-200/80 bg-[#fafafa]"
            >
              {results.map((item) => (
                <li
                  key={item.platform}
                  data-testid={`pivot-result-item-${id}-${item.platform}`}
                  data-status={item.exists ? 'exists' : 'not_found'}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {item.exists ? (
                      <CheckCircle2
                        aria-label="Exists"
                        data-testid={`pivot-status-exists-${id}-${item.platform}`}
                        className="h-4 w-4 shrink-0 text-emerald-600"
                      />
                    ) : (
                      <XCircle
                        aria-label="Not found"
                        data-testid={`pivot-status-not-found-${id}-${item.platform}`}
                        className="h-4 w-4 shrink-0 text-red-600"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-neutral-900">
                          {item.label}
                        </span>
                        <span
                          className={`text-[11px] font-medium ${
                            item.exists ? 'text-emerald-700' : 'text-red-600'
                          }`}
                        >
                          {item.exists ? 'Exists' : 'Not found'}
                        </span>
                      </div>
                      <p className="font-mono-tabular truncate text-[11px] text-neutral-500">
                        {item.displayUrl}
                      </p>
                    </div>
                  </div>

                  <a
                    href={item.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${item.label} profile ${item.displayUrl}`}
                    data-testid={`pivot-link-${id}-${item.platform}`}
                    className="rounded p-1 text-neutral-400 transition-colors hover:bg-white hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div
            data-testid={`pivot-ready-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-5 text-center text-xs text-neutral-500"
          >
            Source text ready. Click Pivot to check GitHub, Instagram, and Reddit in parallel.
          </div>
        )}
      </div>
    </div>
  );
}
