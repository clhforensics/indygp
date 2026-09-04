import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
const alias = (p) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
    // Relative base so the bundle loads from Tauri's asset protocol offline.
    base: './',
    clearScreen: false,
    resolve: {
        alias: {
            '@indygp/core': alias('../core/src/index.ts'),
            '@indygp/render': alias('../render/src/index.ts'),
            '@indygp/platform': alias('../platform/src/index.ts')
        }
    },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: {
        target: 'chrome110',
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: true,
        // keep every asset local; nothing may resolve to a remote URL
        assetsInlineLimit: 0,
        rollupOptions: { output: { manualChunks: { three: ['three'] } } }
    }
});
//# sourceMappingURL=vite.config.js.map