import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  /* The React Compiler memoises components and values automatically.
     Components that break its rules (writing refs during render, say) are
     skipped and run as before, so it can only remove renders, not add bugs. */
  plugins: [react({ babel: { plugins: [["babel-plugin-react-compiler", {}]] } }), tailwindcss()],
  test: {
    setupFiles: ["tests/stopMotion.js"],
    include: ["tests/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
  },
});
