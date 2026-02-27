/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cinema: {
          bg: '#0f1115',
          surface: '#161a20',
          card: '#1a1f27',
          border: 'rgba(255,255,255,0.06)',
          accent: '#7c3aed',
          'accent-blue': '#3b82f6',
          text: '#e2e8f0',
          muted: '#64748b',
          subtle: '#94a3b8',
        },
      },
      backgroundImage: {
        'accent-gradient': 'linear-gradient(135deg, #7c3aed, #3b82f6)',
        'accent-gradient-hover': 'linear-gradient(135deg, #6d28d9, #2563eb)',
      },
      animation: {
        'float-up': 'float-up 3s ease-out forwards',
        'bubble-in': 'bubble-in 0.2s ease-out forwards',
        'bubble-out': 'bubble-out 0.2s ease-in forwards',
        'seat-glow': 'seat-glow 2s ease-in-out infinite',
        'wave': 'wave 0.6s ease-out',
        'reaction-pop': 'reaction-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'scan': 'scan 8s linear infinite',
      },
      keyframes: {
        'float-up': {
          '0%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(-80px) scale(0.6)' },
        },
        'bubble-in': {
          '0%': { opacity: '0', transform: 'scale(0.8) translateY(4px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'bubble-out': {
          '0%': { opacity: '1', transform: 'scale(1)' },
          '100%': { opacity: '0', transform: 'scale(0.8)' },
        },
        'seat-glow': {
          '0%, 100%': { boxShadow: '0 0 8px rgba(124, 58, 237, 0.4)' },
          '50%': { boxShadow: '0 0 16px rgba(124, 58, 237, 0.7)' },
        },
        'wave': {
          '0%': { boxShadow: '0 0 0 rgba(124, 58, 237, 0.8)' },
          '100%': { boxShadow: '0 0 24px rgba(124, 58, 237, 0)' },
        },
        'reaction-pop': {
          '0%': { opacity: '0', transform: 'scale(0.3) translateY(0)' },
          '60%': { opacity: '1', transform: 'scale(1.2) translateY(-10px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(-4px)' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        'scan': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
}
