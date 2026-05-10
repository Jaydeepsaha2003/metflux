/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand green – sampled to match the Metflux logo mark.
        brand: {
          50:  '#ecfdf3',
          100: '#d1fadf',
          200: '#a6f4c5',
          300: '#6ce9a6',
          400: '#32d583',
          500: '#22c55e', // primary
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#0e3a22',
          950: '#052e16',
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
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
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
      },
    },
  },
  plugins: [],
};
