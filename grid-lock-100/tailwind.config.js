/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            animation: {
                'shake': 'shake 0.5s',
                'lock': 'chain-lock 0.4s ease-out forwards',
                'flash': 'flash-red 0.5s ease-out',
                'clearing': 'shrink-out 0.8s forwards',
                'float-score': 'float-up 1s ease-out forwards',
            },
            keyframes: {
                shake: {
                    '0%': { transform: 'translate(1px, 1px) rotate(0deg)' },
                    '10%': { transform: 'translate(-1px, -2px) rotate(-1deg)' },
                    '20%': { transform: 'translate(-3px, 0px) rotate(1deg)' },
                    '30%': { transform: 'translate(3px, 2px) rotate(0deg)' },
                    '40%': { transform: 'translate(1px, -1px) rotate(1deg)' },
                    '50%': { transform: 'translate(-1px, 2px) rotate(-1deg)' },
                    '60%': { transform: 'translate(-3px, 1px) rotate(0deg)' },
                    '70%': { transform: 'translate(3px, 1px) rotate(-1deg)' },
                    '80%': { transform: 'translate(-1px, -1px) rotate(1deg)' },
                    '90%': { transform: 'translate(1px, 2px) rotate(0deg)' },
                    '100%': { transform: 'translate(1px, -2px) rotate(-1deg)' },
                },
                'chain-lock': {
                    '0%': { transform: 'scale(0)', opacity: '0' },
                    '50%': { transform: 'scale(1.2)', opacity: '1' },
                    '100%': { transform: 'scale(1)', opacity: '1' },
                },
                'flash-red': {
                    '0%': { backgroundColor: 'rgba(239, 68, 68, 0)' },
                    '50%': { backgroundColor: 'rgba(239, 68, 68, 0.3)' },
                    '100%': { backgroundColor: 'rgba(239, 68, 68, 0)' },
                },
                'shrink-out': {
                    '0%': { transform: 'scale(1)', opacity: '1', filter: 'brightness(2)', backgroundColor: 'white' },
                    '100%': { transform: 'scale(0)', opacity: '0' },
                },
                'float-up': {
                    '0%': { transform: 'translate(-50%, -50%) scale(1)', opacity: '1' },
                    '50%': { transform: 'translate(-50%, -150%) scale(1.5)', opacity: '1' },
                    '100%': { transform: 'translate(-50%, -300%) scale(1)', opacity: '0' },
                }
            }
        },
    },
    plugins: [],
}
