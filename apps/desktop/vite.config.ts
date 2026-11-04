import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),base:'./',plugins:[react(),tailwindcss()],build:{outDir:'dist/renderer',emptyOutDir:true,target:'chrome130',sourcemap:true}})
