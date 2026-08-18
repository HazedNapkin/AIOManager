import type { AddonDescriptor } from '@/types/addon'

const addonSerializeCache = new WeakMap<object, string>()
const addonListFingerprintCache = new WeakMap<object, { elements: unknown[]; fp: string }>()

// Identity-cached fingerprints: valid only while addon objects/arrays are treated as
// immutable. In-place mutation returns a stale fingerprint (documented in the test).
export function fingerprintAddonList(addons: AddonDescriptor[]): string {
    const cached = addonListFingerprintCache.get(addons)
    if (cached && cached.elements.length === addons.length && cached.elements.every((el, i) => el === addons[i])) {
        return cached.fp
    }
    let fp = ''
    for (const el of addons) {
        let s = typeof el === 'object' && el !== null ? addonSerializeCache.get(el) : undefined
        if (s === undefined) {
            s = JSON.stringify(el) ?? 'null'
            if (typeof el === 'object' && el !== null) addonSerializeCache.set(el, s)
        }
        fp += `${s.length}:${s};`
    }
    addonListFingerprintCache.set(addons, { elements: addons, fp })
    return fp
}
