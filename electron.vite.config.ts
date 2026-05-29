import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('electron/main'),
        '@shared': resolve('shared'),
      },
    },
    build: {
      outDir: 'out/main',
      lib: {
        entry: resolve('electron/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@preload': resolve('electron/preload'),
        '@shared': resolve('shared'),
      },
    },
    build: {
      outDir: 'out/preload',
      lib: {
        entry: resolve('electron/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: 'src',
    resolve: {
      alias: {
        '@': resolve('src'),
        '@shared': resolve('shared'),
      },
    },
    plugins: [react(), tailwindcss()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve('src/index.html'),
      },
    },
  },
})
