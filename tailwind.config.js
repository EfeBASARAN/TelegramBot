/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        dark: {
          bg: '#0a0a0a',
          surface: '#121212',
          card: '#1a1a1a',
          'card-hover': '#222222',
          border: '#2a2a2a',
          'border-light': '#3a3a3a',
          text: '#ffffff',
          'text-secondary': '#a0a0a0',
          'text-tertiary': '#707070',
        },
      },
      boxShadow: {
        'card': '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)',
        'card-hover': '0 10px 25px rgba(0, 0, 0, 0.4), 0 4px 10px rgba(0, 0, 0, 0.3)',
        'glow': '0 0 20px rgba(255, 255, 255, 0.1)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in',
        'slide-in': 'slideIn 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
}

