import { useState, type KeyboardEvent } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Search,
  Server,
} from 'lucide-react';
import type { ShodanNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import { HANDLE_IDS } from '../../utils/osintGraph';

export function ShodanNode({ id, data, selected }: NodeProps<ShodanNodeData>) {
  const shodanApiKey = useCanvasStore((state) => state.shodanApiKey);
  const setShodanApiKey = useCanvasStore((state) => state.setShodanApiKey);
  const isSearching = useCanvasStore((state) =>
    Boolean(state.searchingShodanIds[id]),
  );
  const updateShodanNodeData = useCanvasStore(
    (state) => state.updateShodanNodeData,
  );
  const runShodanForNode = useCanvasStore((state) => state.runShodanForNode);

  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const results = data.results ?? [];

  const handleSearch = async () => {
    setError(null);
    const outcome = await runShodanForNode(id, shodanApiKey);
    if (!outcome.ok && outcome.error) {
      setError(outcome.error);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleSearch();
    }
  };

  return (
    <div
      data-testid={`shodan-node-${id}`}
      data-result-count={String(results.length)}
      className={`relative w-88 rounded-xl border bg-white transition-shadow duration-150 ${
        selected
          ? 'border-neutral-900 shadow-md'
          : 'border-neutral-200/90 shadow-sm'
      }`}
    >
      {/* Left Input Handle accepting OcrNode or ChatNode text */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.SHODAN_IN}
        aria-label={`Query input for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header */}
      <div className="border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Server className="h-4 w-4 shrink-0 text-[#ff4d4d]" />
            <h3 className="truncate text-sm font-semibold text-neutral-900">
              {data.title}
            </h3>
          </div>
          {typeof data.total === 'number' && !isSearching && (
            <span className="font-mono-tabular shrink-0 text-[11px] font-medium text-neutral-500">
              {results.length}
              {data.total > results.length ? ` / ${data.total}` : ''} host
              {results.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-neutral-500">
          {data.lastQuery
            ? `Last query: ${data.lastQuery}`
            : 'Shodan host search & IP lookup'}
        </p>
      </div>

      {/* Body */}
      <div className="space-y-3 p-3.5">
        <div className="nodrag space-y-2">
          {/* IP / Query Input */}
          <div>
            <label
              htmlFor={`shodan-query-${id}`}
              className="mb-1 block text-[11px] font-medium text-neutral-600"
            >
              IP / Query
            </label>
            <input
              id={`shodan-query-${id}`}
              type="text"
              value={data.queryInput}
              onChange={(e) => {
                setError(null);
                updateShodanNodeData(id, { queryInput: e.target.value });
              }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. 8.8.8.8 or apache port:443"
              spellCheck={false}
              data-testid={`shodan-query-input-${id}`}
              className="font-mono-tabular w-full rounded-lg border border-neutral-200 bg-neutral-50/70 px-2.5 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:outline-none"
            />
          </div>

          {/* Shodan API Key (synced globally via Dashboard Settings / localStorage) */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label
                htmlFor={`shodan-key-${id}`}
                className="text-[11px] font-medium text-neutral-600"
              >
                Shodan API Key
              </label>
              <span className="text-[10px] text-neutral-400">
                Synced with Dashboard Settings
              </span>
            </div>
            <div className="relative flex items-center">
              <KeyRound className="pointer-events-none absolute left-2 h-3 w-3 text-neutral-400" />
              <input
                id={`shodan-key-${id}`}
                type={showKey ? 'text' : 'password'}
                value={shodanApiKey}
                onChange={(e) => {
                  setError(null);
                  setShodanApiKey(e.target.value);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Paste Shodan API key..."
                autoComplete="off"
                spellCheck={false}
                data-testid={`shodan-apikey-input-${id}`}
                className="font-mono-tabular w-full rounded-lg border border-neutral-200 bg-neutral-50/70 pl-6 pr-7 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey((prev) => !prev)}
                aria-label={showKey ? 'Hide Shodan API key' : 'Show Shodan API key'}
                className="absolute right-1.5 rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                {showKey ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>

          <button
            type="button"
            disabled={isSearching}
            onClick={() => void handleSearch()}
            data-testid={`shodan-search-btn-${id}`}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 cursor-pointer"
          >
            {isSearching ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#ff4d4d]" />
                <span>Searching Shodan...</span>
              </>
            ) : (
              <>
                <Search className="h-3.5 w-3.5 text-[#ff4d4d]" />
                <span>Search</span>
              </>
            )}
          </button>
        </div>

        {/* Inline Error */}
        {error && (
          <div
            data-testid={`shodan-error-${id}`}
            className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-2 text-xs text-red-700"
          >
            {error}
          </div>
        )}

        {/* Results List */}
        {results.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>Exposed Services</span>
              <span className="font-mono-tabular">
                {data.mode === 'host' ? 'IP Lookup' : 'Host Search'}
              </span>
            </div>
            <ul
              data-testid={`shodan-results-${id}`}
              className="nodrag nowheel max-h-64 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200/80 bg-[#fafafa]"
            >
              {results.map((item, idx) => (
                <li
                  key={`${item.ip}-${item.port}-${idx}`}
                  data-testid={`shodan-result-item-${id}-${idx}`}
                  className="flex items-start gap-2.5 px-2.5 py-2 text-xs"
                >
                  {item.screenshotDataUrl && (
                    <img
                      src={item.screenshotDataUrl}
                      alt={`Shodan screenshot for ${item.ip}:${item.port}`}
                      className="h-12 w-16 shrink-0 rounded border border-neutral-200 object-cover bg-neutral-900"
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono-tabular truncate font-semibold text-neutral-900">
                        {item.ip}
                      </span>
                      <span className="font-mono-tabular shrink-0 rounded bg-neutral-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-800">
                        :{item.port}
                      </span>
                    </div>
                    <p className="truncate text-[11px] font-medium text-neutral-700">
                      {item.org}
                    </p>
                    {(item.product || item.location) && (
                      <p className="truncate text-[10px] text-neutral-500">
                        {[item.product, item.location].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : data.lastQuery ? (
          <div
            data-testid={`shodan-empty-results-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-5 text-center text-xs text-neutral-500"
          >
            No Shodan matches found for &ldquo;{data.lastQuery}&rdquo;.
          </div>
        ) : (
          <div
            data-testid={`shodan-ready-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-5 text-center text-xs text-neutral-400"
          >
            Enter an IP address or Shodan query and click Search to inspect open ports, organizations, and screenshots.
          </div>
        )}
      </div>
    </div>
  );
}
