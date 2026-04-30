import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  appType: "mpa",
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        "101": path.resolve(__dirname, "101/index.html"),
        "104": path.resolve(__dirname, "104/index.html"),
        "105": path.resolve(__dirname, "105/index.html"),
      },
    },
  },
});
