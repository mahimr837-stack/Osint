import { useEffect, useRef, useState } from 'react';

export type MobileSyncStatus = 'connecting' | 'connected' | 'disconnected';

export interface MobileSyncImagePayload {
  targetId: string;
  imageBase64: string;
}

export interface UseMobileSyncOptions {
  url?: string;
  pin?: string;
  enabled?: boolean;
  onImageReceived: (payload: MobileSyncImagePayload) => void;
}

export interface UseMobileSyncResult {
  status: MobileSyncStatus;
  isConnected: boolean;
  syncPin: string | null;
}

function resolveDefaultWsUrl(): string {
  const envUrl =
    typeof import.meta !== 'undefined'
      ? (import.meta as unknown as { env?: Record<string, string> }).env
          ?.VITE_BACKEND_WS_URL
      : undefined;
  if (envUrl) return envUrl;
  if (typeof window !== 'undefined' && window.location?.host) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/sync`;
  }
  return 'ws://127.0.0.1:3000/sync';
}

const DEFAULT_WS_URL = resolveDefaultWsUrl();

// Only accept valid base64-encoded image data URLs to prevent XSS / broken src values.
const IMAGE_DATA_URL_RE =
  /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/i;

const INITIAL_RECONNECT_MS = 1_500;
const MAX_RECONNECT_MS = 10_000;

export function parseMobileSyncMessage(
  rawText: string,
): MobileSyncImagePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.image_base64 !== 'string') return null;

  const imageBase64 = record.image_base64.trim();
  if (!IMAGE_DATA_URL_RE.test(imageBase64)) return null;

  const rawTarget =
    typeof record.target_id === 'string' ? record.target_id.trim() : '';

  return {
    targetId: rawTarget || 'new',
    imageBase64,
  };
}

async function fetchLocalSyncPin(): Promise<string | null> {
  try {
    const res = await fetch('/api/sync/pin');
    if (!res.ok) return null;
    const data = (await res.json()) as { pin?: unknown };
    return typeof data.pin === 'string' && data.pin.trim()
      ? data.pin.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Maintains a PIN-authenticated WebSocket connection to the local backend `/sync`
 * relay so the mobile companion app can push base64 images straight onto the OSINT canvas.
 */
export function useMobileSync({
  url = DEFAULT_WS_URL,
  pin: explicitPin,
  enabled = true,
  onImageReceived,
}: UseMobileSyncOptions): UseMobileSyncResult {
  const [status, setStatus] = useState<MobileSyncStatus>(
    enabled ? 'connecting' : 'disconnected',
  );
  const [syncPin, setSyncPin] = useState<string | null>(
    explicitPin?.trim() || null,
  );
  const onImageReceivedRef = useRef(onImageReceived);

  useEffect(() => {
    onImageReceivedRef.current = onImageReceived;
  }, [onImageReceived]);

  useEffect(() => {
    if (!enabled || typeof WebSocket === 'undefined') {
      setStatus('disconnected');
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = INITIAL_RECONNECT_MS;

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
    };

    const handleRawText = (text: string, isCurrentSocket: boolean) => {
      try {
        const parsed = JSON.parse(text) as { type?: unknown } | null;
        if (parsed && typeof parsed === 'object' && parsed.type === 'auth_ok') {
          if (isCurrentSocket && !disposed) {
            reconnectDelay = INITIAL_RECONNECT_MS;
            setStatus('connected');
          }
          return;
        }
      } catch {
        // Fall through to image payload parser
      }

      const payload = parseMobileSyncMessage(text);
      if (payload && !disposed) {
        onImageReceivedRef.current(payload);
      }
    };

    const connect = async () => {
      if (disposed) return;
      setStatus('connecting');

      const activePin = explicitPin?.trim() || (await fetchLocalSyncPin());
      if (disposed) return;

      setSyncPin(activePin);
      if (!activePin) {
        setStatus('disconnected');
        scheduleReconnect();
        return;
      }

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        setStatus('disconnected');
        scheduleReconnect();
        return;
      }

      socket = ws;

      ws.addEventListener('open', () => {
        if (disposed || socket !== ws) return;
        ws.send(JSON.stringify({ type: 'auth', pin: activePin }));
      });

      ws.addEventListener('message', (event) => {
        if (disposed || socket !== ws) return;
        if (typeof event.data === 'string') {
          handleRawText(event.data, socket === ws);
        } else if (event.data instanceof Blob) {
          void event.data
            .text()
            .then((txt) => handleRawText(txt, socket === ws))
            .catch(() => {});
        }
      });

      ws.addEventListener('error', () => {
        // Close event follows and handles status update + reconnect scheduling.
      });

      ws.addEventListener('close', () => {
        if (disposed || socket !== ws) return;
        socket = null;
        setStatus('disconnected');
        scheduleReconnect();
      });
    };

    void connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        const closing = socket;
        socket = null;
        closing.close();
      }
    };
  }, [url, explicitPin, enabled]);

  return {
    status,
    isConnected: status === 'connected',
    syncPin,
  };
}
