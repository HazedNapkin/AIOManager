import { create } from 'zustand'
import localforage from 'localforage'
import { triggerSync } from '@/lib/sync-trigger'
import { encrypt, decrypt } from '@/lib/crypto'
import { useAuthStore } from '@/store/authStore'

const OLD_STORAGE_KEY = 'aiom-notes'
export const NOTES_INDEX_KEY = 'aiom-notes-index'
export const NOTES_TRASH_KEY = 'aiom-notes-trash'
const TRASH_TTL = 30 * 24 * 60 * 60 * 1000
const MAX_NOTE_CONTENT = 50000
const MAX_NOTE_TITLE = 200
const NOTE_KEY_PREFIX = 'aiom-note:'
const CACHE_MAX = 10
const ENC_PREFIX = 'AIOMENC1:'

function noteKey(id: string): string {
    return `${NOTE_KEY_PREFIX}${id}`
}

function getEncryptionKey(): CryptoKey | null {
    return useAuthStore.getState().encryptionKey
}

async function encryptContent(content: string): Promise<string> {
    const key = getEncryptionKey()
    if (!key) return content
    return ENC_PREFIX + await encrypt(content, key)
}

async function readNoteFromStorage(id: string): Promise<Note | null> {
    const stored = await localforage.getItem<Note>(noteKey(id))
    if (!stored) return null
    const raw = String(stored.content ?? '')
    if (!raw.startsWith(ENC_PREFIX)) return { ...stored, content: raw }
    const key = getEncryptionKey()
    if (!key) return null
    try {
        return { ...stored, content: await decrypt(raw.slice(ENC_PREFIX.length), key) }
    } catch {
        return null
    }
}

export function extractTags(content: string): string[] {
    const matches = content.match(/(?:^|\s)#([a-zA-Z0-9_-]{2,30})/g)
    if (!matches) return []
    return [...new Set(matches.map(m => m.trim().slice(1)))]
}

export function extractWikilinks(content: string): string[] {
    const matches = content.match(/\[\[([^\]]+)\]\]/g)
    if (!matches) return []
    return [...new Set(matches.map(m => m.slice(2, -2)))]
}

export interface NoteMeta {
    id: string
    title: string
    createdAt: string
    updatedAt: string
    pinned?: boolean
    tags: string[]
    wikilinks: string[]
}

export interface Note extends NoteMeta {
    content: string
}

function toMeta(note: Note): NoteMeta {
    return {
        id: note.id,
        title: note.title,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        pinned: note.pinned,
        tags: note.tags,
        wikilinks: note.wikilinks,
    }
}

function sanitizeNote(raw: Record<string, unknown>): Note {
    const content = String(raw.content || '').slice(0, MAX_NOTE_CONTENT)
    return {
        id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
        title: String(raw.title || 'Untitled').slice(0, MAX_NOTE_TITLE),
        content,
        createdAt: (raw.createdAt as string) || new Date().toISOString(),
        updatedAt: (raw.updatedAt as string) || new Date().toISOString(),
        pinned: Boolean(raw.pinned),
        tags: raw.tags && Array.isArray(raw.tags) ? raw.tags : extractTags(content),
        wikilinks: raw.wikilinks && Array.isArray(raw.wikilinks) ? raw.wikilinks : extractWikilinks(content),
    }
}

function noteTime(note: Pick<Note, 'updatedAt'> | Pick<NoteMeta, 'updatedAt'> | undefined): number {
    const ts = new Date(note?.updatedAt || 0).getTime()
    return Number.isFinite(ts) ? ts : 0
}

async function persistIndex(metas: NoteMeta[]) {
    await localforage.setItem(NOTES_INDEX_KEY, metas)
}

async function persistNote(note: Note) {
    const stored: Note = { ...note, content: await encryptContent(note.content) }
    await localforage.setItem(noteKey(note.id), stored)
}

