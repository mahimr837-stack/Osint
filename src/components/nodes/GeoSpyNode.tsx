import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { Compass, Loader2, Server } from 'lucide-react';
import type { GeoSpyNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import {
  getConnectedSourceImageForNode,
  HANDLE_IDS,
} from '../../utils/osintGraph';
import { buildSourceImageSignature } from '../../utils/canvasPersistence';
import { formatLatLngLabel } from '../../utils/mapCoordinates';
import {
  formatGeoSpyLocationLabel,
  predictGeoSpyLocation,
} from '../../utils/geoSpy';

const redPinIcon = L.divIcon({
  className: 'traceboard-geospy-pin',
  html: `
    <div style="position:relative;width:24px;height:30px;display:flex;align-items:center;justify-content:center;">
      <svg width="24" height="30" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 1C6.477 1 2 5.477 2 11C2 18.25 12 29 12 29C12 29 22 18.25 22 11C22 5.477 17.523 1 12 1Z" fill="#ff4d4d" stroke="#ffffff" stroke-width="2"/>
        <circle cx="12" cy="11" r="3.5" fill="#ffffff"/>
      </svg>
    </div>
  `,
  iconSize: [24, 30],
  iconAnchor: [12, 30],
  popupAnchor: [0, -28],
});

function GeoSpyMapViewportSync({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
    map.setView([lat, lng], 12, { animate: false });
  }, [lat, lng, map]);

  return null;
}

