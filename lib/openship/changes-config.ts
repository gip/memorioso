// Deployment configuration for the write half of Openship. Read from env with no fallbacks, in
// keeping with the rest of this app: a missing value disables the feature rather than guessing.

import { getDomain } from 'tldts'

export type ChangesConfig = {
  enabled: boolean
  /**
   * The registrable domain builds are served from. OpenShip Changes requires this to be a
   * different registrable domain from the production site, not a subdomain of it: subdomains share
   * cookie scope, and a build that can set a cookie on the parent can fix a session on the real
   * site. Enforced here rather than left to the operator's memory.
   */
  buildsDomain: string | null
  /** x402 price per accepted submission, as a decimal string. Absent means no payment required. */
  price: string | null
  priceAsset: string | null
  payTo: string | null
}

const clean = (value: string | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * Rejects a builds domain that is the production origin's host or any subdomain of it. This is the
 * single highest-value constraint in the whole design, so it fails closed at read time rather than
 * appearing as a note in the documentation.
 */
export const isolatedFrom = (buildsDomain: string, appUrl: string | undefined): boolean => {
  if (!appUrl) return true
  let host: string
  try {
    host = new URL(appUrl).hostname.toLowerCase()
  } catch {
    return true
  }
  const builds = buildsDomain.toLowerCase().replace(/^\.+/, '')
  if (host === 'localhost' || host === builds) return host !== builds
  const productionDomain = getDomain(host, { allowPrivateDomains: true })
  const candidateDomain = getDomain(builds, { allowPrivateDomains: true })
  if (productionDomain && candidateDomain) return productionDomain !== candidateDomain

  // Fail closed for unregistrable but related hostnames such as a bare public suffix.
  return !host.endsWith(`.${builds}`) && !builds.endsWith(`.${host}`)
}

export const getChangesConfig = (): ChangesConfig => {
  const buildsDomain = clean(process.env.OPENSHIP_BUILDS_DOMAIN)
  const requested = process.env.OPENSHIP_CHANGES_ENABLED === '1'
  const isolated = buildsDomain ? isolatedFrom(buildsDomain, process.env.NEXT_PUBLIC_APP_URL) : false

  return {
    enabled: requested && Boolean(buildsDomain) && isolated,
    buildsDomain,
    price: clean(process.env.OPENSHIP_CHANGES_PRICE),
    priceAsset: clean(process.env.OPENSHIP_CHANGES_PRICE_ASSET),
    payTo: clean(process.env.OPENSHIP_CHANGES_PAY_TO),
  }
}

export const buildUrl = (buildsDomain: string, buildId: string): string =>
  `https://${buildId}.${buildsDomain}`
