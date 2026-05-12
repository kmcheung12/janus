export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    // Skip iframes — the isolated-world listener in content.ts also skips them,
    // so events dispatched inside iframes would be lost anyway.
    if (window !== window.top) return

    const script = document.createElement('script')
    script.textContent = `(${inject.toString()})()`
    ;(document.head ?? document.documentElement).appendChild(script)
    script.remove()
  },
})

// Self-contained: runs as serialised string in the page's MAIN world.
// No imports — all constants and helpers are defined inline.
function inject() {
  const NETWORK_EVENT = 'janus:api-event'
  const CONSOLE_EVENT = 'janus:console-event'
  const BODY_MAX = 500
  const JANUS_MARKER = '__janusWrapper__'

  function truncate(s: string | null): string | null {
    return s && s.length > BODY_MAX ? s.slice(0, BODY_MAX - 1) + '\u2026' : s
  }

  // ── fetch ────────────────────────────────────────────────────────────────
  const originalFetch = window.fetch

  const wrapper = async function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    const isRequest =
      typeof input === 'object' && !(input instanceof URL) && 'method' in input
    const method =
      init?.method ?? (isRequest ? (input as Request).method : 'GET')
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url
    const reqBodyText =
      isRequest && !init?.body
        ? await (input as Request)
            .clone()
            .text()
            .catch(() => null)
        : init?.body
          ? String(init.body)
          : null
    const requestBody = truncate(reqBodyText)
    const start = Date.now()

    try {
      const response = await originalFetch.call(window, input, init)
      const responseText = await response
        .clone()
        .text()
        .catch(() => null)
      document.dispatchEvent(
        new CustomEvent(NETWORK_EVENT, {
          detail: JSON.stringify({
            method,
            url,
            status: response.status,
            requestBody,
            responseBody: truncate(responseText),
            errorDetails: null,
            duration: Date.now() - start,
          }),
        }),
      )
      return response
    } catch (err) {
      document.dispatchEvent(
        new CustomEvent(NETWORK_EVENT, {
          detail: JSON.stringify({
            method,
            url,
            status: null,
            requestBody,
            responseBody: null,
            errorDetails: err instanceof Error ? err.message : String(err),
            duration: Date.now() - start,
          }),
        }),
      )
      throw err
    }
  }

  ;(wrapper as unknown as Record<string, boolean>)[JANUS_MARKER] = true
  window.fetch = wrapper as typeof fetch

  // ── console ──────────────────────────────────────────────────────────────
  const seen = new Set<string>()
  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)

  function emitConsole(level: 'error' | 'warn', args: unknown[]) {
    const message = args
      .map((a) => (a instanceof Error ? a.message : String(a)))
      .join(' ')
    const key = `${level}:${message}`
    if (seen.has(key)) return
    seen.add(key)
    document.dispatchEvent(
      new CustomEvent(CONSOLE_EVENT, {
        detail: JSON.stringify({ level, message }),
      }),
    )
  }

  console.error = (...args: unknown[]) => {
    origError(...args)
    emitConsole('error', args)
  }
  console.warn = (...args: unknown[]) => {
    origWarn(...args)
    emitConsole('warn', args)
  }
}
