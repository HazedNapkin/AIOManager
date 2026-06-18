import { Routes, Route, Navigate } from 'react-router-dom'
import { NotFoundPage } from '@/pages/NotFoundPage'

import { lazy, Suspense } from 'react'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { AppLoader } from '@/components/common/LoadingScreen'

const AccountsPage = lazy(() => import('@/pages/AccountsPage').then(m => ({ default: m.AccountsPage })))
const AccountDetailPage = lazy(() => import('@/pages/AccountDetailPage').then(m => ({ default: m.AccountDetailPage })))
const SavedAddonsPage = lazy(() => import('@/pages/SavedAddonsPage').then(m => ({ default: m.SavedAddonsPage })))
const AIOStreamsPage = lazy(() => import('@/pages/AIOStreamsPage').then(m => ({ default: m.AIOStreamsPage })))
const AIOMetadataPage = lazy(() => import('@/pages/AIOMetadataPage').then(m => ({ default: m.AIOMetadataPage })))

const KronoriumPage = lazy(() => import('@/pages/kronorium/KronoriumPage').then(m => ({ default: m.KronoriumPage })))
const KronoriumDocsLayout = lazy(() => import('@/components/kronorium/KronoriumDocsLayout').then(m => ({ default: m.KronoriumDocsLayout })))

const ReplayPage = lazy(() => import('@/pages/ReplayPage').then(m => ({ default: m.ReplayPage })))
const ReplaySharePage = lazy(() => import('@/pages/ReplaySharePage').then(m => ({ default: m.ReplaySharePage })))
const ActivityPage = lazy(() => import('@/pages/ActivityPage').then(m => ({ default: m.ActivityPage })))
const MetricsPage = lazy(() => import('@/pages/MetricsPage').then(m => ({ default: m.MetricsPage })))
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const NotesPage = lazy(() => import('@/pages/NotesPage').then(m => ({ default: m.NotesPage })))
const VaultPage = lazy(() => import('@/pages/VaultPage').then(m => ({ default: m.VaultPage })))
const ThemeEditorPage = lazy(() => import('@/pages/ThemeEditorPage').then(m => ({ default: m.ThemeEditorPage })))
const fallback = <AppLoader variant="route" />

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<ErrorBoundary><Suspense fallback={fallback}><AccountsPage /></Suspense></ErrorBoundary>} />
      <Route path="/saved-addons" element={<ErrorBoundary><Suspense fallback={fallback}><SavedAddonsPage /></Suspense></ErrorBoundary>} />
      <Route path="/discover" element={<Navigate to="/saved-addons#discover" replace />} />

      <Route path="/account/:accountId" element={<ErrorBoundary><Suspense fallback={fallback}><AccountDetailPage /></Suspense></ErrorBoundary>} />
      <Route path="/account/:accountId/aiostreams/:uuid" element={<ErrorBoundary><Suspense fallback={fallback}><AIOStreamsPage /></Suspense></ErrorBoundary>} />
      <Route path="/account/:accountId/aiometadata/:uuid" element={<ErrorBoundary><Suspense fallback={fallback}><AIOMetadataPage /></Suspense></ErrorBoundary>} />


      <Route path="/activity" element={<ErrorBoundary><Suspense fallback={fallback}><ActivityPage /></Suspense></ErrorBoundary>} />
      <Route path="/metrics" element={<ErrorBoundary><Suspense fallback={fallback}><MetricsPage /></Suspense></ErrorBoundary>} />
      <Route path="/replay" element={<ErrorBoundary><Suspense fallback={fallback}><ReplayPage /></Suspense></ErrorBoundary>} />
      <Route path="/replay/share/:token" element={<ErrorBoundary><Suspense fallback={fallback}><ReplaySharePage /></Suspense></ErrorBoundary>} />
      <Route path="/settings" element={<ErrorBoundary><Suspense fallback={fallback}><SettingsPage /></Suspense></ErrorBoundary>} />
      <Route path="/settings/theme/editor" element={<ErrorBoundary><Suspense fallback={fallback}><ThemeEditorPage /></Suspense></ErrorBoundary>} />
      <Route path="/notes" element={<ErrorBoundary><Suspense fallback={fallback}><NotesPage /></Suspense></ErrorBoundary>} />

      <Route path="/vault" element={<ErrorBoundary><Suspense fallback={fallback}><VaultPage /></Suspense></ErrorBoundary>} />
      <Route path="/vault/:groupSlug" element={<Navigate to="/vault" replace />} />

      <Route path="/kronorium" element={<ErrorBoundary><Suspense fallback={fallback}><KronoriumDocsLayout><KronoriumPage /></KronoriumDocsLayout></Suspense></ErrorBoundary>} />
      <Route path="/kronorium/*" element={<ErrorBoundary><Suspense fallback={fallback}><KronoriumDocsLayout><KronoriumPage /></KronoriumDocsLayout></Suspense></ErrorBoundary>} />
      <Route path="/faq" element={<Navigate to="/kronorium" replace />} />

      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  )
}
