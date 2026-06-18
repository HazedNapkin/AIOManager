import { StateStorage, createJSONStorage } from 'zustand/middleware'

const safeLocalStorage: StateStorage = {
    getItem: (name: string): string | null => {
        try {
            const value = localStorage.getItem(name)
            if (value && (value.includes('[object Object]') || value === '[object Object]')) {
                console.warn(`[SafeStorage] Corrupted key detected: ${name}. Attempting recovery.`)

                const backupKey = `${name}:last-good`
                const backup = localStorage.getItem(backupKey)
                if (backup && !backup.includes('[object Object]') && backup !== '[object Object]') {
                    console.warn(`[SafeStorage] Recovered ${name} from backup`)
                    localStorage.setItem(name, backup)
                    return backup
                }

                if (import.meta.env.DEV) console.error(`[SafeStorage] No backup for ${name}. Wiping corrupted key.`)
                localStorage.removeItem(name)
                return null
            }

            if (value && name === 'stremio-manager-sync') {
                try {
                    const parsed = JSON.parse(value)
                    if (parsed && parsed.state && parsed.state.auth && parsed.state.auth.isAuthenticated) {
                        localStorage.setItem(`${name}:last-good`, value)
                    }
                } catch {
                    console.warn(`[SafeStorage] Stored data for ${name} is not valid JSON. Wiping corrupted key.`)
                    localStorage.removeItem(name)
                    localStorage.removeItem(`${name}:last-good`)
                    return null
                }
            }

            try {
                if (value) JSON.parse(value)
            } catch {
                if (value && !value.startsWith('{')) {
                    console.warn(`[SafeStorage] Stored data for ${name} diverged from expected format. Resetting.`)
                    localStorage.removeItem(name)
                    return null
                }
            }

            return value
        } catch (e) {
            if (import.meta.env.DEV) console.error(`[SafeStorage] Failed to read ${name}`, e)
            return null
        }
    },
    setItem: (name: string, value: string): void => {
        if (value.includes('[object Object]')) {
            console.warn(`[SafeStorage] Prevented writing corrupted data to ${name}`)
            return
        }
        try {
            localStorage.setItem(name, value)
        } catch (e) {
            console.warn(`[SafeStorage] Failed to write ${name} (private/incognito mode?)`, e)
        }
    },
    removeItem: (name: string): void => {
        try {
            localStorage.removeItem(name)
        } catch {}
    }
}

export const createSafeStorage = () => createJSONStorage(() => safeLocalStorage)
