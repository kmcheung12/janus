export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    // Skip iframes — the isolated-world listener in content.ts also skips them,
    // so events dispatched inside iframes would be lost anyway.
    if (window !== window.top) return

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

  // ── XHR ──────────────────────────────────────────────────────────────────
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...args: unknown[]
  ) {
    ;(this as unknown as Record<string, unknown>)._janusMethod = method
    ;(this as unknown as Record<string, unknown>)._janusUrl =
      typeof url === 'string' ? url : (url as URL).href
    return originalOpen.apply(this, [method, url, ...args] as Parameters<typeof originalOpen>)
  }

  XMLHttpRequest.prototype.send = function (
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const start = Date.now()
    const requestBody = truncate(body != null ? String(body) : null)
    const self = this as unknown as Record<string, unknown>

    this.addEventListener('loadend', () => {
      let responseBody: string | null = null
      try {
        responseBody = truncate(
          this.responseType === '' || this.responseType === 'text'
            ? this.responseText
            : null,
        )
      } catch {
        // responseText throws when responseType isn't text
      }

      document.dispatchEvent(
        new CustomEvent(NETWORK_EVENT, {
          detail: JSON.stringify({
            method: self._janusMethod,
            url: self._janusUrl,
            status: this.status || null,
            requestBody,
            responseBody,
            errorDetails:
              this.status === 0 ? 'Network error or request aborted' : null,
            duration: Date.now() - start,
          }),
        }),
      )
    })

    return originalSend.apply(this, [body] as Parameters<typeof originalSend>)
  }

  // ── console ──────────────────────────────────────────────────────────────
  const CONSOLE_MARKER = '__janusConsole__'

  // Guard against double-patching if the script is injected more than once
  if (!(console.error as unknown as Record<string, unknown>)[CONSOLE_MARKER]) {
    const seen = new Set<string>()
    const origError = console.error.bind(console)
    const origWarn = console.warn.bind(console)

    type EmitSource = 'console.error' | 'console.warn' | 'error' | 'unhandledrejection'

    function emitConsole(level: 'error' | 'warn', args: unknown[], emitSource: EmitSource) {
      const message = args
        .map((a) => (a instanceof Error ? a.message : String(a)))
        .join(' ')
      const key = `${emitSource}:${message}`
      if (seen.has(key)) return
      seen.add(key)

      let source: string | null = null
      try {
        const lines = (new Error().stack ?? '').split('\n')
        const frames = lines.filter(l =>
          /^\s+at /.test(l) ||        // V8/Chrome: "    at name (url:line:col)"
          /@.+:\d+:\d+$/.test(l)      // Firefox:   "name@url:line:col"
        )
        // frames[0] = emitConsole, frames[1] = console.error/warn wrapper, frames[2] = originator
        const frame = frames[2]
        if (frame) {
          const v8 = frame.match(/\((.+)\)$/) ?? frame.match(/^\s+at\s+(.+)$/)
          if (v8) source = v8[1]
          else {
            const atIdx = frame.lastIndexOf('@')
            if (atIdx >= 0) source = frame.slice(atIdx + 1)
          }
        }
      } catch { /* ignore */ }

      document.dispatchEvent(
        new CustomEvent(CONSOLE_EVENT, {
          detail: JSON.stringify({ level, message, source }),
        }),
      )
    }

    const errorWrapper = (...args: unknown[]) => {
      origError(...args)
      emitConsole('error', args, 'console.error')
    }
    const warnWrapper = (...args: unknown[]) => {
      origWarn(...args)
      emitConsole('warn', args, 'console.warn')
    }
    ;(errorWrapper as unknown as Record<string, unknown>)[CONSOLE_MARKER] = true
    ;(warnWrapper as unknown as Record<string, unknown>)[CONSOLE_MARKER] = true
    console.error = errorWrapper as typeof console.error
    console.warn = warnWrapper as typeof console.warn

    window.addEventListener('error', (event) => {
      emitConsole('error', [event.error ?? event.message], 'error')
    })

    window.addEventListener('unhandledrejection', (event) => {
      emitConsole('error', [event.reason], 'unhandledrejection')
    })
  }
  },
})
