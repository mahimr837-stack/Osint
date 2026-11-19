import { useEffect, useState } from 'react';
import {
  Check,
  ExternalLink,
  Server,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useCanvasStore } from '../store/useCanvasStore';
import {
  getProviderMeta,
  LLM_PROVIDERS,
  type LlmProviderId,
} from '../utils/llmProviders';

interface ModelSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function ModelSettingsDialogContent({ onClose }: { onClose: () => void }) {
  const activeProvider = useCanvasStore((state) => state.provider);
  const activeModel = useCanvasStore((state) => state.model);
  const providerConfigs = useCanvasStore((state) => state.providerConfigs);
  const setModelConfig = useCanvasStore((state) => state.setModelConfig);

  const [selectedProvider, setSelectedProvider] =
    useState<LlmProviderId>(activeProvider);
  const [draftConfigs, setDraftConfigs] = useState<
    Record<LlmProviderId, { apiKey: string; model: string }>
  >(() => ({
    ...providerConfigs,
    [activeProvider]: {
      apiKey: '',
      model: activeModel,
    },
  }));
  const [serverKeyStatus, setServerKeyStatus] = useState<
    Partial<Record<LlmProviderId, boolean>>
  >({});

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/providers/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { providers?: Partial<Record<LlmProviderId, boolean>> } | null) => {
        if (!cancelled && data?.providers) {
          setServerKeyStatus(data.providers);
        }
      })
      .catch(() => {
        // Ignore status check error if offline
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentMeta = getProviderMeta(selectedProvider);
  const currentDraft = draftConfigs[selectedProvider] ?? {
    apiKey: '',
    model: currentMeta.defaultModel,
  };
  const resolvedModel = currentDraft.model.trim() || currentMeta.defaultModel;
  const isServerConfigured = serverKeyStatus[selectedProvider];

  const updateCurrentDraft = (
    patch: Partial<{ apiKey: string; model: string }>,
  ) => {
    setDraftConfigs((prev) => ({
      ...prev,
      [selectedProvider]: {
        ...(prev[selectedProvider] ?? {
          apiKey: '',
          model: currentMeta.defaultModel,
        }),
        ...patch,
      },
    }));
  };

  const handleSave = () => {
    setModelConfig({
      provider: selectedProvider,
      apiKey: '',
      model: resolvedModel,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/35 p-4 backdrop-blur-[1px]"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-settings-title"
        data-testid="model-settings-modal"
        className="w-full max-w-[440px] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl"
      >
        {/* Compact Modal Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-[#ff4d4d]" />
            <h2
              id="model-settings-title"
              className="text-sm font-semibold text-neutral-900"
            >
              Model & Provider Settings
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Models modal"
            className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Clean, Linear Configuration Form */}
        <div className="space-y-3.5 p-4">
          {/* 1. Provider Dropdown */}
          <div>
            <label
              htmlFor="provider-select"
              className="mb-1.5 block text-xs font-medium text-neutral-700"
            >
              Provider
            </label>
            <select
              id="provider-select"
              data-testid="provider-select"
              value={selectedProvider}
              onChange={(e) =>
                setSelectedProvider(e.target.value as LlmProviderId)
              }
              className="w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs font-medium text-neutral-900 focus:border-neutral-400 focus:outline-none"
            >
              {LLM_PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Server-Side Proxy Environment Variable Status + Get API Key Link */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-neutral-700">
                Server Environment Variable
              </span>
              <a
                href={currentMeta.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="get-api-key-link"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#ff4d4d] transition-colors hover:text-red-700 focus-visible:outline-none focus-visible:underline"
              >
                <span>Get API Key</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
            <div
              data-testid="server-secret-status"
              className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50/70 px-2.5 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Server className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                <code className="font-mono-tabular truncate text-xs font-medium text-neutral-900">
                  {currentMeta.envVarName}
                </code>
              </div>
              <span
                className={`shrink-0 text-[11px] font-medium ${
                  isServerConfigured
                    ? 'text-emerald-700'
                    : 'text-neutral-500'
                }`}
              >
                {isServerConfigured
                  ? 'Configured on server'
                  : 'Set in Settings > Secrets'}
              </span>
            </div>
          </div>

          {/* 3. Model Identifier + Compact Preset Model Selector */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor="provider-model-custom"
                className="text-xs font-medium text-neutral-700"
              >
                Model Identifier
              </label>
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="provider-model-select"
                  className="text-[11px] text-neutral-400"
                >
                  Preset Model
                </label>
                <select
                  id="provider-model-select"
                  data-testid="model-select"
                  aria-label="Preset Model"
                  value={
                    currentMeta.models.includes(currentDraft.model)
                      ? currentDraft.model
                      : '__custom__'
                  }
                  onChange={(e) => {
                    if (e.target.value !== '__custom__') {
                      updateCurrentDraft({ model: e.target.value });
                    }
                  }}
                  className="max-w-44 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] font-medium text-neutral-700 focus:border-neutral-400 focus:bg-white focus:outline-none"
                >
                  {currentMeta.models.map((modelId) => (
                    <option key={modelId} value={modelId}>
                      {modelId}
                    </option>
                  ))}
                  {!currentMeta.models.includes(currentDraft.model) && (
                    <option value="__custom__">Custom</option>
                  )}
                </select>
              </div>
            </div>
            <input
              id="provider-model-custom"
              data-testid="model-custom-input"
              type="text"
              value={currentDraft.model}
              onChange={(e) => updateCurrentDraft({ model: e.target.value })}
              placeholder={currentMeta.defaultModel}
              spellCheck={false}
              className="font-mono-tabular w-full rounded-lg border border-neutral-200 bg-neutral-50/70 px-2.5 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        {/* Minimal Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-neutral-100 bg-neutral-50/60 px-4 py-2.5">
          <span
            data-testid="model-settings-summary"
            className="font-mono-tabular truncate text-[11px] text-neutral-500"
          >
            Active: {currentMeta.name} ({resolvedModel})
          </span>
          <button
            type="button"
            data-testid="save-model-config-btn"
            onClick={handleSave}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            <Check className="h-3.5 w-3.5" />
            <span>Save Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function ModelSettingsModal({ isOpen, onClose }: ModelSettingsModalProps) {
  if (!isOpen) return null;
  return <ModelSettingsDialogContent onClose={onClose} />;
}
