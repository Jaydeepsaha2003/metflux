/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand palette – driven by CSS variables so it can be re-themed per
        // deployment/domain at runtime (see index.css :root defaults + the
        // branding store's applyBrandColor). Channels are space-separated RGB so
        // Tailwind's /alpha opacity utilities keep working. Default = Metflux green.
        brand: {
          50:  'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
          950: 'rgb(var(--brand-950) / <alpha-value>)',
        },
        // Charcoal/ink – matches the dark grey strokes in the logo.
        ink: {
          50:  '#f6f7f9',
          100: '#eceef2',
          200: '#d5d8e0',
          300: '#b1b6c2',
          400: '#878d9d',
          500: '#6b7180',
          600: '#555a68',
          700: '#3f4350',
          800: '#2d2f36',
          900: '#1a1c20',
          950: '#0d0e11',
        },
      },
      fontFamily: {
        // One family for the whole app. 'Inter Variable' is the name the
        // variable file registers under when self-hosted; plain 'Inter' is what
        // Google serves today, so both are listed and whichever is present
        // wins before the system stack is reached.
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
      keyframes: {
        blob: {
          '0%, 100%': { transform: 'translate(0px, 0px) scale(1)' },
          '33%':      { transform: 'translate(30px, -50px) scale(1.1)' },
          '66%':      { transform: 'translate(-20px, 20px) scale(0.95)' },
        },
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'gradient-x': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%':      { backgroundPosition: '100% 50%' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        'blob-slow':   'blob 16s ease-in-out infinite',
        'blob-medium': 'blob 11s ease-in-out infinite',
        'blob-fast':   'blob 8s  ease-in-out infinite',
        'fade-up':     'fade-up 350ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in':     'fade-in 400ms ease-out',
        'gradient-x':  'gradient-x 14s ease infinite',
        shimmer:       'shimmer 1.6s infinite',
        float:         'float 4s ease-in-out infinite',
      },
      boxShadow: {
        'glow-brand': '0 0 0 1px rgba(34,197,94,0.2), 0 8px 30px rgba(34,197,94,0.18)',
        // A layered elevation scale. Each step is two shadows — a tight contact
        // shadow that seats the element, and a wider soft one that gives it
        // height. One big blurry shadow reads as a smudge; two read as depth.
        e1: '0 1px 2px -1px rgb(15 23 42 / 0.06), 0 1px 3px 0 rgb(15 23 42 / 0.05)',
        e2: '0 2px 4px -2px rgb(15 23 42 / 0.06), 0 6px 14px -4px rgb(15 23 42 / 0.10)',
        e3: '0 4px 8px -4px rgb(15 23 42 / 0.08), 0 14px 32px -8px rgb(15 23 42 / 0.14)',
        // Dark surfaces swallow shadow, so depth there comes from a lit top
        // edge instead — the same trick a physical bevel uses.
        lit: 'inset 0 1px 0 0 rgb(255 255 255 / 0.06)',
      },
    },
  },
  plugins: [],
};
