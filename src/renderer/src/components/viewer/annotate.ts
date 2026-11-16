/**
 * Screenshot-style annotations (pen, shapes, text, pixelate, numbered markers
 * and crop) kept in image pixels, so they stay put while the image is zoomed
 * and are drawn at full resolution when the result is copied or saved.
 */
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Tool = "pan" | "pen" | "line" | "arrow" | "rect" | "ellipse" | "marker" | "text" | "pixelate" | "counter" | "crop";
export type Shape =
  | { kind: "pen" | "marker"; color: string; width: number; points: Point[] }
  | { kind: "line" | "arrow" | "rect" | "ellipse"; color: string; width: number; from: Point; to: Point }
  | { kind: "pixelate"; block: number; from: Point; to: Point }
  | { kind: "text"; color: string; size: number; at: Point; text: string }
  | { kind: "counter"; color: string; size: number; at: Point; n: number };
export interface Edit { shapes: Shape[]; crop: Rect | null }
export const EMPTY_EDIT: Edit = { shapes: [], crop: null };

export const COLORS = ["#ff3b30", "#ff9f0a", "#ffd60a", "#34c759", "#0a84ff", "#bf5af2", "#ffffff", "#111111"] as const;
/** Stroke widths on screen; they are turned into image pixels for the current zoom. */
export const SIZES = [3, 6, 12] as const;

export const rectOf = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
export const nextCounter = (edit: Edit) => edit.shapes.reduce((n, shape) => shape.kind === "counter" ? Math.max(n, shape.n) : n, 0) + 1;
/** A drag too short to mean anything (a click with a shape tool) is ignored. */
export const meaningful = (shape: Shape, scale: number) => {
  const min = 3 / scale;
  if ("points" in shape) return shape.points.length > 1;
  if (shape.kind === "text") return shape.text.trim().length > 0;
  if (shape.kind === "counter") return true;
  return Math.abs(shape.from.x - shape.to.x) > min || Math.abs(shape.from.y - shape.to.y) > min;
};

const FONT = '600 {size}px "Inter", "Segoe UI", system-ui, sans-serif';
export const textFont = (size: number) => FONT.replace("{size}", String(size));
export const textLineHeight = (size: number) => size * 1.25;

function stroke(ctx: CanvasRenderingContext2D, color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function path(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  // Midpoint curves smooth a hand-drawn line without lagging behind the pointer.
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!, q = points[i + 1]!;
    ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  const last = points[points.length - 1]!;
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function pixelate(ctx: CanvasRenderingContext2D, image: CanvasImageSource, area: Rect, block: number) {
  const x = Math.max(0, Math.floor(area.x)), y = Math.max(0, Math.floor(area.y));
  const width = Math.floor(Math.min(area.width, ctx.canvas.width - x)), height = Math.floor(Math.min(area.height, ctx.canvas.height - y));
  if (width < 1 || height < 1) return;
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.ceil(width / block));
  small.height = Math.max(1, Math.ceil(height / block));
  const smallCtx = small.getContext("2d");
  if (!smallCtx) return;
  smallCtx.drawImage(image, x, y, width, height, 0, 0, small.width, small.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, x, y, width, height);
  ctx.restore();
}

export function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, image: CanvasImageSource) {
  ctx.save();
  switch (shape.kind) {
    case "pen":
      stroke(ctx, shape.color, shape.width);
      path(ctx, shape.points);
      break;
    case "marker":
      // A translucent, flat-ended stroke reads as a highlighter over text.
      stroke(ctx, shape.color, shape.width * 3);
      ctx.globalAlpha = 0.38;
      ctx.lineCap = "square";
      ctx.globalCompositeOperation = "multiply";
      path(ctx, shape.points);
      break;
    case "line":
    case "arrow": {
      stroke(ctx, shape.color, shape.width);
      const { from, to } = shape;
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const head = Math.max(10, shape.width * 4);
      // The shaft stops under the head so a thick arrow keeps a sharp point.
      const end = shape.kind === "arrow" ? { x: to.x - Math.cos(angle) * head * 0.6, y: to.y - Math.sin(angle) * head * 0.6 } : to;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      if (shape.kind === "arrow") {
        ctx.fillStyle = shape.color;
        ctx.beginPath();
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(to.x - Math.cos(angle - 0.45) * head, to.y - Math.sin(angle - 0.45) * head);
        ctx.lineTo(to.x - Math.cos(angle + 0.45) * head, to.y - Math.sin(angle + 0.45) * head);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "rect": {
      stroke(ctx, shape.color, shape.width);
      const r = rectOf(shape.from, shape.to);
      ctx.strokeRect(r.x, r.y, r.width, r.height);
      break;
    }
    case "ellipse": {
      stroke(ctx, shape.color, shape.width);
      const r = rectOf(shape.from, shape.to);
      ctx.beginPath();
      ctx.ellipse(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "pixelate":
      pixelate(ctx, image, rectOf(shape.from, shape.to), shape.block);
      break;
    case "text": {
      ctx.font = textFont(shape.size);
      ctx.textBaseline = "top";
      ctx.fillStyle = shape.color;
      // A soft outline keeps text legible over busy screenshots.
      ctx.lineWidth = Math.max(2, shape.size / 7);
      ctx.lineJoin = "round";
      ctx.strokeStyle = shape.color === "#111111" ? "rgba(255,255,255,.7)" : "rgba(0,0,0,.55)";
      shape.text.split("\n").forEach((line, i) => {
        const y = shape.at.y + i * textLineHeight(shape.size);
        ctx.strokeText(line, shape.at.x, y);
        ctx.fillText(line, shape.at.x, y);
      });
      break;
    }
    case "counter": {
      const radius = shape.size;
      ctx.fillStyle = shape.color;
      ctx.beginPath();
      ctx.arc(shape.at.x, shape.at.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, radius / 8);
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.stroke();
      ctx.fillStyle = shape.color === "#ffffff" || shape.color === "#ffd60a" ? "#111111" : "#ffffff";
      ctx.font = textFont(Math.round(radius * 1.15));
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(shape.n), shape.at.x, shape.at.y + radius * 0.06);
      break;
    }
  }
  ctx.restore();
}

/** Draws the annotations (not the image) for the on-screen layer. */
export function drawLayer(ctx: CanvasRenderingContext2D, image: CanvasImageSource, shapes: Shape[]) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const shape of shapes) drawShape(ctx, shape, image);
}

/** The image with every annotation, cut to the crop, as a PNG. */
export async function flatten(image: CanvasImageSource, size: { width: number; height: number }, edit: Edit): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(image, 0, 0, size.width, size.height);
  for (const shape of edit.shapes) drawShape(ctx, shape, image);
  let result = canvas;
  const crop = edit.crop && clampRect(edit.crop, size);
  if (crop && crop.width >= 1 && crop.height >= 1) {
    result = document.createElement("canvas");
    result.width = Math.round(crop.width);
    result.height = Math.round(crop.height);
    result.getContext("2d")!.drawImage(canvas, Math.round(crop.x), Math.round(crop.y), result.width, result.height, 0, 0, result.width, result.height);
  }
  return new Promise((resolve, reject) => result.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Export failed"))), "image/png"));
}

export function clampRect(rect: Rect, size: { width: number; height: number }): Rect {
  const x = Math.max(0, Math.min(size.width, rect.x)), y = Math.max(0, Math.min(size.height, rect.y));
  return { x, y, width: Math.max(0, Math.min(size.width, rect.x + rect.width) - x), height: Math.max(0, Math.min(size.height, rect.y + rect.height) - y) };
}
