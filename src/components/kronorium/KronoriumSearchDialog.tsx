import {
    SearchDialog,
    SearchDialogClose,
    SearchDialogContent,
    SearchDialogHeader,
    SearchDialogIcon,
    SearchDialogInput,
    SearchDialogList,
    SearchDialogOverlay,
    type SharedProps,
} from 'fumadocs-ui/components/dialog/search'
import { useDocsSearch } from 'fumadocs-core/search/client'
import { searchDocs } from '@/lib/source'

// fumadocs' static search client always fetches an exported index from a URL, which this Vite SPA
// doesn't serve, so we drive the dialog with an in-memory client that searches page bodies.
export default function KronoriumSearchDialog(props: SharedProps) {
    const { search, setSearch, query } = useDocsSearch({
        client: { search: (q: string) => searchDocs(q) },
    })

    return (
        <SearchDialog
            search={search}
            onSearchChange={setSearch}
            isLoading={query.isLoading}
            {...props}
        >
            {/* Drop the backdrop-blur: re-blurring the whole docs page each frame janks the
                open/scroll animation. A plain dimmed overlay is far cheaper and looks ~the same. */}
            <SearchDialogOverlay className="backdrop-blur-none" />
            <SearchDialogContent>
                <SearchDialogHeader>
                    <SearchDialogIcon />
                    <SearchDialogInput placeholder="Search the Kronorium..." />
                    <SearchDialogClose />
                </SearchDialogHeader>
                <SearchDialogList items={query.data !== 'empty' ? query.data : null} />
            </SearchDialogContent>
        </SearchDialog>
    )
}
