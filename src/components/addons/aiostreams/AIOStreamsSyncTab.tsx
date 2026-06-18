import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/status-chip'
import { Progress } from '@/components/ui/progress'
import { CopyButton } from '@/components/ui/copy-button'
import { useToast } from '@/hooks/use-toast'
import {
    fetchAIOStreamsUser,
    updateAIOStreamsUser,
    createAIOStreamsUser,
    saveAIOStreamsPassword,
    fetchAIOStreamsStatus,
    getStoredAIOStreamsPassword,
    getSectionSummary,
    AIOSTREAMS_RUNTIME_CONFIG_KEYS,
    AIOSTREAMS_TARGET_LOCAL_CONFIG_KEYS,
    AIOSTREAMS_PARENT_CONFIG_KEYS,
    sanitizeAIOStreamsConfigForCreate,
    sanitizeAIOStreamsConfigForUpdate,
} from '@/lib/aiostreams-utils'
import { SectionPreview } from './SectionPreview'
import { cn } from '@/lib/utils'
import { mapConcurrent } from '@/lib/concurrency'
import { useAccountStore } from '@/store/accountStore'
import { EmptyState } from '@/components/common/EmptyState'
import { AddonIcon } from '@/components/ui/addon-icon'
import { useNavigate } from 'react-router-dom'
import {
    Loader2, ArrowRightLeft, Eye, EyeOff,
    Zap, ArrowUpDown, FolderOpen, Tv, Layers, Shield, Bookmark, Image, BarChart3,
    RotateCw, Search, CheckCircle2, AlertTriangle, XCircle, ListChecks,
    ClipboardCheck, UserPlus, Users,
} from 'lucide-react'

const SECTION_ICONS: Record<string, React.ReactNode> = {
    formatter: <Zap className="w-3.5 h-3.5" />,
    sortCriteria: <ArrowUpDown className="w-3.5 h-3.5" />,
    groups: <FolderOpen className="w-3.5 h-3.5" />,
    services: <Tv className="w-3.5 h-3.5" />,
    deduplicator: <Layers className="w-3.5 h-3.5" />,
    filters: <ListChecks className="w-3.5 h-3.5" />,
    proxy: <Shield className="w-3.5 h-3.5" />,
    presets: <Bookmark className="w-3.5 h-3.5" />,
    metadata: <Image className="w-3.5 h-3.5" />,
    statistics: <BarChart3 className="w-3.5 h-3.5" />,
    playback: <RotateCw className="w-3.5 h-3.5" />,
    branding: <Image className="w-3.5 h-3.5" />,
}

export interface TargetOption {
    accountId: string
    accountName: string
    addonName: string
    transportUrl: string
    baseUrl: string
    uuid: string
    logo?: string
}

interface SyncResult {
    target: TargetOption
    status: 'changed' | 'skipped' | 'failed'
    error?: string
    changedSections?: string[]
    preserved?: string[]
    rollbackConfig?: Record<string, unknown>
    restored?: boolean
}

interface DiffEntry {
    section: string
    sourceSummary: string
    targetSummary: string
    changed: boolean
}

interface TargetPreview {
    target: TargetOption
    entries: DiffEntry[]
    changedSections: string[]
    preserved: string[]
    targetConfig?: Record<string, unknown>
    plannedConfig?: Record<string, unknown>
    error?: string
}

export interface MissingTargetAccount {
    accountId: string
    accountName: string
}

interface CreateTargetResult {
    accountId: string
    accountName: string
    status: 'created' | 'failed'
    uuid?: string
    installUrl?: string
    error?: string
}

type SyncPhase = 'select' | 'preview' | 'syncing' | 'results'

interface SyncReceipt {
    timestamp: string
    sourceName: string
    sourceAccountName: string
    sourceBaseUrl: string
    mode: SyncMode
    selectedSections: string[]
    targetCount: number
    updatedCount: number
    skippedCount: number
    failedCount: number
    preserved: string[]
}

interface AIOStreamsSyncTabProps {
    sourceConfig: Record<string, unknown>
    targetOptions: TargetOption[]
    sourceName: string
    sourceAccountName: string
    sourceBaseUrl: string
    sourceUuid: string
    missingAccountCount?: number
    missingAccounts?: MissingTargetAccount[]
    sameUserAccounts?: MissingTargetAccount[]
}

type SyncMode = 'full' | 'sections'

const AIOSTREAMS_SYNC_CONCURRENCY = 2
const PREVIEW_STALE_MS = 5 * 60 * 1000

const BRANDING_KEYS = [
    'addonName',
    'addonLogo',
    'addonBackground',
    'addonDescription',
]

const FILTER_CONFIG_KEYS = [
    'excludedResolutions', 'includedResolutions', 'requiredResolutions', 'preferredResolutions',
    'excludedQualities', 'includedQualities', 'requiredQualities', 'preferredQualities',
    'excludedLanguages', 'includedLanguages', 'requiredLanguages', 'preferredLanguages',
    'excludedSubtitles', 'includedSubtitles', 'requiredSubtitles', 'preferredSubtitles',
    'excludedVisualTags', 'includedVisualTags', 'requiredVisualTags', 'preferredVisualTags',
    'excludedAudioTags', 'includedAudioTags', 'requiredAudioTags', 'preferredAudioTags',
    'excludedAudioChannels', 'includedAudioChannels', 'requiredAudioChannels', 'preferredAudioChannels',
    'excludedStreamTypes', 'includedStreamTypes', 'requiredStreamTypes', 'preferredStreamTypes',
    'excludedEncodes', 'includedEncodes', 'requiredEncodes', 'preferredEncodes',
    'excludedRegexPatterns', 'includedRegexPatterns', 'requiredRegexPatterns', 'preferredRegexPatterns',
    'rankedRegexPatterns', 'regexOverrides', 'selOverrides',
    'syncedPreferredRegexUrls', 'syncedExcludedRegexUrls', 'syncedIncludedRegexUrls', 'syncedRequiredRegexUrls', 'syncedRankedRegexUrls',
    'syncedPreferredStreamExpressionUrls', 'syncedExcludedStreamExpressionUrls', 'syncedIncludedStreamExpressionUrls', 'syncedRequiredStreamExpressionUrls', 'syncedRankedStreamExpressionUrls',
    'excludedStreamExpressions', 'includedStreamExpressions', 'requiredStreamExpressions', 'preferredStreamExpressions', 'rankedStreamExpressions',
    'excludedKeywords', 'includedKeywords', 'requiredKeywords', 'preferredKeywords',
    'excludedReleaseGroups', 'includedReleaseGroups', 'requiredReleaseGroups', 'preferredReleaseGroups',
    'enableSeadex', 'excludeSeasonPacks',
    'excludeCached', 'excludeCachedFromAddons', 'excludeCachedFromServices', 'excludeCachedFromStreamTypes', 'excludeCachedMode',
    'excludeUncached', 'excludeUncachedFromAddons', 'excludeUncachedFromServices', 'excludeUncachedFromStreamTypes', 'excludeUncachedMode',
    'excludeSeederRange', 'includeSeederRange', 'requiredSeederRange', 'seederRangeTypes',
    'excludeAgeRange', 'includeAgeRange', 'requiredAgeRange', 'ageRangeTypes',
    'digitalReleaseFilter', 'size', 'bitrate', 'titleMatching', 'yearMatching', 'seasonEpisodeMatching',
]

const METADATA_CONFIG_KEYS = [
    'tmdbApiKey', 'tmdbAccessToken', 'tvdbApiKey',
    'rpdbApiKey', 'topPosterApiKey', 'aioratingsApiKey', 'aioratingsProfileId',
    'openposterdbApiKey', 'openposterdbUrl', 'posterService',
    'usePosterRedirectApi', 'usePosterServiceForMeta',
]

const PLAYBACK_CONFIG_KEYS = [
    'autoPlay', 'areYouStillThere', 'statistics', 'dynamicAddonFetching',
    'nzbFailover', 'serviceWrap', 'cacheAndPlay', 'preloadStreams',
    'precacheNextEpisode', 'alwaysPrecache', 'precacheCondition', 'precacheSelector', 'precacheSingleStream',
    'hideErrors', 'hideErrorsForResources',
    'externalDownloads', 'autoRemoveDownloads', 'checkOwned', 'showChanges',
    'randomiseResults', 'enhanceResults', 'enhancePosters',
]

const ADDON_CONFIG_KEYS = [
    'presets',
    'addonCategoryColors',
    'catalogModifications',
    'mergedCatalogs',
]

interface SyncGroupDefinition {
    key: string
    label: string
    description: string
    fields: string[]
}

