/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@ionic/react/**/*.js", // ← Add this line
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
