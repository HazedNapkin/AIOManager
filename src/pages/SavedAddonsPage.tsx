import { useEffect } from 'react'
import { SavedAddonLibrary } from '@/components/saved-addons/SavedAddonLibrary'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { journeyEnd } from '@/lib/journey-spans'

export function SavedAddonsPage() {
  useDocumentTitle('Saved Addons')
  useEffect(() => {
    journeyEnd('open-library')
  }, [])
  return <SavedAddonLibrary />
}
