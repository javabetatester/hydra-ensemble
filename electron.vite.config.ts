import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // Emit CommonJS so Electron can load the `electron` module and other
      // native CJS deps (node-pty) without Node's ESM/CJS bridge tripping
      // on `module.exports` introspection. Without "type": "module" in the
      // root package.json, .js files are interpreted as CJS by Node.
      rollupOptions: {
        // `agent-runner` is forked by AgentHost via `child_process.fork`,
        // so it needs its own compiled file alongside `index.js`.
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'agent-runner': resolve(__dirname, 'src/main/orchestra/agent-runner.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, 'src/preload/index.ts'),
        formats: ['cjs'],
        fileName: () => 'index.js'
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
