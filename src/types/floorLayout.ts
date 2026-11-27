import type { LayoutRect } from './pos'

export const GRID = 20
export const MAX_CANVAS = 8000
export const MIN_WIDTH = 120
export const MIN_HEIGHT = 100

export function snap(value: number, minimum: number, maximum: number) {
  return Math.min(Math.floor(maximum / GRID) * GRID, Math.max(minimum, Math.round(value / GRID) * GRID))
}

export function editRect(rect: LayoutRect, dx: number, dy: number, resize: boolean): LayoutRect {
  if (resize) return {
    x_pos: snap(rect.x_pos, 0, MAX_CANVAS - MIN_WIDTH),
    y_pos: snap(rect.y_pos, 0, MAX_CANVAS - MIN_HEIGHT),
    width: snap(rect.width + dx, MIN_WIDTH, MAX_CANVAS - snap(rect.x_pos, 0, MAX_CANVAS - MIN_WIDTH)),
    height: snap(rect.height + dy, MIN_HEIGHT, MAX_CANVAS - snap(rect.y_pos, 0, MAX_CANVAS - MIN_HEIGHT)),
  }
  const width = snap(rect.width, MIN_WIDTH, MAX_CANVAS)
  const height = snap(rect.height, MIN_HEIGHT, MAX_CANVAS)
  return {
    x_pos: snap(rect.x_pos + dx, 0, MAX_CANVAS - width),
    y_pos: snap(rect.y_pos + dy, 0, MAX_CANVAS - height),
    width, height,
  }
}
