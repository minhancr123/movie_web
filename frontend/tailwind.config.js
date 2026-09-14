const defaultColors = require('tailwindcss/colors');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        syne: ['var(--font-syne)', 'Syne', 'var(--font-bevn)', 'Be Vietnam Pro', 'var(--font-jakarta)', 'Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        sans: ['var(--font-jakarta)', 'Plus Jakarta Sans', 'sans-serif'],
        mono: ['var(--font-grotesk)', 'Space Grotesk', 'monospace'],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: "#f59e0b",
        surface: "#121316",
        "surface-dark": "#0d0e11",
        "surface-light": "#1b1b1f",
        "surface-card": "rgba(27, 27, 31, 0.65)",
        "surface-bright": "#38393d",
        "surface-container": "#1f1f23",
        "surface-container-high": "#292a2d",
        "surface-container-highest": "#343538",
        amber: {
          ...defaultColors.amber,
          gold: "#ffc174",
          primary: "#f59e0b",
          glow: "rgba(245, 158, 11, 0.45)",
        },
        cyan: {
          ...defaultColors.cyan,
          accent: "#54ddfc",
        },
        wine: {
          ...defaultColors.rose,
          accent: "#cc003c",
        },
        cinema: {
          text: "#e3e2e6",
          muted: "#d8c3ad",
          subtle: "#8e8f96",
        },
      },
      fontSize: {
        'display-hero': ['52px', { lineHeight: '58px', letterSpacing: '-0.03em', fontWeight: '800' }],
        'display-hero-mobile': ['36px', { lineHeight: '42px', letterSpacing: '-0.02em', fontWeight: '800' }],
        'headline-xl': ['32px', { lineHeight: '38px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-lg': ['24px', { lineHeight: '30px', letterSpacing: '-0.01em', fontWeight: '700' }],
        'headline-md': ['20px', { lineHeight: '26px', letterSpacing: '-0.01em', fontWeight: '700' }],
        'headline-sm': ['18px', { lineHeight: '24px', letterSpacing: '0em', fontWeight: '600' }],
        'body-lg': ['16px', { lineHeight: '24px', letterSpacing: '0em', fontWeight: '400' }],
        'body-md': ['14px', { lineHeight: '20px', letterSpacing: '0em', fontWeight: '400' }],
        'body-sm': ['12px', { lineHeight: '16px', letterSpacing: '0.01em', fontWeight: '400' }],
        'label-lg': ['14px', { lineHeight: '18px', letterSpacing: '0.04em', fontWeight: '600' }],
        'label-md': ['12px', { lineHeight: '16px', letterSpacing: '0.06em', fontWeight: '600' }],
        'label-sm': ['10px', { lineHeight: '12px', letterSpacing: '0.08em', fontWeight: '700' }],
        'badge-numeric': ['13px', { lineHeight: '14px', letterSpacing: '0.02em', fontWeight: '700' }],
      },
      spacing: {
        'space-2xs': '0.25rem',
        'space-xs': '0.5rem',
        'space-sm': '0.75rem',
        'space-md': '1rem',
        'space-lg': '1.5rem',
        'space-xl': '2rem',
        'space-2xl': '3rem',
        margin: '1.25rem',
        gutter: '1rem',
      },
      maxWidth: {
        shell: '1440px',
      },
      boxShadow: {
        glow: '0 0 20px rgba(245, 158, 11, 0.4)',
        'glow-lg': '0 0 30px rgba(245, 158, 11, 0.6)',
        'amber-glow': '0 0 35px -5px rgba(245, 158, 11, 0.5), 0 0 15px -3px rgba(255, 193, 116, 0.3)',
        'amber-button': '0 8px 30px rgba(245, 158, 11, 0.45)',
        'glass-card': '0 8px 32px 0 rgba(0, 0, 0, 0.45)',
        'card-hover': '0 20px 40px -10px rgba(0, 0, 0, 0.8), 0 0 25px rgba(245, 158, 11, 0.3)',
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        }
      }
    },
  },
  plugins: [],
};