export function GeoSpyNode({ id, data, selected }: NodeProps<GeoSpyNodeData>) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const updateGeoSpyNodeData = useCanvasStore(
    (state) => state.updateGeoSpyNodeData,
  );

  const connectedImage = useMemo(
    () => getConnectedSourceImageForNode(id, nodes, edges),
    [id, nodes, edges],
  );

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSubmittedSignatureRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);

  const imageUrl = connectedImage?.imageUrl ?? null;
  const connectedId = connectedImage?.id ?? null;
  const connectedTitle = connectedImage?.title ?? null;
  const signature = buildSourceImageSignature(connectedId, imageUrl);

  const runPrediction = useCallback(
    async (force = false) => {
      if (!connectedId || !imageUrl || !signature) return;

      if (
        !force &&
        lastSubmittedSignatureRef.current === signature &&
        data.processedSignature === signature &&
        data.prediction
      ) {
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      lastSubmittedSignatureRef.current = signature;
      setIsLoading(true);
      setError(null);

      try {
        const prediction = await predictGeoSpyLocation({
          imageUrl,
          fileName: connectedTitle ?? undefined,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        updateGeoSpyNodeData(id, {
          prediction,
          sourceTitle: connectedTitle,
          processedSignature: signature,
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        const message =
          err instanceof Error
            ? err.message
            : 'GeoSpy location prediction failed.';
        setError(message);
        updateGeoSpyNodeData(id, {
          prediction: null,
          sourceTitle: connectedTitle,
          processedSignature: null,
        });
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [
      connectedId,
      connectedTitle,
      data.prediction,
      data.processedSignature,
      id,
      imageUrl,
      signature,
      updateGeoSpyNodeData,
    ],
  );

  // Clear prediction when image disconnects
  useEffect(() => {
    if (!connectedId || !imageUrl || !signature) {
      abortRef.current?.abort();
      lastSubmittedSignatureRef.current = '';
      setIsLoading(false);
      setError(null);
      updateGeoSpyNodeData(id, {
        prediction: null,
        sourceTitle: null,
        processedSignature: null,
      });
    }
  }, [connectedId, id, imageUrl, signature, updateGeoSpyNodeData]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const prediction = data.prediction ?? null;
  const locationLabel = prediction
    ? formatGeoSpyLocationLabel(prediction)
    : null;

  return (
    <div
      data-testid={`geospy-node-${id}`}
      data-has-source={connectedImage ? 'true' : 'false'}
      data-has-prediction={prediction ? 'true' : 'false'}
      className={`relative w-88 rounded-xl border bg-white transition-shadow duration-150 ${
        selected
          ? 'border-neutral-900 shadow-md'
          : 'border-neutral-200/90 shadow-sm'
      }`}
    >
      {/* Left Input Handle for ImageNode / EnhanceNode */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.GEOSPY_IN}
        aria-label={`Image input for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header */}
      <div className="border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Compass className="h-4 w-4 shrink-0 text-[#ff4d4d]" />
            <h3 className="truncate text-sm font-semibold text-neutral-900">
              {data.title}
            </h3>
          </div>
          {prediction?.confidence !== null &&
            prediction?.confidence !== undefined &&
            !isLoading && (
              <span className="font-mono-tabular shrink-0 text-[11px] font-medium text-neutral-500">
                {prediction.confidence}% conf
              </span>
            )}
        </div>
        <p className="mt-1 truncate text-xs text-neutral-500">
          {connectedImage
            ? `Source: ${connectedImage.title}`
            : 'No ImageNode connected'}
        </p>
      </div>

      {/* Body */}
      <div className="space-y-3 p-3.5">
        {/* Server Proxy Action Bar */}
        <div className="nodrag flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50/70 px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-neutral-600">
            <Server className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
            <code className="font-mono-tabular truncate text-[11px] text-neutral-700">
              GEOSPY_API_KEY
            </code>
          </div>

          <button
            type="button"
            onClick={() => void runPrediction(true)}
            disabled={isLoading || !connectedImage?.imageUrl}
            data-testid={`geospy-predict-btn-${id}`}
            className="shrink-0 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            {isLoading ? 'Locating' : 'Predict'}
          </button>
        </div>

        {/* Inline Error */}
        {error && (
          <div
            data-testid={`geospy-error-${id}`}
            className="rounded-lg border border-red-200 bg-red-50/50 px-3 py-2 text-xs text-red-700"
          >
            {error}
          </div>
        )}

        {/* States & Predicted Location Map */}
        {!connectedImage ? (
          <div
            data-testid={`geospy-empty-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-6 text-center text-xs text-neutral-400"
          >
            Connect an ImageNode and click Predict to run server-proxied GeoSpy geolocation.
          </div>
        ) : !connectedImage.imageUrl ? (
          <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-6 text-center text-xs text-neutral-400">
            Connected frame has no image loaded yet.
          </div>
        ) : isLoading ? (
          <div
            data-testid={`geospy-loading-${id}`}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-neutral-200/80 bg-neutral-50/70 px-3 py-8 text-center text-xs text-neutral-600"
          >
            <Loader2 className="h-4 w-4 animate-spin text-[#ff4d4d]" />
            <span>Querying GeoSpy geolocation proxy...</span>
          </div>
        ) : !prediction ? (
          <div
            data-testid={`geospy-awaiting-key-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-6 text-center text-xs text-neutral-500"
          >
            Image wired. Click Predict above to run geolocation via the server proxy.
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span
                data-testid={`geospy-location-${id}`}
                className="truncate text-xs font-semibold text-neutral-900"
              >
                {locationLabel}
              </span>
              <span
                data-testid={`geospy-coords-${id}`}
                className="font-mono-tabular shrink-0 text-[11px] font-medium text-neutral-600"
              >
                {formatLatLngLabel(prediction.coordinates)}
              </span>
            </div>

            <div
              data-testid={`geospy-map-viewport-${id}`}
              className="nodrag nowheel nopan relative h-48 w-full overflow-hidden rounded-lg border border-neutral-200/90 bg-neutral-100"
            >
              <MapContainer
                center={[
                  prediction.coordinates.lat,
                  prediction.coordinates.lng,
                ]}
                zoom={12}
                scrollWheelZoom
                attributionControl={false}
                className="h-full w-full z-0"
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution="&copy; OpenStreetMap contributors"
                />
                <GeoSpyMapViewportSync
                  lat={prediction.coordinates.lat}
                  lng={prediction.coordinates.lng}
                />
                <Marker
                  position={[
                    prediction.coordinates.lat,
                    prediction.coordinates.lng,
                  ]}
                  icon={redPinIcon}
                >
                  <Popup>
                    <div className="text-xs">
                      <p className="font-semibold text-neutral-900">
                        {locationLabel}
                      </p>
                      <p className="font-mono-tabular mt-0.5 text-neutral-600">
                        {formatLatLngLabel(prediction.coordinates)}
                      </p>
                    </div>
                  </Popup>
                </Marker>
              </MapContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
