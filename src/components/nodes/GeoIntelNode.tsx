import { useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Loader2, Radar } from 'lucide-react';
import type { GeoIntelNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import {
  getConnectedSourceImageForNode,
  HANDLE_IDS,
} from '../../utils/osintGraph';
import { getProviderMeta } from '../../utils/llmProviders';

export function GeoIntelNode({
  id,
  data,
  selected,
}: NodeProps<GeoIntelNodeData>) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const provider = useCanvasStore((state) => state.provider);
  const model = useCanvasStore((state) => state.model);
  const isExtracting = useCanvasStore(
    (state) => Boolean(state.extractingGeoIntelIds[id]),
  );
  const extractGeoIntelCluesForNode = useCanvasStore(
    (state) => state.extractGeoIntelCluesForNode,
  );

  const [error, setError] = useState<string | null>(null);

  const connectedImage = useMemo(
    () => getConnectedSourceImageForNode(id, nodes, edges),
    [id, nodes, edges],
  );

  const providerMeta = getProviderMeta(provider);
  const clues = data.clues ?? [];

  const handleExtract = async () => {
    setError(null);
    const result = await extractGeoIntelCluesForNode(id);
    if (!result.ok && result.error) {
      setError(result.error);
    }
  };

  return (
    <div
      data-testid={`geointel-node-${id}`}
      data-has-source={connectedImage ? 'true' : 'false'}
      data-clue-count={String(clues.length)}
      className={`relative w-88 rounded-xl border bg-white transition-shadow duration-150 ${
        selected
          ? 'border-neutral-900 shadow-md'
          : 'border-neutral-200/90 shadow-sm'
      }`}
    >
      {/* Left Input Handle accepting ImageNode / EnhanceNode */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.GEOINTEL_IN}
        aria-label={`Image input for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header */}
      <div className="border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Radar className="h-4 w-4 shrink-0 text-[#ff4d4d]" />
            <h3 className="truncate text-sm font-semibold text-neutral-900">
              {data.title}
            </h3>
          </div>
          {clues.length > 0 && !isExtracting && (
            <span className="font-mono-tabular shrink-0 text-[11px] font-medium text-neutral-500">
              {clues.length} clue{clues.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-neutral-500">
          {connectedImage
            ? `Source: ${connectedImage.title}`
            : 'No ImageNode connected'}
        </p>
      </div>

      {/* Body */}
      <div className="space-y-3 p-3.5">
        <div className="nodrag space-y-2">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="font-medium text-neutral-600">GEOINT Vision</span>
            <span className="truncate text-neutral-400">
              {providerMeta.name} · {model.trim() || providerMeta.defaultModel}
            </span>
          </div>

          <button
            type="button"
            disabled={isExtracting}
            onClick={() => {
              void handleExtract();
            }}
            data-testid={`extract-geointel-btn-${id}`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            {isExtracting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#ff4d4d]" />
                <span>Extracting Clues...</span>
              </>
            ) : (
              <span>Extract Clues</span>
            )}
          </button>
        </div>

        {/* Inline Error */}
        {error && (
          <div
            data-testid={`geointel-error-${id}`}
            className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-2 text-xs text-red-700"
          >
            {error}
          </div>
        )}

        {/* Bulleted Clues List or Empty / Ready State */}
        {!connectedImage && clues.length === 0 ? (
          <div
            data-testid={`geointel-empty-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-6 text-center text-xs text-neutral-400"
          >
            Connect an ImageNode and click Extract Clues to catalog physical geolocation indicators.
          </div>
        ) : connectedImage && !connectedImage.imageUrl && clues.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-6 text-center text-xs text-neutral-400">
            Connected frame has no image loaded yet.
          </div>
        ) : clues.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>Extracted Clues</span>
              {data.sourceTitle && (
                <span className="max-w-44 truncate text-neutral-400">
                  {data.sourceTitle}
                </span>
              )}
            </div>
            <ul
              data-testid={`geointel-clue-list-${id}`}
              className="nodrag nowheel max-h-64 list-disc space-y-2 overflow-y-auto rounded-lg border border-neutral-200/80 bg-[#fafafa] py-2.5 pl-6 pr-3 text-xs text-neutral-800"
            >
              {clues.map((clue, index) => (
                <li
                  key={`${index}-${clue.category}`}
                  data-testid={`geointel-clue-item-${id}-${index}`}
                  className="leading-relaxed marker:text-[#ff4d4d]"
                >
                  <span className="font-semibold text-neutral-900">
                    {clue.category}:{' '}
                  </span>
                  <span className="text-neutral-700">{clue.observation}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div
            data-testid={`geointel-ready-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-5 text-center text-xs text-neutral-500"
          >
            Image wired. Click Extract Clues to analyze architecture, vegetation, shadows, plates, signage, and infrastructure.
          </div>
        )}
      </div>
    </div>
  );
}
