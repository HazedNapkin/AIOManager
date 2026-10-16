import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import mdx from 'fumadocs-mdx/vite'
import * as MdxConfig from './source.config'
import path from 'path'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { visualizer } from 'rollup-plugin-visualizer'
import type { OutputChunk } from 'vite'

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    const port = env.PORT || '16100'
    const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))
    const buildCommit = process.env.GIT_COMMIT
        || (() => {
            try {
                return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
            } catch {
                return 'dev'
            }
        })()

    return {
        base: '/',
        // Without this, an unset NODE_ENV lets react-dom bundle its development build into production.
        define: {
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || mode),
            __BUILD_VERSION__: JSON.stringify(pkg.version),
            __BUILD_COMMIT__: JSON.stringify(buildCommit),
        },
        plugins: [
            ...(process.env.ANALYZE ? [visualizer({ json: true, filename: 'bundle-stats.json', gzipSize: true })] : []),
            {
                name: 'fix-fumadocs-glob',
                enforce: 'pre',
                transform(code, id) {
                    if (id.includes('.source/') && (id.endsWith('.ts') || id.endsWith('.js'))) {
                        let result = code;
                        
                        const baseMatch = result.match(/"base":\s*"(.*?)",/);
                        if (baseMatch) {
                            const base = baseMatch[1];
                            // Strip the base option
                            result = result.replace(/"base":\s*"(.*?)",\s*/g, '');
                            
                            // Smarter pattern replacement: match any quoted string inside import.meta.glob's array
                            // and prepend the base path if it starts with ./
                            result = result.replace(/import\.meta\.glob\(\s*\[([\s\S]*?)\],/g, (m, content) => {
                                const newContent = content.replace(/(['"])\.\/(.*?)\1/g, (m, quote, path) => {
                                    return `${quote}${base}/${path}${quote}`;
                                });
                                return `import.meta.glob([${newContent}],`;
                            });
                        }

                        if (result !== code) {
                            console.log(`[Vite Fix] Patched glob options in: ${id}`);
                            return {
                                code: result,
                                map: null,
                            };
                        }
                    }
                },
            },
            mdx(MdxConfig),
            react(),
            tailwindcss(),
            {
                // Preload app code without evaluating it before storage migration finishes.
                name: 'boot-modulepreload',
                apply: 'build',
                generateBundle: {
                    order: 'post',
                    handler(_options, bundle) {
                        const htmlAsset = bundle['index.html']
                        if (!htmlAsset || htmlAsset.type !== 'asset' || typeof htmlAsset.source !== 'string') return
                        const appEntry = Object.values(bundle).find(
                            (c): c is OutputChunk => c.type === 'chunk' && c.name === 'app-entry'
                        )
                        if (!appEntry) return
                        const closure: string[] = []
                        const walk = (chunk: OutputChunk) => {
                            for (const dep of chunk.imports) {
                                const depChunk = bundle[dep]
                                if (depChunk?.type === 'chunk' && !closure.includes(depChunk.fileName)) {
                                    closure.push(depChunk.fileName)
                                    walk(depChunk)
                                }
                            }
                        }
                        walk(appEntry)
                        const tags = [...new Set(closure)].map(
                            (f) => `<link rel="modulepreload" crossorigin href="/${f}">`
                        )
                        tags.push(`<link rel="modulepreload" crossorigin href="/${appEntry.fileName}">`)
                        // Match Vite's crossorigin mode so preloaded CSS reuses the same cache entry.
                        for (const css of appEntry.viteMetadata?.importedCss ?? []) {
                            const tag = `<link rel="preload" href="/${css}" as="style" crossorigin>`
                            if (!tags.includes(tag)) tags.push(tag)
                        }
                        htmlAsset.source = htmlAsset.source.replace('</head>', `${tags.join('\n')}\n</head>`)
                    },
                },
            },
        ],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
            },
        },
        esbuild: {
            drop: ['console'],
        },
        build: {
            rollupOptions: {
                output: {
                    manualChunks: {
                        'vendor-react': ['react', 'react-dom', 'react-router-dom', 'clsx', 'tailwind-merge'],
                        'vendor-radix': ['@radix-ui/react-checkbox', '@radix-ui/react-select', '@radix-ui/react-tabs', '@radix-ui/react-tooltip', '@radix-ui/react-popover', '@radix-ui/react-alert-dialog', '@radix-ui/react-progress', '@radix-ui/react-scroll-area'],
                        'vendor-motion': ['framer-motion'],
                        'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities', '@dnd-kit/modifiers'],
                        'vendor-icons': ['lucide-react'],
                        'vendor-date': ['date-fns'],
                        'vendor-charts': ['recharts'],
                    }
                }
            }
        },
        server: {
            host: true,
            proxy: {
                '/api': {
                    target: `http://127.0.0.1:${port}`,
                    changeOrigin: true,
                    secure: false,
                },
                '/addon': {
                    target: `http://127.0.0.1:${port}`,
                    changeOrigin: true,
                    secure: false,
                }
            }
        }
    }
})
