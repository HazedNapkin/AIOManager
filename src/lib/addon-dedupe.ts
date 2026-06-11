import type { AddonDescriptor } from '@/types/addon'
import { normalizeAddonUrl } from '@/lib/utils'

export function getAddonUrlKey(url: string): string {
  return normalizeAddonUrl(url)
}

function hasKeys(value: Record<string, unknown> | undefined): boolean {
  return Boolean(value && Object.keys(value).length > 0)
}

function withoutUndefined<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {}
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>
}

function mergeDuplicateAddon(existing: AddonDescriptor, incoming: AddonDescriptor): AddonDescriptor {
  // Intentional asymmetry: existing flags preserve local controls such as
  // protected/disabled, while incoming metadata can refresh deployment labels.
  const flags = {
    ...(incoming.flags || {}),
    ...(existing.flags || {}),
  }
  const metadata = {
    ...withoutUndefined(existing.metadata),
    ...withoutUndefined(incoming.metadata),
  }

  return {
    ...existing,
    ...incoming,
    transportUrl: incoming.transportUrl || existing.transportUrl,
    manifest: incoming.manifest || existing.manifest,
    flags: hasKeys(flags) ? flags : undefined,
    metadata: hasKeys(metadata) ? metadata : undefined,
    catalogOverrides: incoming.catalogOverrides || existing.catalogOverrides,
    note: incoming.note ?? existing.note,
    syncToLibrary: incoming.syncToLibrary ?? existing.syncToLibrary,
  }
}

export function dedupeAddonsByTransportUrl(addons: AddonDescriptor[]): AddonDescriptor[] {
  const result: AddonDescriptor[] = []
  const indexByUrl = new Map<string, number>()

  for (const addon of addons) {
    const key = getAddonUrlKey(addon.transportUrl)
    if (!key) {
      result.push(addon)
      continue
    }

    const existingIndex = indexByUrl.get(key)
    if (existingIndex === undefined) {
      indexByUrl.set(key, result.length)
      result.push(addon)
      continue
    }

    result[existingIndex] = mergeDuplicateAddon(result[existingIndex], addon)
  }

  return result
}
