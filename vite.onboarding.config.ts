import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const outputDirectory = process.env.ONBOARDING_OUT_DIR

if (!outputDirectory) {
  throw new Error('ONBOARDING_OUT_DIR fehlt.')
}

export default defineConfig({
  root: path.resolve(process.cwd(), 'onboarding'),
  plugins: [react()],
  base: './',
  build: {
    outDir: path.resolve(outputDirectory),
    emptyOutDir: true,
  },
})
