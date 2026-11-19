import { useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { AlertCircle, FileText, ScanSearch } from 'lucide-react';
import type { ResultNodeData } from '../../types/osint';
import { HANDLE_IDS } from '../../utils/osintGraph';

type FilterMode = 'standard' | 'contrast' | 'mono';

export function ResultNode({ id, data, selected }: NodeProps<ResultNodeData>) {
  const [filterMode, setFilterMode] = useState<FilterMode>('standard');
  const [imageError, setImageError] = useState(false);

  const imageFilterClass =
    filterMode === 'contrast'
      ? 'contrast-125 brightness-105 saturate-110'
      : filterMode === 'mono'
        ? 'grayscale contrast-150'
        : '';

  return (
    <div
      data-testid={`result-node-${id}`}
      data-is-error={data.isError ? 'true' : 'false'}
      className={`relative w-[340px] rounded-xl border bg-white transition-shadow duration-150 ${
        data.isError
          ? 'border-red-300 shadow-sm'
          : selected
            ? 'border-neutral-900 shadow-md'
            : 'border-neutral-200/90 shadow-sm'
      }`}
    >
      {/* Left Handle to receive output from ChatNode */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.RESULT_IN}
        aria-label={`Result input for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header */}
      <div className="border-b border-neutral-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {data.isError ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
            ) : (
              <FileText className="h-4 w-4 shrink-0 text-neutral-500" />
            )}
            <h3
              className={`text-sm font-semibold ${
                data.isError ? 'text-red-700' : 'text-neutral-900'
              }`}
            >
              {data.title}
            </h3>
          </div>
          {data.updatedAt && (
            <span className="font-mono-tabular text-[11px] text-neutral-400">
              {data.updatedAt}
            </span>
          )}
        </div>
        <p className={`mt-1 text-xs ${data.isError ? 'text-red-600' : 'text-neutral-500'}`}>
          {data.sourceSummary || 'Awaiting ChatNode output'}
        </p>
      </div>

      {/* Enhanced / Reference Image Preview */}
      <div className="p-3.5 pb-2.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-medium text-neutral-500">
            Enhanced Frame
          </span>
          <div className="nodrag flex items-center gap-0.5 rounded-md bg-neutral-100 p-0.5">
            {(
              [
                ['standard', 'Raw'],
                ['contrast', 'Sharpen'],
                ['mono', 'Mono'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setFilterMode(mode)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors whitespace-nowrap ${
                  filterMode === mode
                    ? 'bg-white text-neutral-900 shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-neutral-200/80 bg-[#fafafa]">
          {data.enhancedImageUrl && !imageError ? (
            <img
              src={data.enhancedImageUrl}
              alt={data.enhancedCaption || 'Enhanced OSINT output frame'}
              referrerPolicy="no-referrer"
              onError={() => setImageError(true)}
              className={`h-full w-full object-cover transition-all duration-200 ${imageFilterClass}`}
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-4 text-center text-neutral-400">
              <ScanSearch className="h-6 w-6 stroke-[1.5]" />
              <span className="text-xs font-medium text-neutral-500">
                Enhanced image output placeholder
              </span>
              <span className="text-[11px] text-neutral-400">
                Run a ChatNode prompt to render inspection output
              </span>
            </div>
          )}
        </div>
        {data.enhancedCaption && (
          <p className="mt-1.5 text-[11px] text-neutral-500">
            {data.enhancedCaption}
          </p>
        )}
      </div>

      {/* Text Analysis Output or Error Message */}
      <div className="border-t border-neutral-100 px-4 py-3">
        <div className="mb-1.5 text-[11px] font-medium text-neutral-500">
          {data.isError ? 'Error Details' : 'Text Analysis'}
        </div>
        <div
          data-testid={`result-analysis-${id}`}
          className={`nodrag nowheel max-h-64 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap ${
            data.isError ? 'text-red-700' : 'text-neutral-700'
          }`}
        >
          {data.analysisText || (
            <span className="text-neutral-400">
              Connect a ChatNode output wire and submit a prompt to populate structured OSINT findings here.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
