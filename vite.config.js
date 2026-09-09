import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // .env belongs to the Node backend, never the client bundler.
  envDir: false,
  build: { outDir: "dist" },
});
