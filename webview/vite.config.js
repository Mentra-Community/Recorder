import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from "path";
import tailwindcss from '@tailwindcss/vite';
// https://vite.dev/config/
export default defineConfig({
    plugins: [tailwindcss(), react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 5173,
        strictPort: true, // Don't try other ports if 5173 is taken
        hmr: {
            // Enhanced HMR settings for proxy support
            host: 'localhost',
            port: 5173,
            // Don't force clientPort - let it autodetect from the host
            protocol: 'ws',
            timeout: 30000,
            overlay: true,
        },
        // Full CORS support
        cors: {
            origin: '*',
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
            credentials: true,
        },
        allowedHosts: ['localhost', 'isaiah-webview.ngrok.app', 'isaiah-tpa.ngrok.app'],
        proxy: {
            '/api': {
                target: process.env.VITE_BACKEND_URL || 'https://isaiah-tpa.ngrok.app',
                changeOrigin: true,
                secure: false,
            }
        },
        // Improved headers for websocket support
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
        },
    },
    build: {
        // Ensure assets use relative paths
        assetsDir: 'assets',
        outDir: 'dist',
        sourcemap: true,
        // Generate a manifest for asset mapping
        manifest: true,
        // Optimize for production
        rollupOptions: {
            output: {
                manualChunks: {
                    vendor: ['react', 'react-dom'],
                    mentra: ['@mentra/react']
                }
            }
        }
    },
    // Ensure environment variables are available
    define: {
        // Make sure Vite env vars are properly defined
        'import.meta.env.VITE_BACKEND_URL': JSON.stringify(process.env.VITE_BACKEND_URL || 'https://isaiah-tpa.ngrok.app')
    }
});
