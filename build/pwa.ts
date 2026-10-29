/**
 * Build-time part of the installable web app:
 *  - writes dist/sw.js with the exact list of files of this build, and a
 *    version that changes whenever any of them changes
 *  - in the web build only, adds a Content-Security-Policy that lets the page
 *    talk to its own origin and nothing else (the desktop app sets its own
 *    policy in src-tauri/tauri.conf.json)
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

export const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "img-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function ezpdfPwa(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'ezpdf-pwa',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    transformIndexHtml(html) {
      if (config.mode !== 'production') return html;
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${WEB_CSP}" />`);
    },
    closeBundle() {
      const out = config.build.outDir;
      const files = walk(out)
        .map((p) => relative(out, p).split(sep).join('/'))
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.endsWith('.txt') && !f.endsWith('.md'))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(out, f)));
      const template = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8');
      const sw = template.replace('__EZPDF_VERSION__', hash.digest('hex').slice(0, 16)).replace('__EZPDF_FILES__', JSON.stringify(files, null, 2));
      writeFileSync(join(out, 'sw.js'), sw);
    },
  };
}
