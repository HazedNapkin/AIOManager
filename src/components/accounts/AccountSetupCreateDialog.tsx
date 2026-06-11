import { useState, useEffect, type KeyboardEvent } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface AccountSetupCreateDialogProps {
  isOpen: boolean
  onClose: () => void
  accountName: string
  onConfirm: (name: string, clone: boolean) => void
}

export function AccountSetupCreateDialog({
  isOpen,
  onClose,
  accountName,
  onConfirm,
}: AccountSetupCreateDialogProps) {
  const [name, setName] = useState('New Setup')
  const [clone, setClone] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setName('New Setup')
      setClone(false)
    }
  }, [isOpen])

  const handleConfirm = () => {
    if (name.trim()) {
      onConfirm(name.trim(), clone)
      onClose()
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleConfirm()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-[460px]"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>Create Setup</DialogTitle>
          <DialogDescription>
            Setups keep separate add-ons and Autopilot rules inside {accountName}. Use them for different people, rooms, testing, or alternate configurations.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Setup name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Kids, Guests, Testing"
              autoFocus
            />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-xl border border-border/45 bg-muted/25 p-3">
            <div className="space-y-1">
              <Label htmlFor="clone" className="text-sm font-semibold">
                Clone current setup
              </Label>
              <p className="text-xs leading-snug text-muted-foreground">
                Copy this setup's add-ons and Autopilot rules into the new setup. Turn it off to start empty.
              </p>
            </div>
            <div className="pt-0.5">
              <Switch
                id="clone"
                checked={clone}
                onCheckedChange={setClone}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!name.trim()}>
            Create Setup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
