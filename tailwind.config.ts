import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#38BDF8',
          50: '#F0F9FF',
          100: '#E0F2FE',
          200: '#BAE6FD',
          300: '#7DD3FC',
          400: '#38BDF8',
          500: '#0EA5E9',
          600: '#0EA5E9',
          700: '#0284C7',
          800: '#0369A1',
          900: '#0C4A6E',
        },
        page: '#F0F9FF',
        surface: '#FFFFFF',
        'border-sky': '#E0F2FE',
        ink: '#0F172A',
        'ink-muted': '#64748B',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 4px 20px -2px rgba(14, 165, 233, 0.08), 0 2px 6px -1px rgba(15, 23, 42, 0.04)',
        card: '0 8px 30px rgba(14, 165, 233, 0.10)',
      },
    },
  },
  plugins: [],
};

export default config;
