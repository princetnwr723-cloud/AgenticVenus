import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    // lib/markdown.ts builds HTML with Tailwind classes; without this line
    // those classes were never generated.
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: "#F4F1EA",
        "cream-dark": "#EDE8DC",
        ink: "#1F1B16",
        clay: "#D97757",
        "clay-dark": "#BF5F3F",
        sand: "#E8E1D3",
        moss: "#5A6B4E",
      },
      fontFamily: {
        serif: ["Georgia", "Iowan Old Style", "Times New Roman", "serif"],
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        card: "12px",
      },
    },
  },
  plugins: [],
};

export default config;