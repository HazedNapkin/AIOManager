import { loader } from 'fumadocs-core/source';
import { searchIndexed, type IndexedDoc, type DocSearchResult } from './doc-search';

const docs = import.meta.glob('../../content/docs/**/*.{md,mdx}', { eager: true });
const metas = import.meta.glob('../../content/docs/**/meta.json', { eager: true, import: 'default' });

const files = [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...Object.entries(docs).map(([path, module]: [string, any]) => {
        let cleanPath = path.replace('../../content/docs/', '');
        
        // Map 'index.mdx' to empty path for fumadocs root page matching
        if (cleanPath === 'index.mdx' || cleanPath === 'index.md') {
            cleanPath = '';
        } else {
            cleanPath = cleanPath.replace(/\.mdx?$/, '');
        }
        
        return {
            type: 'page' as const,
            path: cleanPath,
            data: {
                ...module.frontmatter,
                body: module.default,
                toc: module.toc,
                structuredData: module.structuredData,
            },
        };
    }),
    ...Object.entries(metas).map(([path, data]) => {
        const cleanPath = path
            .replace('../../content/docs/', '')
            .replace('/meta.json', '')
            .replace(/\/$/, '');
        
        return {
            type: 'meta' as const,
            path: cleanPath,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: data as any,
        };
    }),
];

export const source = loader({
    baseUrl: '/kronorium',
    source: {
        files,
    },
});

const indexedDocs: IndexedDoc[] = files.filter(f => f.type === 'page').map(f => {
    const path = f.path as string
    const data = f.data as { title?: string; description?: string; structuredData?: { headings?: Array<{ id?: string; content?: string }>; contents?: Array<{ content?: string }> } }
    // fumadocs-mdx's structuredData carries already-extracted plain text: headings ({id, content})
    // and contents (body split by section). Use it instead of toc, whose title is a ReactNode, so
    // calling .toLowerCase() on that threw and silently aborted every search.
    const sd = data.structuredData ?? {}
    const headings = (sd.headings ?? []) as Array<{ id?: string; content?: string }>
    const contents = (sd.contents ?? []) as Array<{ content?: string }>
    return {
        id: path || 'index',
        title: data.title || path || 'Home',
        url: path ? `/kronorium/${path}` : '/kronorium',
        description: data.description || '',
        headings: headings.map((h) => ({ id: h.id ?? '', content: h.content ?? '' })),
        body: contents.map(c => c.content ?? '').join(' '),
    }
})

// In-memory client search. fumadocs' static client always fetches an exported index from a URL
// (no such endpoint in this SPA), so we wire this through useDocsSearch({ client }) instead.
export function searchDocs(query: string): DocSearchResult[] {
    return searchIndexed(query, indexedDocs)
}