async function removeNoteKey(id: string) {
    await localforage.removeItem(noteKey(id))
}

async function persistTrash(trash: Note[]) {
    try {
        await localforage.setItem(NOTES_TRASH_KEY, trash)
    } catch (err) {
        if (import.meta.env.DEV) console.error('[NotesStore] Failed to persist trash:', err)
        throw err
    }
}

async function migrateFromOldFormat(): Promise<{ metas: NoteMeta[]; notes: Note[] } | null> {
    const old = await localforage.getItem<Note[]>(OLD_STORAGE_KEY)
    if (!old || !Array.isArray(old)) return null

    const notes: Note[] = []
    const metas: NoteMeta[] = []

    for (const raw of old) {
        const content = String(raw.content || '').slice(0, MAX_NOTE_CONTENT)
        const note: Note = {
            id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
            title: String(raw.title || 'Untitled').slice(0, MAX_NOTE_TITLE),
            content,
            createdAt: raw.createdAt || new Date().toISOString(),
            updatedAt: raw.updatedAt || new Date().toISOString(),
            pinned: Boolean(raw.pinned),
            tags: extractTags(content),
            wikilinks: extractWikilinks(content),
        }
        notes.push(note)
        metas.push(toMeta(note))
        await persistNote(note)
    }

    await localforage.setItem(NOTES_INDEX_KEY, metas)
    await localforage.removeItem(OLD_STORAGE_KEY)
    return { metas, notes }
}

let migrationDone = false

async function migratePlaintextNotes(): Promise<void> {
    if (migrationDone) return
    const key = getEncryptionKey()
    if (!key) return
    try {
        const index = await localforage.getItem<NoteMeta[]>(NOTES_INDEX_KEY)
        if (!index || !Array.isArray(index)) {
            migrationDone = true
            return
        }
        for (const meta of index) {
            try {
                const stored = await localforage.getItem<Note>(noteKey(meta.id))
                if (!stored) continue
                const raw = String(stored.content ?? '')
                if (raw.startsWith(ENC_PREFIX)) continue
                const encryptedContent = ENC_PREFIX + await encrypt(raw, key)
                await localforage.setItem(noteKey(meta.id), { ...stored, content: encryptedContent })
            } catch (e) {
                if (import.meta.env.DEV) console.error('[NotesStore] Failed to migrate note ' + meta.id + ':', e)
            }
        }
        migrationDone = true
    } catch (e) {
        if (import.meta.env.DEV) console.error('[NotesStore] Content encryption migration failed:', e)
    }
}

interface NotesStore {
    notes: NoteMeta[]
    trash: Note[]
    loading: boolean
    activeNote: Note | null
    initialize: () => Promise<void>
    loadNoteContent: (id: string) => Promise<Note | null>
    setActiveNote: (note: Note | null) => void
    createNote: (title: string, content: string) => Promise<Note>
    updateNote: (id: string, data: Partial<Pick<Note, 'title' | 'content' | 'pinned'>>) => Promise<void>
    deleteNote: (id: string) => Promise<void>
    trashAllNotes: () => Promise<void>
    restoreNote: (id: string) => Promise<void>
    emptyTrash: () => Promise<void>
    importNotes: (notes: Note[]) => Promise<void>
    importTrash: (trash: Note[]) => Promise<void>
    getAllNotesWithContent: () => Promise<Note[]>
    saveFailed: boolean
}

const noteCache = new Map<string, { note: Note; ts: number }>()

function cachePut(note: Note) {
    noteCache.set(note.id, { note, ts: Date.now() })
    if (noteCache.size > CACHE_MAX) {
        let oldest = ''
        let oldestTs = Infinity
        for (const [id, entry] of noteCache) {
            if (entry.ts < oldestTs) { oldestTs = entry.ts; oldest = id }
        }
        if (oldest) noteCache.delete(oldest)
    }
}

