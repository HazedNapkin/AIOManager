import { useNavigate, useLocation } from 'react-router-dom'
import { Monitor, ArrowLeft } from 'lucide-react'
import { CustomThemeEditor } from '@/components/settings/CustomThemeEditor'
import type { CustomThemeData } from '@/contexts/ThemeContext'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { Button } from '@/components/ui/button'

export function ThemeEditorPage() {
    useDocumentTitle('Theme Editor')
    const navigate = useNavigate()
    const { state } = useLocation()
    const editingTheme = (state as { editingTheme?: CustomThemeData } | null)?.editingTheme ?? null

    return (
        <>
            <div className="hidden lg:block">
                <CustomThemeEditor
                    editingTheme={editingTheme}
                    onClose={() => navigate('/settings#appearance')}
                />
            </div>
            <div className="lg:hidden flex flex-col items-center justify-center min-h-[60vh] gap-4 p-8 text-center">
                <Monitor className="w-12 h-12 text-muted-foreground/60" />
                <div className="space-y-1">
                    <p className="text-muted-foreground text-sm max-w-xs">
                        Theme editing requires a larger screen.
                    </p>
                    <p className="text-muted-foreground/60 text-xs max-w-xs">
                        You can still pick from 50+ built-in themes on mobile.
                    </p>
                </div>
                <Button size="sm" onClick={() => navigate('/settings#appearance')} className="gap-1.5 h-8">
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Pick a Built-in Theme
                </Button>
            </div>
        </>
    )
}
