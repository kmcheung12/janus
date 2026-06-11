import { describe, it, expect, beforeEach } from 'vitest'
import {
  upsertJourney, getById, getByDomain, getLatest, listAll,
  setStatus, addFile, addEvent, clear,
} from '../src/journey-store.js'
import type { JourneyMeta, FileAttachment } from '../src/types.js'

const meta = (domain: string, startTime = 1000): JourneyMeta => ({
  startTime, startUrl: `https://${domain}/`, tabTitle: domain, domain, status: 'recording',
})

beforeEach(() => clear())

describe('upsertJourney', () => {
  it('creates a new journey', () => {
    upsertJourney('abc', meta('google.com'), [])
    expect(getById('abc')).toMatchObject({ id: 'abc', meta: { domain: 'google.com' } })
  })

  it('replaces events on resync but preserves files', () => {
    upsertJourney('abc', meta('google.com'), [])
    const file: FileAttachment = { filename: 'shot.png', mimeType: 'image/png', path: '/tmp/shot.png' }
    addFile('abc', file)
    upsertJourney('abc', meta('google.com'), [])
    const j = getById('abc')!
    expect(j.events).toHaveLength(0)
    expect(j.files).toHaveLength(1)
  })
})

describe('addEvent', () => {
  it('appends event to existing journey', () => {
    upsertJourney('abc', meta('google.com'), [])
    const event = { id: 'e1', type: 'navigation' as const, timestamp: 1, url: 'https://google.com', title: 'G' }
    addEvent('abc', event)
    expect(getById('abc')?.events).toHaveLength(1)
  })

  it('silently ignores unknown journeyId', () => {
    expect(() => addEvent('nope', { id: 'e1', type: 'navigation' as const, timestamp: 1, url: '', title: '' })).not.toThrow()
  })
})

describe('setStatus', () => {
  it('updates status to stopped', () => {
    upsertJourney('abc', meta('google.com'), [])
    setStatus('abc', 'stopped')
    expect(getById('abc')?.meta.status).toBe('stopped')
  })
})

describe('getByDomain', () => {
  it('matches partial hostname case-insensitively', () => {
    upsertJourney('a', meta('mail.google.com', 1000), [])
    upsertJourney('b', meta('github.com', 2000), [])
    const results = getByDomain('Google')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('a')
  })

  it('returns multiple matching journeys', () => {
    upsertJourney('a', meta('docs.google.com', 1000), [])
    upsertJourney('b', meta('mail.google.com', 2000), [])
    upsertJourney('c', meta('github.com', 3000), [])
    expect(getByDomain('google')).toHaveLength(2)
  })
})

describe('getLatest', () => {
  it('returns undefined when empty', () => {
    expect(getLatest()).toBeUndefined()
  })

  it('returns journey with highest startTime', () => {
    upsertJourney('a', meta('a.com', 1000), [])
    upsertJourney('b', meta('b.com', 3000), [])
    upsertJourney('c', meta('c.com', 2000), [])
    expect(getLatest()?.id).toBe('b')
  })
})

describe('listAll', () => {
  it('returns all journeys', () => {
    upsertJourney('a', meta('a.com'), [])
    upsertJourney('b', meta('b.com'), [])
    expect(listAll()).toHaveLength(2)
  })
})
