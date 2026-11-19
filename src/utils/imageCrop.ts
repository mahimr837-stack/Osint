export interface DisplayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceCropRect {
  sx: number;
  sy: number;
  sWidth: number;
  sHeight: number;
}

export interface ClientOverlayBounds {
  left: number;
  top: number;
  width: number;
  height: number;
  localWidth?: number;
  localHeight?: number;
}

/**
 * Converts viewport clientX/clientY coordinates into unscaled local container
 * coordinates so SVG selection boxes align with the cursor at any React Flow zoom level.
 */
export function clientPointToContainerPoint(
  clientX: number,
  clientY: number,
  bounds: ClientOverlayBounds,
): { point: { x: number; y: number }; width: number; height: number } | null {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }

  const width =
    bounds.localWidth && bounds.localWidth > 0
      ? bounds.localWidth
      : bounds.width;
  const height =
    bounds.localHeight && bounds.localHeight > 0
      ? bounds.localHeight
      : bounds.height;

  const scaleX = width / bounds.width;
  const scaleY = height / bounds.height;

  return {
    point: {
      x: (clientX - bounds.left) * scaleX,
      y: (clientY - bounds.top) * scaleY,
    },
    width,
    height,
  };
}

/**
 * Normalizes a drag box from start/end points and clamps it inside the container bounds.
 */
export function normalizeSelectionRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  containerWidth: number,
  containerHeight: number,
): DisplayRect {
  const clampX = (v: number) => Math.max(0, Math.min(containerWidth, v));
  const clampY = (v: number) => Math.max(0, Math.min(containerHeight, v));

  const x1 = clampX(start.x);
  const y1 = clampY(start.y);
  const x2 = clampX(end.x);
  const y2 = clampY(end.y);

  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return {
    x,
    y,
    width: Math.max(0, Math.max(x1, x2) - x),
    height: Math.max(0, Math.max(y1, y2) - y),
  };
}

/**
 * Maps a display selection rectangle over an `object-cover` image container
 * back to natural image pixel coordinates (sx, sy, sWidth, sHeight) for Canvas drawImage.
 */
export function mapDisplaySelectionToSourceRect(params: {
  selection: DisplayRect;
  containerWidth: number;
  containerHeight: number;
  naturalWidth: number;
  naturalHeight: number;
}): SourceCropRect | null {
  const {
    selection,
    containerWidth,
    containerHeight,
    naturalWidth,
    naturalHeight,
  } = params;

  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    selection.width < 2 ||
    selection.height < 2
  ) {
    return null;
  }

  // CSS object-fit: cover scales uniformly so the image covers the entire container
  const scale = Math.max(
    containerWidth / naturalWidth,
    containerHeight / naturalHeight,
  );
  const renderedWidth = naturalWidth * scale;
  const renderedHeight = naturalHeight * scale;
  const offsetX = (containerWidth - renderedWidth) / 2;
  const offsetY = (containerHeight - renderedHeight) / 2;

  const rawSx = (selection.x - offsetX) / scale;
  const rawSy = (selection.y - offsetY) / scale;
  const rawEx = (selection.x + selection.width - offsetX) / scale;
  const rawEy = (selection.y + selection.height - offsetY) / scale;

  const sx = Math.max(0, Math.min(naturalWidth - 1, Math.round(rawSx)));
  const sy = Math.max(0, Math.min(naturalHeight - 1, Math.round(rawSy)));
  const ex = Math.max(sx + 1, Math.min(naturalWidth, Math.round(rawEx)));
  const ey = Math.max(sy + 1, Math.min(naturalHeight, Math.round(rawEy)));

  return {
    sx,
    sy,
    sWidth: ex - sx,
    sHeight: ey - sy,
  };
}

export function formatCroppedNodeTitle(parentTitle: string): string {
  const clean = parentTitle.trim() || 'Untitled Image';
  return clean.startsWith('Cropped: ') ? clean : `Cropped: ${clean}`;
}
