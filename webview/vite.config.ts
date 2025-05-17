import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from "path"
import tailwindcss from '@tailwindcss/vite'

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
    proxy: {
      // Proxy API requests back to the TPA server
      '/api': {
        target: 'http://localhost:8069',
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
    // Generate a manifest for asset mapping
    manifest: true,
  }
})