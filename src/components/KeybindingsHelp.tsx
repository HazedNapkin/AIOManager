import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Command } from 'lucide-react'

interface KeybindingsHelpProps {
    isOpen: boolean
    onClose: () => void
}

export function KeybindingsHelp({ isOpen, onClose }: KeybindingsHelpProps) {
    const shortcuts = [
        { key: '?', description: 'Show this help menu', group: 'General' },
        { key: 'Ctrl/⌘ K', description: 'Open command palette', group: 'General' },
        { key: 'g a', description: 'Go to Accounts', group: 'Navigation' },
        { key: 'g s', description: 'Go to Saved Addons', group: 'Navigation' },
        { key: 'g h', description: 'Go to Activity', group: 'Navigation' },
        { key: 'g m', description: 'Go to Metrics', group: 'Navigation' },
        { key: 'g n', description: 'Go to Notes', group: 'Navigation' },
        { key: 'g p', description: 'Go to Settings', group: 'Navigation' },
        { key: 'g v', description: 'Go to Key Vault', group: 'Navigation' },
        { key: 'g f', description: 'Go to Kronorium docs', group: 'Navigation' },
        { key: 'g r', description: 'Go to Replay', group: 'Navigation' },
        { key: 'S', description: 'Save selected addons to library', group: 'Actions' },
        { key: 'Ctrl+A', description: 'Select all addons', group: 'Actions' },
        { key: 'Esc', description: 'Exit selection / close dialog', group: 'Actions' },
        { key: 'Ctrl+N', description: 'New note (on Notes page)', group: 'Actions' },
        { key: 'Ctrl+B', description: 'Bold text (in note editor)', group: 'Actions' },
        { key: 'Ctrl+I', description: 'Italic text (in note editor)', group: 'Actions' },
    ]

    const general = shortcuts.filter(s => s.group === 'General')
    const navigation = shortcuts.filter(s => s.group === 'Navigation')
    const actions = shortcuts.filter(s => s.group === 'Actions')

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[425px] bg-background/95 backdrop-blur-md border-primary/20">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Command className="h-5 w-5 text-primary" />
                        Keyboard Shortcuts
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-6 py-4">
                    <div className="space-y-4">
                        <h4 className="text-xs font-bold text-muted-foreground uppercase">General</h4>
                        <div className="space-y-2">
                            {general.map((s) => (
                                <div key={s.key} className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">{s.description}</span>
                                    <div className="flex gap-1">
                                        {s.key.split(' ').map((k) => (
                                            <kbd key={k} className="px-2 py-1 bg-muted rounded border border-border/40 text-xs font-mono">{k}</kbd>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h4 className="text-xs font-bold text-muted-foreground uppercase">Navigation</h4>
                        <div className="space-y-3">
                            {navigation.map((s) => (
                                <div key={s.key} className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">{s.description}</span>
                                    <div className="flex gap-1">
                                        {s.key.split(' ').map((k) => (
                                            <kbd key={k} className="px-2 py-1 bg-muted rounded border border-border/40 text-xs font-mono">{k}</kbd>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h4 className="text-xs font-bold text-muted-foreground uppercase">Actions</h4>
                        <div className="space-y-3">
                            {actions.map((s) => (
                                <div key={s.key} className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">{s.description}</span>
                                    <div className="flex gap-1">
                                        {s.key.split('+').map((k, i, arr) => (
                                            <kbd key={i} className="px-2 py-1 bg-muted rounded border border-border/40 text-xs font-mono">{k}{i < arr.length - 1 ? ' +' : ''}</kbd>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
