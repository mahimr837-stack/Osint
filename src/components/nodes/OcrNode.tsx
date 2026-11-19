import { useEffect, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Check, Copy, Loader2, ScanText } from 'lucide-react';
import { createWorker, type Worker } from 'tesseract.js';
import type { OcrNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import {
  getConnectedSourceImageForNode,
  HANDLE_IDS,
} from '../../utils/osintGraph';
import { buildSourceImageSignature } from '../../utils/canvasPersistence';

export function OcrNode({ id, data, selected }: NodeProps<OcrNodeData>) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const updateOcrNodeData = useCanvasStore((state) => state.updateOcrNodeData);

  const connectedImage = useMemo(
    () => getConnectedSourceImageForNode(id, nodes, edges),
    [id, nodes, edges],
  );

  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusLabel, setStatusLabel] = useState('');
  const [extractedText, setExtractedText] = useState(data.extractedText ?? '');
  const [confidence, setConfidence] = useState<number | null>(data.confidence ?? null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const imageUrl = connectedImage?.imageUrl ?? null;
  const connectedId = connectedImage?.id ?? null;
  const connectedTitle = connectedImage?.title ?? null;
  const signature = buildSourceImageSignature(connectedId, imageUrl);

  useEffect(() => {
    // Clear everything immediately when disconnected or image is missing
    if (!connectedId || !imageUrl || !signature) {
      setIsLoading(false);
      setProgress(0);
      setStatusLabel('');
      setExtractedText('');
      setConfidence(null);
      setError(null);
      updateOcrNodeData(id, {
        extractedText: '',
        confidence: null,
        sourceTitle: null,
        processedSignature: null,
      });
      return;
    }

    // Restore persisted IndexedDB result immediately if signature matches
    if (data.processedSignature === signature && data.extractedText !== undefined) {
      setIsLoading(false);
      setError(null);
      setExtractedText(data.extractedText);
      setConfidence(data.confidence ?? null);
      return;
    }

    let cancelled = false;
    let worker: Worker | null = null;

    const runOcr = async () => {
      setIsLoading(true);
      setProgress(0);
      setStatusLabel('Loading OCR engine...');
      setExtractedText('');
      setConfidence(null);
      setError(null);

      try {
        worker = await createWorker('eng', 1, {
          logger: (message) => {
            if (cancelled) return;
            if (message.status) {
              setStatusLabel(message.status);
            }
            if (typeof message.progress === 'number') {
              setProgress(Math.round(message.progress * 100));
            }
          },
        });

        if (cancelled) return;

        const result = await worker.recognize(imageUrl);
        if (cancelled) return;

        const text = result.data.text?.trim() ?? '';
        const conf =
          typeof result.data.confidence === 'number'
            ? Math.round(result.data.confidence)
            : null;
        setExtractedText(text);
        setConfidence(conf);
        updateOcrNodeData(id, {
          extractedText: text,
          confidence: conf,
          sourceTitle: connectedTitle,
          processedSignature: signature,
        });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Local OCR processing failed.';
        setError(message);
        updateOcrNodeData(id, {
          extractedText: '',
          confidence: null,
          sourceTitle: connectedTitle,
          processedSignature: null,
        });
      } finally {
        if (worker) {
          try {
            await worker.terminate();
          } catch {
            // Ignore worker cleanup errors
          }
        }
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void runOcr();

    return () => {
      cancelled = true;
    };
  }, [
    connectedId,
    connectedTitle,
    data.confidence,
    data.extractedText,
    data.processedSignature,
    id,
    imageUrl,
    signature,
    updateOcrNodeData,
  ]);

  const handleCopy = async () => {
    if (!extractedText) return;
    try {
      await navigator.clipboard.writeText(extractedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard write may be blocked in restricted contexts
    }
  };

  return (
    <div
      data-testid={`ocr-node-${id}`}
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
        id={HANDLE_IDS.OCR_IN}
        aria-label={`Image input for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Right Output Handle for chaining extracted text to ChatNode */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OCR_OUT}
        aria-label={`OCR text output for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header */}
      <div className="border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ScanText className="h-4 w-4 shrink-0 text-neutral-500" />
            <h3 className="truncate text-sm font-semibold text-neutral-900">
              {data.title}
            </h3>
          </div>
          {confidence !== null && !isLoading && (
            <span className="font-mono-tabular shrink-0 text-[11px] text-neutral-400">
              {confidence}% conf
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
            Connect an ImageNode to extract visible text locally.
          </div>
        ) : !connectedImage.imageUrl ? (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-6 text-center text-xs text-neutral-400">
            Connected frame has no image loaded yet.
          </div>
        ) : isLoading ? (
          <div
            data-testid={`ocr-loading-${id}`}
            className="rounded-lg border border-neutral-200/80 bg-neutral-50/70 px-3 py-5"
          >
            <div className="flex items-center justify-between gap-2 text-xs text-neutral-700">
              <div className="flex items-center gap-2 min-w-0">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#ff4d4d]" />
                <span className="truncate capitalize">
                  {statusLabel || 'Running OCR...'}
                </span>
              </div>
              <span className="font-mono-tabular shrink-0 text-[11px] text-neutral-500">
                {progress}%
              </span>
            </div>
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
              <div
                className="h-full rounded-full bg-[#ff4d4d] transition-all duration-150"
                style={{ width: `${Math.max(progress, 8)}%` }}
              />
            </div>
          </div>
        ) : error ? (
          <div
            data-testid={`ocr-error-${id}`}
            className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-3 text-xs text-red-700"
          >
            {error}
          </div>
        ) : (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium text-neutral-500">
                Extracted Text
              </span>
              {extractedText && (
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  aria-label={`Copy extracted text from ${data.title}`}
                  className="nodrag inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-600" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              )}
            </div>
            <div
              data-testid={`ocr-output-${id}`}
              className="nodrag nowheel max-h-52 min-h-24 overflow-y-auto rounded-lg border border-neutral-200/80 bg-[#fafafa] p-2.5 font-mono-tabular text-xs leading-relaxed text-neutral-800 whitespace-pre-wrap"
            >
              {extractedText || (
                <span className="font-sans text-neutral-400">
                  No readable text detected in this frame.
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
