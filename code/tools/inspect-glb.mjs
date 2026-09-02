// GLB 检查工具：列出模型的 morph target（blendshape）名称、数量、面数、顶点数
// 用法：node tools/inspect-glb.mjs <xxx.glb> [--detail]
// 用途：M0 资产验收 —— blendshape ≥15、命名符合 ARKit、面数 ≤1万
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('用法: node inspect-glb.mjs <模型.glb> [--detail]'); process.exit(1); }
const detail = process.argv.includes('--detail');

const buf = readFileSync(file);
const magic = buf.toString('ascii', 0, 4);
if (magic !== 'glTF') { console.error('不是 GLB 文件'); process.exit(1); }
const version = buf.readUInt32LE(4);
let off = 12;
let json = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
  off += 8 + len;
}
if (!json) { console.error('GLB 中没有 JSON chunk'); process.exit(1); }

console.log(`文件: ${file}`);
console.log(`glTF 版本: ${version}, 生成器: ${json.asset?.generator ?? '未知'}`);
console.log(`网格数: ${json.meshes?.length ?? 0}, 材质数: ${json.materials?.length ?? 0}, 节点数: ${json.nodes?.length ?? 0}`);

const totalTargets = new Set();
for (const mesh of json.meshes ?? []) {
  for (const prim of mesh.primitives ?? []) {
    const targets = prim.targets ?? [];
    const targetNames = prim.extras?.targetNames ?? mesh.extras?.targetNames ?? [];
    // 顶点数：POSITION accessor 的 count
    const posAcc = json.accessors?.[prim.attributes?.POSITION];
    const verts = posAcc?.count ?? '?';
    console.log(`\n[网格] ${mesh.name ?? '(无名)'}`);
    console.log(`  三角面数(索引/3): ${(json.accessors?.[prim.indices]?.count ?? '?') !== '?' ? Math.round(json.accessors[prim.indices].count / 3) : '?'}, 顶点数: ${verts}`);
    console.log(`  morph target 数量: ${targets.length}`);
    if (targetNames.length) {
      console.log(`  morph target 名称 (${targetNames.length}):`);
      const names = [...targetNames];
      names.forEach((n, i) => { if (!detail && i >= 40) return; console.log(`    ${i}: ${n}`); if (!detail && i === 40) console.log(`    ... 共 ${names.length} 个`); });
      names.forEach(n => totalTargets.add(n));
    } else {
      console.log('  ⚠️ 未找到 targetNames（在 primitives.extras 或 mesh.extras），无法做 ARKit 命名校验');
    }
  }
}

// ARKit 常用子集校验
const ark = ['mouthOpen','mouthSmile','mouthFrown','mouthWide','browUpLeft','browUpRight','browDownLeft','browDownRight','eyeBlinkLeft','eyeBlinkRight','eyeSquintLeft','eyeSquintRight','jawOpen','cheekPuff'];
if (totalTargets.size) {
  const have = [...totalTargets];
  const missing = ark.filter(a => !have.includes(a));
  console.log(`\n[ARKit 子集校验] 方案所需 ${ark.length} 项，缺少: ${missing.length ? missing.join(', ') : '无（全部覆盖）'}`);
}
