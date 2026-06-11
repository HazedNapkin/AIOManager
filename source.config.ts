import { defineCollections, defineConfig } from 'fumadocs-mdx/config'

export const docs = defineCollections({
    dir: 'content/docs',
    schema: (v) => v,
    type: 'doc',
})

export const meta = defineCollections({
    dir: 'content/docs',
    schema: (v) => v,
    type: 'meta',
})

export default defineConfig()
