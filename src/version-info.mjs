// 版本号三处一致性：package.json（唯一来源）、根目录 VERSION 文件、CHANGELOG 首条。
// scripts/status-line.mjs 守五处（含两份 README），这里守 CLI 承诺的三处——
// 「agent-web version」把判决印出来并给出退出码，而不是让人自己对数。
import fs from 'node:fs';
import path from 'node:path';

const VERSION_FORM = /^\d+\.\d+\.\d+$/;
const CHANGELOG_HEADING = /^##\s+/;

export function collectVersionInfo({ root, pkgVersion }) {
  const problems = [];
  const read = (p) => {
    try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
  };

  // 第一处：根目录 VERSION 文件。
  const versionRaw = read(path.join(root, 'VERSION'));
  const versionFile = versionRaw === null ? null : versionRaw.trim();
  if (versionFile === null) {
    problems.push('VERSION 文件不存在（应有且仅有一行版本号）');
  } else if (!VERSION_FORM.test(versionFile)) {
    problems.push(`VERSION 文件内容不是 x.y.z 形式：「${versionFile}」`);
  }

  // 第二处：CHANGELOG.md 首条「## x.y.z」。
  const log = read(path.join(root, 'CHANGELOG.md'));
  let changelogVersion = null;
  let changelogHead = null;
  let latestSummary = null;
  if (log === null) {
    problems.push('CHANGELOG.md 不存在');
  } else {
    const lines = log.split(/\r?\n/); // 仓库 CHANGELOG 是 CRLF，解析不能挑行尾
    const idx = lines.findIndex((l) => CHANGELOG_HEADING.test(l));
    if (idx === -1 || !/^##\s+(\d+\.\d+\.\d+)/.test(lines[idx])) {
      problems.push('CHANGELOG.md 没有「## x.y.z」形式的首条版本');
    } else {
      changelogVersion = lines[idx].match(/^##\s+(\d+\.\d+\.\d+)/)[1];
      changelogHead = lines[idx].replace(/^##\s+/, '').trim();
      for (let i = idx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || CHANGELOG_HEADING.test(line)) continue;
        latestSummary = line.replace(/^[-*]\s+/, '').trim();
        break;
      }
    }
  }

  // 第三处：package.json（唯一来源，另两处跟它看齐）。
  if (versionFile !== null && versionFile !== pkgVersion) {
    problems.push(`VERSION 文件 ${versionFile} ≠ package.json ${pkgVersion}`);
  }
  if (changelogVersion !== null && changelogVersion !== pkgVersion) {
    problems.push(`CHANGELOG 首条 ${changelogVersion} ≠ package.json ${pkgVersion}`);
  }

  return {
    pkgVersion,
    versionFile,
    changelogVersion,
    changelogHead,
    latestSummary,
    consistent: problems.length === 0,
    problems,
  };
}
