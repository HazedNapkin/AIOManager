import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import mdx from 'fumadocs-mdx/vite'
import * as MdxConfig from './source.config'
import path from 'path'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { visualizer } from 'rollup-plugin-visualizer'

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
                    // fumadocs is Kronorium-only: without its own chunk it gets hoisted into the
                    // shared eager chunk (~84% of it) and every page loads the docs engine.
                    manualChunks(id) {
                        if (id.includes('fumadocs')) return 'kronorium-docs'
                        const vendorBuckets = {
                            'vendor-react': ['react', 'react-dom', 'react-router-dom', 'clsx', 'tailwind-merge'],
                            'vendor-radix': ['@radix-ui/react-checkbox', '@radix-ui/react-select', '@radix-ui/react-tabs', '@radix-ui/react-tooltip', '@radix-ui/react-popover', '@radix-ui/react-alert-dialog', '@radix-ui/react-progress', '@radix-ui/react-scroll-area'],
                            'vendor-motion': ['framer-motion'],
                            'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities', '@dnd-kit/modifiers'],
                            'vendor-icons': ['lucide-react'],
                            'vendor-date': ['date-fns'],
                            'vendor-charts': ['recharts'],
                            'vendor-themes': ['next-themes'],
                        }
                        for (const [chunk, pkgs] of Object.entries(vendorBuckets)) {
                            if (pkgs.some(p => id.includes(`node_modules/${p}/`) || id.includes(`node_modules/${p}/`))) return chunk
                        }
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
