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
        canvas: "#ffffff",
        "canvas-soft": "#f8fafc",
        surface: "#ffffff",
        hairline: "#e2e8f0",
        "hairline-input": "#cbd5e1",

        primary: {
          DEFAULT: "#2563eb",
          active: "#1d4ed8",
        },
        "on-primary": "#ffffff",
        secondary: "#1e293b",

        ink: {
          DEFAULT: "#0f172a",
          secondary: "#334155",
          muted: "#64748b",
          faint: "#94a3b8",
        },

        accent: {
          sky: "#3b82f6",
          purple: "#c084fc",
          "purple-deep": "#7e22ce",
          pink: "#ec4899",
          orange: "#d97706",
          "orange-deep": "#b91c1c",
          teal: "#0891b2",
          green: "#059669",
          brown: "#92400e",
        },
      },
      borderRadius: {
        xs: "4px",
        sm: "5px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
      boxShadow: {
        xs: "0 1px 2px rgba(0,0,0,0.02)",
        sm: "0 1px 3px rgba(0,0,0,0.02), 0 1px 2px rgba(0,0,0,0.01)",
        DEFAULT: "0 1px 3px rgba(0,0,0,0.02), 0 1px 2px rgba(0,0,0,0.01)",
        md: "0 2px 8px rgba(0,0,0,0.02), 0 4px 12px rgba(0,0,0,0.02)",
        lg: "0 2px 8px rgba(0,0,0,0.02), 0 6px 16px rgba(0,0,0,0.03)",
        soft: "0 1px 3px rgba(0, 0, 0, 0.02), 0 1px 2px rgba(0, 0, 0, 0.01)",
        elevated: "0 2px 8px rgba(0, 0, 0, 0.02), 0 6px 16px rgba(0, 0, 0, 0.03)",
        "notion-soft": "0 1px 3px rgba(0, 0, 0, 0.02), 0 1px 2px rgba(0, 0, 0, 0.01)",
        "notion-elevated": "0 2px 8px rgba(0, 0, 0, 0.02), 0 6px 16px rgba(0, 0, 0, 0.03)",
      },
      letterSpacing: {
        "display-1": "-2.125px",
        "display-2": "-1.875px",
        "heading-1": "-1px",
        "heading-2": "-0.625px",
        "heading-3": "-0.25px",
        title: "-0.125px",
        eyebrow: "0.125px",
      },
    },
  },
  plugins: [],
};

export default config;
