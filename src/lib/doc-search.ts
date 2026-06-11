// Pure, dependency-free doc search used by the Kronorium. Kept separate from source.ts (which
// uses Vite's import.meta.glob) so the matching logic is unit-testable. See doc-search.test.ts.

export interface IndexedDoc {
    id: string
    title: string
    url: string
    description: string
    headings: Array<{ id: string; content: string }>
    body: string
}

export interface DocSearchResult {
    id: string
    url: string
    type: 'page' | 'heading'
    content: string
}

export function searchIndexed(query: string, docs: IndexedDoc[]): DocSearchResult[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const terms = q.split(/\s+/).filter(Boolean)

    const scored: Array<{ score: number; results: DocSearchResult[] }> = []
    for (const doc of docs) {
        const title = doc.title.toLowerCase()
        const headingText = doc.headings.map(h => h.content).join(' ').toLowerCase()
        const hay = `${title} ${doc.description.toLowerCase()} ${headingText} ${doc.body.toLowerCase()}`
        if (!terms.every(t => hay.includes(t))) continue

        let score = 0
        if (title.includes(q)) score += 100
        if (terms.every(t => title.includes(t))) score += 40
        if (headingText.includes(q)) score += 20
        if (doc.description.toLowerCase().includes(q)) score += 10

        const results: DocSearchResult[] = [{ id: doc.id, url: doc.url, type: 'page', content: doc.title }]
        for (const h of doc.headings) {
            const headingContent = String(h.content ?? '')
            if (terms.some(t => headingContent.toLowerCase().includes(t))) {
                results.push({ id: `${doc.id}-${h.id}`, url: `${doc.url}#${h.id}`, type: 'heading', content: headingContent })
            }
        }
        scored.push({ score, results })
    }

    return scored
        .sort((a, b) => b.score - a.score)
        .flatMap(s => s.results)
        .slice(0, 40)
}
