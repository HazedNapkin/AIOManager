import type { Note } from '@/store/notesStore'

export function mergeNotesTrash(local: Note[], pulled: Note[]): Note[] {
    const byId = new Map<string, Note>()
    for (const note of [...pulled, ...local]) {
        const existing = byId.get(note.id)
        if (!existing || new Date(note.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) byId.set(note.id, note)
    }
    return Array.from(byId.values())
}

export function filterNotesByTrash(notes: Note[], trash: Note[]): Note[] {
    const tombById = new Map(trash.map(t => [t.id, t.updatedAt]))
    return notes.filter(n => {
        const trashedAt = tombById.get(n.id)
        return !trashedAt || new Date(trashedAt).getTime() < new Date(n.updatedAt).getTime()
    })
}
