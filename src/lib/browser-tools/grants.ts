/**
 * What the user authorized, as distinct from what routes a call.
 *
 * A grant is an origin. A page handle is a document. Separating them is what
 * lets an agent follow a link: enablement stops dying at every navigation,
 * while page identity keeps its §7 guarantees — new document, new random
 * handle, nothing carried across.
 *
 * Scope is the whole origin. A path prefix was considered and dropped: on
 * Hacker News, enabling from /item?id=1 would have defaulted to /item and
 * forbidden /news, and the narrow reading is wrong more often than it is
 * protective. The cost is explicit — /logout and /settings are inside every
 * grant — so the controls that matter are the write opt-in and the URL rules
 * in navigate().
 *
 * Held in session storage, so a grant dies with the browser and never reaches
 * disk. That deliberately replaces the expiry per-document enablement gave for
 * free: previously a grant lasted until you clicked a link.
 */

export interface OriginGrant {
  origin: string
  allowWrites: boolean
  grantedAt: number
}

const KEY = 'janus_origin_grants'

type GrantMap = Record<string, OriginGrant>

async function read(): Promise<GrantMap> {
  try {
    const stored = await browser.storage.session.get(KEY)
    return (stored[KEY] as GrantMap | undefined) ?? {}
  } catch {
    // Session storage is unavailable in some contexts; no grant is the safe
    // reading, since it only ever withholds authority.
    return {}
  }
}

async function write(grants: GrantMap): Promise<void> {
  try {
    await browser.storage.session.set({ [KEY]: grants })
  } catch { /* see read(): losing a grant fails closed */ }
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

export async function grantFor(url: string): Promise<OriginGrant | undefined> {
  const origin = originOf(url)
  if (!origin.startsWith('http')) return undefined
  return (await read())[origin]
}

export async function grant(origin: string, allowWrites: boolean): Promise<OriginGrant> {
  const grants = await read()
  const record: OriginGrant = {
    origin,
    // Re-enabling must not silently widen an existing grant.
    allowWrites: allowWrites || (grants[origin]?.allowWrites ?? false),
    grantedAt: grants[origin]?.grantedAt ?? Date.now(),
  }
  grants[origin] = record
  await write(grants)
  return record
}

export async function setWrites(origin: string, allowWrites: boolean): Promise<void> {
  const grants = await read()
  if (!grants[origin]) return
  grants[origin] = { ...grants[origin], allowWrites }
  await write(grants)
}

export async function revoke(origin: string): Promise<void> {
  const grants = await read()
  delete grants[origin]
  await write(grants)
}

export async function all(): Promise<OriginGrant[]> {
  return Object.values(await read())
}
