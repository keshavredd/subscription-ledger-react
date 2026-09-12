/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        warm: {
          bg: '#fdfbf7',
          card: '#ffffff',
          border: '#e5e7eb',
          text: '#111827',
          muted: '#6b7280',
          label: '#4b5563',
          totalBg: '#f3f4f6',
          totalText: '#111827',
          tableBg: '#ffffff',
        },
        // Dark surfaces: navy slate (matches the Marketing dashboard's dark theme)
        dark: {
          bg: '#0b1120',
          card: '#121b2d',
          border: '#223046',
          text: '#f1f5f9',
          muted: '#94a3b8',
          label: '#e2e8f0',
          totalBg: '#1c2942',
          totalText: '#f1f5f9',
          tableBg: '#121b2d',
        },
        // Accent scale is CSS-variable driven: amber in light mode, blue in dark
        // mode (see index.css). Every existing `amber-*` class flips per theme
        // without touching call sites.
        amber: {
          50: 'rgb(var(--accent-50) / <alpha-value>)',
          100: 'rgb(var(--accent-100) / <alpha-value>)',
          200: 'rgb(var(--accent-200) / <alpha-value>)',
          300: 'rgb(var(--accent-300) / <alpha-value>)',
          400: 'rgb(var(--accent-400) / <alpha-value>)',
          500: 'rgb(var(--accent-500) / <alpha-value>)',
          600: 'rgb(var(--accent-600) / <alpha-value>)',
          700: 'rgb(var(--accent-700) / <alpha-value>)',
          800: 'rgb(var(--accent-800) / <alpha-value>)',
          900: 'rgb(var(--accent-900) / <alpha-value>)',
          950: 'rgb(var(--accent-950) / <alpha-value>)',
          accent: 'rgb(var(--accent-base) / <alpha-value>)',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}