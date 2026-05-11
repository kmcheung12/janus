import { describe, it, expect, vi, beforeEach } from 'vitest'
import { copyToClipboard } from '../src/lib/clipboard'

describe('copyToClipboard', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('uses navigator.clipboard.writeText when available', async () => {
    const result = await copyToClipboard('hello')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello')
    expect(result).toBe(true)
  })

  it('returns false when clipboard API throws', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'))
    // jsdom does not support execCommand, so fallback also returns false in test env
    const result = await copyToClipboard('hello')
    expect(result).toBe(false)
  })
})
