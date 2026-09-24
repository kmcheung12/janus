/**
 * Bounded network-response extraction (§11).
 *
 * Observes responses the page makes and reads authored fields out of them. It
 * does not replay recorded requests and is not a general authenticated fetch:
 * the matcher is fixed at authoring time and the caller cannot redirect it.
 *
 * The distinction this file exists to preserve is between *matching* and
 * *causation*. A response that matches the authored matcher within the
 * observation window is evidence, not proof. Two matches are ambiguous and
 * fail rather than silently picking the first.
 */

import type { AuthoringBinding, GeneratedDefinition, Json } from './contract'
import { LIMITS } from './limits'

type ResponseBinding = Extract<AuthoringBinding, { kind: 'response' }>

export interface ResponseObserver {
  /** Resolve once a match settles, or throw on timeout/ambiguity. */
  settled(timeoutMs: number): Promise<void>
  read(pointer: string): Json
  stop(): void
}

interface Capture {
  body: Json
  truncated: boolean
}

class ObserverError extends Error {
  constructor(public readonly code: 'RESPONSE_MISSING' | 'RESPONSE_AMBIGUOUS' | 'CAPTURE_LIMIT', message: string) {
    super(message)
  }
}

export function observeResponses(
  binding: ResponseBinding,
  input: Record<string, Json>,
  definition: GeneratedDefinition,
): ResponseObserver {
  const matches: Capture[] = []
  let totalBytes = 0
  let stopped = false
  const waiters: Array<() => void> = []

  const originalFetch = window.fetch

  // Installed before the triggering action runs, so a fast response cannot
  // land in the gap between the click and the observer being ready.
  const wrapped: typeof window.fetch = async (inputArg, init) => {
    const response = await originalFetch(inputArg, init)
    if (stopped) return response

    try {
      const url = new URL(
        typeof inputArg === 'string' ? inputArg
          : inputArg instanceof URL ? inputArg.href
          : (inputArg as Request).url,
        window.location.href,
      )
      const method = (init?.method
        ?? (typeof inputArg === 'object' && 'method' in inputArg ? (inputArg as Request).method : 'GET')
      ).toUpperCase()

      if (shouldCapture(url, method, response.status)) {
        // Clone so the page still receives an unread body.
        void capture(response.clone(), url)
      }
    } catch {
      // A malformed URL is not our problem; never break the page's own call.
    }
    return response
  }

  window.fetch = wrapped

  function shouldCapture(url: URL, method: string, status: number): boolean {
    if (method !== binding.method) return false
    if (url.origin !== binding.origin) return false
    if (url.pathname !== binding.pathname) return false
    if (!binding.statuses.includes(status)) return false

    // Declared query comparisons only; no regex, no expressions.
    for (const match of binding.match) {
      if (match.location !== 'query') continue
      const expected = expectedValue(match.expected)
      if (url.searchParams.get(match.key) !== String(expected)) return false
    }
    return true
  }

  function expectedValue(ref: ResponseBinding['match'][number]['expected']): Json {
    if (ref.kind === 'literal') return ref.value
    const parameter = definition.parameters.find((p) => p.slotId === ref.slotId)
    return parameter ? input[parameter.name] ?? null : null
  }

  async function capture(response: Response, url: URL): Promise<void> {
    try {
      const text = await readBounded(response)
      totalBytes += text.length
      if (totalBytes > LIMITS.responseTotalMaxBytesPerInvocation) {
        throw new ObserverError('CAPTURE_LIMIT', 'Total captured response bytes exceeded the limit')
      }

      let body: Json
      try {
        body = JSON.parse(text) as Json
      } catch {
        // §11: report unparseable data explicitly rather than as an empty result.
        throw new ObserverError('CAPTURE_LIMIT', `Response from ${url.pathname} was not parseable JSON`)
      }

      // JSON-body matchers are checked after parsing.
      for (const match of binding.match) {
        if (match.location !== 'json_body') continue
        if (readPointer(body, match.pointer) !== expectedValue(match.expected)) return
      }

      matches.push({ body, truncated: false })
    } catch (e) {
      matches.push({ body: null, truncated: true })
      if (e instanceof ObserverError) failure = e
    } finally {
      for (const waiter of waiters.splice(0)) waiter()
    }
  }

  let failure: ObserverError | undefined

  async function readBounded(response: Response): Promise<string> {
    const reader = response.body?.getReader()
    if (!reader) return response.text()

    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > LIMITS.responseBodyMaxBytes) {
        // Stop reading rather than buffering an unbounded body.
        await reader.cancel()
        throw new ObserverError('CAPTURE_LIMIT', 'Response body exceeded the capture limit')
      }
      chunks.push(value)
    }
    return new TextDecoder().decode(concat(chunks, size))
  }

  return {
    async settled(timeoutMs: number) {
      const deadline = Date.now() + timeoutMs
      while (matches.length === 0 && Date.now() < deadline && !failure) {
        await Promise.race([
          new Promise<void>((r) => waiters.push(r)),
          new Promise<void>((r) => setTimeout(r, 50)),
        ])
      }
      if (failure) throw failure
      if (matches.length === 0) {
        throw new ObserverError('RESPONSE_MISSING', 'The expected response did not arrive in time')
      }
      if (matches.length > 1) {
        // Background polling can produce several matches. Guessing which one
        // the action caused would fabricate a causal claim.
        throw new ObserverError('RESPONSE_AMBIGUOUS', `${matches.length} responses matched; cannot attribute one to this action`)
      }
    },

    read(pointer: string): Json {
      const match = matches[0]
      if (!match) throw new ObserverError('RESPONSE_MISSING', 'No matched response to read from')
      if (match.truncated) throw new ObserverError('CAPTURE_LIMIT', 'The matched response was truncated')
      return readPointer(match.body, pointer)
    },

    stop() {
      stopped = true
      // Only unwrap if nobody else has wrapped over us since.
      if (window.fetch === wrapped) window.fetch = originalFetch
      for (const waiter of waiters.splice(0)) waiter()
    },
  }
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out
}

/** RFC 6901 JSON Pointer — the only field-path syntax in v1 (§17). */
export function readPointer(value: Json, pointer: string): Json {
  if (pointer === '') return value
  if (!pointer.startsWith('/')) throw new Error(`Invalid JSON Pointer: ${pointer}`)

  let current: Json = value
  for (const rawSegment of pointer.slice(1).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~')
    if (current === null || typeof current !== 'object') return null
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return null
      current = current[index]
    } else {
      current = (current as { [k: string]: Json })[segment] ?? null
    }
  }
  return current
}
