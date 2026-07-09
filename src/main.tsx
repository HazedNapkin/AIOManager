import './lib/polyfill'
import { migrateLocalStorageKeys, migrateLocalforageKeys } from '@/lib/storage-migration'

migrateLocalStorageKeys()

migrateLocalforageKeys().finally(() => {
  import('./app-entry')
})
