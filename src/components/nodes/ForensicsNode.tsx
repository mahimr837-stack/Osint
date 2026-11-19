import { useEffect, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Loader2, ScanSearch } from 'lucide-react';
import type { ForensicsNodeData, ForensicsViewMode } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import {
  getConnectedSourceImageForNode,
  HANDLE_IDS,
} from '../../utils/osintGraph';
import { buildSourceImageSignature } from '../../utils/canvasPersistence';
import {
  ELA_AMPLIFICATION_FACTOR,
  ELA_JPEG_QUALITY,
  runErrorLevelAnalysis,
} from '../../utils/forensicsEla';

export function ForensicsNode({
  id,
  data,
  selected,
}: NodeProps<ForensicsNodeData>) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const updateForensicsNodeData = useCanvasStore(
    (state) => state.updateForensicsNodeData,
  );
  const setForensicsNodeViewMode = useCanvasStore(
    (state) => state.setForensicsNodeViewMode,
  );

  const connectedImage = useMemo(
    () => getConnectedSourceImageForNode(id, nodes, edges),
    [id, nodes, edges],
  );

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imageUrl = connectedImage?.imageUrl ?? null;
  const connectedId = connectedImage?.id ?? null;
  const connectedTitle = connectedImage?.title ?? null;
  const viewMode: ForensicsViewMode = data.viewMode === 'original' ? 'original' : 'ela';
  const signature = buildSourceImageSignature(
    connectedId,
    imageUrl,
    `${ELA_JPEG_QUALITY}-${ELA_AMPLIFICATION_FACTOR}`,
  );

  useEffect(() => {
    if (!connectedId || !imageUrl || !signature) {
      setIsLoading(false);
      setError(null);
      updateForensicsNodeData(id, {
        elaImageUrl: null,
        dimensions: null,
        maxChannelDiff: null,
        meanChannelDiff: null,
        sourceTitle: null,
        processedSignature: null,
      });
      return;
    }

    if (data.processedSignature === signature && data.elaImageUrl) {
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const analyze = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await runErrorLevelAnalysis(imageUrl, {
          quality: ELA_JPEG_QUALITY,
          amplification: ELA_AMPLIFICATION_FACTOR,
        });
        if (cancelled) return;

        updateForensicsNodeData(id, {
          elaImageUrl: result.elaImageUrl,
          dimensions: result.dimensions,
          maxChannelDiff: result.maxChannelDiff,
          meanChannelDiff: result.meanChannelDiff,
          sourceTitle: connectedTitle,
          processedSignature: signature,
        });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : 'Error Level Analysis failed on the connected image.';
        setError(message);
        updateForensicsNodeData(id, {
          elaImageUrl: null,
          dimensions: null,
          maxChannelDiff: null,
          meanChannelDiff: null,
          sourceTitle: connectedTitle,
          processedSignature: null,
        });
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void analyze();

    return () => {
      cancelled = true;
    };
  }, [
    connectedId,
    connectedTitle,
    data.elaImageUrl,
    data.processedSignature,
    id,
    imageUrl,
    signature,
    updateForensicsNodeData,
  ]);

  const displayedSrc =
    viewMode === 'original' ? imageUrl : (data.elaImageUrl ?? null);
  const elaReady = Boolean(data.elaImageUrl && !isLoading && !error);

  return (
    <div
      data-testid={`forensics-node-${id}`}
      data-has-source={connectedImage ? 'true' : 'false'}
      data-view-mode={viewMode}
      data-ela-ready={elaReady ? 'true' : 'false'}
      className={`relative w-80 rounded-xl border bg-white transition-shadow duration-150 ${
        selected
          ? 'border-neutral-900 shadow-md'
          : 'border-neutral-200/90 shadow-sm'
      }`}
    >
      {/* Left Input Handle for ImageNode / EnhanceNode */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.FORENSICS_IN}
        aria-label={`Image input for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header */}
      <div className="border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <ScanSearch className="h-4 w-4 shrink-0 text-neutral-500" />
            <h3 className="truncate text-sm font-semibold text-neutral-900">
              {data.title}
            </h3>
          </div>

          <div
            role="group"
            aria-label={`View mode for ${data.title}`}
            className="nodrag flex shrink-0 items-center gap-0.5 rounded-md bg-neutral-100 p-0.5"
          >
            {(
              [
                { mode: 'original', label: 'Original' },
                { mode: 'ela', label: 'ELA' },
              ] as const
            ).map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                aria-pressed={viewMode === mode}
                data-testid={`forensics-toggle-${mode}-${id}`}
                onClick={() => {
                  if (viewMode !== mode) {
                    setForensicsNodeViewMode(id, mode);
                  }
                }}
                className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                  viewMode === mode
                    ? 'bg-white text-neutral-900 shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-1 truncate text-xs text-neutral-500">
          {connectedImage
            ? `Source: ${connectedImage.title}`
            : 'No ImageNode connected'}
        </p>
      </div>

      {/* Body */}
      <div className="p-3.5">
        {!connectedImage ? (
          <div
            data-testid={`forensics-empty-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-8 text-center text-xs text-neutral-400"
          >
            Connect an ImageNode to perform 90% JPEG Error Level Analysis (15×).
          </div>
        ) : !connectedImage.imageUrl ? (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-8 text-center text-xs text-neutral-400">
            Connected frame has no image loaded yet.
          </div>
        ) : isLoading ? (
          <div
            data-testid={`forensics-loading-${id}`}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-neutral-200/80 bg-neutral-50/70 px-3 py-8 text-center text-xs text-neutral-600"
          >
            <Loader2 className="h-4 w-4 animate-spin text-[#ff4d4d]" />
            <span>Running 90% JPEG ELA (15× diff)...</span>
          </div>
        ) : error ? (
          <div
            data-testid={`forensics-error-${id}`}
            className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-3 text-xs text-red-700"
          >
            {error}
          </div>
        ) : displayedSrc ? (
          <div>
            <div
              className={`nodrag relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-neutral-200/80 ${
                viewMode === 'ela' ? 'bg-neutral-950' : 'bg-[#fafafa]'
              }`}
            >
              <img
                data-testid={`forensics-preview-${id}`}
                data-active-layer={viewMode}
                src={displayedSrc}
                alt={
                  viewMode === 'ela'
                    ? `Error Level Analysis output for ${connectedImage.title}`
                    : `Original source frame for ${connectedImage.title}`
                }
                referrerPolicy="no-referrer"
                draggable={false}
                className="h-full w-full object-contain"
              />
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-neutral-500">
              <span className="truncate">
                {viewMode === 'ela'
                  ? 'ELA · JPEG 90% · 15× diff'
                  : 'Original source frame'}
              </span>
              <span className="font-mono-tabular shrink-0 text-neutral-700">
                {typeof data.maxChannelDiff === 'number'
                  ? `Peak Δ${data.maxChannelDiff}`
                  : data.dimensions ?? ''}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