const SYNC_GROUPS: SyncGroupDefinition[] = [
    { key: 'services', label: 'Services', description: 'Debrid services and their API credentials', fields: ['services'] },
    { key: 'presets', label: 'Addons', description: 'Configured addons, catalogs, and marketplace presets', fields: ADDON_CONFIG_KEYS },
    { key: 'groups', label: 'Groups', description: 'Addon grouping and fetch behavior', fields: ['groups'] },
    { key: 'filters', label: 'Filters', description: 'Resolution, quality, language, cache, size, release, and matching filters', fields: FILTER_CONFIG_KEYS },
    { key: 'sortCriteria', label: 'Sorting', description: 'Sort order, result limits, and deduplication behavior', fields: ['sortCriteria', 'deduplicator', 'resultLimits'] },
    { key: 'formatter', label: 'Custom Formatter', description: 'Stream title formatting', fields: ['formatter'] },
    { key: 'metadata', label: 'Metadata & Posters', description: 'Poster services plus metadata and poster API keys', fields: METADATA_CONFIG_KEYS },
    { key: 'proxy', label: 'Proxy', description: 'Stream proxy settings', fields: ['proxy'] },
    { key: 'playback', label: 'Playback & extras', description: 'Autoplay, precache, download, error, and enhancement options', fields: PLAYBACK_CONFIG_KEYS },
]

const PREVIEW_ONLY_SYNC_GROUPS: SyncGroupDefinition[] = [
    { key: 'branding', label: 'Branding', description: 'Addon name, logo, background, and description', fields: BRANDING_KEYS },
]

const ALL_SYNC_GROUPS = [...SYNC_GROUPS, ...PREVIEW_ONLY_SYNC_GROUPS]

function cloneConfig(config: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(config))
}

function cloneConfigValue(value: unknown): unknown {
    return cloneConfig({ value }).value
}

function stableStringify(value: unknown): string {
    const normalize = (input: unknown, ancestors = new WeakSet<object>()): unknown => {
        if (input === undefined) return undefined
        if (input === null || typeof input !== 'object') return input
        const objectInput = input as object
        if (ancestors.has(objectInput)) return '[Circular]'
        ancestors.add(objectInput)
        try {
            if (Array.isArray(input)) {
                return input.map((item) => normalize(item, ancestors)).filter((item) => item !== undefined)
            }
            return Object.keys(input as Record<string, unknown>)
                .sort()
                .reduce<Record<string, unknown>>((acc, key) => {
                    const next = normalize((input as Record<string, unknown>)[key], ancestors)
                    if (next !== undefined) acc[key] = next
                    return acc
                }, {})
        } finally {
            ancestors.delete(objectInput)
        }
    }

    return JSON.stringify(normalize(value))
}

function hasConfigChanged(before: unknown, after: unknown): boolean {
    return stableStringify(before) !== stableStringify(after)
}

function withoutKeys(config: Record<string, unknown>, keys: string[]): Record<string, unknown> {
    const next = { ...config }
    for (const key of keys) delete next[key]
    return next
}

function stripParentConfig(config: Record<string, unknown>) {
    for (const key of AIOSTREAMS_PARENT_CONFIG_KEYS) delete config[key]
}

function stripSystemConfig(config: Record<string, unknown>) {
    for (const key of AIOSTREAMS_RUNTIME_CONFIG_KEYS) delete config[key]
}

function getComparableTargetConfig(config: Record<string, unknown>): Record<string, unknown> {
    const next = cloneConfig(config)
    stripSystemConfig(next)
    stripParentConfig(next)
    return next
}

function getSyncGroupDefinition(key: string): SyncGroupDefinition | undefined {
    return ALL_SYNC_GROUPS.find(group => group.key === key)
}

function getSyncGroupFields(key: string): string[] {
    return getSyncGroupDefinition(key)?.fields ?? [key]
}

function copyConfigFields(
    nextConfig: Record<string, unknown>,
    sourceConfig: Record<string, unknown>,
    fields: string[]
) {
    for (const key of fields) {
        if (sourceConfig[key] !== undefined) {
            nextConfig[key] = cloneConfigValue(sourceConfig[key])
        } else {
            delete nextConfig[key]
        }
    }
}

function preserveKeys(
    nextConfig: Record<string, unknown>,
    targetConfig: Record<string, unknown>,
    keys: string[]
) {
    for (const key of keys) {
        if (targetConfig[key] !== undefined) {
            nextConfig[key] = targetConfig[key]
        } else {
            delete nextConfig[key]
        }
    }
}

function getSyncGroupData(config: Record<string, unknown>, key: string): unknown {
    const fields = getSyncGroupFields(key)
    if (fields.length === 1) return config[fields[0]]

    const data: Record<string, unknown> = {}
    for (const field of fields) {
        if (config[field] !== undefined) data[field] = config[field]
    }
    return Object.keys(data).length > 0 ? data : undefined
}

function hasSyncGroupData(config: Record<string, unknown>, key: string): boolean {
    return getSyncGroupFields(key).some(field => config[field] !== undefined && config[field] !== null)
}

function getSyncGroupSummary(config: Record<string, unknown>, key: string): string {
    const group = getSyncGroupDefinition(key)
    if (!group) return getSectionSummary(key, config[key])

    if (group.fields.length === 1) {
        return getSectionSummary(group.fields[0], config[group.fields[0]])
    }

    const configured = group.fields.filter(field => config[field] !== undefined && config[field] !== null)
    if (configured.length === 0) return 'Not configured'

    if (key === 'filters') {
        return `${configured.length} filter setting${configured.length !== 1 ? 's' : ''}`
    }
    if (key === 'metadata') {
        const apiKeyCount = configured.filter(field => /apiKey|accessToken|profileId/i.test(field)).length
        const poster = typeof config.posterService === 'string' ? config.posterService : undefined
        return [
            poster ? `Poster: ${formatPreviewSection(poster)}` : null,
            apiKeyCount > 0 ? `${apiKeyCount} API key${apiKeyCount !== 1 ? 's' : ''}` : null,
        ].filter(Boolean).join(', ') || `${configured.length} setting${configured.length !== 1 ? 's' : ''}`
    }
    if (key === 'presets') {
        return getSectionSummary('presets', config.presets)
    }
    if (key === 'sortCriteria') {
        return getSectionSummary('sortCriteria', config.sortCriteria)
    }
    if (key === 'playback') {
        return `${configured.length} option${configured.length !== 1 ? 's' : ''}`
    }
    if (key === 'branding') {
        return typeof config.addonName === 'string' ? config.addonName : `${configured.length} branding field${configured.length !== 1 ? 's' : ''}`
    }

    return `${configured.length} setting${configured.length !== 1 ? 's' : ''}`
}

function buildNewTargetConfig(
    sourceConfig: Record<string, unknown>,
    syncMode: SyncMode,
    selectedSections: Set<string>,
    copyBranding: boolean
): Record<string, unknown> {
    const nextConfig: Record<string, unknown> = syncMode === 'full' ? cloneConfig(sourceConfig) : {}
    if (syncMode === 'sections') {
        for (const key of selectedSections) {
            copyConfigFields(nextConfig, sourceConfig, getSyncGroupFields(key))
        }
    }
    if (copyBranding) copyConfigFields(nextConfig, sourceConfig, BRANDING_KEYS)
    else for (const key of BRANDING_KEYS) delete nextConfig[key]
    stripParentConfig(nextConfig)
    return sanitizeAIOStreamsConfigForCreate(nextConfig)
}

function getUnchangedLabels(
    syncMode: SyncMode,
    copyBranding: boolean
): string[] {
    const labels = ['target identity and install state']
    if (syncMode === 'sections') {
        labels.push('unselected settings groups')
    }
    if (!copyBranding) labels.push('target branding')
    return labels
}

function buildTargetConfig(
    sourceConfig: Record<string, unknown>,
    targetConfig: Record<string, unknown>,
    syncMode: SyncMode,
    selectedSections: Set<string>,
    copyBranding: boolean
): Record<string, unknown> {
    const nextConfig = syncMode === 'full'
        ? cloneConfig(sourceConfig)
        : cloneConfig(targetConfig)

    if (syncMode === 'sections') {
        for (const key of selectedSections) {
            copyConfigFields(nextConfig, sourceConfig, getSyncGroupFields(key))
        }
    }

    stripParentConfig(nextConfig)
    stripSystemConfig(nextConfig)
    preserveKeys(nextConfig, targetConfig, AIOSTREAMS_TARGET_LOCAL_CONFIG_KEYS)

    if (copyBranding) copyConfigFields(nextConfig, sourceConfig, BRANDING_KEYS)
    else preserveKeys(nextConfig, targetConfig, BRANDING_KEYS)

    return nextConfig
}

