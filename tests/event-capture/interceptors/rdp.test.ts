import { describe, it, expect } from 'vitest'
import { rdp } from '../../../src/lib/event-capture/interceptors/rdp'

describe('rdp', () => {
  it('returns unchanged when fewer than 3 points', () => {
    expect(rdp([{ x: 0, y: 0 }], 3)).toHaveLength(1)
    expect(rdp([{ x: 0, y: 0 }, { x: 10, y: 0 }], 3)).toHaveLength(2)
  })

  it('collapses collinear points to endpoints', () => {
    const points = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }]
    const result = rdp(points, 3)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ x: 0, y: 0 })
    expect(result[result.length - 1]).toEqual({ x: 100, y: 0 })
  })

  it('preserves a corner point that deviates beyond epsilon', () => {
    const points = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }]
    const result = rdp(points, 3)
    expect(result).toHaveLength(3)
    expect(result[1]).toEqual({ x: 50, y: 50 })
  })

  it('drops a point within epsilon of the line', () => {
    // middle point is 1px off the line — within epsilon=3
    const points = [{ x: 0, y: 0 }, { x: 50, y: 1 }, { x: 100, y: 0 }]
    const result = rdp(points, 3)
    expect(result).toHaveLength(2)
  })

  it('always preserves first and last point', () => {
    const points = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }]
    const result = rdp(points, 3)
    expect(result[0]).toEqual({ x: 0, y: 0 })
    expect(result[result.length - 1]).toEqual({ x: 100, y: 0 })
  })
})
