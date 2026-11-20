export interface FloatingRect {
  x: number
  y: number
  width: number
  height: number
}

export const FLOATING_MARGIN = 12
export const LAUNCHER_SIZE = 48
export const PANEL_SIZE = { width: 420, height: 520 }

export const resizeEdges = {
  n: '上边', ne: '右上角', e: '右边', se: '右下角',
  s: '下边', sw: '左下角', w: '左边', nw: '左上角',
}
export type ResizeEdge = keyof typeof resizeEdges

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export function fitFloatingRect(rect: FloatingRect, bounds: FloatingRect): FloatingRect {
  const width = Math.min(rect.width, bounds.width)
  const height = Math.min(rect.height, bounds.height)
  return {
    width,
    height,
    x: clamp(rect.x, bounds.x, bounds.x + bounds.width - width),
    y: clamp(rect.y, bounds.y, bounds.y + bounds.height - height),
  }
}

export function resizeFloatingRect(rect: FloatingRect, bounds: FloatingRect, edge: ResizeEdge, dx: number, dy: number): FloatingRect {
  const minWidth = Math.min(320, bounds.width)
  const minHeight = Math.min(300, bounds.height)
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  const next = { ...rect }
  if (edge.includes('w')) {
    next.width = clamp(rect.width - dx, minWidth, Math.min(800, right - bounds.x))
    next.x = right - next.width
  }
  if (edge.includes('e')) next.width = clamp(rect.width + dx, minWidth, Math.min(800, bounds.x + bounds.width - rect.x))
  if (edge.includes('n')) {
    next.height = clamp(rect.height - dy, minHeight, bottom - bounds.y)
    next.y = bottom - next.height
  }
  if (edge.includes('s')) next.height = clamp(rect.height + dy, minHeight, bounds.y + bounds.height - rect.y)
  return next
}
