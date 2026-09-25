# Per-origin grants and agent navigation

Supersedes the per-document enablement rule in
`2026-09-24-webmcp-tools-and-browser-bridge-design.md` §19. Page *identity*
under §7 is unchanged.

## Problem

An agent cannot move between pages. Enablement is per-document, `onNavigated`
withdraws the handle, and re-enabling is a human click — so a task spanning two
URLs on one site is not expressible. A tool surface without navigation is not
usable for real work.

The fix is not to make tools origin-scoped: they already are. Definitions carry
`Applicability { origin, pathnamePrefix }` and survive navigation. What is
per-document is the **user's grant**, and that is what moves.

## Model

Two records where there was one.

```ts
/** What the user authorized. Held for the browser session. */
interface OriginGrant {
  grantId: Id
  origin: string
  allowWrites: boolean
  grantedAt: number
}

/** One live document under a grant. Minted and discarded as today. */
interface EnabledPage {
  pageId: PageId       // still new and random per document (§7)
  grantId: Id          // new
  tabId: number
  documentId: Id
  // ...unchanged
}
```

A grant is **not** a handle. Agents never see `grantId`; they continue to route
by `pageId`. The grant only decides whether a handle may be minted.

Scope is the whole origin. Enabling on `mydomain.com/path` grants
`mydomain.com`. A path prefix was considered and dropped: it would have
defaulted to something like `/item` on Hacker News, forbidding `/news`, and the
narrow reading is wrong more often than it is protective. Definitions keep
their own `Applicability.pathnamePrefix` — that is a statement about where a
recipe works, not about what the user authorized, and the two should not be
conflated.

The cost is explicit: `/logout` and `/settings` are inside every grant. Nothing
in the grant model prevents reaching them, so the controls that matter are the
write gate and the URL rules below.

This is the risk the WebMCP spec names as **misrepresentation of intent** —
ambiguity about whether an execution matches what the user wanted, including
accidental finalization. Origin-wide grants widen exactly that gap: the user
enabled one page and authorized a site. The spec does not forbid it and offers
no mechanism against it; the answer here is the on-page panel, which turns a
grant from an invisible standing permission into a visible one.

The spec also names **same-origin boundary violations** as a risk, which is why
`navigate` rejects cross-origin rather than prompting.

### Expiry

Grants live in `browser.storage.session`, so they die with the browser and
never reach disk. This deliberately replaces the expiry that per-document
enablement provided for free: previously a grant lasted until you clicked a
link, and nothing about the new model should be quieter than that.

Revocation is immediate and withdraws every page under the grant.

## Navigation lifecycle

`onNavigated(tabId)` stops being `disablePage`.

1. Resolve the committed URL's origin against live grants.
2. No match → `disablePage(tabId, 'navigation')`, exactly as today.
3. Match → withdraw the old handle with reason `'navigation'`, mint a new
   `pageId` for the new document, republish.

### Coalescing

A redirect chain (`/` → `/login` → `/home`) commits three times and would mint
three handles and three `pages_sync` rounds, most of them for documents no
agent will ever address.

Publication is therefore deferred per tab: on commit, withdraw immediately but
schedule the mint behind a short settle window (~250ms), resetting the timer on
each further commit. Only the document that survives the window is published.

Withdrawal is *not* deferred. Dropping the old handle late would leave a window
in which an agent could dispatch against a document that has already gone,
which is the `outcome_unknown` case again. Fail fast on the way down, settle on
the way up.

The daemon sees a removal followed by an addition. That is already expressible
in `pages_sync` and needs no contract change. Tool IDs, frozen name slugs and
revision high-water marks do **not** carry across — §7 is unchanged, and a
stale `pageId` still fails loudly rather than silently retargeting.

## The `navigate` tool

Served by the **background**, not the content script.

This is the load-bearing decision. A page-served `navigate` would have to
return through the handle its own navigation destroys, which is precisely the
`outcome_unknown` state the runtime works to avoid. The background owns the
tab, outlives the document, and replies once the new handle exists.

```
navigate(url) -> { pageId, url, title }
```

Constraints, enforced in the background before the tab is touched:

- Resolved URL must be same-origin with the grant. Cross-origin is rejected,
  not re-prompted; another site needs its own grant.
