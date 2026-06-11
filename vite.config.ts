import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import mdx from 'fumadocs-mdx/vite'
import * as MdxConfig from './source.config'
import path from 'path'

export default defineConfig({
    base: '/',
    plugins: [
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
                manualChunks: {
                    'vendor-react': ['react', 'react-dom', 'react-router-dom'],
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
                target: 'http://127.0.0.1:16100',
                changeOrigin: true,
                secure: false,
            }
        }
    }
})
