import { useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { ExternalLink, Loader2, Terminal } from 'lucide-react';
import type { DorkNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import { HANDLE_IDS, resolveDorkSourceForNode } from '../../utils/osintGraph';
import {
  buildGoogleSearchUrl,
  DORK_TARGET_OPTIONS,
  type DorkTargetType,
} from '../../utils/dorkGenerator';
import { getProviderMeta } from '../../utils/llmProviders';

export function DorkNode({ id, data, selected }: NodeProps<DorkNodeData>) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const provider = useCanvasStore((state) => state.provider);
  const model = useCanvasStore((state) => state.model);
  const isGenerating = useCanvasStore(
    (state) => Boolean(state.generatingDorkIds[id]),
  );
  const updateDorkNodeData = useCanvasStore((state) => state.updateDorkNodeData);
  const generateDorksForNode = useCanvasStore(
    (state) => state.generateDorksForNode,
  );

  const [error, setError] = useState<string | null>(null);

  const resolvedSource = useMemo(
    () => resolveDorkSourceForNode(id, nodes, edges),
    [id, nodes, edges],
  );

  const providerMeta = getProviderMeta(provider);
  const dorks = data.dorks ?? [];

  const handleTargetChange = (nextTarget: DorkTargetType) => {
    setError(null);
    updateDorkNodeData(id, { targetType: nextTarget });
  };

  const handleGenerate = async () => {
    setError(null);
    const result = await generateDorksForNode(id);
    if (!result.ok && result.error) {
      setError(result.error);
    }
  };

  return (
    <div
      data-testid={`dork-node-${id}`}
      data-has-source={resolvedSource ? 'true' : 'false'}
      data-dork-count={String(dorks.length)}
      className={`relative w-88 rounded-xl border bg-white transition-shadow duration-150 ${
        selected
          ? 'border-neutral-900 shadow-md'
          : 'border-neutral-200/90 shadow-sm'
      }`}
    >
      {/* Left Input Handle accepting OcrNode, ExifNode, or ChatNode */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.DORK_IN}
        aria-label={`Text source input for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header */}
      <div className="border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Terminal className="h-4 w-4 shrink-0 text-[#ff4d4d]" />
            <h3 className="truncate text-sm font-semibold text-neutral-900">
              {data.title}
            </h3>
          </div>
          {dorks.length > 0 && !isGenerating && (
            <span className="font-mono-tabular shrink-0 text-[11px] font-medium text-neutral-500">
              {dorks.length} dork{dorks.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-neutral-500">
          {resolvedSource
            ? `Source: ${resolvedSource.summaryLabel}`
            : 'No OcrNode, ExifNode, or ChatNode connected'}
        </p>
      </div>

      {/* Body */}
      <div className="space-y-3 p-3.5">
        {/* Target Dropdown + Generate Action */}
        <div className="nodrag space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor={`dork-target-${id}`}
              className="text-[11px] font-medium text-neutral-600"
            >
              Target Focus
            </label>
            <span className="truncate text-[11px] text-neutral-400">
              {providerMeta.name} · {model.trim() || providerMeta.defaultModel}
            </span>
          </div>

          <select
            id={`dork-target-${id}`}
            value={data.targetType}
            onChange={(e) => handleTargetChange(e.target.value as DorkTargetType)}
            data-testid={`dork-target-select-${id}`}
            className="w-full rounded-lg border border-neutral-200 bg-neutral-50/70 px-2.5 py-1.5 text-xs font-medium text-neutral-900 focus:border-neutral-400 focus:bg-white focus:outline-none"
          >
            {DORK_TARGET_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={isGenerating}
            onClick={() => {
              void handleGenerate();
            }}
            data-testid={`generate-dorks-btn-${id}`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#ff4d4d]" />
                <span>Generating Dorks...</span>
              </>
            ) : (
              <span>Generate Dorks</span>
            )}
          </button>
        </div>

        {/* Inline Error Feedback */}
        {error && (
          <div
            data-testid={`dork-error-${id}`}
            className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-2 text-xs text-red-700"
          >
            {error}
          </div>
        )}

        {/* Clickable Google Dork Links or Empty / Pending State */}
        {!resolvedSource && dorks.length === 0 ? (
          <div
            data-testid={`dork-empty-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-6 text-center text-xs text-neutral-400"
          >
            Connect an OcrNode, ExifNode, or ChatNode to synthesize targeted Google Dorks.
          </div>
        ) : resolvedSource && !resolvedSource.hasText && dorks.length === 0 ? (
          <div
            data-testid={`dork-pending-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-6 text-center text-xs text-neutral-500"
          >
            Connected source has no text yet. Run upstream extraction or chat analysis first.
          </div>
        ) : dorks.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>Generated Queries</span>
              <span>Click to search Google</span>
            </div>
            <ol
              data-testid={`dork-list-${id}`}
              className="nodrag nowheel max-h-60 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200/80 bg-[#fafafa]"
            >
              {dorks.map((dork, index) => (
                <li key={`${index}-${dork}`}>
                  <a
                    href={buildGoogleSearchUrl(dork)}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`dork-link-${id}-${index}`}
                    aria-label={`Search Google for ${dork}`}
                    className="group flex items-start justify-between gap-2 px-2.5 py-2 text-xs text-neutral-800 transition-colors hover:bg-white hover:text-neutral-950 focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900"
                  >
                    <span className="flex min-w-0 items-start gap-2">
                      <span className="font-mono-tabular mt-0.5 shrink-0 text-[11px] text-neutral-400">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="font-mono-tabular break-all leading-relaxed">
                        {dork}
                      </span>
                    </span>
                    <ExternalLink
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400 transition-colors group-hover:text-[#ff4d4d]"
                      aria-hidden="true"
                    />
                  </a>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div
            data-testid={`dork-ready-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-5 text-center text-xs text-neutral-500"
          >
            Source text ready. Choose a target focus and click Generate Dorks.
          </div>
        )}
      </div>
    </div>
  );
}
