import { defineConfig } from "vite";

// Builds the browser playground (playground.html) for GitHub Pages.
// Relative base, so it works under https://<user>.github.io/bitling/.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist-site",
    emptyOutDir: true,
    rollupOptions: { input: "playground.html" },
  },
});
