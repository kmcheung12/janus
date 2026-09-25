/**
 * Keeping session credentials out of agent context.
 *
 * Pages put per-session tokens in link URLs. Hacker News alone emits
 * `logout?auth=…`, `fave?id=…&auth=…` and `flag?id=…&auth=…` on every logged-in
 * page; Rails, Django and most session frameworks do comparable things. A read
 * tool that returns hrefs verbatim therefore hands an agent credentials that
 * authorize writes — from a tool annotated `readOnlyHint: true`.
 *
 * WebMCP has no mechanism for this. Its `untrustedContentHint` marks output as
 * untrusted *input* to the agent, which is the opposite direction, and the
 * `sensitiveHint` proposal (webmachinelearning/webmcp#110) is still backlog.
 * The spec's security section lists permissions policy, input length caps and
 * the untrusted/consequential annotations, and nothing for sensitive output —
 * a scoping decision, not an oversight: it assumes agents already "inherit
 * user identity and authentication context from the browser" and leaves
 * precise mitigation to agents and user agents.
 *
 * That assumption is about *ambient* authority — the browser attaches it,
 * same-origin rules bound it, it never becomes data. A token serialized into a
 * tool result is a *bearer* credential: it lands in agent context, provider
 * logs and transcripts, and can be replayed from anywhere those are later
 * read. Redacting is about keeping the credential inside the browser boundary,
 * not about denying the agent authority it already has.
 *
 * Used symmetrically, which is what lets `navigate` stay stateless: strip on
 * the way out of a read tool, reject on the way in to a navigation. There is
 * no allowlist of previously-seen URLs to keep, bound or expire.
 */

/**
 * Query parameter names that carry authority rather than addressing.
 *
 * Matched on the whole name, case-insensitively, so `id` and `sig` are
 * distinguished — `?id=123` is addressing and must survive, because losing it
 * would break the ordinary case this whole feature exists for.
 */
const CREDENTIAL_PARAM =
  /^(auth|authorization|token|access_token|id_token|refresh_token|csrf|csrf_token|xsrf|xsrfToken|session|sessionid|sid|key|apikey|api_key|secret|sig|signature|nonce|state|code|password|passwd|pwd)$/i

/** Replaced rather than dropped, so a reader can see something was removed. */
const REDACTED = 'REDACTED'

function parse(href: string): URL | null {
  try {
    // Relative hrefs resolve against the document; `a.href` is already
    // absolute, but find_text and authored definitions may pass either.
    return new URL(href, document.baseURI)
  } catch {
    return null
  }
}

/**
 * A URL safe to put in a tool result. Credential-shaped parameters are
 * redacted; everything else, including ordinary query parameters, survives.
 *
 * Unparseable input is returned with its query string removed entirely rather
 * than passed through — failing closed is cheap here, since a href we cannot
 * parse is one we also cannot vouch for.
 */
export function sanitizeUrl(href: string): string {
  const url = parse(href)
  if (!url) return href.split('?')[0]

  // `forEach`, not `keys()`. Firefox content scripts see DOM objects through
  // Xray wrappers, under which the URLSearchParams iterator is not iterable —
  // `[...url.searchParams.keys()]` throws at runtime in Firefox while passing
  // in jsdom and Chromium. Do not "simplify" this back to a spread or for-of.
  const names: string[] = []
  url.searchParams.forEach((_value, name) => { names.push(name) })

  let changed = false
  for (const name of names) {
    if (!CREDENTIAL_PARAM.test(name)) continue
    url.searchParams.set(name, REDACTED)
    changed = true
  }

  // `URL` normalizes even when nothing matched; returning the original avoids
  // gratuitously rewriting hrefs the page already had right.
  return changed ? url.href : href
}

/**
 * Whether a URL carries something that looks like a credential.
 *
 * `navigate` rejects on this rather than silently stripping: a caller asking
 * to visit `logout?auth=…` has either been injected or is working from stale
 * output, and quietly visiting `logout` instead would be worse than refusing.
 */
export function hasCredentialParams(href: string): boolean {
  const url = parse(href)
  if (!url) return false
  // See sanitizeUrl: iterators on URLSearchParams break under Firefox Xrays.
  let found = false
  url.searchParams.forEach((_value, name) => {
    if (CREDENTIAL_PARAM.test(name)) found = true
  })
  return found
}
