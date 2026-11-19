import { useEffect, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Loader2, Sparkles } from 'lucide-react';
import type { EnhanceNodeData, EnhanceScale } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import {
  getConnectedSourceImageForNode,
  HANDLE_IDS,
} from '../../utils/osintGraph';
import { upscaleAndSharpenImage } from '../../utils/imageEnhance';
import { buildSourceImageSignature } from '../../utils/canvasPersistence';

export function EnhanceNode({ id, data, selected }: NodeProps<EnhanceNodeData>) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const setEnhanceNodeScale = useCanvasStore((state) => state.setEnhanceNodeScale);
  const updateEnhanceNodeData = useCanvasStore((state) => state.updateEnhanceNodeData);

  const connectedImage = useMemo(
    () => getConnectedSourceImageForNode(id, nodes, edges),
    [id, nodes, edges],
  );

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imageUrl = connectedImage?.imageUrl ?? null;
  const connectedId = connectedImage?.id ?? null;
  const connectedTitle = connectedImage?.title ?? null;
  const scale = data.scale;
  const signature = buildSourceImageSignature(connectedId, imageUrl, scale);

  useEffect(() => {
    if (!connectedId || !imageUrl || !signature) {
      setIsLoading(false);
      setError(null);
      updateEnhanceNodeData(id, {
        enhancedImageUrl: null,
        sourceDimensions: null,
        outputDimensions: null,
        sourceTitle: null,
        processedSignature: null,
      });
      return;
    }

    // Restore persisted IndexedDB enhanced output immediately if signature matches
    if (data.processedSignature === signature && data.enhancedImageUrl) {
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const runEnhance = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await upscaleAndSharpenImage(imageUrl, scale);
        if (cancelled) return;

        updateEnhanceNodeData(id, {
          enhancedImageUrl: result.enhancedImageUrl,
          sourceDimensions: result.sourceDimensions,
          outputDimensions: result.outputDimensions,
          sourceTitle: connectedTitle,
          processedSignature: signature,
        });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : 'Local canvas super-resolution failed.';
        setError(message);
        updateEnhanceNodeData(id, {
          enhancedImageUrl: null,
          sourceDimensions: null,
          outputDimensions: null,
          sourceTitle: connectedTitle,
          processedSignature: null,
        });
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void runEnhance();

    return () => {
      cancelled = true;
    };
  }, [
    connectedId,
    connectedTitle,
    data.enhancedImageUrl,
    data.processedSignature,
    id,
    imageUrl,
    scale,
    signature,
    updateEnhanceNodeData,
  ]);

  const handleScaleChange = (nextScale: EnhanceScale) => {
    if (nextScale === scale) return;
    setEnhanceNodeScale(id, nextScale);
  };

  return (
    <div
      data-testid={`enhance-node-${id}`}
      data-has-source={connectedImage ? 'true' : 'false'}
      data-scale={`${scale}x`}
      className={`relative w-80 rounded-xl border bg-white transition-shadow duration-150 ${
        selected
          ? 'border-neutral-900 shadow-md'
          : 'border-neutral-200/90 shadow-sm'
      }`}
    >
      {/* Left Input Handle for ImageNode */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.ENHANCE_IN}
        aria-label={`Image input for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Right Output Handle for chaining enhanced image downstream */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.ENHANCE_OUT}
        aria-label={`Enhanced image output for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header */}
      <div className="border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-neutral-500" />
            <h3 className="truncate text-sm font-semibold text-neutral-900">
              {data.title}
            </h3>
          </div>

          <div
            role="group"
            aria-label={`Upscale factor for ${data.title}`}
            className="nodrag flex shrink-0 items-center gap-0.5 rounded-md bg-neutral-100 p-0.5"
          >
            {([2, 4] as const).map((factor) => (
              <button
                key={factor}
                type="button"
                aria-pressed={scale === factor}
                onClick={() => handleScaleChange(factor)}
                className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                  scale === factor
                    ? 'bg-white text-neutral-900 shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-900'
                }`}
              >
                {factor}x
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
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-8 text-center text-xs text-neutral-400">
            Connect an ImageNode to upscale ({scale}x) and sharpen locally.
          </div>
        ) : !connectedImage.imageUrl ? (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-8 text-center text-xs text-neutral-400">
            Connected frame has no image loaded yet.
          </div>
        ) : isLoading ? (
          <div
            data-testid={`enhance-loading-${id}`}
            className="flex items-center justify-center gap-2 rounded-lg border border-neutral-200/80 bg-neutral-50/70 px-3 py-10 text-xs text-neutral-600"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#ff4d4d]" />
            <span>Upscaling {scale}x &amp; sharpening...</span>
          </div>
        ) : error ? (
          <div
            data-testid={`enhance-error-${id}`}
            className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-3 text-xs text-red-700"
          >
            {error}
          </div>
        ) : data.enhancedImageUrl ? (
          <div>
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-neutral-200/80 bg-[#fafafa]">
              <img
                data-testid={`enhance-output-${id}`}
                src={data.enhancedImageUrl}
                alt={`Enhanced ${scale}x frame from ${connectedImage.title}`}
                referrerPolicy="no-referrer"
                draggable={false}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-neutral-500">
              <span>{scale}x Sharpened</span>
              {data.sourceDimensions && data.outputDimensions && (
                <span className="font-mono-tabular truncate text-neutral-700">
                  {data.sourceDimensions} → {data.outputDimensions}
                </span>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
