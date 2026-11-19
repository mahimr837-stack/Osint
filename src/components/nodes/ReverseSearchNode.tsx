import { useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Check, ExternalLink, Globe, Loader2 } from 'lucide-react';
import type { ReverseSearchNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import { getConnectedSourceImageForNode, HANDLE_IDS } from '../../utils/osintGraph';
import {
  inspectImageBufferWithFileType,
  resolveReverseSearchAction,
  REVERSE_SEARCH_ENGINES,
  type ReverseSearchEngine,
} from '../../utils/reverseSearch';

interface ValidatedImageAsset {
  objectUrl: string;
  blob: Blob;
  mime: string;
  ext: string;
  byteSize: number;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

async function convertImageBlobToPng(blob: Blob, objectUrl: string): Promise<Blob> {
  if (blob.type === 'image/png') {
    return blob;
  }

  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1;
      canvas.height = img.naturalHeight || 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable for clipboard conversion.'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          resolve(pngBlob);
        } else {
          reject(new Error('Unable to encode PNG for clipboard.'));
        }
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Unable to decode image for clipboard copy.'));
    img.src = objectUrl;
  });
}

function openUrlInNewTab(targetUrl: string): void {
  const link = document.createElement('a');
  link.href = targetUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function ReverseSearchNode({
  id,
  data,
  selected,
}: NodeProps<ReverseSearchNodeData>) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);

  const connectedImage = useMemo(
    () => getConnectedSourceImageForNode(id, nodes, edges),
    [id, nodes, edges],
  );

  const [isValidating, setIsValidating] = useState(false);
  const [validatedAsset, setValidatedAsset] = useState<ValidatedImageAsset | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [lastLaunchedEngine, setLastLaunchedEngine] =
    useState<ReverseSearchEngine | null>(null);

  const activeObjectUrlRef = useRef<string | null>(null);

  const revokeActiveObjectUrl = () => {
    if (activeObjectUrlRef.current) {
      URL.revokeObjectURL(activeObjectUrlRef.current);
      activeObjectUrlRef.current = null;
    }
  };

  const imageUrl = connectedImage?.imageUrl ?? null;
  const connectedId = connectedImage?.id ?? null;

  useEffect(() => {
    revokeActiveObjectUrl();
    setValidatedAsset(null);
    setValidationError(null);
    setStatusNote(null);
    setLastLaunchedEngine(null);

    if (!connectedId || !imageUrl) {
      setIsValidating(false);
      return;
    }

    let cancelled = false;

    const validateAndCreateObjectUrl = async () => {
      setIsValidating(true);

      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error('Could not read connected image bytes.');
        }

        const buffer = await response.arrayBuffer();
        if (cancelled) return;

        const inspection = await inspectImageBufferWithFileType(buffer);
        if (cancelled) return;

        if (!inspection.valid || !inspection.mime || !inspection.ext) {
          setValidationError(
            inspection.mime
              ? `Unsupported file signature (${inspection.mime}). Connect a valid image.`
              : 'Unrecognized file signature. Connect a valid PNG, JPEG, or WebP image.',
          );
          return;
        }

        const blob = new Blob([buffer], { type: inspection.mime });
        const tempObjectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(tempObjectUrl);
          return;
        }

        activeObjectUrlRef.current = tempObjectUrl;
        setValidatedAsset({
          objectUrl: tempObjectUrl,
          blob,
          mime: inspection.mime,
          ext: inspection.ext,
          byteSize: buffer.byteLength,
        });
      } catch (err) {
        if (cancelled) return;
        setValidationError(
          err instanceof Error
            ? err.message
            : 'Unable to validate connected image file type.',
        );
      } finally {
        if (!cancelled) {
          setIsValidating(false);
        }
      }
    };

    void validateAndCreateObjectUrl();

    return () => {
      cancelled = true;
      revokeActiveObjectUrl();
    };
  }, [connectedId, imageUrl]);

  const handleEngineClick = async (engineId: ReverseSearchEngine) => {
    if (!imageUrl || !validatedAsset) return;

    const plan = resolveReverseSearchAction(engineId, imageUrl);
    setLastLaunchedEngine(engineId);

    if (plan.mode === 'direct-url') {
      openUrlInNewTab(plan.targetUrl);
      setStatusNote(`Opened ${plan.engineName} with remote image URL.`);
      return;
    }

    // URL upload is blocked for local/data/blob images: copy image to clipboard & open homepage
    let clipboardPromise: Promise<void> | null = null;
    const canWriteClipboard =
      typeof navigator !== 'undefined' &&
      Boolean(navigator.clipboard?.write) &&
      typeof ClipboardItem !== 'undefined';

    if (canWriteClipboard) {
      try {
        const pngPromise = convertImageBlobToPng(
          validatedAsset.blob,
          validatedAsset.objectUrl,
        );
        clipboardPromise = navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngPromise }),
        ]);
      } catch {
        clipboardPromise = null;
      }
    }

    openUrlInNewTab(plan.targetUrl);

    if (clipboardPromise) {
      try {
        await clipboardPromise;
        setStatusNote(
          `Image copied to clipboard — paste on ${plan.engineName} to search.`,
        );
      } catch {
        setStatusNote(
          `Opened ${plan.engineName} homepage (clipboard copy blocked by browser).`,
        );
      }
    } else {
      setStatusNote(
        `Opened ${plan.engineName} homepage (clipboard unavailable in this context).`,
      );
    }
  };

  return (
    <div
      data-testid={`reverse-search-node-${id}`}
      data-has-source={connectedImage ? 'true' : 'false'}
      data-valid-image={validatedAsset ? 'true' : 'false'}
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
        id={HANDLE_IDS.REVERSE_SEARCH_IN}
        aria-label={`Image input for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header */}
      <div className="border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Globe className="h-4 w-4 shrink-0 text-neutral-500" />
            <h3 className="truncate text-sm font-semibold text-neutral-900">
              {data.title}
            </h3>
          </div>
          {validatedAsset && (
            <span
              data-testid={`reverse-search-mime-${id}`}
              className="font-mono-tabular shrink-0 text-[11px] text-neutral-400"
            >
              {validatedAsset.ext.toUpperCase()} · {formatByteSize(validatedAsset.byteSize)}
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
            data-testid={`reverse-search-empty-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-6 text-center text-xs text-neutral-400"
          >
            Connect an ImageNode to validate image bytes and run reverse image lookups.
          </div>
        ) : !connectedImage.imageUrl ? (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-6 text-center text-xs text-neutral-400">
            Connected frame has no image loaded yet.
          </div>
        ) : isValidating ? (
          <div
            data-testid={`reverse-search-loading-${id}`}
            className="flex items-center justify-center gap-2 rounded-lg border border-neutral-200/80 bg-neutral-50/70 px-3 py-6 text-xs text-neutral-600"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#ff4d4d]" />
            <span>Verifying image type...</span>
          </div>
        ) : validationError ? (
          <div
            data-testid={`reverse-search-error-${id}`}
            className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-3 text-xs text-red-700"
          >
            {validationError}
          </div>
        ) : validatedAsset ? (
          <div className="space-y-2.5">
            {/* Validated preview strip using temporary object URL */}
            <div className="flex items-center gap-2.5 rounded-lg border border-neutral-200/80 bg-neutral-50/60 p-2">
              <img
                src={validatedAsset.objectUrl}
                alt={`Validated preview for ${connectedImage.title}`}
                data-testid={`reverse-search-preview-${id}`}
                className="h-11 w-14 shrink-0 rounded object-cover border border-neutral-200/70 bg-white"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-neutral-800">
                  Valid {validatedAsset.mime}
                </p>
                <p className="font-mono-tabular truncate text-[11px] text-neutral-400">
                  Temp object URL ready
                </p>
              </div>
            </div>

            {/* Search Engine Buttons */}
            <div className="flex flex-col gap-1.5">
              {REVERSE_SEARCH_ENGINES.map((engine) => {
                const launched = lastLaunchedEngine === engine.id;
                return (
                  <button
                    key={engine.id}
                    type="button"
                    data-testid={`reverse-search-btn-${engine.id}-${id}`}
                    onClick={() => void handleEngineClick(engine.id)}
                    className="nodrag flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-800 transition-colors hover:border-neutral-300 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                  >
                    <span className="truncate">{engine.buttonLabel}</span>
                    {launched ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-[#ff4d4d]" />
                    ) : (
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                    )}
                  </button>
                );
              })}
            </div>

            {statusNote && (
              <p
                data-testid={`reverse-search-status-${id}`}
                className="text-[11px] leading-relaxed text-neutral-500"
              >
                {statusNote}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