- Rejected outright if it carries a credential-shaped query parameter
  (`hasCredentialParams`). Not stripped — a caller asking for
  `logout?auth=…` is either injected or working from stale output, and quietly
  visiting `logout` instead would be worse than refusing.
- `consequentialHint: true`. Navigation is not a read.
- Subject to the existing per-page execution queue: a navigation and a tool
  call on the same page cannot interleave.

## Prerequisite: URL token sanitisation — **done**

Shipped ahead of the rest: `src/lib/browser-tools/url-safety.ts`, applied to
every href `read_page` and `find_text` emit and to `read_page`'s own `url`.
Tests in `tests/browser-tools/url-safety.test.ts`.

`read_page` currently returns hrefs with session credentials in them. Observed
on Hacker News:

```
logout?auth=6d5957a190ee89ec3bd1d423f4e2c13fc2040335&goto=…
fave?id=49836880&auth=f4bc5cfddefdf3080a25fc24a9d5845c52afe190
```

Under per-document enablement that is a disclosure. With `navigate` it is an
escalation: an agent reads a CSRF token from a `readOnlyHint: true` tool,
navigates to a state-changing GET, and never touches the write gate. The write
opt-in would be intact and irrelevant.

The sanitiser is a pure function used **symmetrically**: strip on the way out
of a read tool, reject on the way in to `navigate`. That is what lets
`navigate` stay stateless.

An earlier draft had `navigate` accept a query string only if a read tool had
already surfaced that exact URL. Dropped: the allowlist grows with every
`read_page` across every document under the grant, holds thousands of URLs for
the session, and goes stale — a URL read ten navigations ago may no longer mean
what it did. Symmetric sanitisation covers the same threat with no state. If a
tighter rule is wanted later, "links on the current document" is cleaner than
an accumulating set.

Parameter names are matched whole and case-insensitively, so `?id=123` survives
while `?sid=123` does not — losing addressing parameters would break the
ordinary navigation this feature exists to enable.

## UI

`PageAccessPanel` changes from a page toggle to a grant editor:

- "Enable tools on **news.ycombinator.com**" with the path prefix shown and
  editable, defaulting to the current path's directory rather than `/`. The
  default should be the narrower reading of what the user was looking at.
- "Allow form tools" moves onto the grant.
- Active grants are listed with their scope and a revoke control.

The on-page panel (`AgentToolsOverlay`) becomes more important, not less. Under
per-document enablement the click *was* the signal; a grant that follows the
user across a site needs a standing indicator that it is live, and that is the
panel's job.

## Unchanged

- §7 page identity, handle minting, revision rules.
- `Applicability` and `matchesApplicability` in `recipe-runtime`.
- Write gating: still off by default, still separate from read.
- The daemon contract and `pages_sync` semantics.

## Tests

- A same-origin navigation re-mints the handle; the old `pageId` is rejected
  with the existing stale-handle error rather than silently retargeted.
- A cross-origin navigation withdraws and does not re-mint.
- A navigation outside `pathPrefix` withdraws and does not re-mint.
- `navigate` to a cross-origin URL fails before the tab moves.
- `navigate` to a URL bearing an unseen query string fails.
- `read_page` emits no href containing `auth=`.
- Revoking a grant withdraws every page under it.
- Grants do not survive a browser restart.

## Open

- **Journeys leak the same tokens.** `NavigationEvent.url` and `ApiEvent.url`
  are captured raw and reach agent context through `get_journey_by_id`. Same
  defect, different surface, and not fixed here — journeys are user-initiated
  recording rather than agent-reachable tools, so the exposure is narrower but
  real. `url-safety.ts` applies unchanged if we want it.
- **Credential parameter names are a heuristic.** A site using `?t=` or `?v=`
  for a token defeats it. The rule fails open, and nothing in the design
  notices. Worth revisiting if webmachinelearning/webmcp#110 lands, since a
  browser-enforced `sensitiveHint` would be a real boundary rather than a
  guess.
- **`/logout` is inside every grant.** Accepted consequence of origin-wide
  scope. Mitigated only by the write gate and by `navigate` refusing
  credential-bearing URLs; a GET-only logout with no token remains reachable.
