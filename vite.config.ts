import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/simulador-ripley/", // <--- AGREGA ESTA LÍNEA (El nombre de tu repo entre barras)
})