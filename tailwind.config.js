/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Every value is a CSS variable defined in src/index.css with a light
        // AND a dark value, so no component ever hard-codes a color.
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        hero: 'rgb(var(--hero) / <alpha-value>)',
        'hero-text': 'rgb(var(--hero-text) / <alpha-value>)',
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        good: {
          DEFAULT: 'rgb(var(--good) / <alpha-value>)',
          soft: 'rgb(var(--good-soft) / <alpha-value>)',
          ring: 'rgb(var(--good-ring) / <alpha-value>)',
        },
        warn: {
          DEFAULT: 'rgb(var(--warn) / <alpha-value>)',
          soft: 'rgb(var(--warn-soft) / <alpha-value>)',
          ring: 'rgb(var(--warn-ring) / <alpha-value>)',
        },
        bad: {
          DEFAULT: 'rgb(var(--bad) / <alpha-value>)',
          soft: 'rgb(var(--bad-soft) / <alpha-value>)',
          ring: 'rgb(var(--bad-ring) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'rgb(var(--info) / <alpha-value>)',
          soft: 'rgb(var(--info-soft) / <alpha-value>)',
          ring: 'rgb(var(--info-ring) / <alpha-value>)',
        },
        agent: {
          DEFAULT: 'rgb(var(--agent) / <alpha-value>)',
          soft: 'rgb(var(--agent-soft) / <alpha-value>)',
          ring: 'rgb(var(--agent-ring) / <alpha-value>)',
        },
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['Geist', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      maxWidth: {
        page: '72rem',
      },
    },
  },
  plugins: [],
}
