import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from 'reactflow';
import { X } from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';

export function RedBezierEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const deleteEdge = useCanvasStore((state) => state.deleteEdge);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.35,
  });

  const active = hovered || selected;

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group"
    >
      {/* Invisible wider hit path for smooth hover and selection */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        className="cursor-pointer"
      />
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: '#ff4d4d',
          strokeWidth: active ? 2.75 : 2,
          strokeLinecap: 'round',
          filter: active ? 'drop-shadow(0 0 4px rgba(255, 77, 77, 0.35))' : undefined,
          transition: 'stroke-width 140ms ease, filter 140ms ease',
        }}
      />
      <EdgeLabelRenderer>
        {active && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                deleteEdge(id);
              }}
              aria-label={`Disconnect wire ${id}`}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-[#ff4d4d]/40 bg-white text-[#ff4d4d] shadow-sm transition-colors hover:bg-[#ff4d4d] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4d4d]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </EdgeLabelRenderer>
    </g>
  );
}
