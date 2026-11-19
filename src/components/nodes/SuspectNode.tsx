import { useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import {
  AlertCircle,
  Loader2,
  Sparkles,
  UserCheck,
  UserRoundSearch,
} from 'lucide-react';
import type { SuspectNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import { HANDLE_IDS } from '../../utils/osintGraph';
import {
  DALLE_MODEL_ID,
  IMAGEN_MODEL_ID,
  resolveSuspectContextForNode,
} from '../../utils/suspectComposite';
import { getProviderMeta } from '../../utils/llmProviders';

export function SuspectNode({
  id,
  data,
  selected,
}: NodeProps<SuspectNodeData>) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const provider = useCanvasStore((state) => state.provider);
  const isGenerating = useCanvasStore((state) =>
    Boolean(state.generatingSuspectIds[id]),
  );
  const storeSuspectImageUrl = useCanvasStore(
    (state) => state.suspectImageUrls[id],
  );
  const updateSuspectNodeData = useCanvasStore(
    (state) => state.updateSuspectNodeData,
  );
  const generateSuspectImageForNode = useCanvasStore(
    (state) => state.generateSuspectImageForNode,
  );

  const [localError, setLocalError] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState(false);

  const resolvedContext = useMemo(
    () => resolveSuspectContextForNode(id, nodes, edges),
    [id, nodes, edges],
  );

  const suspectImageUrl = storeSuspectImageUrl ?? data.suspectImageUrl ?? null;
  const providerMeta = getProviderMeta(provider);
  const activeImageModelLabel =
    provider === 'openai'
      ? `${providerMeta.name} · ${DALLE_MODEL_ID}`
      : provider === 'google'
        ? `${providerMeta.name} · ${IMAGEN_MODEL_ID}`
        : `${providerMeta.name} (Select Google or OpenAI)`;

  const canGenerate =
    !isGenerating &&
    (data.descriptionPrompt.trim().length > 0 ||
      resolvedContext.items.length > 0);

  const handleGenerateClick = async () => {
    setLocalError(null);
    setImageLoadError(false);
    const result = await generateSuspectImageForNode(id);
    if (!result.ok && result.error) {
      setLocalError(result.error);
    }
  };

  return (
    <div
      data-testid={`suspect-node-${id}`}
      data-has-context={resolvedContext.items.length > 0 ? 'true' : 'false'}
      data-has-image={suspectImageUrl ? 'true' : 'false'}
      data-is-generating={isGenerating ? 'true' : 'false'}
      className={`relative w-[420px] rounded-xl border bg-white transition-shadow duration-150 ${
        selected
          ? 'border-neutral-900 shadow-md'
          : 'border-neutral-200/90 shadow-sm'
      }`}
    >
      {/* Left Input Handle: accepts ImageNode, OcrNode, or ChatNode context */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.SUSPECT_IN}
        aria-label={`Context input for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header */}
      <div className="border-b border-neutral-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <UserRoundSearch className="h-4 w-4 shrink-0 text-[#ff4d4d]" />
            <input
              type="text"
              value={data.title}
              onChange={(e) =>
                updateSuspectNodeData(id, { title: e.target.value })
              }
              aria-label={`Title for ${id}`}
              className="nodrag w-full truncate rounded bg-transparent text-sm font-semibold text-neutral-900 focus:bg-neutral-50 focus:px-1.5 focus:outline-none"
            />
          </div>
          <span className="shrink-0 rounded-md bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
            Composite
          </span>
        </div>

        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-500">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              resolvedContext.items.length > 0
                ? 'bg-[#ff4d4d]'
                : 'bg-neutral-300'
            }`}
          />
          <span className="truncate" data-testid={`suspect-context-${id}`}>
            {resolvedContext.summaryLabel}
          </span>
        </div>
      </div>

      {/* Top Section: Suspect / Target Description Text Area */}
      <div className="border-b border-neutral-100 px-4 py-3">
        <div className="mb-1.5 flex items-center justify-between">
          <label
            htmlFor={`suspect-desc-${id}`}
            className="text-xs font-medium text-neutral-700"
          >
            Suspect / Target Description
          </label>
          <span className="text-[11px] text-neutral-400">
            Combines with wired nodes
          </span>
        </div>
        <textarea
          id={`suspect-desc-${id}`}
          data-testid={`suspect-description-input-${id}`}
          rows={3}
          value={data.descriptionPrompt}
          onChange={(e) => {
            if (localError) setLocalError(null);
            updateSuspectNodeData(id, { descriptionPrompt: e.target.value });
          }}
          placeholder="Describe physical traits, attire, age range, eyewear, distinguishing marks, or target features..."
          className="nodrag nowheel w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50/70 px-3 py-2 text-xs leading-relaxed text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:outline-none"
        />
      </div>

      {/* Middle Section: Generated Target Composite Image or Pulsing Skeleton / Loading Spinner */}
      <div className="px-4 py-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-medium text-neutral-500">
            Forensic Composite Output
          </span>
          {data.lastProviderLabel && !isGenerating && (
            <span className="font-mono-tabular text-[10px] text-neutral-400">
              {data.lastProviderLabel}
            </span>
          )}
        </div>

        <div
          data-testid={`suspect-preview-box-${id}`}
          className="relative aspect-square w-full overflow-hidden rounded-lg border border-neutral-200/90 bg-[#fafafa]"
        >
          {isGenerating ? (
            <div
              data-testid={`suspect-loading-${id}`}
              className="flex h-full w-full animate-pulse flex-col items-center justify-center gap-2.5 bg-neutral-100/90 px-6 text-center"
            >
              <Loader2 className="h-6 w-6 animate-spin text-[#ff4d4d]" />
              <div className="space-y-1">
                <p className="text-xs font-medium text-neutral-700">
                  Synthesizing forensic composite...
                </p>
                <p className="font-mono-tabular text-[11px] text-neutral-500">
                  {activeImageModelLabel}
                </p>
              </div>
            </div>
          ) : suspectImageUrl && !imageLoadError ? (
            <img
              src={suspectImageUrl}
              alt={`Generated forensic composite for ${data.title}`}
              data-testid={`suspect-generated-img-${id}`}
              referrerPolicy="no-referrer"
              onError={() => setImageLoadError(true)}
              draggable={false}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              data-testid={`suspect-empty-${id}`}
              className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-6 text-center text-neutral-400"
            >
              <UserCheck className="h-7 w-7 stroke-[1.5] text-neutral-300" />
              <span className="text-xs font-medium text-neutral-500">
                No composite generated yet
              </span>
              <span className="text-[11px] leading-relaxed text-neutral-400">
                Enter a suspect/target description or wire ImageNode, OCR, or
                ChatNode context, then click Generate Target Image.
              </span>
            </div>
          )}
        </div>

        {/* Inline Error Notice */}
        {localError && (
          <div
            role="alert"
            data-testid={`suspect-error-${id}`}
            className="mt-2.5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-700"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
            <span className="leading-relaxed">{localError}</span>
          </div>
        )}
      </div>

      {/* Bottom Section: Active Image Endpoint Badge + Generate Target Image Button */}
      <div className="flex items-center justify-between gap-2 border-t border-neutral-100 bg-neutral-50/60 px-4 py-2.5">
        <span
          data-testid={`suspect-endpoint-label-${id}`}
          className="font-mono-tabular truncate text-[11px] text-neutral-500"
        >
          {activeImageModelLabel}
        </span>

        <button
          type="button"
          onClick={() => void handleGenerateClick()}
          disabled={!canGenerate}
          data-testid={`suspect-generate-btn-${id}`}
          className="nodrag inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Generating...</span>
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5 text-[#ff4d4d]" />
              <span>Generate Target Image</span>
            </>
          )}
        </button>
      </div>

      {/* Right Output Handle: connects to ImageNode, ResultNode, or downstream forensics tools */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.SUSPECT_OUT}
        aria-label={`Composite output for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />
    </div>
  );
}
