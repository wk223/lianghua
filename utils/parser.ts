/**
 * 数据解析工具
 * 解析东方财富 API 返回数据 / 用户输入
 *
 * @module utils/parser
 * @todo S1-3: 完善数据解析逻辑
 */

/** 解析用户输入的股票列表 */
export function parseStockInput(input: string): { code: string; name: string }[] {
  const lines = input.trim().split('\n').filter(Boolean);
  return lines.map((line) => {
    const parts = line.trim().split(/[\s,，、]+/);
    if (parts.length >= 2) {
      // 尝试识别 "代码 名称" 或 "名称 代码"
      const first = parts[0].trim();
      const second = parts[1].trim();
      if (/^\d{6}$/.test(first)) {
        return { code: first, name: second };
      } else if (/^\d{6}$/.test(second)) {
        return { code: second, name: first };
      }
      return { code: first, name: second };
    }
    return { code: parts[0], name: '' };
  });
}

/** 判断股票代码属于哪个交易所 */
export function getExchange(code: string): 'SH' | 'SZ' | 'BJ' {
  if (code.startsWith('6')) return 'SH';
  if (code.startsWith('0') || code.startsWith('3')) return 'SZ';
  if (code.startsWith('4') || code.startsWith('8')) return 'BJ';
  return 'SZ';
}
