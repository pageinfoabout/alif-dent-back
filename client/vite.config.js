import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,       // your desired port
    strictPort: true, // fail if taken (set false to auto-pick another)
    host: true        // optional: expose on LAN
  },
  preview: {
    port: 5177,
    strictPort: true,
    host: true
  }
})