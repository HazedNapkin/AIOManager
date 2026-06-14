import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUIStore } from '@/store/uiStore'
import { useAccountStore } from '@/store/accountStore'
import { ClipboardPaste, Zap } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

export function AddonInstaller() {
  const isOpen = useUIStore((state) => state.isAddAddonDialogOpen)
  const closeDialog = useUIStore((state) => state.closeAddAddonDialog)
  const selectedAccountId = useUIStore((state) => state.selectedAccountId)
  const installAddon = useAccountStore((state) => state.installAddonToAccount)
  const loading = useAccountStore((state) => state.loadingAccounts.size > 0)

  const [addonUrl, setAddonUrl] = useState('')
  const [error, setError] = useState('')
  const [isClipboardScanActive, setIsClipboardScanActive] = useState(false)
  const { isLight } = useTheme()

  useEffect(() => {
    if (!isOpen) {
      setIsClipboardScanActive(false)
      return
    }

    const checkClipboard = async () => {
      try {
        if (!navigator.clipboard) return
        const text = await navigator.clipboard.readText()
        if (text && (text.startsWith('stremio://') || (text.includes('/manifest.json') && text.startsWith('http')))) {
          setAddonUrl(text)
          setIsClipboardScanActive(true)
          // Hide hint after 3 seconds
          setTimeout(() => setIsClipboardScanActive(false), 3000)
        }
      } catch (err) {
        // Silently swallow NotAllowedError/privacy blocks
      }
    }

    window.addEventListener('focus', checkClipboard)
    checkClipboard() // Initial check when opened

    return () => window.removeEventListener('focus', checkClipboard)
  }, [isOpen])

  const handleClose = () => {
    setAddonUrl('')
    setError('')
    closeDialog()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!selectedAccountId) {
      setError('No account selected')
      return
    }

    if (!addonUrl.trim()) {
      setError('Addon URL is required')
      return
    }

    const normalizedUrl = addonUrl.trim().replace(/^stremio:\/\//, 'https://')

    try {
      // Validate URL format
      new URL(normalizedUrl)

      await installAddon(selectedAccountId, normalizedUrl)
      handleClose()
    } catch (err) {
      if (err instanceof TypeError) {
        setError('Invalid URL format')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to install addon')
      }
    }
  }

  const handlePaste = async () => {
    try {
      if (!navigator.clipboard) return
      const text = await navigator.clipboard.readText()
      if (text) {
        setAddonUrl(text)
      }
    } catch (err) {
      import.meta.env.DEV && console.error('Failed to read clipboard:', err)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install Addon</DialogTitle>
          <DialogDescription>
            Enter the addon URL to install it to the selected account
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="addonUrl">Addon URL</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1.5 px-2 text-xs"
                onClick={handlePaste}
              >
                <ClipboardPaste className="h-3 w-3" />
                Paste
              </Button>
            </div>
            <Input
              id="addonUrl"
              type="text"
              value={addonUrl}
              onChange={(e) => setAddonUrl(e.target.value)}
              placeholder="https://example.com/addon/manifest.json"
              required
              autoFocus
              className={isClipboardScanActive ? `ring-2 ${isLight ? 'ring-primary/50' : 'ring-primary/25'}` : ""}
            />
            {isClipboardScanActive && (
              <div className="flex items-center gap-1.5 text-xs text-primary font-semibold uppercase animate-in fade-in slide-in-from-top-1">
                <Zap className="h-3 w-3" />
                URL DETECTED FROM CLIPBOARD
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              The URL should point to the addon's base URL (e.g., https://addon.example.com)
            </p>
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="subtle" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Installing...' : 'Install Addon'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
