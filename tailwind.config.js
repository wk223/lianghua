/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './sidepanel/**/*.{ts,tsx,html}',
    './src/**/*.{ts,tsx,html}',
  ],
  theme: {
    extend: {
      colors: {
        // 四类结论颜色
        'buy': '#22c55e',
        'cond-buy': '#eab308',
        'watch': '#f97316',
        'no-buy': '#ef4444',
        // 市场环境级别
        'env-s': '#22c55e',
        'env-a': '#16a34a',
        'env-b': '#eab308',
        'env-c': '#f97316',
        'env-d': '#ef4444',
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont',
          '"Segoe UI"', 'Roboto', '"PingFang SC"',
          '"Microsoft YaHei"', 'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
