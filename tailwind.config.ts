import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50: "#eef4ff", 100: "#dbe7fe", 500: "#3b6fe0", 600: "#2c58c4", 700: "#24479e", 900: "#172b5c" },
      },
    },
  },
  plugins: [],
} satisfies Config;
