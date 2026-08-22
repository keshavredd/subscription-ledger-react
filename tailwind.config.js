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
        dark: {
          bg: '#09090b',
          card: '#18181b',
          border: '#27272a',
          text: '#fafafa',
          muted: '#a1a1aa',
          label: '#e4e4e7',
          totalBg: '#27272a',
          totalText: '#fafafa',
          tableBg: '#18181b',
        },
        amber: {
          accent: '#d97706',
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}