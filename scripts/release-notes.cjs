#!/usr/bin/env node
/**
 * The text of a GitHub release (used by the release job in
 * .github/workflows/build.yml):
 *
 *   node scripts/release-notes.cjs 0.8.7            the release notes (Markdown)
 *   node scripts/release-notes.cjs 0.8.7 --title    the release title
 *
 * What the version brings is taken from its row in docs/03-ke-hoach-cac-moc.md
 * ("| **Bản 0.8.7 · Xuất thành ảnh** ✅ | what it brings | how it was checked |");
 * a version without a row gets the download list only. GitHub adds the list of
 * commits after this text.
 */
const fs = require('fs');
const path = require('path');

const [version, flag] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('usage: release-notes.cjs X.Y.Z [--title]');
  process.exit(2);
}

const plan = fs.readFileSync(path.join(__dirname, '..', 'docs', '03-ke-hoach-cac-moc.md'), 'utf8');
const row = plan.split('\n').find((l) => l.startsWith(`| **Bản ${version} `) || l.startsWith(`| **Bản ${version}**`));
const cells = row ? row.trim().replace(/^\|/, '').replace(/\|$/, '').split(' | ').map((c) => c.trim()) : [];
// "**Bản 0.8.7 · Xuất thành ảnh** ✅" → "Xuất thành ảnh"
const name = cells[0]?.match(/^\*\*Bản [\d.]+(?: · (.+?))?\*\*/)?.[1] ?? '';
const brings = cells.length >= 3 ? cells[1] : '';

if (flag === '--title') {
  console.log(name ? `ezPDF ${version} · ${name}` : `ezPDF ${version}`);
  process.exit(0);
}

const repo = process.env.GITHUB_REPOSITORY || 'quanbughunter/ezpdf';
const [owner, project] = repo.split('/');
const lines = [];
if (brings) lines.push(brings, '');
lines.push(
  '## Tải về',
  '',
  '| Tệp | Dùng cho |',
  '|---|---|',
  `| \`ezPDF-${version}-android.apk\` | Android: mở tệp trên điện thoại để cài. Cài đè được lên bản trước (cùng khóa ký), giữ nguyên bản nháp. |`,
  `| \`ezPDF-${version}-windows-setup.exe\` | Windows 10, 11: bộ cài (nên dùng). |`,
  `| \`ezPDF-${version}-windows.msi\` | Windows: gói MSI, cho máy cài qua công cụ quản lý. |`,
  '',
  `iPhone và trình duyệt dùng bản web, luôn là bản mới nhất: https://${owner}.github.io/${project}/`,
  '',
  '**Lưu ý khi cài**',
  '',
  '- Windows: bộ cài chưa ký số, nên SmartScreen có thể hiện “Windows protected your PC”. Bấm “More info” rồi “Run anyway”.',
  '- Android: APK không đến từ Google Play, nên máy hỏi quyền “Cài ứng dụng không rõ nguồn gốc” cho trình duyệt hoặc ứng dụng Tệp. Cho phép một lần là được. APK ký bằng khóa thử nghiệm của dự án, chưa phải khóa phát hành.',
  '',
);
process.stdout.write(lines.join('\n'));
