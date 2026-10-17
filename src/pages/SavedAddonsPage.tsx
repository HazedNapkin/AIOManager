import { SavedAddonLibrary } from '@/components/saved-addons/SavedAddonLibrary'
import { useDocumentTitle } from '@/hooks/use-document-title'

export function SavedAddonsPage() {
  useDocumentTitle('Saved Addons')
  return <SavedAddonLibrary />
}
