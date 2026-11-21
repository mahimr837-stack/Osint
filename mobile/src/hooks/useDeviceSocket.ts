import { useCallback, useEffect, useRef, useState } from 'react';

export type SocketStatus = 'connecting' | 'connected' | 'disconnected';

const STORAGE_KEY = 'traceboard_mobile_ws_url';
const PIN_STORAGE_KEY = 'traceboard_mobile_ws_pin';
const WS_CLOSE_UNAUTHORIZED = 4001;
export const DEFAULT_WS_URL = 'ws://localhost:3000/sync';

function getInitialWsUrl(): string {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)?.trim();
    if (saved) {
      // Automatically migrate legacy port-3001 URLs to the consolidated port-3000 server.
      if (/:3001\/sync$/i.test(saved)) {
        const migrated = saved.replace(/:3001\/sync$/i, ':3000/sync');
        window.localStorage.setItem(STORAGE_KEY, migrated);
        return migrated;
      }
      return saved;
    }
  } catch {
    // Ignore storage access errors in private browsing.
  }

  // If served directly from the unified Trace server (e.g. /mobile on port 3000), use its exact host:port.
  const host = window.location.hostname;
  const port = window.location.port;
  const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (host && port && port !== '5173') {
    return `${wsProto}//${window.location.host}/sync`;
  }
  // When opened over Wi-Fi LAN IP via standalone Vite dev server (5173), suggest that host on port 3000.
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return `ws://${host}:3000/sync`;
  }
  return DEFAULT_WS_URL;
}

function getInitialPin(): string {
  try {
    return window.localStorage.getItem(PIN_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function useDeviceSocket() {
  const [wsUrl, setWsUrlState] = useState<string>(getInitialWsUrl);
  const [pin, setPinState] = useState<string>(getInitialPin);
  const [status, setStatus] = useState<SocketStatus>(
    getInitialPin() ? 'connecting' : 'disconnected',
  );
  const [authError, setAuthError] = useState<string | null>(null);
  const [reconnectTick, setReconnectTick] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const isAuthenticatedRef = useRef(false);

  const updatePairing = useCallback((nextUrl: string, nextPin: string) => {
    const trimmedUrl = nextUrl.trim() || DEFAULT_WS_URL;
    const trimmedPin = nextPin.trim();
    setWsUrlState(trimmedUrl);
    setPinState(trimmedPin);
    setAuthError(null);
    setReconnectTick((n) => n + 1);
    try {
      window.localStorage.setItem(STORAGE_KEY, trimmedUrl);
      window.localStorage.setItem(PIN_STORAGE_KEY, trimmedPin);
    } catch {
      // Ignore storage access errors.
    }
  }, []);

  const setWsUrl = useCallback(
    (nextUrl: string) => {
      updatePairing(nextUrl, pin);
    },
    [pin, updatePairing],
  );

  useEffect(() => {
    isAuthenticatedRef.current = false;

    if (!pin.trim()) {
      setStatus('disconnected');
      return;
    }

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let delay = 1_500;

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
      delay = Math.min(delay * 2, 10_000);
    };

    const connect = () => {
      if (disposed) return;
      isAuthenticatedRef.current = false;
      setStatus('connecting');

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        setStatus('disconnected');
        scheduleReconnect();
        return;
      }

      socketRef.current = ws;

      ws.addEventListener('open', () => {
        if (disposed || socketRef.current !== ws) return;
        ws.send(JSON.stringify({ type: 'auth', pin: pin.trim() }));
      });

      ws.addEventListener('message', (event) => {
        if (disposed || socketRef.current !== ws) return;
        if (typeof event.data === 'string') {
          try {
            const parsed = JSON.parse(event.data) as { type?: unknown } | null;
            if (parsed && typeof parsed === 'object' && parsed.type === 'auth_ok') {
              isAuthenticatedRef.current = true;
              delay = 1_500;
              setAuthError(null);
              setStatus('connected');
            }
          } catch {
            // Ignore non-JSON messages
          }
        }
      });

      ws.addEventListener('close', (event) => {
        if (disposed || socketRef.current !== ws) return;
        socketRef.current = null;
        isAuthenticatedRef.current = false;
        setStatus('disconnected');

        if (event.code === WS_CLOSE_UNAUTHORIZED) {
          setAuthError(
            'Invalid or missing PIN. Check the 6-digit PIN printed in your Trace terminal.',
          );
          return;
        }
        scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        // Close handler manages status update and reconnect.
      });
    };

    connect();

    return () => {
      disposed = true;
      isAuthenticatedRef.current = false;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
      }
      if (socketRef.current) {
        const current = socketRef.current;
        socketRef.current = null;
        current.close();
      }
    };
  }, [wsUrl, pin, reconnectTick]);

  const sendImagePayload = useCallback(
    (targetId: string, imageBase64: string): { ok: boolean; error?: string } => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !isAuthenticatedRef.current) {
        return {
          ok: false,
          error:
            'Not paired with desktop. Tap Pair to enter the WebSocket URL and 6-digit PIN.',
        };
      }
      ws.send(
        JSON.stringify({
          target_id: targetId,
          image_base64: imageBase64,
        }),
      );
      return { ok: true };
    },
    [],
  );

  return {
    wsUrl,
    pin,
    authError,
    setWsUrl,
    updatePairing,
    status,
    isConnected: status === 'connected',
    sendImagePayload,
  };
}
