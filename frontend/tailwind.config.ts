import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "state-detected": "#6b7280",
        "state-contacted": "#3b82f6",
        "state-retrying": "#3b82f6",
        "state-cooling_down": "#f59e0b",
        "state-escalated": "#8b5cf6",
        "state-recovered": "#22c55e",
        "state-written_off": "#ef4444",
        "state-do_not_contact": "#64748b",
      },
    },
  },
  plugins: [],
};

export default config;
