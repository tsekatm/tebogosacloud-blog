/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          black: '#0B0B0F',
          dark: '#131318',
          card: '#1A1A21',
          muted: '#2A2A35',
          border: '#3A3A45',
          grey: '#8A8A95',
          beige: '#C4B99A',
          cream: '#E8E0D0',
          light: '#F5F0E8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      typography: {
        DEFAULT: {
          css: {
            '--tw-prose-body': '#E8E0D0',
            '--tw-prose-headings': '#F5F0E8',
            '--tw-prose-lead': '#C4B99A',
            '--tw-prose-links': '#C4B99A',
            '--tw-prose-bold': '#F5F0E8',
            '--tw-prose-counters': '#8A8A95',
            '--tw-prose-bullets': '#8A8A95',
            '--tw-prose-hr': '#3A3A45',
            '--tw-prose-quotes': '#C4B99A',
            '--tw-prose-quote-borders': '#3A3A45',
            '--tw-prose-captions': '#8A8A95',
            '--tw-prose-code': '#C4B99A',
            '--tw-prose-pre-code': '#E8E0D0',
            '--tw-prose-pre-bg': '#131318',
            '--tw-prose-th-borders': '#3A3A45',
            '--tw-prose-td-borders': '#2A2A35',
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
