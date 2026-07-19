import type { AddonDescriptor } from '../types/addon'
import { normalizeAddonUrl } from './addon-url.ts'

export type CloneMode = 'addons-only' | 'addons-settings' | 'full-mirror'

export interface CloneOptions {
  mode: CloneMode
  overwrite?: boolean
}

export function getDefaultCloneOptions(): CloneOptions {
  return {
    mode: 'full-mirror',
    overwrite: false
  }
}

function getAddonUrlKey(url: string): string {
  return normalizeAddonUrl(url)
}

export function cloneAddonsWithMode(
  sourceAddons: AddonDescriptor[],
  targetAddons: AddonDescriptor[],
  options: CloneOptions
): AddonDescriptor[] {
  const { mode, overwrite = false } = options

  let result: AddonDescriptor[] = []

  if (overwrite) {
    result = []
  } else {
    result = [...targetAddons]
  }

  const existingUrls = new Set(result.map(a => getAddonUrlKey(a.transportUrl)))

  for (const sourceAddon of sourceAddons) {
    const sourceUrlKey = getAddonUrlKey(sourceAddon.transportUrl)
    if (!existingUrls.has(sourceUrlKey)) {
      if (mode !== 'full-mirror' && !sourceAddon.manifest) continue

      let clonedAddon: AddonDescriptor

      if (mode === 'addons-only') {
        clonedAddon = {
          transportUrl: sourceAddon.transportUrl,
          manifest: { ...sourceAddon.manifest },
          flags: {
            enabled: true,
            protected: false
          }
        }
      } else if (mode === 'addons-settings') {
        const metadata = sourceAddon.metadata?.hideConfigure !== undefined
          ? { hideConfigure: sourceAddon.metadata.hideConfigure }
          : undefined

        clonedAddon = {
          transportUrl: sourceAddon.transportUrl,
          manifest: { ...sourceAddon.manifest },
          flags: {
            enabled: sourceAddon.flags?.enabled ?? true,
            protected: sourceAddon.flags?.protected ?? false,
            ...(sourceAddon.flags?.official ? { official: true } : {}),
          },
          metadata
        }
      } else {
        clonedAddon = {
          ...sourceAddon,
          transportUrl: sourceAddon.transportUrl,
          manifest: sourceAddon.manifest ? { ...sourceAddon.manifest } : { id: '', name: '', version: '', description: '' },
          flags: {
            ...sourceAddon.flags,
            enabled: sourceAddon.flags?.enabled ?? true,
            protected: sourceAddon.flags?.protected ?? false
          },
          metadata: sourceAddon.metadata ? { ...sourceAddon.metadata } : undefined,
          catalogOverrides: sourceAddon.catalogOverrides ? { ...sourceAddon.catalogOverrides } : undefined,
          note: sourceAddon.note,
          syncToLibrary: sourceAddon.syncToLibrary
        }
      }

      result.push(clonedAddon)
      existingUrls.add(sourceUrlKey)
    }
  }

  return result
}