import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { DEFAULT_WS_URL, type SocketStatus } from '../hooks/useDeviceSocket';

interface PairDeviceModalProps {
  isOpen: boolean;
  currentUrl: string;
  status: SocketStatus;
  onSave: (url: string) => void;
  onClose: () => void;
}

export function PairDeviceModal({
  isOpen,
  currentUrl,
  status,
  onSave,
  onClose,
}: PairDeviceModalProps) {
  const [urlInput, setUrlInput] = useState(currentUrl);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setUrlInput(currentUrl);
      setValidationError(null);
    }
  }, [isOpen, currentUrl]);

  if (!isOpen) return null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = urlInput.trim();
    if (!/^wss?:\/\/.+/i.test(trimmed)) {
      setValidationError('Enter a valid WebSocket URL starting with ws:// or wss://');
      return;
    }
    onSave(trimmed);
    onClose();
  };

  const statusLabel =
    status === 'connected'
      ? 'Connected'
      : status === 'connecting'
        ? 'Connecting...'
        : 'Disconnected';

  const statusDotClass =
    status === 'connected'
      ? 'bg-emerald-500'
      : status === 'connecting'
        ? 'bg-amber-400'
        : 'bg-red-500';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pair-modal-title"
      data-testid="pair-device-modal"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2
            id="pair-modal-title"
            className="text-lg font-semibold text-gray-900"
          >
            Pair Device
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-1.5 text-sm text-gray-500">
          Enter your desktop backend WebSocket URL to send photos directly to the canvas.
        </p>

        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
          <span className={`h-2 w-2 rounded-full ${statusDotClass}`} />
          <span>{statusLabel}</span>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="ws-url-input"
                className="text-sm font-medium text-gray-700"
              >
                WebSocket URL
              </label>
              <button
                type="button"
                onClick={() => {
                  setUrlInput(DEFAULT_WS_URL);
                  setValidationError(null);
                }}
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                Use default
              </button>
            </div>
            <input
              id="ws-url-input"
              type="url"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                setValidationError(null);
              }}
              placeholder={DEFAULT_WS_URL}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              data-testid="pair-ws-url-input"
              className="mt-1.5 w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            {validationError && (
              <p className="mt-1.5 text-xs text-red-600">{validationError}</p>
            )}
          </div>

          <div className="flex items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="pair-save-btn"
              className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Connect
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
