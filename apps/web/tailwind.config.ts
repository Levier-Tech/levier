import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#080808',
        surface: {
          DEFAULT: '#111111',
          subtle: '#13160f',
          hover: '#191d13',
          border: 'rgba(255, 255, 255, 0.12)',
          'border-light': 'rgba(255, 255, 255, 0.20)',
          line: '#292a27',
        },
        acid: {
          DEFAULT: '#c2ff47',
          bright: '#daff92',
          dark: '#9ecf35',
          deep: '#48cc0e',
          muted: 'rgba(194, 255, 71, 0.15)',
        },
        brand: {
          DEFAULT: '#c2ff47',
          hover: '#daff92',
          dark: '#9ecf35',
          muted: 'rgba(194, 255, 71, 0.15)',
        },
        // Secondary brand tones sampled from /assets/levier-logo.png (the lever pictogram).
        silver: {
          DEFAULT: '#a7a7a9',
          light: '#c9cacc',
        },
        muted: {
          DEFAULT: '#9b9b99',
          dark: '#72746d',
        },
        danger: {
          DEFAULT: '#d6153c',
          muted: 'rgba(214, 21, 60, 0.15)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Arial', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
        heroDisplay: ['Tomorrow', "'Courier New'", 'monospace'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '4px',
        sm: '2px',
        md: '4px',
        lg: '6px',
        xl: '8px',
        full: '9999px',
      },
      letterSpacing: {
        tightest: '-0.06em',
        tighter: '-0.04em',
        widest: '0.15em',
      },
    },
  },
  plugins: [],
};

export default config;

