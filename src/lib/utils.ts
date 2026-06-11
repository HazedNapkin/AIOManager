import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { inflateSync, strFromU8 } from 'fflate'
import type { AddonDescriptor } from '@/types/addon'
import { getHostnameIdentifier } from '@/lib/addon-identifier'
import { normalizeAddonUrl } from '@/lib/addon-url'

export { normalizeAddonUrl }

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email
  const [local, domain] = email.split('@')
  if (local.length <= 3) return `***@${domain}`
  return `${local.substring(0, 3)}***@${domain}`
}

export function maskUrl(url: string): string {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname
    return `${urlObj.protocol}//${hostname}/********`
  } catch {
    return '********'
  }
}

export function getStremioLink(url: string): string {
  return url.replace(/^https?:\/\//, 'stremio://')
}

/**
 * Robustly opens a Stremio detail page.
 * Tries deep link first, then falls back to web.stremio.com for a better web/mobile experience.
 */
export function openStremioDetail(type: string, id: string) {
  const normalizedType = type === 'anime' ? 'series' : type
  const deepLink = `stremio:///detail/${normalizedType}/${id}`
  const webLink = `https://web.stremio.com/#/detail/${normalizedType}/${id}`

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

  if (isMobile) {
    // On mobile, just use the deep link, browsers handle it better with a prompt
    window.location.href = deepLink
    // Fallback if they don't have it? We can't easily detect.
    // But we can offer a button in the UI if we want to be fancy.
    return
  }

  const start = Date.now()
  let blurred = false

  const onBlur = () => { blurred = true }
  window.addEventListener('blur', onBlur)

  window.location.href = deepLink

  setTimeout(() => {
    window.removeEventListener('blur', onBlur)
    if (!blurred && (Date.now() - start < 1000)) {
      // If we didn't blur and it's been ~500ms, the protocol probably isn't handled.
      // We open the web version as a fallback.
      window.open(webLink, '_blank')
    }
  }, 500)
}

export function getAddonConfigureUrl(installUrl: string): string {
  return installUrl.replace('manifest.json', 'configure')
}

/**
 * Normalizes an addon URL for consistent comparison.
 * Handles stremio:// protocols, trailing slashes, manifest.json suffixes, and lowercases the result.
 */

/**
 * Strips user-specific UUID segments (20+ chars, hex/hyphen) from the path.
 * This ensures that multiple configs of the same self-hosted addon are grouped.
 */
export function getCanonicalAddonUrl(url: string): string {
  const normalized = normalizeAddonUrl(url)
  try {
    const urlObj = new URL(normalized.startsWith('http') ? normalized : `https://${normalized}`)
    const segments = urlObj.pathname.split('/')
    const filteredSegments = segments.filter(s => !/^[0-9a-fA-F-]{20,}$/i.test(s))
    return `${urlObj.hostname}${filteredSegments.join('/')}`.toLowerCase()
  } catch {
    return normalized.toLowerCase()
  }
}

/**
 * Returns a reliable grouping key for an addon across different accounts.
 * Primary match is manifest.id. If missing or invalid, falls back to canonical URL.
 */
export function getAddonGroupKey(addon: AddonDescriptor): string {
  const id = addon.manifest?.id
  if (id && id !== 'unknown') {
    return id.toLowerCase()
  }
  return getCanonicalAddonUrl(addon.transportUrl)
}

export function getAddonVersionKey(addon: { transportUrl: string; manifest?: { id?: string } }): string {
  return `${addon.manifest?.id || 'unknown'}::${normalizeAddonUrl(addon.transportUrl)}`
}

export function getLatestAddonVersion(
  latestVersions: Record<string, string>,
  addon: { transportUrl: string; manifest?: { id?: string; version?: string } }
): string | undefined {
  const id = addon.manifest?.id
  const instanceVersion = latestVersions[getAddonVersionKey(addon)]
  if (instanceVersion) return instanceVersion

  // Pre-release/custom builds are often separate instances sharing a manifest ID.
  // Do not inherit another instance's stable latest version until this URL is checked.
  if (addon.manifest?.version && /[-+]/.test(addon.manifest.version)) return undefined

  const legacyLatest = id ? latestVersions[id] : undefined
  if (legacyLatest && /[-+]/.test(legacyLatest)) return undefined
  return legacyLatest
}

/**
 * Checks if a version string is strictly newer than the current version.
 * Handles 'v' prefixes, varying segment lengths, and basic semver flags.
 */
export function isNewerVersion(current?: string, latest?: string): boolean {
  if (!latest || !current) return false
  if (latest === current) return false

  const parseVersion = (v: string) => {
    const lower = v.toLowerCase().replace(/^v/, '')
    const [base, buildPart] = lower.split('+')

    const cleanBase = base.split('-')[0]
    const parts = cleanBase.split('.').map(Number)

    let buildNum = 0
    if (buildPart && buildPart.startsWith('build.')) {
      buildNum = parseInt(buildPart.split('.')[1]) || 0
    }

    return { parts, buildNum }
  }

  const c = parseVersion(current)
  const l = parseVersion(latest)

  const maxLength = Math.max(c.parts.length, l.parts.length)

  for (let i = 0; i < maxLength; i++) {
    const cPart = c.parts[i] || 0
    const lPart = l.parts[i] || 0
    if (lPart > cPart) return true
    if (lPart < cPart) return false
  }

  if (l.buildNum > c.buildNum) return true

  return false
}

const normalizeIdentityText = (value: string | undefined) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function hasFallbackAddonName(addon: Pick<AddonDescriptor, 'transportUrl' | 'manifest'>): boolean {
  const manifestName = addon.manifest?.name
  if (!manifestName || manifestName === 'Unknown Addon') return true

  const hostFallback = getHostnameIdentifier(addon.transportUrl)
  const normalizedName = normalizeIdentityText(manifestName)
  const normalizedHostFallback = normalizeIdentityText(hostFallback)
  return Boolean(normalizedName && normalizedName === normalizedHostFallback)
}

export function hasFallbackAddonIdentity(addon: Pick<AddonDescriptor, 'transportUrl' | 'manifest'>): boolean {
  if (hasFallbackAddonName(addon)) return true

  const hostFallback = getHostnameIdentifier(addon.transportUrl)
  const normalizedHostFallback = normalizeIdentityText(hostFallback)

  const description = addon.manifest?.description || ''
  return description.startsWith('Addon from ') && normalizeIdentityText(description).includes(normalizedHostFallback)
}

/**
 * Helper: Merge remote addons with local addons, preserving order and flags.
 * Source of Truth: Remote presence determines "enabled" status, but local flags and metadata are preserved.
 */

export function mergeAddons(localAddons: AddonDescriptor[], remoteAddons: AddonDescriptor[]) {
  // STRICT: Case-sensitive URL matching only. No ID-based deduplication.
  const remoteAddonMap = new Map<string, AddonDescriptor>()

  remoteAddons.forEach((a) => {
    const norm = normalizeAddonUrl(a.transportUrl)
    if (!remoteAddonMap.has(norm)) remoteAddonMap.set(norm, a)
  })

  const processedRemoteNormUrls = new Set<string>()
  const finalAddons: AddonDescriptor[] = []

  const now = Date.now()
  const MANIFEST_GRACE_PERIOD = 10 * 60 * 1000 // 10 minutes

  localAddons.forEach((localAddon) => {
    const normLocal = normalizeAddonUrl(localAddon.transportUrl)

    // STRICT: Only match by transportUrl to support multiple instances of same manifest ID (e.g. AIOStreams variants)
    const remoteAddon = remoteAddonMap.get(normLocal)

    const isRecentLocalChange = localAddon.metadata?.lastUpdated && (now - localAddon.metadata.lastUpdated < MANIFEST_GRACE_PERIOD)

    if (remoteAddon) {
      // ANTI-WIPE GUARD: Favor local manifest if remote is 'broken' or if we recently updated/enabled it locally.
      const isSubstantial = (addon: AddonDescriptor | undefined) => {
        const m = addon?.manifest;
        if (!addon || !m || !m.name || m.name === 'Unknown Addon' || hasFallbackAddonName(addon)) return false;
        const v = (m.version || '').replace(/^v/, '');
        const hasResources = Array.isArray(m.resources) && m.resources.length > 0;
        return v !== '0.0.0' && v !== '' && hasResources;
      };

      const remoteManifest = remoteAddon.manifest;
      const localManifest = localAddon.manifest;
      const useLocalManifest = (isSubstantial(localAddon) && !isSubstantial(remoteAddon)) || isRecentLocalChange;

      // Metadata: start from local (which carries customName, customLogo, etc.)
      let mergedMetadata = localAddon.metadata
        ? { ...localAddon.metadata }
        : (remoteAddon.metadata ? { ...remoteAddon.metadata } : undefined)

      // MIGRATION: If we chose the remote manifest over local, check whether the
      // local manifest had a different name/description/logo. If so, the local value
      // was a user customization that was baked into the manifest but never migrated
      // to the metadata fields. Migrate it now so it survives all future merges.
      // Guard: only migrate if metadata doesn't already have an explicit override.
      if (!useLocalManifest && localManifest && remoteManifest) {
        if (localManifest.name && localManifest.name !== remoteManifest.name && !mergedMetadata?.customName) {
          mergedMetadata = { ...(mergedMetadata || {}), customName: localManifest.name }
        }
        if (localManifest.description && localManifest.description !== remoteManifest.description && !mergedMetadata?.customDescription) {
          mergedMetadata = { ...(mergedMetadata || {}), customDescription: localManifest.description }
        }
        if (localManifest.logo && localManifest.logo !== remoteManifest.logo && !mergedMetadata?.customLogo) {
          mergedMetadata = { ...(mergedMetadata || {}), customLogo: localManifest.logo }
        }
      }

      // NAME COLLISION GUARD: If the remote name looks like a hostname/URL, and we have a local customized name,
      // favor the local name more aggressively to avoid showing "https://..." in the UI.
      const isHostname = (s: string) => /^[a-z0-9-]+\.[a-z0-9-]{2,}/i.test(s) || s.startsWith('http');
      if (remoteManifest.name && isHostname(remoteManifest.name) && mergedMetadata?.customName) {
        // Local customName is already in mergedMetadata from the logic above or existing state
      }

      const finalManifest = useLocalManifest ? localManifest : remoteManifest;

      finalAddons.push({
        ...remoteAddon,
        transportUrl: localAddon.transportUrl,
        manifest: finalManifest,
        flags: {
          ...remoteAddon.flags,
          protected: localAddon.flags?.protected,
          enabled: isRecentLocalChange ? (localAddon.flags?.enabled !== false) : (remoteAddon.flags?.enabled !== false),
        },
        metadata: mergedMetadata,
        catalogOverrides: localAddon.catalogOverrides,
        note: localAddon.note,
      })

      processedRemoteNormUrls.add(normalizeAddonUrl(remoteAddon.transportUrl))
      processedRemoteNormUrls.add(normLocal)
    } else {
      // 1. Missing from remote but was RECENTLY changed locally (e.g. just installed or enabled)
      // 2. OR it is currently DISABLED.
      // 3. OR it has PROTECTED status or CUSTOM METADATA that we want to keep.
      // Rationale: AIOManager intentionally hides disabled addons from Stremio.
      // We MUST keep them locally to avoid a sync-deletion loop.
      const hasCustomizations = localAddon.metadata?.customName || localAddon.metadata?.customLogo || localAddon.metadata?.customDescription;
      const isProtected = localAddon.flags?.protected;
      const hasNote = Boolean(localAddon.note?.trim());

      if (localAddon.flags?.enabled === false) {
        finalAddons.push({ ...localAddon })
      } else if (isRecentLocalChange || hasCustomizations || isProtected || hasNote) {
        finalAddons.push({ ...localAddon })
      }
    }
    // If not in remote AND none of the above -> DROP (1:1 Mirroring)
  })

  remoteAddons.forEach((remoteAddon) => {
    const normRemote = normalizeAddonUrl(remoteAddon.transportUrl)

    // STRICT: Only skip if this exact URL has been processed
    const alreadyProcessed = processedRemoteNormUrls.has(normRemote)

    if (!alreadyProcessed) {
      finalAddons.push({
        ...remoteAddon,
        flags: { ...(remoteAddon.flags || {}), enabled: true },
      })
    }
  })

  return finalAddons
}

export const ACCOUNT_COLORS = [
  '#3b82f6', // blue
  '#a855f7', // purple
  '#22c55e', // green
  '#f59e0b', // amber
  '#f43f5e', // rose
  '#06b2d2', // cyan
  '#f97316', // orange
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#10b981', // emerald
]

export function getTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000)

  let interval = seconds / 31536000
  if (interval > 1) {
    return Math.floor(interval) + 'y ago'
  }
  interval = seconds / 2592000
  if (interval > 1) {
    return Math.floor(interval) + 'mo ago'
  }
  interval = seconds / 86400
  if (interval > 1) {
    return Math.floor(interval) + 'd ago'
  }
  interval = seconds / 3600
  if (interval > 1) {
    return Math.floor(interval) + 'h ago'
  }
  interval = seconds / 60
  if (interval > 1) {
    return Math.floor(interval) + 'm ago'
  }
  if (seconds < 10) return 'just now'
  return Math.floor(seconds) + 's ago'
}

export function decompressSyncPayload(base64String: string): string {
  const bytes = Uint8Array.from(atob(base64String), c => c.charCodeAt(0))
  return strFromU8(inflateSync(bytes))
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function safeHref(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '#'
    return url
  } catch { return '#' }
}

export function inlineFormat(text: string, options?: { wikilinks?: boolean }): string {
  let html = escapeHtml(text)
  if (options?.wikilinks !== false) {
    html = html.replace(/\[\[([^\]]+)\]\]/g, (_, title) => {
      const safeTitle = title.replace(/"/g, '&quot;')
      return `<span class="text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary cursor-pointer" data-wikilink="${safeTitle}">${title}</span>`
    })
  }
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')
  html = html.replace(/`(.+?)`/g, '<code class="bg-destructive/10 text-destructive border border-destructive/15 px-1 py-0.5 rounded text-[0.8em] font-mono">$1</code>')
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, (_, t, url) => `<a href="${safeHref(url)}" class="text-primary underline underline-offset-2 hover:opacity-80" target="_blank" rel="noopener noreferrer">${t}</a>`)
  return html
}
