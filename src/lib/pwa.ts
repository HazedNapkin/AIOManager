interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<(canInstall: boolean) => void>()

function notify() {
    for (const l of listeners) l(!!deferredPrompt)
}

export function registerServiceWorker() {
    if (!import.meta.env.PROD) return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ })
    })
}

export function initInstallPrompt() {
    if (typeof window === 'undefined') return
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault()
        deferredPrompt = e as BeforeInstallPromptEvent
        notify()
    })
    window.addEventListener('appinstalled', () => {
        deferredPrompt = null
        notify()
    })
}

export function canInstall(): boolean {
    return !!deferredPrompt
}

export function subscribeInstall(listener: (canInstall: boolean) => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

export async function promptInstall(): Promise<boolean> {
    if (!deferredPrompt) return false
    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    deferredPrompt = null
    notify()
    return choice.outcome === 'accepted'
}
