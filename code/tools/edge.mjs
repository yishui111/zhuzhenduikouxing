// 开发用浏览器自动化：解析本机 Edge/Chrome 可执行文件路径
// 供 smoke / e2e / 建库等工具使用。查找顺序：环境变量 EDGE_PATH → CHROME_PATH → 常见安装位置。
// 找不到返回 null，由调用方给出提示后以退出码 0 跳过（避免 CI/无浏览器环境直接失败）。
import { existsSync } from 'node:fs';

const CANDIDATES = [
  process.env.EDGE_PATH || process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

export function resolveBrowserExe() {
  for (const p of CANDIDATES) {
    try {
      if (existsSync(p)) return p;
    } catch {
      /* 忽略非法路径 */
    }
  }
  return null;
}