function getPreviewKeys(syncMode: SyncMode, selectedSections: Set<string>, copyBranding: boolean): string[] {
    const keys = syncMode === 'sections'
        ? Array.from(selectedSections)
        : SYNC_GROUPS.map(section => section.key)
    if (copyBranding) keys.push('branding')
    return keys
}

function getPreviewFieldKeys(previewKeys: string[]): string[] {
    return Array.from(new Set(previewKeys.flatMap(key => getSyncGroupFields(key))))
}

export function AIOStreamsSyncTab({
    sourceConfig,
    targetOptions,
    sourceName,
    sourceAccountName,
    sourceBaseUrl,
    sourceUuid,
    missingAccountCount = 0,
    missingAccounts = [],
    sameUserAccounts = [],
}: AIOStreamsSyncTabProps) {
    const { toast } = useToast()
    const navigate = useNavigate()
    const installAddonToAccount = useAccountStore(s => s.installAddonToAccount)
    const [syncMode, setSyncMode] = useState<SyncMode>('full')
    const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set())
    const [selectedTargets, setSelectedTargets] = useState<Map<string, string>>(new Map())
    const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({})
    const [syncing, setSyncing] = useState(false)
    const [progress, setProgress] = useState({ current: 0, total: 0 })
    const [results, setResults] = useState<SyncResult[]>([])
    const [phase, setPhase] = useState<SyncPhase>('select')
    const [previews, setPreviews] = useState<Map<string, TargetPreview>>(new Map())
    const [previewCreatedAt, setPreviewCreatedAt] = useState<number | null>(null)
    const [loadingDiffs, setLoadingDiffs] = useState(false)
    const [copyBranding, setCopyBranding] = useState(false)
    const [targetQuery, setTargetQuery] = useState('')
    const [receipt, setReceipt] = useState<SyncReceipt | null>(null)
    const [createTargetAccountIds, setCreateTargetAccountIds] = useState<Set<string>>(new Set())
    const [createTargetPassword, setCreateTargetPassword] = useState('')
    const [showCreateTargetPassword, setShowCreateTargetPassword] = useState(false)
    const [creatingTargets, setCreatingTargets] = useState(false)
    const [createTargetResults, setCreateTargetResults] = useState<CreateTargetResult[]>([])
    const [restoringTargetUrls, setRestoringTargetUrls] = useState<Set<string>>(new Set())
    const syncInFlightRef = useRef(false)
    const sourceLocationRef = useRef(`${window.location.pathname}${window.location.search}${window.location.hash}`)

    useEffect(() => {
        const validTargetUrls = new Set(targetOptions.map(target => target.transportUrl))
        setSelectedTargets(prev => {
            const next = new Map(Array.from(prev.entries()).filter(([url]) => validTargetUrls.has(url)))
            return next.size === prev.size ? prev : next
        })
    }, [targetOptions])

    useEffect(() => {
        const validAccountIds = new Set(missingAccounts.map(account => account.accountId))
        setCreateTargetAccountIds(prev => {
            const next = new Set(Array.from(prev).filter(accountId => validAccountIds.has(accountId)))
            return next.size === prev.size ? prev : next
        })
    }, [missingAccounts])

    const targetStats = useMemo(() => {
        const instanceCount = new Set(targetOptions.map(t => t.baseUrl)).size
        const savedPasswordCount = targetOptions.filter(t => getStoredAIOStreamsPassword(t.baseUrl, t.uuid)).length
        const sameInstanceCount = targetOptions.filter(t => t.baseUrl === sourceBaseUrl).length
        return {
            total: targetOptions.length,
            instanceCount,
            savedPasswordCount,
            passwordNeededCount: targetOptions.length - savedPasswordCount,
            sameInstanceCount,
            crossInstanceCount: targetOptions.length - sameInstanceCount,
        }
    }, [targetOptions, sourceBaseUrl])

    const filteredTargets = useMemo(() => {
        const query = targetQuery.trim().toLowerCase()
        return targetOptions.filter((target) => {
            const searchable = [
                target.addonName,
                target.accountName,
                target.baseUrl,
                target.uuid,
                formatHost(target.baseUrl),
            ].join(' ').toLowerCase()

            if (query && !searchable.includes(query)) return false
            return true
        })
    }, [targetOptions, targetQuery])

    const groupedTargets = useMemo(() => {
        const groups = new Map<string, TargetOption[]>()
        filteredTargets.forEach((target) => {
            const key = target.baseUrl
            groups.set(key, [...(groups.get(key) ?? []), target])
        })
        return Array.from(groups.entries()).map(([baseUrl, targets]) => ({ baseUrl, targets }))
    }, [filteredTargets])
    const canCreateTargets = createTargetAccountIds.size > 0 && createTargetPassword.trim().length > 0 && !creatingTargets

    const toggleSection = (key: string) => {
        setSelectedSections(prev => {
            const next = new Set(prev)
            if (next.has(key)) { next.delete(key) } else { next.add(key) }
            return next
        })
    }

    const toggleTarget = (target: TargetOption) => {
        setSelectedTargets(prev => {
            const next = new Map(prev)
            if (next.has(target.transportUrl)) {
                next.delete(target.transportUrl)
            } else {
                const stored = getStoredAIOStreamsPassword(target.baseUrl, target.uuid)
                next.set(target.transportUrl, stored || '')
            }
            return next
        })
    }

    const setTargetPassword = (transportUrl: string, password: string) => {
        setSelectedTargets(prev => {
            const next = new Map(prev)
            next.set(transportUrl, password)
            return next
        })
    }

    const toggleVisibleTargets = () => {
        setSelectedTargets(prev => {
            const next = new Map(prev)
            filteredTargets.forEach((target) => {
                if (allVisibleTargetsSelected) {
                    next.delete(target.transportUrl)
                } else {
                    const stored = getStoredAIOStreamsPassword(target.baseUrl, target.uuid)
                    next.set(target.transportUrl, stored || '')
                }
            })
            return next
        })
    }

    const toggleCreateTargetAccount = (accountId: string) => {
        setCreateTargetAccountIds(prev => {
            const next = new Set(prev)
            if (next.has(accountId)) next.delete(accountId)
            else next.add(accountId)
            return next
        })
    }

    const handleCreateTargets = useCallback(async () => {
        if (!canCreateTargets) return
        setCreatingTargets(true)
        setCreateTargetResults([])

        try {
            await fetchAIOStreamsStatus(sourceBaseUrl)
        } catch {
            setCreatingTargets(false)
            toast({
                title: 'Instance unreachable',
                description: `Could not connect to ${sourceBaseUrl}`,
                variant: 'destructive',
            })
            return
        }

        const accountById = new Map(missingAccounts.map(account => [account.accountId, account]))
        const accountIds = Array.from(createTargetAccountIds)
        const targetPassword = createTargetPassword.trim()
        const sourceLocation = sourceLocationRef.current
        const baseConfig = buildNewTargetConfig(sourceConfig, syncMode, selectedSections, copyBranding)

        const createdResults = await mapConcurrent(accountIds, AIOSTREAMS_SYNC_CONCURRENCY, async (accountId): Promise<CreateTargetResult> => {
            const account = accountById.get(accountId)
            const accountName = account?.accountName ?? accountId
            try {
                const result = await createAIOStreamsUser(sourceBaseUrl, targetPassword, cloneConfig(baseConfig))
                try { await saveAIOStreamsPassword(sourceBaseUrl, result.uuid, targetPassword) } catch { /* non-critical */ }

                const addonUrl = `${sourceBaseUrl}/stremio/${result.uuid}/${result.encryptedPassword}/manifest.json`
                try {
                    await installAddonToAccount(accountId, addonUrl)
                    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== sourceLocation) {
                        navigate(sourceLocation, { replace: true })
                    }
                } catch (e: unknown) {
                    return {
                        accountId,
                        accountName,
                        status: 'failed',
                        uuid: result.uuid,
                        installUrl: addonUrl,
                        error: `Created user, install failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
                    }
                }
                return { accountId, accountName, status: 'created', uuid: result.uuid }
            } catch (e: unknown) {
                return {
                    accountId,
                    accountName,
                    status: 'failed',
                    error: e instanceof Error ? e.message : 'Unknown error',
                }
            }
        })

        setCreateTargetResults(createdResults)
        setCreatingTargets(false)

        const createdCount = createdResults.filter(result => result.status === 'created').length
        const failedCount = createdResults.filter(result => result.status === 'failed').length
        toast({
            title: failedCount === 0 ? 'Target setups created' : 'Target setup creation partially complete',
            description: `${createdCount} created, ${failedCount} failed`,
            variant: failedCount > 0 ? 'destructive' : undefined,
        })
    }, [
        canCreateTargets,
        createTargetAccountIds,
        createTargetPassword,
        installAddonToAccount,
        missingAccounts,
        sourceBaseUrl,
        syncMode,
        selectedSections,
        copyBranding,
        sourceConfig,
        toast,
        navigate,
    ])

    const handleRestoreTarget = useCallback(async (result: SyncResult) => {
        if (!result.rollbackConfig) return
        const restoreKey = result.target.transportUrl
        if (restoringTargetUrls.has(restoreKey)) return
        const rollbackPassword = selectedTargets.get(result.target.transportUrl)?.trim()
            || getStoredAIOStreamsPassword(result.target.baseUrl, result.target.uuid)
        if (!rollbackPassword) {
            toast({
                title: 'Restore needs password',
                description: `Enter the password for ${result.target.addonName}, then try again.`,
                variant: 'destructive',
            })
            return
        }
        setRestoringTargetUrls(prev => new Set(prev).add(restoreKey))
        try {
            await updateAIOStreamsUser(
                result.target.baseUrl,
                result.target.uuid,
                rollbackPassword,
                sanitizeAIOStreamsConfigForUpdate(result.rollbackConfig)
            )
            setResults(prev => prev.map(item => (
                item.target.transportUrl === result.target.transportUrl
                    ? { ...item, restored: true }
                    : item
            )))
            toast({
                title: 'Target restored',
                description: `${result.target.addonName} was restored to its pre-sync config.`,
            })
        } catch (e: unknown) {
            toast({
                title: 'Restore failed',
                description: e instanceof Error ? e.message : 'Unknown error',
                variant: 'destructive',
            })
        } finally {
            setRestoringTargetUrls(prev => {
                const next = new Set(prev)
                next.delete(restoreKey)
                return next
            })
        }
    }, [restoringTargetUrls, selectedTargets, toast])

    const selectedPreviewKeys = useMemo(
        () => getPreviewKeys(syncMode, selectedSections, copyBranding),
        [syncMode, selectedSections, copyBranding]
    )
    const selectedPreviewFieldKeys = useMemo(
        () => getPreviewFieldKeys(selectedPreviewKeys),
        [selectedPreviewKeys]
    )
    const selectableSectionKeys = useMemo(
        () => SYNC_GROUPS.map(section => section.key),
        []
    )
    useEffect(() => {
        const selectable = new Set(selectableSectionKeys)
        setSelectedSections(prev => {
            const next = new Set(Array.from(prev).filter(key => selectable.has(key)))
            return next.size === prev.size ? prev : next
        })
    }, [selectableSectionKeys])
    const preservedLabels = useMemo(
        () => getUnchangedLabels(syncMode, copyBranding),
        [syncMode, copyBranding]
    )
    const allSectionsSelected = selectableSectionKeys.length > 0
        && selectableSectionKeys.every(key => selectedSections.has(key))
    const allVisibleTargetsSelected = filteredTargets.length > 0
        && filteredTargets.every(target => selectedTargets.has(target.transportUrl))
    const allCreateTargetsSelected = missingAccounts.length > 0
        && missingAccounts.every(account => createTargetAccountIds.has(account.accountId))
    const allPasswordsFilled = Array.from(selectedTargets.values()).every(p => p.trim().length > 0)
    const canSync = selectedTargets.size > 0 && allPasswordsFilled && !syncing && (syncMode === 'full' || selectedSections.size > 0)
    const editingLocked = phase !== 'select'
    const previewItems = Array.from(previews.values())
    const previewChangedCount = previewItems.filter(preview => !preview.error && preview.changedSections.length > 0).length
    const previewSkippedCount = previewItems.filter(preview => !preview.error && preview.changedSections.length === 0).length
    const previewErrorCount = previewItems.filter(preview => preview.error).length
    const previewChangeTotal = previewItems.reduce((total, preview) => total + preview.changedSections.length, 0)
    const syncProgressValue = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
    const selectedMissingPasswordCount = Array.from(selectedTargets.values()).filter(p => !p.trim()).length
    const targetToolsActive = targetQuery.trim().length > 0
    const receiptText = receipt ? JSON.stringify(receipt, null, 2) : ''
    const liveStatus = creatingTargets
        ? `Creating ${createTargetAccountIds.size} target setup${createTargetAccountIds.size !== 1 ? 's' : ''}`
        : loadingDiffs
        ? 'Loading sync preview'
        : phase === 'syncing'
        ? `Syncing ${progress.current} of ${progress.total} targets`
        : phase === 'preview' && previews.size > 0
            ? `Preview ready. ${previewChangedCount} targets will update, ${previewSkippedCount} already match, ${previewErrorCount} need a password or check.`
            : phase === 'results' && results.length > 0
                ? `Sync complete. ${results.filter(r => r.status === 'changed').length} updated, ${results.filter(r => r.status === 'skipped').length} already matched, ${results.filter(r => r.status === 'failed').length} failed.`
                : ''

    const handlePreview = useCallback(async () => {
        if (!canSync) return
        setLoadingDiffs(true)
        setPreviews(new Map())
        setPreviewCreatedAt(null)
        setReceipt(null)
        const selectedTargetEntries = Array.from(selectedTargets.entries())

        const previewResults = await mapConcurrent<[string, string], TargetPreview | null>(selectedTargetEntries, AIOSTREAMS_SYNC_CONCURRENCY, async ([transportUrl, password]) => {
            const target = targetOptions.find(t => t.transportUrl === transportUrl)
            if (!target) return null

            try {
                const targetData = await fetchAIOStreamsUser(target.baseUrl, target.uuid, password)
                const targetConfig = targetData.userData as Record<string, unknown>
                const comparableTargetConfig = getComparableTargetConfig(targetConfig)
                const plannedConfig = buildTargetConfig(sourceConfig, targetConfig, syncMode, selectedSections, copyBranding)
                const entries: DiffEntry[] = []

                for (const key of selectedPreviewKeys) {
                    const plannedData = getSyncGroupData(plannedConfig, key)
                    const targetData2 = getSyncGroupData(comparableTargetConfig, key)
                    entries.push({
                        section: key,
                        sourceSummary: getSyncGroupSummary(plannedConfig, key),
                        targetSummary: getSyncGroupSummary(comparableTargetConfig, key),
                        changed: hasConfigChanged(targetData2, plannedData),
                    })
                }

                const otherSettingsChanged = syncMode === 'full'
                    && hasConfigChanged(
                        withoutKeys(comparableTargetConfig, selectedPreviewFieldKeys),
                        withoutKeys(plannedConfig, selectedPreviewFieldKeys)
                    )
                if (otherSettingsChanged) {
                    entries.push({
                        section: 'otherSettings',
                        sourceSummary: 'Will update',
                        targetSummary: 'Different',
                        changed: true,
                    })
                }

                return {
                    target,
                    entries,
                    changedSections: entries.filter(entry => entry.changed).map(entry => entry.section),
                    preserved: preservedLabels,
                    targetConfig: sanitizeAIOStreamsConfigForUpdate(targetConfig),
                    plannedConfig: cloneConfig(plannedConfig),
                }
            } catch (e: unknown) {
                return {
                    target,
                    entries: selectedPreviewKeys.map(key => ({
                        section: key,
                        sourceSummary: getSyncGroupSummary(sourceConfig, key),
                        targetSummary: 'Failed to fetch',
                        changed: true,
                    })),
                    changedSections: selectedPreviewKeys,
                    preserved: preservedLabels,
                    error: e instanceof Error ? e.message : 'Failed to fetch',
                }
            }
        })

        setPreviews(new Map(
            previewResults
                .filter((preview): preview is TargetPreview => preview !== null)
                .map((preview) => [preview.target.transportUrl, preview])
        ))
        setPreviewCreatedAt(Date.now())
        setLoadingDiffs(false)
        setPhase('preview')
    }, [canSync, selectedTargets, targetOptions, selectedPreviewKeys, selectedPreviewFieldKeys, selectedSections, sourceConfig, syncMode, copyBranding, preservedLabels])

    const handleSync = useCallback(async () => {
        if (syncInFlightRef.current) return
        if (previewErrorCount > 0) {
            toast({
                title: 'Preview needs attention',
                description: 'Fix targets that failed preview before running sync.',
                variant: 'destructive',
            })
            return
        }
        if (previewChangedCount === 0) {
            toast({
                title: 'Nothing to sync',
                description: 'All selected targets already match this draft.',
            })
            return
        }
        if (previewCreatedAt && Date.now() - previewCreatedAt > PREVIEW_STALE_MS) {
            setPreviews(new Map())
            setPreviewCreatedAt(null)
            setPhase('select')
            toast({
                title: 'Preview expired',
                description: 'Refresh the preview before writing changes.',
            })
            return
        }
        syncInFlightRef.current = true
        setSyncing(true)
        setPhase('syncing')
        setResults([])
        setProgress({ current: 0, total: selectedTargets.size })

        try {
            const selectedTargetEntries = Array.from(selectedTargets.entries())
            let completed = 0

            const syncResults = await mapConcurrent<[string, string], SyncResult | null>(selectedTargetEntries, AIOSTREAMS_SYNC_CONCURRENCY, async ([transportUrl, password]) => {
                const target = targetOptions.find(t => t.transportUrl === transportUrl)
                if (!target) {
                    completed++
                    setProgress({ current: completed, total: selectedTargets.size })
                    return null
                }

                try {
                    const preview = previews.get(target.transportUrl)
                    const hasUsablePreview = !!preview && !preview.error && !!preview.targetConfig && !!preview.plannedConfig
                    const targetConfig = hasUsablePreview
                        ? cloneConfig(preview!.targetConfig!)
                        : ((await fetchAIOStreamsUser(target.baseUrl, target.uuid, password)).userData as Record<string, unknown>)
                    const comparableTargetConfig = getComparableTargetConfig(targetConfig)
                    const plannedConfig = hasUsablePreview
                        ? cloneConfig(preview!.plannedConfig!)
                        : buildTargetConfig(sourceConfig, targetConfig, syncMode, selectedSections, copyBranding)
                    const changedSections = hasUsablePreview
                        ? preview!.changedSections
                        : selectedPreviewKeys.filter(key => hasConfigChanged(
                            getSyncGroupData(comparableTargetConfig, key),
                            getSyncGroupData(plannedConfig, key)
                        ))
                    const fullConfigChanged = hasConfigChanged(comparableTargetConfig, plannedConfig)

                    if (!fullConfigChanged) {
                        return { target, status: 'skipped' as const, changedSections: [], preserved: preservedLabels }
                    }

                    await updateAIOStreamsUser(target.baseUrl, target.uuid, password, plannedConfig)
                    return {
                        target,
                        status: 'changed' as const,
                        changedSections,
                        preserved: preservedLabels,
                        rollbackConfig: sanitizeAIOStreamsConfigForUpdate(targetConfig),
                    }
                } catch (e: unknown) {
                    return {
                        target,
                        status: 'failed' as const,
                        error: e instanceof Error ? e.message : 'Unknown error',
                        preserved: preservedLabels,
                    }
                } finally {
                    completed++
                    setProgress({ current: completed, total: selectedTargets.size })
                }
            })

            const finalizedResults = syncResults.filter((result): result is SyncResult => result !== null)

            setResults(finalizedResults)
            setPhase('results')

            const changedCount = finalizedResults.filter(r => r.status === 'changed').length
            const skippedCount = finalizedResults.filter(r => r.status === 'skipped').length
            const failCount = finalizedResults.filter(r => r.status === 'failed').length
            const selectedSectionLabels = syncMode === 'full'
                ? ['Everything']
                : Array.from(selectedSections).map(key => getSyncGroupDefinition(key)?.label ?? key)
            if (copyBranding && syncMode === 'sections') selectedSectionLabels.push('Branding')
            setReceipt({
                timestamp: new Date().toISOString(),
                sourceName,
                sourceAccountName,
                sourceBaseUrl,
                mode: syncMode,
                selectedSections: selectedSectionLabels,
                targetCount: finalizedResults.length,
                updatedCount: changedCount,
                skippedCount,
                failedCount: failCount,
                preserved: preservedLabels,
            })

            if (failCount === 0) {
                toast({
                    title: 'Sync complete',
                    description: `${changedCount} updated, ${skippedCount} already matched`,
                })
            } else {
                toast({
                    title: 'Sync partially complete',
                    description: `${changedCount} updated, ${skippedCount} skipped, ${failCount} failed`,
                    variant: 'destructive',
                })
            }
        } catch (e: unknown) {
            setPhase('preview')
            toast({
                title: 'Sync failed',
                description: e instanceof Error ? e.message : 'Unknown error',
                variant: 'destructive',
            })
        } finally {
            setSyncing(false)
            syncInFlightRef.current = false
        }
    }, [selectedTargets, targetOptions, selectedSections, selectedPreviewKeys, sourceConfig, syncMode, copyBranding, preservedLabels, sourceName, sourceAccountName, sourceBaseUrl, toast, previews, previewCreatedAt, previewChangedCount, previewErrorCount])

    const handleRetryFailed = useCallback(() => {
        const failedUrls = new Set(results.filter(r => r.status === 'failed').map(r => r.target.transportUrl))
        const newTargets = new Map<string, string>()
        for (const [url, pwd] of selectedTargets) {
            if (failedUrls.has(url)) newTargets.set(url, pwd)
        }
        setSelectedTargets(newTargets)
        setResults([])
        setPhase('select')
    }, [results, selectedTargets])

    const resetToSelect = useCallback(() => {
        setPhase('select')
        setPreviews(new Map())
        setPreviewCreatedAt(null)
    }, [])

    if (targetOptions.length === 0 && missingAccounts.length === 0 && sameUserAccounts.length === 0) {
        return (
            <EmptyState
                icon={<ArrowRightLeft className="h-6 w-6" />}
                title="No other AIOStreams setups found"
                description="Install AIOStreams on another account, then use this source setup as a sync source."
            />
        )
    }

    return (
        <div className="mx-auto max-w-5xl space-y-4">
            <div role="status" aria-live="polite" className="sr-only">
                {liveStatus}
            </div>

            <div className="space-y-4">
                <Card className="overflow-hidden border-border/40 bg-card/90 shadow-sm">
                    <CardHeader className="space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 items-start gap-3">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted/30 text-primary ring-1 ring-border/40">
                                    <ArrowRightLeft className="h-5 w-5" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Sync Set</p>
                                    <CardTitle className="mt-1 text-xl">Copy from {sourceName}</CardTitle>
                                    <CardDescription>
                                        {sourceAccountName} - {formatHost(sourceBaseUrl)}
                                    </CardDescription>
                                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                                        {sourceUuid.slice(0, 8)}...
                                    </p>
                                </div>
                            </div>
                            <div className="w-fit rounded-full border border-border/40 bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
                                {selectedTargets.size} selected
                            </div>
                        </div>
                    </CardHeader>

                    <CardContent className="space-y-4">
                        <div className="rounded-[1.5rem] border border-border/30 bg-muted/[0.08] p-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">From</p>
                                    <p className="truncate text-sm font-semibold">{sourceName}</p>
                                </div>
                                <div className="hidden h-px flex-1 bg-border/40 sm:block" />
                                <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">To</p>
                                    <p className="truncate text-sm font-semibold">
                                        {selectedTargets.size > 0
                                            ? `${selectedTargets.size} target${selectedTargets.size !== 1 ? 's' : ''}`
                                            : 'Choose targets'
                                        }
                                    </p>
                                </div>
                            </div>
                        </div>

                        <section id="aiostreams-customize-sync" className="space-y-4 rounded-2xl border border-border/30 bg-muted/[0.08] p-3">
                            <div>
                                <p className="text-sm font-semibold">What moves</p>
                                <p className="text-xs text-muted-foreground">
                                    {syncMode === 'full' ? 'Everything' : `${selectedSections.size} settings group${selectedSections.size !== 1 ? 's' : ''}`} - Branding: {copyBranding ? 'copy source name/logo' : 'keep each target name/logo'}
                                </p>
                            </div>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <div>
                                            <p className="text-sm font-semibold">Scope</p>
                                            <p className="text-xs text-muted-foreground">
                                                Everything copies the source AIOStreams config. Groups copy only the parts you pick.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Sync mode">
                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={syncMode === 'full'}
                                            disabled={editingLocked}
                                            onClick={() => setSyncMode('full')}
                                            className={cn(
                                                'rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
                                                syncMode === 'full' ? 'border-primary/35 bg-primary/5' : 'border-border/30 bg-muted/10 hover:bg-muted/20'
                                            )}
                                        >
                                            <span className="flex items-center gap-2 text-sm font-semibold">
                                                <ClipboardCheck className="h-4 w-4 text-primary" />
                                                Everything
                                            </span>
                                            <span className="mt-1 block text-xs text-muted-foreground">Includes services, API keys, filters, sorting, addons, and formatter.</span>
                                        </button>
                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={syncMode === 'sections'}
                                            disabled={editingLocked}
                                            onClick={() => setSyncMode('sections')}
                                            className={cn(
                                                'rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
                                                syncMode === 'sections' ? 'border-primary/35 bg-primary/5' : 'border-border/30 bg-muted/10 hover:bg-muted/20'
                                            )}
                                        >
                                            <span className="flex items-center gap-2 text-sm font-semibold">
                                                <ListChecks className="h-4 w-4 text-primary" />
                                                Choose groups
                                            </span>
                                            <span className="mt-1 block text-xs text-muted-foreground">Leave a group unchecked to keep the target's version.</span>
                                        </button>
                                    </div>
                                </div>

                                {syncMode === 'sections' && (
                                    <div className="space-y-2 rounded-xl border border-border/30 bg-muted/10 p-3">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs font-medium uppercase text-muted-foreground">Settings groups</p>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                disabled={editingLocked || selectableSectionKeys.length === 0}
                                                onClick={() => setSelectedSections(
                                                    allSectionsSelected ? new Set() : new Set(selectableSectionKeys)
                                                )}
                                            >
                                                {allSectionsSelected ? 'Deselect all' : 'Select all'}
                                            </Button>
                                        </div>
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                            {SYNC_GROUPS.map(section => {
                                                const active = selectedSections.has(section.key)
                                                const data = getSyncGroupData(sourceConfig, section.key)
                                                const hasData = hasSyncGroupData(sourceConfig, section.key)
                                                const summary = getSyncGroupSummary(sourceConfig, section.key)
                                                const sectionId = `sync-section-${section.key}`

                                                return (
                                                    <SectionPreview key={section.key} data={data} label={section.label}>
                                                        <div className={cn(
                                                            'flex items-start gap-2 rounded-lg border p-2 transition-colors',
                                                            active ? 'border-primary/40 bg-primary/5' : 'border-border/30 bg-background/35',
                                                            editingLocked && 'opacity-60'
                                                        )}>
                                                            <Checkbox
                                                                id={sectionId}
                                                                checked={active}
                                                                disabled={editingLocked}
                                                                onCheckedChange={() => toggleSection(section.key)}
                                                                aria-describedby={`${sectionId}-summary`}
                                                                className="mt-0.5"
                                                            />
                                                            <Label htmlFor={sectionId} className="min-w-0 flex-1 cursor-pointer">
                                                                <span className="flex items-center gap-1.5 text-xs font-semibold">
                                                                    {SECTION_ICONS[section.key]}
                                                                    {section.label}
                                                                </span>
                                                                <span id={`${sectionId}-summary`} className="mt-0.5 block truncate text-xs text-muted-foreground">
                                                                    {hasData ? summary : 'Empty in source; selecting clears this group on targets'}
                                                                </span>
                                                            </Label>
                                                        </div>
                                                    </SectionPreview>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-3">
                                    <div>
                                        <p className="text-sm font-semibold">Branding</p>
                                        <p className="text-xs text-muted-foreground">
                                            This is the AIOManager-facing part: how the addon appears after it is installed.
                                        </p>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Branding behavior">
                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={!copyBranding}
                                            disabled={editingLocked}
                                            onClick={() => setCopyBranding(false)}
                                            className={cn(
                                                'rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
                                                !copyBranding ? 'border-primary/35 bg-primary/5' : 'border-border/30 bg-background/35 hover:bg-muted/20'
                                            )}
                                        >
                                            <span className="block text-sm font-semibold">Keep target branding</span>
                                            <span className="mt-1 block text-xs text-muted-foreground">Leave each target's addon name and logo as they are.</span>
                                        </button>
                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={copyBranding}
                                            disabled={editingLocked}
                                            onClick={() => setCopyBranding(true)}
                                            className={cn(
                                                'rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
                                                copyBranding ? 'border-primary/35 bg-primary/5' : 'border-border/30 bg-background/35 hover:bg-muted/20'
                                            )}
                                        >
                                            <span className="block text-sm font-semibold">Copy source branding</span>
                                            <span className="mt-1 block text-xs text-muted-foreground">Apply this setup's addon name and logo to targets.</span>
                                        </button>
                                    </div>
                                </div>
                        </section>
                    </CardContent>
                </Card>

                <Card className="overflow-hidden border-border/40 bg-card/90 shadow-sm">
                    <CardHeader className="space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <CardTitle className="text-base">Targets</CardTitle>
                                <CardDescription>
                                    {targetOptions.length} setup{targetOptions.length !== 1 ? 's' : ''} available
                                    {targetStats.savedPasswordCount > 0 && ` - ${targetStats.savedPasswordCount} with saved passwords`}
                                </CardDescription>
                            </div>
                        </div>

                        {sameUserAccounts.length > 0 && (
                            <div className="space-y-2 rounded-2xl border border-info/20 bg-info/5 p-3">
                                <div>
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Already sharing this user</p>
                                    <p className="text-xs text-muted-foreground">
                                        These accounts have the same AIOStreams UUID installed, so they are not listed as sync targets.
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {sameUserAccounts.map(account => (
                                        <span key={account.accountId} className="inline-flex items-center gap-1.5 rounded-full border border-info/20 bg-background/60 px-2.5 py-1 text-xs font-medium">
                                            <Users className="h-3 w-3 text-info" />
                                            {account.accountName}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {missingAccountCount > 0 && (
                            <div className="space-y-3 rounded-2xl border border-border/30 bg-muted/[0.08] p-3">
                                <div>
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">New targets</p>
                                </div>
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                        <p className="text-sm font-semibold">Create on {formatHost(sourceBaseUrl)}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {missingAccountCount === 1
                                                ? `1 account can get a new AIOStreams setup on ${formatHost(sourceBaseUrl)}.`
                                                : `${missingAccountCount} accounts can get new AIOStreams setups on ${formatHost(sourceBaseUrl)}.`
                                            }
                                        </p>
                                    </div>
                                    {missingAccounts.length > 1 && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            disabled={creatingTargets}
                                            onClick={() => setCreateTargetAccountIds(
                                                allCreateTargetsSelected ? new Set<string>() : new Set(missingAccounts.map(account => account.accountId))
                                            )}
                                        >
                                            {allCreateTargetsSelected ? 'Clear' : 'Select all'}
                                        </Button>
                                    )}
                                </div>

                                {missingAccounts.length > 0 && (
                                    <div id="aiostreams-create-targets" className="space-y-3">
                                        <p className="text-xs text-muted-foreground">
                                            Choose Stremio accounts, set the password for the new AIOStreams users, then AIOManager creates them on {formatHost(sourceBaseUrl)} and installs the addon.
                                        </p>
                                        <div className="grid gap-2 sm:grid-cols-2">
                                            {missingAccounts.map(account => {
                                                const accountId = `create-target-${account.accountId}`
                                                const checked = createTargetAccountIds.has(account.accountId)
                                                return (
                                                    <label key={account.accountId} htmlFor={accountId} className="flex items-center gap-2 rounded-xl border border-border/30 bg-background/45 p-2 text-xs">
                                                        <Checkbox
                                                            id={accountId}
                                                            checked={checked}
                                                            disabled={creatingTargets}
                                                            onCheckedChange={() => toggleCreateTargetAccount(account.accountId)}
                                                        />
                                                        <span className="min-w-0 flex-1 truncate font-medium">{account.accountName}</span>
                                                    </label>
                                                )
                                            })}
                                        </div>

                                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                                            <div className="space-y-1">
                                                <Label htmlFor="create-target-password" className="text-xs font-medium text-muted-foreground">New setup password</Label>
                                                <div className="relative">
                                                    <Input
                                                        id="create-target-password"
                                                        type={showCreateTargetPassword ? 'text' : 'password'}
                                                        value={createTargetPassword}
                                                        disabled={creatingTargets}
                                                        onChange={(event) => setCreateTargetPassword(event.target.value)}
                                                        placeholder="Password for new users"
                                                        className="h-10 rounded-2xl border-border/40 bg-background/70 pr-11 font-mono"
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                                        onClick={() => setShowCreateTargetPassword(value => !value)}
                                                        aria-label={showCreateTargetPassword ? 'Hide new setup password' : 'Show new setup password'}
                                                    >
                                                        {showCreateTargetPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                                    </Button>
                                                </div>
                                            </div>
                                            <Button
                                                type="button"
                                                className="self-end gap-2"
                                                disabled={!canCreateTargets}
                                                onClick={handleCreateTargets}
                                            >
                                                {creatingTargets ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                                                {createTargetAccountIds.size > 0
                                                    ? `Create ${createTargetAccountIds.size} setup${createTargetAccountIds.size !== 1 ? 's' : ''}`
                                                    : 'Create setups'
                                                }
                                            </Button>
                                        </div>

                                        <p className="rounded-xl border border-border/30 bg-background/45 p-2 text-xs text-muted-foreground">
                                            New setups use the same scope above: Everything creates a full clone; Groups creates a setup from only the selected groups.
                                        </p>

                                        {createTargetResults.length > 0 && (
                                            <div className="space-y-1">
                                                {createTargetResults.map(result => (
                                                    <div key={result.accountId} className={cn(
                                                        'flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs',
                                                        result.status === 'created' ? 'border-success/20 bg-success/5 text-success' : 'border-destructive/20 bg-destructive/5 text-destructive'
                                                    )}>
                                                        {result.status === 'created' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                                                        <span className="min-w-0 flex-1 truncate font-medium">{result.accountName}</span>
                                                        <span className="truncate">{result.status === 'created' ? `Created ${result.uuid?.slice(0, 8)}...` : result.error}</span>
                                                        {result.installUrl && (
                                                            <div className="flex items-center gap-1" title="Install URLs include the encrypted AIOStreams password. Only share with trusted Stremio accounts.">
                                                                <AlertTriangle className="h-3 w-3 text-warning" />
                                                                <CopyButton value={result.installUrl} variant="ghost" aria-label={`Copy credentialed install URL for ${result.accountName}`}>
                                                                    <span className="ml-1 text-xs font-medium">Copy URL</span>
                                                                </CopyButton>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        <div id="aiostreams-target-tools" className="flex flex-col gap-2 sm:flex-row">
                            <div className="relative min-w-0 flex-1">
                                <Label htmlFor="aiostreams-target-search" className="sr-only">Search targets</Label>
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    id="aiostreams-target-search"
                                    value={targetQuery}
                                    disabled={editingLocked}
                                    onChange={(event) => setTargetQuery(event.target.value)}
                                    placeholder="Search accounts"
                                    className="h-10 rounded-2xl border-border/40 bg-background/70 pl-9"
                                />
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {targetOptions.length > 1 && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={editingLocked || filteredTargets.length === 0}
                                        onClick={toggleVisibleTargets}
                                    >
                                        {allVisibleTargetsSelected ? 'Clear visible' : 'Select visible'}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </CardHeader>

                    <CardContent className="space-y-3">
                        {groupedTargets.length === 0 ? (
                            <EmptyState
                                icon={<Search className="h-6 w-6" />}
                                title={targetOptions.length === 0 ? 'No target setups yet' : 'No targets found'}
                                description={targetOptions.length === 0
                                    ? 'Add AIOStreams to another account, then it can be selected here.'
                                    : 'Try a different search.'
                                }
                                action={targetToolsActive ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setTargetQuery('')}
                                    >
                                        Clear search
                                    </Button>
                                ) : undefined}
                                className="py-8"
                            />
                        ) : (
                            groupedTargets.map(group => (
                                <div key={group.baseUrl} className="space-y-2">
                                    {groupedTargets.length > 1 && (
                                        <p className="truncate px-1 text-xs font-medium text-muted-foreground">
                                            {formatHost(group.baseUrl)}
                                        </p>
                                    )}
                                    <div className="space-y-2">
                                        {group.targets.map(target => {
                                            const isSelected = selectedTargets.has(target.transportUrl)
                                            const password = selectedTargets.get(target.transportUrl) ?? ''
                                            const showPwd = showPasswords[target.transportUrl] ?? false
                                            const stored = getStoredAIOStreamsPassword(target.baseUrl, target.uuid)
                                            const targetId = getTargetDomId(target)
                                            const passwordId = `${targetId}-password`
                                            const helpId = `${targetId}-help`

                                            return (
                                                <article
                                                    key={target.transportUrl}
                                                    className={cn(
                                                        'rounded-2xl border p-3 transition-colors',
                                                        isSelected ? 'border-primary/30 bg-primary/[0.04]' : 'border-border/30 bg-muted/[0.08] hover:bg-muted/15'
                                                    )}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <Checkbox
                                                            id={targetId}
                                                            checked={isSelected}
                                                            disabled={editingLocked}
                                                            onCheckedChange={() => toggleTarget(target)}
                                                            aria-describedby={helpId}
                                                            className="shrink-0"
                                                        />
                                                        <AddonIcon
                                                            name={target.addonName}
                                                            logo={target.logo}
                                                            className="h-10 w-10"
                                                            textClassName="text-xs"
                                                            imageClassName="p-1"
                                                        />
                                                        <Label htmlFor={targetId} className="min-w-0 flex-1 cursor-pointer">
                                                            <span className="block truncate text-sm font-semibold">{target.addonName}</span>
                                                            <span id={helpId} className="block truncate text-xs text-muted-foreground">
                                                                {target.accountName} - {formatHost(target.baseUrl)}
                                                            </span>
                                                        </Label>
                                                        {stored && !isSelected && (
                                                            <span className="hidden rounded-full bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground sm:inline">
                                                                Password saved
                                                            </span>
                                                        )}
                                                    </div>

                                                    {isSelected && (
                                                        <div className="mt-3 grid gap-2 pl-7 sm:pl-[3.25rem]">
                                                            <Label htmlFor={passwordId} className="mb-1 block text-xs font-medium text-muted-foreground">
                                                                Password
                                                            </Label>
                                                            <div className="relative">
                                                                <Input
                                                                    id={passwordId}
                                                                    type={showPwd ? 'text' : 'password'}
                                                                    placeholder="Target password"
                                                                    value={password}
                                                                    onChange={e => setTargetPassword(target.transportUrl, e.target.value)}
                                                                    disabled={editingLocked}
                                                                    className="h-10 rounded-2xl border-border/40 bg-background/70 pr-11 font-mono text-sm"
                                                                    aria-invalid={!password.trim()}
                                                                />
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                                                    onClick={() => setShowPasswords(v => ({ ...v, [target.transportUrl]: !v[target.transportUrl] }))}
                                                                    aria-label={showPwd ? 'Hide target password' : 'Show target password'}
                                                                >
                                                                    {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                                                </Button>
                                                            </div>
                                                            {stored && (
                                                                <p className="text-xs text-muted-foreground">Saved password filled in.</p>
                                                            )}
                                                        </div>
                                                    )}
                                                </article>
                                            )
                                        })}
                                    </div>
                                </div>
                            ))
                        )}
                    </CardContent>
                </Card>
            </div>

            {phase === 'preview' && previews.size > 0 && (
                <Card className="overflow-hidden border-border/40 bg-card/90 shadow-sm">
                    <CardHeader className="space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <CardTitle className="text-base">Preview</CardTitle>
                                <CardDescription>
                                    {previewChangeTotal} sync area{previewChangeTotal !== 1 ? 's' : ''} will change across {previews.size} target{previews.size !== 1 ? 's' : ''}. This is the draft for this run.
                                </CardDescription>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={resetToSelect}
                            >
                                Back to edit
                            </Button>
                        </div>
                        {preservedLabels.length > 0 && (
                            <div className="rounded-xl border border-info/20 bg-info/5 px-3 py-2.5">
                                <p className="text-xs text-info">
                                    Left unchanged: {preservedLabels.join(', ')}.
                                </p>
                            </div>
                        )}
                        <div className="rounded-2xl border border-border/30 bg-muted/[0.08] px-3 py-2 text-xs text-muted-foreground">
                            {previewChangedCount} will update - {previewSkippedCount} already match - {previewErrorCount} need a password or check
                        </div>
                    </CardHeader>

                    <CardContent className="space-y-2">
                        {Array.from(previews.values()).map((preview) => {
                            const changedCount = preview.changedSections.length
                            const statusVariant = preview.error ? 'destructive' : changedCount > 0 ? 'warning' : 'success'
                            const statusIcon = preview.error
                                ? <XCircle className="h-3.5 w-3.5" />
                                : changedCount > 0
                                    ? <AlertTriangle className="h-3.5 w-3.5" />
                                    : <CheckCircle2 className="h-3.5 w-3.5" />
                            const statusLabel = preview.error
                                ? 'Needs password/check'
                                : changedCount > 0
                                    ? `${changedCount} change${changedCount !== 1 ? 's' : ''}`
                                    : 'Already matches'

                            return (
                                <details key={preview.target.transportUrl} open={!!preview.error} className="overflow-hidden rounded-2xl border border-border/30 bg-muted/[0.06]">
                                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                                        <AddonIcon
                                            name={preview.target.addonName}
                                            logo={preview.target.logo}
                                            className="h-8 w-8"
                                            textClassName="text-xs"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-semibold">{preview.target.addonName}</p>
                                            <p className="truncate text-xs text-muted-foreground">{preview.target.accountName}</p>
                                        </div>
                                        <StatusChip variant={statusVariant} icon={statusIcon}>
                                            {statusLabel}
                                        </StatusChip>
                                    </summary>
                                    {preview.error && (
                                        <div className="border-t border-destructive/10 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                                            {preview.error}
                                        </div>
                                    )}
                                    <div className="divide-y divide-border/10">
                                        {preview.entries.map(entry => {
                                            const sectionDef = getSyncGroupDefinition(entry.section)
                                            return (
                                                <div key={entry.section} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-xs">
                                                    <span className="flex min-w-0 items-center gap-2 font-medium">
                                                        {entry.changed ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />}
                                                        <span className="truncate">{sectionDef?.label ?? formatPreviewSection(entry.section)}</span>
                                                    </span>
                                                    <span className="text-muted-foreground/30">{'->'}</span>
                                                    <span className="truncate text-right text-muted-foreground" title={`${entry.targetSummary} to ${entry.sourceSummary}`}>
                                                        {entry.targetSummary} to {entry.sourceSummary}
                                                    </span>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </details>
                            )
                        })}
                    </CardContent>
                </Card>
            )}

            {phase === 'syncing' && (
                <Card className="border-primary/20 bg-primary/5">
                    <CardContent className="space-y-3 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                <p className="text-sm font-semibold">Syncing targets</p>
                            </div>
                            <p className="text-xs text-muted-foreground">{progress.current}/{progress.total}</p>
                        </div>
                        <Progress value={syncProgressValue} shimmer aria-label="Sync progress" />
                        <p className="text-xs text-muted-foreground">
                            Requests are paced per AIOStreams instance to avoid upstream rate limits.
                        </p>
                    </CardContent>
                </Card>
            )}

            {phase === 'results' && results.length > 0 && (
                <Card className="border-border/40">
                    <CardHeader className="space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <CardTitle className="text-base">Sync receipt</CardTitle>
                                <CardDescription>Keep this summary for troubleshooting or repeat manual runs.</CardDescription>
                            </div>
                            {receipt && (
                                <CopyButton value={receiptText} variant="outline" aria-label="Copy sync receipt">
                                    <span className="ml-1 text-xs font-medium">Copy receipt</span>
                                </CopyButton>
                            )}
                        </div>
                        {receipt && (
                            <>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <PreviewStat label="Updated" value={receipt.updatedCount} tone="success" />
                                    <PreviewStat label="Matched" value={receipt.skippedCount} tone="success" />
                                    <PreviewStat label="Failed" value={receipt.failedCount} tone="destructive" />
                                </div>
                                <div className="rounded-xl border border-border/30 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                                    <p className="truncate">
                                        Source: <span className="font-medium text-foreground">{receipt.sourceName}</span> - {formatHost(receipt.sourceBaseUrl)} - {new Date(receipt.timestamp).toLocaleString()}
                                    </p>
                                    <p className="mt-1 truncate">
                                        Unchanged: {receipt.preserved.length > 0 ? receipt.preserved.join(', ') : 'none'} - Scope: {receipt.selectedSections.join(', ')}
                                    </p>
                                </div>
                            </>
                        )}
                    </CardHeader>

                    <CardContent className="space-y-2">
                        {results.map((result) => (
                            <div key={result.target.transportUrl} className={cn(
                                'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs',
                                result.status === 'failed'
                                    ? 'border-destructive/20 bg-destructive/5'
                                    : result.status === 'skipped'
                                        ? 'border-border/30 bg-muted/10'
                                        : 'border-success/20 bg-success/5'
                            )}>
                                <ResultStatusIcon status={result.status} />
                                <span className="truncate font-semibold">{result.target.addonName}</span>
                                <span className="text-muted-foreground/60">-</span>
                                <span className="truncate text-muted-foreground">{result.target.accountName}</span>
                                <StatusChip
                                    className="ml-auto"
                                    variant={result.status === 'failed' ? 'destructive' : result.status === 'skipped' ? 'muted' : 'success'}
                                >
                                    {result.restored ? 'Restored' : result.status === 'skipped' ? 'Already matched' : result.status === 'changed' ? 'Updated' : 'Failed'}
                                </StatusChip>
                                {result.status === 'failed' && result.error && (
                                    <span className="max-w-[180px] truncate text-destructive" title={result.error}>{result.error}</span>
                                )}
                                {result.status === 'changed' && result.rollbackConfig && !result.restored && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 gap-1.5"
                                        disabled={restoringTargetUrls.has(result.target.transportUrl)}
                                        onClick={() => handleRestoreTarget(result)}
                                    >
                                        {restoringTargetUrls.has(result.target.transportUrl) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                                        Undo update
                                    </Button>
                                )}
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            <Card className="border-border/40 bg-card/80">
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs text-muted-foreground">
                        {selectedTargets.size === 0 && 'Choose at least one target to continue.'}
                        {selectedTargets.size > 0 && selectedMissingPasswordCount > 0 && `${selectedMissingPasswordCount} selected target${selectedMissingPasswordCount !== 1 ? 's' : ''} still need a password.`}
                        {selectedTargets.size > 0 && selectedMissingPasswordCount === 0 && phase === 'select' && 'All pieces selected. Preview creates the draft; sync writes it.'}
                        {phase === 'preview' && previewErrorCount > 0 && 'Fix preview errors before syncing.'}
                        {phase === 'preview' && previewErrorCount === 0 && previewChangedCount === 0 && 'Everything already matches. No sync needed.'}
                        {phase === 'preview' && previewErrorCount === 0 && previewChangedCount > 0 && 'This draft is locked. Go back to edit, or run sync with these settings.'}
                        {phase === 'results' && 'Sync finished. You can retry failures or start another run.'}
                    </div>

                    <div className="flex gap-2">
                        {phase === 'select' && (
                            <Button
                                onClick={handlePreview}
                                disabled={!canSync || loadingDiffs}
                                className="min-w-[180px] gap-2"
                            >
                                {loadingDiffs ? (
                                    <><Loader2 className="h-4 w-4 animate-spin" />Loading preview...</>
                                ) : (
                                    <>
                                        <ClipboardCheck className="h-4 w-4" />
                                        Preview {selectedTargets.size > 0 ? `${selectedTargets.size} target${selectedTargets.size !== 1 ? 's' : ''}` : 'changes'}
                                    </>
                                )}
                            </Button>
                        )}

                        {phase === 'preview' && (
                            <>
                                <Button
                                    variant="outline"
                                    onClick={resetToSelect}
                                >
                                    Back
                                </Button>
                                <Button onClick={handleSync} disabled={syncing || previewErrorCount > 0 || previewChangedCount === 0} className="gap-2">
                                    <ArrowRightLeft className="h-4 w-4" />
                                    {previewErrorCount > 0 ? 'Fix preview first' : previewChangedCount === 0 ? 'No changes' : 'Run sync'}
                                </Button>
                            </>
                        )}

                        {phase === 'syncing' && (
                            <Button disabled className="gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Syncing...
                            </Button>
                        )}

                        {phase === 'results' && (
                            <>
                                {results.some(r => r.status === 'failed') && (
                                    <Button variant="outline" className="gap-2" onClick={handleRetryFailed}>
                                        <RotateCw className="h-4 w-4" />
                                        Retry failed
                                    </Button>
                                )}
                                <Button
                                    onClick={() => { setPhase('select'); setResults([]); setPreviews(new Map()); setPreviewCreatedAt(null); setReceipt(null) }}
                                    className="gap-2"
                                >
                                    <ArrowRightLeft className="h-4 w-4" />
                                    New sync
                                </Button>
                            </>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

function ResultStatusIcon({ status }: { status: SyncResult['status'] }) {
    if (status === 'failed') return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
    if (status === 'skipped') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
}

function PreviewStat({
    label,
    value,
    tone,
}: {
    label: string
    value: number
    tone: 'warning' | 'success' | 'destructive'
}) {
    const toneClass = tone === 'warning'
        ? 'border-warning/20 bg-warning/5 text-warning'
        : tone === 'success'
            ? 'border-success/20 bg-success/5 text-success'
            : 'border-destructive/20 bg-destructive/5 text-destructive'

    return (
        <div className={cn('rounded-xl border px-3 py-2 text-center', toneClass)}>
            <p className="text-sm font-semibold">{value}</p>
            <p className="text-xs uppercase tracking-wide opacity-75">{label}</p>
        </div>
    )
}

function formatPreviewSection(section: string): string {
    return section
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .replace(/^./, c => c.toUpperCase())
        .trim()
}

function formatHost(url: string): string {
    try {
        return new URL(url).host
    } catch {
        return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
    }
}

function getTargetDomId(target: TargetOption): string {
    return `aiostreams-target-${target.accountId}-${target.uuid}`.replace(/[^a-zA-Z0-9_-]/g, '-')
}
