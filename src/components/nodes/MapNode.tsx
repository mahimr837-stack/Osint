import { useEffect, useMemo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import { MapPin } from 'lucide-react';
import type { MapNodeData } from '../../types/osint';
import { useCanvasStore } from '../../store/useCanvasStore';
import { HANDLE_IDS, resolveMapSourceForNode } from '../../utils/osintGraph';
import { formatLatLngLabel } from '../../utils/mapCoordinates';

const redPinIcon = L.divIcon({
  className: 'traceboard-map-pin',
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

function MapViewportSync({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
    map.setView([lat, lng], 13, { animate: false });
  }, [lat, lng, map]);

  return null;
}

export function MapNode({ id, data, selected }: NodeProps<MapNodeData>) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);

  const resolvedSource = useMemo(
    () => resolveMapSourceForNode(id, nodes, edges),
    [id, nodes, edges],
  );

  const coordinates = resolvedSource?.coordinates ?? null;

  return (
    <div
      data-testid={`map-node-${id}`}
      data-has-source={resolvedSource ? 'true' : 'false'}
      data-has-coordinates={coordinates ? 'true' : 'false'}
      className={`relative w-88 rounded-xl border bg-white transition-shadow duration-150 ${
        selected
          ? 'border-neutral-900 shadow-md'
          : 'border-neutral-200/90 shadow-sm'
      }`}
    >
      {/* Left Input Handle accepting ExifNode or ChatNode */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.MAP_IN}
        aria-label={`Coordinate input for ${data.title}`}
        className="!h-3.5 !w-3.5 !border-2 !border-white !bg-[#ff4d4d] !shadow-xs"
      />

      {/* Header */}
      <div className="border-b border-neutral-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-[#ff4d4d]" />
            <h3 className="truncate text-sm font-semibold text-neutral-900">
              {data.title}
            </h3>
          </div>
          {resolvedSource && (
            <span className="font-mono-tabular shrink-0 text-[11px] text-neutral-400">
              {resolvedSource.sourceType === 'exif' ? 'EXIF GPS' : 'Chat Text'}
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-neutral-500">
          {resolvedSource
            ? `Source: ${resolvedSource.sourceTitle}`
            : 'No ExifNode or ChatNode connected'}
        </p>
      </div>

      {/* Body */}
      <div className="p-3.5">
        {!resolvedSource ? (
          <div
            data-testid={`map-empty-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-8 text-center text-xs text-neutral-400"
          >
            Connect an ExifNode or ChatNode to plot GPS or parsed text coordinates.
          </div>
        ) : !coordinates ? (
          <div
            data-testid={`map-pending-${id}`}
            className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50/70 px-3 py-8 text-center text-xs text-neutral-500"
          >
            {resolvedSource.statusMessage ?? 'Awaiting coordinates from connected source.'}
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-neutral-500">Pinned Coordinates</span>
              <span
                data-testid={`map-coords-${id}`}
                className="font-mono-tabular font-medium text-neutral-900"
              >
                {formatLatLngLabel(coordinates)}
              </span>
            </div>

            <div
              data-testid={`map-viewport-${id}`}
              className="nodrag nowheel nopan relative h-52 w-full overflow-hidden rounded-lg border border-neutral-200/90 bg-neutral-100"
            >
              <MapContainer
                center={[coordinates.lat, coordinates.lng]}
                zoom={13}
                scrollWheelZoom
                attributionControl={false}
                className="h-full w-full z-0"
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution="&copy; OpenStreetMap contributors"
                />
                <MapViewportSync lat={coordinates.lat} lng={coordinates.lng} />
                <Marker position={[coordinates.lat, coordinates.lng]} icon={redPinIcon}>
                  <Popup>
                    <div className="text-xs">
                      <p className="font-semibold text-neutral-900">
                        {resolvedSource.sourceTitle}
                      </p>
                      <p className="font-mono-tabular mt-0.5 text-neutral-600">
                        {formatLatLngLabel(coordinates)}
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
