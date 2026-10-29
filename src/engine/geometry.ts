/**
 * Box geometry in page space (points, y down, unrotated page — the space
 * EmbedPDF stores `rect` / `unrotatedRect` in).
 */
export interface Box {
  origin: { x: number; y: number };
  size: { width: number; height: number };
}

/**
 * Grow (or shrink) a possibly rotated box to `newHeight`, keeping its top
 * edge — as the user sees it — where it is.
 *
 * `rotation` is EmbedPDF's UI value: degrees clockwise on screen, applied
 * around the box centre. Returns the new local box and its axis-aligned
 * bounding box (EmbedPDF's `rect` when rotated).
 */
export function resizeKeepingTop(local: Box, rotation: number, newHeight: number): { local: Box; rect: Box } {
  const { width: w, height: h } = local.size;
  const dh = newHeight - h;
  const rad = (rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // centre moves by R(θ)·(0, dh/2); R is clockwise in y-down space
  const cx = local.origin.x + w / 2 - s * (dh / 2);
  const cy = local.origin.y + h / 2 + c * (dh / 2);
  const nextLocal: Box = { origin: { x: cx - w / 2, y: cy - newHeight / 2 }, size: { width: w, height: newHeight } };
  const ex = (Math.abs(w * c) + Math.abs(newHeight * s)) / 2;
  const ey = (Math.abs(w * s) + Math.abs(newHeight * c)) / 2;
  return { local: nextLocal, rect: { origin: { x: cx - ex, y: cy - ey }, size: { width: 2 * ex, height: 2 * ey } } };
}
