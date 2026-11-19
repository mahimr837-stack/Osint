import { useCallback, useEffect, useRef, useState } from 'react';

export type SocketStatus = 'connecting' | 'connected' | 'disconnected';

const STORAGE_KEY = 'traceboard_mobile_ws_url';
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

  // Default to localhost:3000 on loopback; when opened over Wi-Fi LAN IP, suggest that host automatically.
  const host = window.location.hostname;
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return `ws://${host}:3000/sync`;
  }
  return DEFAULT_WS_URL;
}

export function useDeviceSocket() {
  const [wsUrl, setWsUrlState] = useState<string>(getInitialWsUrl);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [reconnectTick, setReconnectTick] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);

  const setWsUrl = useCallback((nextUrl: string) => {
    const trimmed = nextUrl.trim() || DEFAULT_WS_URL;
    setWsUrlState(trimmed);
    setReconnectTick((n) => n + 1);
    try {
      window.localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      // Ignore storage access errors.
    }
  }, []);

  useEffect(() => {
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
        delay = 1_500;
        setStatus('connected');
      });

      ws.addEventListener('close', () => {
        if (disposed || socketRef.current !== ws) return;
        socketRef.current = null;
        setStatus('disconnected');
        scheduleReconnect();
      });

      ws.addEventListener('error', () => {
        // Close handler manages status update and reconnect.
      });
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
      }
      if (socketRef.current) {
        const current = socketRef.current;
        socketRef.current = null;
        current.close();
      }
    };
  }, [wsUrl, reconnectTick]);

  const sendImagePayload = useCallback(
    (targetId: string, imageBase64: string): { ok: boolean; error?: string } => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return {
          ok: false,
          error: 'Not connected to desktop. Tap Pair to check the WebSocket URL.',
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
    setWsUrl,
    status,
    isConnected: status === 'connected',
    sendImagePayload,
  };
}
