import { useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Loader2, ScanFace } from 'lucide-react';
import type { FaceNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import {
  getConnectedSourceImageForNode,
  HANDLE_IDS,
} from '../../utils/osintGraph';
import {
  detectFacesInImage,
  drawFaceDetectionsOnCanvas,
  formatFaceCountLabel,
  type FaceDetectionOutput,
} from '../../utils/faceDetection';

export function FaceNode({ id, data, selected }: NodeProps<FaceNodeData>) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const updateFaceNodeData = useCanvasStore((state) => state.updateFaceNodeData);

  const connectedImage = useMemo(
    () => getConnectedSourceImageForNode(id, nodes, edges),
    [id, nodes, edges],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [stageLabel, setStageLabel] = useState('');
  const [detectionOutput, setDetectionOutput] =
    useState<FaceDetectionOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const imageUrl = connectedImage?.imageUrl ?? null;
  const connectedId = connectedImage?.id ?? null;
  const connectedTitle = connectedImage?.title ?? null;

  useEffect(() => {
    if (!connectedId || !imageUrl) {
      setIsLoading(false);
      setStageLabel('');
      setDetectionOutput(null);
      setError(null);
      if (canvasRef.current) {
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
      }
      updateFaceNodeData(id, {
        faceCount: null,
        sourceTitle: null,
      });
      return;
    }

    let cancelled = false;

    const runDetection = async () => {
      setIsLoading(true);
      setStageLabel('Loading TinyFaceDetector & 68-landmark models...');
      setDetectionOutput(null);
      setError(null);

      try {
        const output = await detectFacesInImage(imageUrl, (stage) => {
          if (!cancelled) {
            setStageLabel(stage);
          }
        });
        if (cancelled) return;

        setDetectionOutput(output);
        updateFaceNodeData(id, {
          faceCount: output.boxes.length,
          sourceTitle: connectedTitle,
        });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : 'Local face detection failed.';
        setError(message);
        updateFaceNodeData(id, {
          faceCount: null,
          sourceTitle: connectedTitle,
        });
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setStageLabel('');
        }
      }
    };

    void runDetection();

    return () => {
      cancelled = true;
    };
  }, [connectedId, connectedTitle, id, imageUrl, updateFaceNodeData]);

  useEffect(() => {
    if (!detectionOutput || !canvasRef.current) return;
    drawFaceDetectionsOnCanvas(
      canvasRef.current,
      detectionOutput.image,
      detectionOutput.boxes,
    );
  }, [detectionOutput]);

  const detectedCount = detectionOutput ? detectionOutput.boxes.length : null;

  return (
    <div
      data-testid={`face-node-${id}`}
      data-has-source={connectedImage ? 'true' : 'false'}
      data-face-count={detectedCount !== null ? String(detectedCount) : ''}
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
        id={HANDLE_IDS.FACE_IN}
        aria-label={`Image input for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header */}
      <div className="border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <ScanFace className="h-4 w-4 shrink-0 text-neutral-500" />
            <h3 className="truncate text-sm font-semibold text-neutral-900">
              {data.title}
            </h3>
          </div>
          {detectedCount !== null && !isLoading && (
            <span className="font-mono-tabular shrink-0 text-[11px] font-medium text-neutral-600">
              {detectedCount} {detectedCount === 1 ? 'face' : 'faces'}
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
          <div
            data-testid={`face-empty-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-8 text-center text-xs text-neutral-400"
          >
            Connect an ImageNode to detect faces and landmarks locally.
          </div>
        ) : !connectedImage.imageUrl ? (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-8 text-center text-xs text-neutral-400">
            Connected frame has no image loaded yet.
          </div>
        ) : isLoading ? (
          <div
            data-testid={`face-loading-${id}`}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-neutral-200/80 bg-neutral-50/70 px-3 py-8 text-center text-xs text-neutral-600"
          >
            <Loader2 className="h-4 w-4 animate-spin text-[#ff4d4d]" />
            <span className="leading-relaxed">
              {stageLabel || 'Detecting faces...'}
            </span>
          </div>
        ) : error ? (
          <div
            data-testid={`face-error-${id}`}
            className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-3 text-xs text-red-700"
          >
            {error}
          </div>
        ) : detectionOutput ? (
          <div>
            <div className="nodrag relative w-full overflow-hidden rounded-lg border border-neutral-200/80 bg-[#fafafa]">
              <canvas
                ref={canvasRef}
                data-testid={`face-canvas-${id}`}
                aria-label={`Face detection bounding boxes for ${connectedImage.title}`}
                className="block max-h-60 w-full object-contain"
              />
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
              <span
                data-testid={`face-count-${id}`}
                className="font-mono-tabular font-semibold text-neutral-900"
              >
                {formatFaceCountLabel(detectionOutput.boxes.length)}
              </span>
              <span className="text-[11px] text-neutral-500">
                {detectionOutput.boxes.length > 0
                  ? 'Red boxes drawn'
                  : 'No faces matched'}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
