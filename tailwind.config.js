/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './sidepanel/**/*.{ts,tsx,html}',
    './content/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // 四类结论颜色
        'buy': '#22c55e',       // 🟢 可直接买
        'cond-buy': '#eab308',  // 🟡 条件买
        'watch': '#f97316',     // 🟠 观察
        'no-buy': '#ef4444',    // 🔴 不买
        // 市场环境级别
        'env-s': '#22c55e',     // S 级
        'env-a': '#16a34a',     // A 级
        'env-b': '#eab308',     // B 级
        'env-c': '#f97316',     // C 级
        'env-d': '#ef4444',     // D 级
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
