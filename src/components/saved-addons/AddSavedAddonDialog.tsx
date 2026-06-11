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
import { TagInput } from '@/components/ui/tag-input'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'

interface AddSavedAddonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  addUrl: string
  setAddUrl: (value: string) => void
  addName: string
  setAddName: (value: string) => void
  addTags: string[]
  setAddTags: (value: string[]) => void
  allTags: string[]
  addError: string | null
  adding: boolean
  onAdd: () => void
}

export function AddSavedAddonDialog({
  open,
  onOpenChange,
  addUrl,
  setAddUrl,
  addName,
  setAddName,
  addTags,
  setAddTags,
  allTags,
  addError,
  adding,
  onAdd,
}: AddSavedAddonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Addon by URL</DialogTitle>
          <DialogDescription>
            Enter an addon URL to add it to your library. It will be added to the currently selected profile.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="addon-url">Addon URL(s) *</Label>
            <Textarea
              id="addon-url"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              placeholder="Paste one or more manifest URLs (one per line)"
              className="min-h-[120px] bg-muted/30 border-border"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="addon-name">Name (optional)</Label>
            <Input
              id="addon-name"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="Leave blank to use addon's name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="addon-tags">Tags</Label>
            <TagInput
              value={addTags}
              onChange={setAddTags}
              placeholder="Add tags... (e.g. Movies, Series)"
              suggestions={allTags}
            />
          </div>

          {addError && (
            <p className="text-sm text-destructive">{addError}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="subtle" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onAdd} disabled={adding}>
            {adding && <Loader2 className="h-4 w-4 animate-spin" />}
            Add Addon
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
