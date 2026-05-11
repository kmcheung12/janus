export const NETWORK_EVENT_NAME = 'janus:api-event'

const BODY_MAX = 500

function truncate(s: string | null): string | null {
  return s && s.length > BODY_MAX ? s.slice(0, BODY_MAX - 1) + '…' : s
}

function dispatch(doc: Document, detail: Record<string, unknown>) {
  doc.dispatchEvent(new CustomEvent(NETWORK_EVENT_NAME, { detail }))
}

const JANUS_FETCH_WRAPPER = Symbol('janusNetworkWrapper')

export function patchNetwork(doc: Document): () => void {
  const originalFetch = window.fetch

  const wrapper = async function (input: RequestInfo | URL, init?: RequestInit) {
    const method = init?.method ?? 'GET'
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url
    const requestBody = truncate(init?.body ? String(init.body) : null)
    const start = Date.now()

    try {
      const response = await originalFetch.call(window, input, init)
      const clone = response.clone()
      const responseText = await clone.text().catch(() => null)

      dispatch(doc, {
        method,
        url,
        status: response.status,
        requestBody,
        responseBody: truncate(responseText),
        errorDetails: null,
        duration: Date.now() - start,
      })

      return response
    } catch (err) {
      dispatch(doc, {
        method,
        url,
        status: null,
        requestBody,
        responseBody: null,
        errorDetails: err instanceof Error ? err.message : String(err),
        duration: Date.now() - start,
      })
      throw err
    }
  }

  ;(wrapper as unknown as Record<symbol, boolean>)[JANUS_FETCH_WRAPPER] = true
  window.fetch = wrapper as typeof fetch

  return () => {
    // Only restore if our wrapper is still in place.
    // If window.fetch was replaced externally (e.g. by a test mock after patching),
    // we leave it alone so the external replacement is preserved.
    if ((window.fetch as unknown as Record<symbol, boolean>)[JANUS_FETCH_WRAPPER]) {
      window.fetch = originalFetch
    }
  }
}
