import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  Link2,
  X,
  AlertCircle,
} from 'lucide-react';
import { useDeviceSocket } from './hooks/useDeviceSocket';
import { PairDeviceModal } from './components/PairDeviceModal';

interface TargetNodeOption {
  id: string;
  label: string;
}

const TARGET_NODE_OPTIONS: readonly TargetNodeOption[] = [
  { id: 'new', label: 'New Node' },
  { id: 'img-1', label: 'Node 1 - Port' },
  { id: 'img-2', label: 'Node 2 - Suspect' },
];

interface ToastState {
  type: 'success' | 'error';
  message: string;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read image data.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const { wsUrl, pin, authError, updatePairing, status, isConnected, sendImagePayload } =
    useDeviceSocket();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [targetNodeId, setTargetNodeId] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Clean up object URL when image changes or unmounts.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Auto-dismiss toast notifications.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3_500);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleSelectImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setToast({ type: 'error', message: 'Please select an image file.' });
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    event.target.value = '';
  };

  const handleClearImage = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelectedFile(null);
    setPreviewUrl(null);
  };

  const canSend = Boolean(selectedFile) && targetNodeId !== '' && !isSending;

  const handleSend = async () => {
    if (!selectedFile || !targetNodeId) return;

    setIsSending(true);
    setToast(null);
    try {
      const base64DataUrl = await readFileAsDataUrl(selectedFile);
      const result = sendImagePayload(targetNodeId, base64DataUrl);
      if (!result.ok) {
        setToast({
          type: 'error',
          message: result.error || 'Could not send image.',
        });
        return;
      }

      const targetLabel =
        TARGET_NODE_OPTIONS.find((opt) => opt.id === targetNodeId)?.label ??
        targetNodeId;
      setToast({
        type: 'success',
        message: `Photo sent to ${targetLabel}`,
      });
    } catch (err) {
      setToast({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Failed to process image.',
      });
    } finally {
      setIsSending(false);
    }
  };

  const dotColor =
    status === 'connected'
      ? 'bg-emerald-500'
      : status === 'connecting'
        ? 'bg-amber-400'
        : 'bg-red-500';

  return (
    <div className="flex min-h-dvh flex-col bg-white text-gray-900">
      {/* Top Header */}
      <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-md items-center justify-between px-5 py-4">
          <h1 className="text-lg font-semibold tracking-tight text-gray-900">
            Send to Desktop
          </h1>

          <button
            type="button"
            onClick={() => setIsPairModalOpen(true)}
            data-testid="pair-device-btn"
            aria-label="Pair Device"
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
          >
            <span
              data-testid="mobile-ws-dot"
              data-status={status}
              className={`h-2 w-2 rounded-full ${dotColor}`}
              aria-hidden="true"
            />
            <Link2 className="h-3.5 w-3.5 text-gray-500" />
            <span>Pair</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-5 py-6">
        {/* Image Selection */}
        <section aria-label="Image selection">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleSelectImage}
            data-testid="mobile-file-input"
            className="hidden"
          />

          {previewUrl ? (
            <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-100">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Change selected photo"
                className="block aspect-[4/3] w-full cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <img
                  src={previewUrl}
                  alt="Selected preview"
                  data-testid="selected-thumbnail"
                  className="h-full w-full object-cover"
                />
              </button>
              <button
                type="button"
                onClick={handleClearImage}
                aria-label="Remove photo"
                className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-xs transition-colors hover:bg-black/75"
              >
                <X className="h-4 w-4" />
              </button>
              {selectedFile && (
                <div className="border-t border-gray-200/80 bg-white px-3.5 py-2.5 text-xs text-gray-500">
                  <span className="block truncate font-medium text-gray-700">
                    {selectedFile.name}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              data-testid="image-picker-area"
              className="flex aspect-[4/3] w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200/70 active:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-xs">
                <Camera className="h-7 w-7 text-gray-600" strokeWidth={1.75} />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-800">
                  Choose a photo
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Camera or photo library
                </p>
              </div>
            </button>
          )}
        </section>

        {/* Target Node Selector */}
        <section className="space-y-2">
          <label
            htmlFor="target-node-select"
            className="block text-sm font-medium text-gray-700"
          >
            Target Node
          </label>
          <div className="relative">
            <select
              id="target-node-select"
              value={targetNodeId}
              onChange={(e) => setTargetNodeId(e.target.value)}
              data-testid="target-node-select"
              className="w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3.5 pr-10 text-base text-gray-900 transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="" disabled>
                Select target node...
              </option>
              {TARGET_NODE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
              aria-hidden="true"
            />
          </div>
        </section>

        {/* Send Button */}
        <section className="mt-auto pt-2">
          <button
            type="button"
            disabled={!canSend}
            onClick={() => void handleSend()}
            data-testid="send-btn"
            className="w-full rounded-xl bg-blue-600 py-3.5 text-base font-semibold text-white shadow-xs transition-all hover:bg-blue-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            {isSending ? 'Sending...' : 'Send'}
          </button>

          {!isConnected && (
            <p className="mt-2.5 text-center text-xs text-gray-500">
              {authError ? 'PIN rejected. ' : 'Desktop not paired. '}
              <button
                type="button"
                onClick={() => setIsPairModalOpen(true)}
                className="font-medium text-blue-600 hover:underline"
              >
                Pair Device
              </button>
            </p>
          )}
        </section>
      </main>

      {/* Success / Error Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          data-testid="mobile-toast"
          data-toast-type={toast.type}
          className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-full bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg"
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Pair Device Modal */}
      <PairDeviceModal
        isOpen={isPairModalOpen}
        currentUrl={wsUrl}
        currentPin={pin}
        status={status}
        authError={authError}
        onSave={updatePairing}
        onClose={() => setIsPairModalOpen(false)}
      />
    </div>
  );
}
