/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Readex Pro', 'sans-serif'],
      },
      colors: {
        surface: {
          base: '#020617',
          card: '#0a1020',
          elevated: '#0f1828',
          hover: '#162035',
          border: '#1e2d45',
          borderhover: '#2a3f5f',
        },
      },
    },
  },
  plugins: [],
};
