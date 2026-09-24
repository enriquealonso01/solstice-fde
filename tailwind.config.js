/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        solstice: {
          ink: '#141210',
          slate: '#2E2A26',
          stone: '#6B625A',
          sand: '#E8E1D7',
          cream: '#F7F3EC',
          ember: '#B4541F',
          gold: '#C8973F',
        },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