function cacheInvalidate(id: string) {
    noteCache.delete(id)
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
let pendingPersist: { note: Note; notes: NoteMeta[] } | null = null

async function flushPendingPersist() {
    if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = null
    }
    const pending = pendingPersist
    if (!pending) return
    pendingPersist = null
    await persistNote(pending.note)
    await persistIndex(pending.notes)
}

function schedulePersist(note: Note, notes: NoteMeta[]) {
    pendingPersist = { note, notes }
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(async () => {
        const pending = pendingPersist
        pendingPersist = null
        persistTimer = null
        if (!pending) return
        try {
            await persistNote(pending.note)
            await persistIndex(pending.notes)
            useNotesStore.setState({ saveFailed: false })
        } catch (e) {
            useNotesStore.setState({ saveFailed: true })
            if (import.meta.env.DEV) console.error(e)
        }
    }, 1000)
}

export const useNotesStore = create<NotesStore>((set, get) => ({
    notes: [],
    trash: [],
    loading: false,
    activeNote: null,
    saveFailed: false,

    initialize: async () => {
        set({ loading: true })
        try {
            const migrated = await migrateFromOldFormat()

            let metas: NoteMeta[]
            if (migrated) {
                metas = migrated.metas
            } else {
                const stored = await localforage.getItem<NoteMeta[]>(NOTES_INDEX_KEY)
                metas = stored && Array.isArray(stored) ? stored : []
            }
            set({ notes: metas })

            await migratePlaintextNotes()

            try {
                const emergencyRaw = localStorage.getItem('aiom-note-emergency-save')
                if (emergencyRaw) {
                    localStorage.removeItem('aiom-note-emergency-save')
                    const emergency = JSON.parse(emergencyRaw) as { id?: string; recovered?: boolean }
                    if (emergency.recovered && emergency.id) {
                        const note = await readNoteFromStorage(emergency.id)
                        if (note) {
                            cachePut(note)
                            set({ activeNote: note })
                        }
                    }
                }
            } catch (e) { if (import.meta.env.DEV) console.error(e) }

            const storedTrash = await localforage.getItem<Note[]>(NOTES_TRASH_KEY)
            if (storedTrash && Array.isArray(storedTrash)) {
                const now = Date.now()
                const pruned = storedTrash.filter(n => now - new Date(n.updatedAt).getTime() < TRASH_TTL)
                set({ trash: pruned })
                if (pruned.length !== storedTrash.length) await persistTrash(pruned)
            }
        } catch (e) {
            if (import.meta.env.DEV) console.error('[NotesStore] Failed to load notes', e)
        } finally {
            set({ loading: false })
        }
    },

    loadNoteContent: async (id) => {
        const cached = noteCache.get(id)
        if (cached) {
            cached.ts = Date.now()
            set({ activeNote: cached.note })
            return cached.note
        }
        try {
            const note = await readNoteFromStorage(id)
            if (note) {
                cachePut(note)
                set({ activeNote: note })
                return note
            }
        } catch (e) {
            if (import.meta.env.DEV) console.error('[NotesStore] Failed to load note content:', e)
        }
        return null
    },

    setActiveNote: (note) => {
        set({ activeNote: note })
    },

    createNote: async (title, content) => {
        const trimmedContent = content.slice(0, MAX_NOTE_CONTENT)
        const note: Note = {
            id: crypto.randomUUID(),
            title: (title.trim() || 'Untitled').slice(0, MAX_NOTE_TITLE),
            content: trimmedContent,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            tags: extractTags(trimmedContent),
            wikilinks: extractWikilinks(trimmedContent),
        }
        const meta = toMeta(note)
        const notes = [meta, ...get().notes]
        cachePut(note)
        set({ notes, activeNote: note })
        await persistNote(note)
        await persistIndex(notes)
        triggerSync()
        return note
    },

    updateNote: async (id, data) => {
        const current = get().activeNote?.id === id ? get().activeNote! : await get().loadNoteContent(id)
        if (!current) return

        const updated: Note = {
            ...current,
            ...(data.title !== undefined ? { title: data.title.slice(0, MAX_NOTE_TITLE) } : {}),
            ...(data.content !== undefined ? { content: data.content.slice(0, MAX_NOTE_CONTENT) } : {}),
            ...(data.pinned !== undefined ? { pinned: data.pinned } : {}),
            updatedAt: new Date().toISOString(),
        }

        if (data.content !== undefined) {
            updated.tags = extractTags(updated.content)
            updated.wikilinks = extractWikilinks(updated.content)
        }
        if (data.title !== undefined) {
            updated.wikilinks = extractWikilinks(updated.content)
        }

        const meta = toMeta(updated)
        const notes = get().notes.map(n => n.id === id ? meta : n)
        cachePut(updated)
        set({ notes, activeNote: updated })
        schedulePersist(updated, notes)
        triggerSync()
    },

    deleteNote: async (id) => {
        const meta = get().notes.find(n => n.id === id)
        const notes = get().notes.filter(n => n.id !== id)
        set({ notes })

        let fullNote: Note | null = null
        const cached = noteCache.get(id)
        if (cached) {
            fullNote = cached.note
        } else {
            fullNote = await readNoteFromStorage(id)
        }

        if (fullNote) {
            const trashItem: Note = { ...fullNote, updatedAt: new Date().toISOString() }
            const trash = [trashItem, ...get().trash]
            set({ trash })
            await removeNoteKey(id)
            await persistTrash(trash)
            await persistIndex(notes)
        } else if (meta) {
            const trashItem: Note = {
                ...meta,
                content: '',
                updatedAt: new Date().toISOString(),
            }
            const trash = [trashItem, ...get().trash]
            set({ trash })
            await persistIndex(notes)
            await persistTrash(trash)
        } else {
            await persistIndex(notes)
        }

        triggerSync()
        cacheInvalidate(id)
        if (get().activeNote?.id === id) set({ activeNote: null })
    },

    trashAllNotes: async () => {
        const notes = get().notes
        if (notes.length === 0) return
        const timestamp = new Date().toISOString()
        const trashItems: Note[] = []
        for (const meta of notes) {
            const cached = noteCache.get(meta.id)
            const fullNote = cached ? cached.note : await readNoteFromStorage(meta.id)
            trashItems.push(fullNote
                ? { ...fullNote, updatedAt: timestamp }
                : { ...meta, content: '', updatedAt: timestamp })
        }
        const trash = [...trashItems, ...get().trash]
        set({ notes: [], trash })
        await persistIndex([])
        await persistTrash(trash)
        for (const meta of notes) {
            await removeNoteKey(meta.id)
            cacheInvalidate(meta.id)
        }
        if (get().activeNote) set({ activeNote: null })
        triggerSync()
    },

    restoreNote: async (id) => {
        const note = get().trash.find(n => n.id === id)
        const trash = get().trash.filter(n => n.id !== id)
        set({ trash })
        await persistTrash(trash)

        if (note) {
            const restored: Note = { ...note, updatedAt: new Date().toISOString() }
            const meta = toMeta(restored)
            const notes = [meta, ...get().notes]
            cachePut(restored)
            set({ notes })
            await persistNote(restored)
            await persistIndex(notes)
            triggerSync()
        }
    },

    emptyTrash: async () => {
        set({ trash: [] })
        await persistTrash([])
        triggerSync()
    },

    importNotes: async (incoming) => {
        await flushPendingPersist()
        const sanitized = incoming
            .filter(n => n && typeof n.content === 'string' && n.content.length <= MAX_NOTE_CONTENT)
            .map(n => sanitizeNote(n as unknown as Record<string, unknown>))
        if (sanitized.length === 0) return

        const metaMap = new Map(get().notes.map(n => [n.id, n]))
        const trashMap = new Map(get().trash.map(n => [n.id, n]))
        let notesChanged = false
        let trashChanged = false
        let activeNote = get().activeNote

        for (const note of sanitized) {
            const trashed = trashMap.get(note.id)
            if (trashed) {
                if (noteTime(note) > noteTime(trashed)) {
                    trashMap.delete(note.id)
                    trashChanged = true
                } else {
                    continue
                }
            }

            const existing = metaMap.get(note.id)
            if (existing && noteTime(existing) >= noteTime(note)) continue

            metaMap.set(note.id, toMeta(note))
            cachePut(note)
            if (activeNote?.id === note.id) activeNote = note
            await persistNote(note)
            notesChanged = true
        }

        if (!notesChanged && !trashChanged) return

        const nextState: Partial<Pick<NotesStore, 'notes' | 'trash' | 'activeNote'>> = {}
        if (notesChanged) {
            const notes = Array.from(metaMap.values())
            nextState.notes = notes
            nextState.activeNote = activeNote
            await persistIndex(notes)
        }
        if (trashChanged) {
            const trash = Array.from(trashMap.values())
            nextState.trash = trash
            await persistTrash(trash)
        }
        set(nextState)

        triggerSync()
    },

    importTrash: async (incoming) => {
        await flushPendingPersist()
        const sanitized = incoming
            .filter(n => n && typeof n.content === 'string' && n.content.length <= MAX_NOTE_CONTENT)
            .map(n => sanitizeNote(n as unknown as Record<string, unknown>))
        if (sanitized.length === 0) return

        const trashMap = new Map(get().trash.map(n => [n.id, n]))
        const metaMap = new Map(get().notes.map(n => [n.id, n]))
        let changed = false
        let activeNote = get().activeNote

        for (const note of sanitized) {
            const existingTrash = trashMap.get(note.id)
            if (!existingTrash || noteTime(note) > noteTime(existingTrash)) {
                trashMap.set(note.id, note)
                changed = true
            }

            const active = metaMap.get(note.id)
            if (active && noteTime(note) >= noteTime(active)) {
                metaMap.delete(note.id)
                cacheInvalidate(note.id)
                await removeNoteKey(note.id)
                if (activeNote?.id === note.id) activeNote = null
                changed = true
            }
        }

        if (!changed) return

        const notes = Array.from(metaMap.values())
        const trash = Array.from(trashMap.values())
        set({ notes, trash, activeNote })
        await persistIndex(notes)
        await persistTrash(trash)

        triggerSync()
    },

    getAllNotesWithContent: async () => {
        await flushPendingPersist()
        const metas = get().notes
        const results: Note[] = []
        for (const meta of metas) {
            const cached = noteCache.get(meta.id)
            if (cached) {
                results.push({ ...meta, content: cached.note.content })
                continue
            }
            const note = await readNoteFromStorage(meta.id)
            if (note) {
                results.push({ ...meta, content: note.content })
            } else {
                results.push({ ...meta, content: '' })
            }
        }
        return results
    },
}))

if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        flushPendingPersist()
        const store = useNotesStore.getState()
        if (store.activeNote) {
            try {
                localStorage.setItem('aiom-note-emergency-save', JSON.stringify({ id: store.activeNote.id, recovered: true }))
            } catch (e) { if (import.meta.env.DEV) console.error(e) }
        }
    })
}

useAuthStore.subscribe((state, prevState) => {
    const prevKey = prevState.encryptionKey
    const currentKey = state.encryptionKey
    if (prevKey && currentKey && prevKey !== currentKey) {
        noteCache.clear()
        useNotesStore.setState({ activeNote: null })
        migrationDone = false
    } else if (currentKey && !prevKey) {
        migratePlaintextNotes().catch(() => {})
    } else if (!currentKey && prevKey) {
        noteCache.clear()
        useNotesStore.setState({ activeNote: null })
    }
})
