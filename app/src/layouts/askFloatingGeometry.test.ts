import { describe, expect, it } from 'vitest'
import { fitFloatingRect, resizeFloatingRect, type ResizeEdge } from './askFloatingGeometry'

const bounds = { x: 12, y: 68, width: 1000, height: 650 }
const panel = { x: 200, y: 180, width: 420, height: 420 }

describe('问数浮窗几何计算', () => {
  it.each([
    ['n', 0, -40, [200, 140, 420, 460]],
    ['ne', 40, -40, [200, 140, 460, 460]],
    ['e', 40, 0, [200, 180, 460, 420]],
    ['se', 40, 40, [200, 180, 460, 460]],
    ['s', 0, 40, [200, 180, 420, 460]],
    ['sw', -40, 40, [160, 180, 460, 460]],
    ['w', -40, 0, [160, 180, 460, 420]],
    ['nw', -40, -40, [160, 140, 460, 460]],
  ] as [ResizeEdge, number, number, number[]][])('拖动 %s 保持对边位置', (edge, dx, dy, [x, y, width, height]) => {
    expect(resizeFloatingRect(panel, bounds, edge, dx, dy)).toEqual({ x, y, width, height })
  })

  it('锁定视口边界和最小尺寸，窄屏压缩到有效空间', () => {
    expect(resizeFloatingRect(panel, bounds, 'nw', -800, -800)).toEqual({
      x: 12, y: 68, width: 608, height: 532,
    })
    expect(resizeFloatingRect(panel, bounds, 'nw', 800, 800)).toEqual({
      x: 300, y: 300, width: 320, height: 300,
    })
    const small = { x: 12, y: 68, width: 290, height: 240 }
    expect(fitFloatingRect(panel, small)).toEqual(small)
    expect(resizeFloatingRect(small, small, 'se', -30, -40)).toEqual(small)
  })
})
