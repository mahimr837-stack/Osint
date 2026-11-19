import { useEffect, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import ExifReader from 'exifreader';
import { Camera, Loader2 } from 'lucide-react';
import type { ExifNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import {
  formatExifSummary,
  getConnectedSourceImageForNode,
  HANDLE_IDS,
  type FormattedExifSummary,
} from '../../utils/osintGraph';
import { buildSourceImageSignature } from '../../utils/canvasPersistence';

export function ExifNode({ id, data, selected }: NodeProps<ExifNodeData>) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const updateExifNodeData = useCanvasStore((state) => state.updateExifNodeData);

  const connectedImage = useMemo(
    () => getConnectedSourceImageForNode(id, nodes, edges),
    [id, nodes, edges],
  );

  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState<FormattedExifSummary | null>(data.summary ?? null);
  const [error, setError] = useState<string | null>(null);

  const imageUrl = connectedImage?.imageUrl ?? null;
  const connectedId = connectedImage?.id ?? null;
  const connectedTitle = connectedImage?.title ?? null;
  const signature = buildSourceImageSignature(connectedId, imageUrl);

  useEffect(() => {
    // Clear metadata immediately when disconnected or image is missing
    if (!connectedId || !imageUrl || !signature) {
      setIsLoading(false);
      setSummary(null);
      setError(null);
      updateExifNodeData(id, {
        summary: null,
        sourceTitle: null,
        processedSignature: null,
      });
      return;
    }

    // Restore persisted IndexedDB result immediately if signature matches
    if (data.processedSignature === signature && data.summary) {
      setIsLoading(false);
      setError(null);
      setSummary(data.summary);
      return;
    }

    let cancelled = false;

    const parseExif = async () => {
      setIsLoading(true);
      setSummary(null);
      setError(null);

      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error('Could not read image bytes for EXIF inspection.');
        }
        const buffer = await response.arrayBuffer();
        if (cancelled) return;

        const tags = ExifReader.load(buffer, { expanded: true });
        if (cancelled) return;

        const parsedSummary = formatExifSummary(tags);
        setSummary(parsedSummary);
        updateExifNodeData(id, {
          summary: parsedSummary,
          sourceTitle: connectedTitle,
          processedSignature: signature,
        });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Unable to parse EXIF metadata.';
        setError(message);
        updateExifNodeData(id, {
          summary: null,
          sourceTitle: connectedTitle,
          processedSignature: null,
        });
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void parseExif();

    return () => {
      cancelled = true;
    };
  }, [
    connectedId,
    connectedTitle,
    data.processedSignature,
    data.summary,
    id,
    imageUrl,
    signature,
    updateExifNodeData,
  ]);

  return (
    <div
      data-testid={`exif-node-${id}`}
      data-has-source={connectedImage ? 'true' : 'false'}
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
        id={HANDLE_IDS.EXIF_IN}
        aria-label={`Image input for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Right Output Handle for chaining GPS/metadata to ChatNode */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.EXIF_OUT}
        aria-label={`EXIF metadata output for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header */}
      <div className="border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Camera className="h-4 w-4 shrink-0 text-neutral-500" />
            <h3 className="truncate text-sm font-semibold text-neutral-900">
              {data.title}
            </h3>
          </div>
          {summary && summary.fileType !== 'Unknown' && (
            <span className="font-mono-tabular shrink-0 text-[11px] text-neutral-400">
              {summary.fileType}
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
      <div className="p-3.5">
        {!connectedImage ? (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-6 text-center text-xs text-neutral-400">
            Connect an ImageNode to inspect camera and GPS metadata.
          </div>
        ) : !connectedImage.imageUrl ? (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-6 text-center text-xs text-neutral-400">
            Connected frame has no image loaded yet.
          </div>
        ) : isLoading ? (
          <div
            data-testid={`exif-loading-${id}`}
            className="flex items-center justify-center gap-2 rounded-lg border border-neutral-200/80 bg-neutral-50/70 px-3 py-6 text-xs text-neutral-600"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#ff4d4d]" />
            <span>Reading EXIF headers...</span>
          </div>
        ) : error ? (
          <div
            data-testid={`exif-error-${id}`}
            className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-3 text-xs text-red-700"
          >
            {error}
          </div>
        ) : summary ? (
          <dl
            data-testid={`exif-output-${id}`}
            className="divide-y divide-neutral-100 text-xs"
          >
            <div className="flex items-baseline justify-between gap-3 py-2 first:pt-0">
              <dt className="shrink-0 text-neutral-500">Camera</dt>
              <dd className="truncate text-right font-medium text-neutral-900">
                {summary.camera}
              </dd>
            </div>

            <div className="flex items-baseline justify-between gap-3 py-2">
              <dt className="shrink-0 text-neutral-500">Date Taken</dt>
              <dd className="font-mono-tabular truncate text-right text-neutral-800">
                {summary.dateTaken}
              </dd>
            </div>

            <div className="flex items-baseline justify-between gap-3 py-2">
              <dt className="shrink-0 text-neutral-500">GPS</dt>
              <dd
                className={`font-mono-tabular truncate text-right ${
                  summary.hasGps
                    ? 'font-medium text-neutral-900'
                    : 'text-neutral-400'
                }`}
              >
                {summary.gpsCoordinates}
              </dd>
            </div>

            <div className="flex items-baseline justify-between gap-3 py-2 last:pb-0">
              <dt className="shrink-0 text-neutral-500">Dimensions</dt>
              <dd className="font-mono-tabular truncate text-right text-neutral-700">
                {summary.dimensions}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>
    </div>
  );
}
