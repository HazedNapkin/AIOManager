import { useId, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Link, Mail, Puzzle, Shield, User, Users, type LucideIcon } from 'lucide-react'
import { PrivacyLevelSlider } from '@/components/ui/privacy-level-slider'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn, maskEmailLevel, maskNameLevel, maskProfileLevel, maskUrlLevel } from '@/lib/utils'

export type PrivacyControlKey =
    | 'privacyLevelNames'
    | 'privacyLevelUrls'
    | 'privacyLevelProfiles'
    | 'privacyLevelEmail'

interface PrivacyControlsProps {
    namesLevel: number
    urlsLevel: number
    profilesLevel: number
    emailLevel: number
    onChange: (key: PrivacyControlKey, value: number) => void
}

// Synthetic values rendered in the preview card only. No store data is read here.
const SAMPLE_ACCOUNT_NAME = "Alex's account"
const SAMPLE_PROFILE_NAME = 'Family setup'
const SAMPLE_EMAIL = 'alex@example.com'
const SAMPLE_ADDON_NAME = 'Personal Config'
const SAMPLE_ADDON_URL = 'https://addons.example.com/personal-config/manifest.json?token=demo'

const LEVEL_LABELS = ['Off', 'Light', 'Strict', 'Hidden'] as const

const LEVEL_LEGEND: ReadonlyArray<{ name: string; description: string }> = [
    { name: 'Off', description: 'shown as entered, no masking' },
    { name: 'Light', description: 'partial masking, keeps some characters' },
    { name: 'Strict', description: 'strong masking, minimal details remain' },
    { name: 'Hidden', description: 'fully replaced with asterisks' },
]

const PRIVACY_FIELDS: ReadonlyArray<{
    key: PrivacyControlKey
    icon: LucideIcon
    title: string
    description: string
}> = [
    { key: 'privacyLevelNames', icon: User, title: 'Account Names', description: 'How account names appear on cards, lists and the account switcher' },
    { key: 'privacyLevelUrls', icon: Link, title: 'Addon URLs', description: 'How addon source URLs appear in detail views' },
    { key: 'privacyLevelProfiles', icon: Users, title: 'Profile Names', description: 'How library profile names appear in the sidebar' },
    { key: 'privacyLevelEmail', icon: Mail, title: 'Email', description: 'How account email addresses appear across the app' },
]

function levelLabel(level: number): string {
    const clamped = Math.max(0, Math.min(Math.round(level), LEVEL_LABELS.length - 1))
    return LEVEL_LABELS[clamped]
}

export function PrivacyControls({ namesLevel, urlsLevel, profilesLevel, emailLevel, onChange }: PrivacyControlsProps) {
    const [showOriginal, setShowOriginal] = useState(false)
    const uid = useId()
    const toggleId = `${uid}-show-original`

    const levels: Record<PrivacyControlKey, number> = {
        privacyLevelNames: namesLevel,
        privacyLevelUrls: urlsLevel,
        privacyLevelProfiles: profilesLevel,
        privacyLevelEmail: emailLevel,
    }

    const shownName = showOriginal ? SAMPLE_ACCOUNT_NAME : maskNameLevel(SAMPLE_ACCOUNT_NAME, namesLevel)
    const shownEmail = showOriginal ? SAMPLE_EMAIL : maskEmailLevel(SAMPLE_EMAIL, emailLevel)
    // count is omitted so Strict hides the name exactly like the library sidebar does
    const shownProfile = showOriginal ? SAMPLE_PROFILE_NAME : maskProfileLevel(SAMPLE_PROFILE_NAME, profilesLevel)
    const shownAddonUrl = showOriginal ? SAMPLE_ADDON_URL : maskUrlLevel(SAMPLE_ADDON_URL, urlsLevel)

    return (
        <div className="mt-2 flex flex-col gap-4 rounded-xl border border-border/30 bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-xs font-medium text-muted-foreground">Granular Privacy Controls</p>
                </div>
                <p className="text-[11px] text-muted-foreground/60">Preview updates live</p>
            </div>

            <div className="grid items-start gap-4 lg:grid-cols-2 lg:gap-5">
                <div className="flex flex-col">
                    {PRIVACY_FIELDS.map((field, index) => {
                        const labelId = `${uid}-${field.key}`
                        const level = levels[field.key]
                        const Icon = field.icon
                        return (
                            <div
                                key={field.key}
                                className={cn('flex flex-col gap-2', index > 0 && 'mt-3 border-t border-border/20 pt-3')}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span id={labelId} className="flex items-center gap-2 text-xs font-medium">
                                        <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                                        {field.title}
                                    </span>
                                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/50">
                                        {levelLabel(level)}
                                    </span>
                                </div>
                                <div role="group" aria-labelledby={labelId}>
                                    <PrivacyLevelSlider value={level} onChange={(v) => onChange(field.key, v)} />
                                </div>
                                <p className="text-[11px] leading-relaxed text-muted-foreground/70">{field.description}</p>
                            </div>
                        )
                    })}
                </div>

                <div className="flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-muted-foreground">Live Preview</p>
                        <span
                            className="rounded-full border border-border/30 bg-muted/30 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                            title="Synthetic sample data, not real account information"
                        >
                            Sample Data
                        </span>
                    </div>

                    <div className="rounded-[1.35rem] border border-border/45 bg-card/80 p-4 shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/35 bg-muted/25">
                                <span className="relative z-10 text-sm font-bold leading-none text-muted-foreground">A</span>
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold tracking-tight" title={shownName}>{shownName}</p>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground" title={shownEmail}>{shownEmail}</p>
                            </div>
                            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                                Active
                            </span>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/30 bg-muted/30 px-2.5 py-0.5 text-[11px] text-muted-foreground">
                                <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
                                <span className="truncate" title={shownProfile}>{shownProfile}</span>
                            </span>
                        </div>

                        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-border/30 bg-muted/20 p-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/40 ring-1 ring-border/25">
                                <Puzzle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium">{SAMPLE_ADDON_NAME}</p>
                                <p className="mt-0.5 break-all font-mono text-[10px] leading-relaxed text-muted-foreground" title={shownAddonUrl}>
                                    {shownAddonUrl}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Switch id={toggleId} checked={showOriginal} onCheckedChange={setShowOriginal} />
                        <Label htmlFor={toggleId} className="cursor-pointer text-xs font-normal text-muted-foreground">
                            Show original sample
                        </Label>
                    </div>

                    <p className="text-[11px] leading-relaxed text-muted-foreground/70" aria-live="polite">
                        Fictional sample only. Showing {showOriginal ? 'the original details' : 'your selected masking levels'}.
                    </p>
                </div>
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-2 rounded-lg border border-border/20 bg-muted/10 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                    <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Levels</span>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        {LEVEL_LEGEND.map((entry) => (
                            <span key={entry.name} className="text-[11px] text-muted-foreground/80">
                                <span className="font-medium text-foreground/75">{entry.name}</span>
                                <span className="mx-1.5 text-muted-foreground/40" aria-hidden="true">&middot;</span>
                                {entry.description}
                            </span>
                        ))}
                    </div>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground/70">
                    Privacy masking only changes what the app displays. It does not disconnect accounts or revoke stored credentials.
                    {' '}<RouterLink to="/kronorium/settings/privacy" className="font-medium text-primary hover:underline">Privacy Mode guide</RouterLink>
                </p>
            </div>
        </div>
    )
}
