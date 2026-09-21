import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#211a16",
        paper: "#fbf6ef",
        bar: "#151110",
        pink: {
          50: "#fff3f8",
          100: "#ffe1ee",
          300: "#f7b8d3",
          500: "#ef8bb6",
          600: "#e2699c",
          700: "#c04c7d",
        },
        lime: {
          400: "#c8f169",
          500: "#a9e63f",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      backgroundImage: {
        dots:
          "radial-gradient(currentColor 1px, transparent 1px)",
      },
      backgroundSize: {
        dots: "14px 14px",
      },
    },
  },
  plugins: [],
};

export default config;
