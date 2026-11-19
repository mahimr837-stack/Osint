import { useEffect, useRef, useState } from 'react';

export type MobileSyncStatus = 'connecting' | 'connected' | 'disconnected';

export interface MobileSyncImagePayload {
  targetId: string;
  imageBase64: string;
}

export interface UseMobileSyncOptions {
  url?: string;
  enabled?: boolean;
  onImageReceived: (payload: MobileSyncImagePayload) => void;
}

export interface UseMobileSyncResult {
  status: MobileSyncStatus;
  isConnected: boolean;
}

const DEFAULT_WS_URL =
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_BACKEND_WS_URL) ||
  'ws://localhost:3001/sync';

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

/**
 * Maintains a WebSocket connection to the local backend `/sync` relay so the
 * mobile companion app can push base64 images straight onto the OSINT canvas.
 */
export function useMobileSync({
  url = DEFAULT_WS_URL,
  enabled = true,
  onImageReceived,
}: UseMobileSyncOptions): UseMobileSyncResult {
  const [status, setStatus] = useState<MobileSyncStatus>(
    enabled ? 'connecting' : 'disconnected',
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
        connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
    };

    const handleRawText = (text: string) => {
      const payload = parseMobileSyncMessage(text);
      if (payload && !disposed) {
        onImageReceivedRef.current(payload);
      }
    };

    const connect = () => {
      if (disposed) return;
      setStatus('connecting');

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
        reconnectDelay = INITIAL_RECONNECT_MS;
        setStatus('connected');
      });

      ws.addEventListener('message', (event) => {
        if (disposed || socket !== ws) return;
        if (typeof event.data === 'string') {
          handleRawText(event.data);
        } else if (event.data instanceof Blob) {
          void event.data.text().then(handleRawText).catch(() => {});
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

    connect();

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
  }, [url, enabled]);

  return {
    status,
    isConnected: status === 'connected',
  };
}
