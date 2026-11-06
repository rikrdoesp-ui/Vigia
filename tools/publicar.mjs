// Prepara index.html y sw.js para publicar una versión nueva de Vigía.
//   node tools/publicar.mjs            -> versión con la fecha y hora actuales; versión corta = la del último commit + 0.01
//   node tools/publicar.mjs 2.00       -> versión corta indicada a mano (para un cambio grande)
//   node tools/publicar.mjs 2026.11.06-1500
// Hace tres cosas, en este orden:
//   1. Pone APP_VERSION (fecha y hora) y APP_VER (versión corta visible, ej. 1.03) en index.html.
//      La versión corta se calcula sobre la del último commit, así correrlo varias veces antes del commit no la sube de más.
//   2. Recalcula la política de seguridad (CSP): solo se ejecutan los scripts de la app, identificados
//      por su huella SHA-256, y se bloquea toda conexión a otros sitios.
//   3. Pone en sw.js la misma versión + los 10 primeros caracteres del SHA-1 de index.html,
//      para que los dispositivos instalados reciban la actualización.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* Huellas SHA-256 de los <script> en línea (el navegador convierte CRLF en LF antes de calcularlas) */
export function huellas(src) {
  return [...src.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(m => "'sha256-" + createHash('sha256').update(m[1].replace(/\r\n?/g, '\n'), 'utf8').digest('base64') + "'");
}
export const csp = h => [
  "default-src 'none'",
  `script-src ${h.join(' ')}`,
  "style-src 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-src blob:",            // solo la vista previa del PDF generado en el propio dispositivo
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
export const CSP_RE = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = new URL('../', import.meta.url);
  const pad = n => String(n).padStart(2, '0');
  const d = new Date();
  const args = process.argv.slice(2);
  const corta = args.find(a => /^\d+\.\d{2}$/.test(a));
  const version = args.find(a => /^\d{4}\.\d{2}\.\d{2}-\d{4}$/.test(a)) || `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  for (const a of args) if (a !== corta && a !== version) throw new Error('Argumento inválido: ' + a + ' (usa 2.00 o 2026.11.06-1500)');

  let html = readFileSync(new URL('index.html', root), 'utf8');

  // 1. Versión de la app
  if (!/const APP_VERSION = '[^']*';/.test(html)) throw new Error('No se encontró APP_VERSION en index.html');
  html = html.replace(/const APP_VERSION = '[^']*';/, `const APP_VERSION = '${version}';`);

  // 1b. Versión corta: la indicada, o la del último commit + 0.01
  if (!/const APP_VER = '[^']*';/.test(html)) throw new Error('No se encontró APP_VER en index.html');
  let base = null;
  try { base = (execSync('git show HEAD:index.html', { cwd: fileURLToPath(root), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }).match(/const APP_VER = '(\d+\.\d{2})';/) || [])[1] || null; } catch {}
  const ver = corta || (base ? (Math.round(parseFloat(base) * 100) + 1) / 100 : parseFloat(html.match(/const APP_VER = '([^']*)';/)[1])).toFixed(2);
  html = html.replace(/const APP_VER = '[^']*';/, `const APP_VER = '${ver}';`);

  // 2. CSP (va justo después de <meta charset> para que aplique antes de cualquier script)
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp(huellas(html))}">`;
  html = CSP_RE.test(html) ? html.replace(CSP_RE, meta) : html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${meta}`);
  writeFileSync(new URL('index.html', root), html);

  // 3. Versión del service worker (sobre el contenido que publica GitHub, con LF)
  const sha1 = createHash('sha1').update(html.replace(/\r\n/g, '\n'), 'utf8').digest('hex').slice(0, 10);
  const swUrl = new URL('sw.js', root);
  const sw = readFileSync(swUrl, 'utf8');
  if (!/const VERSION = '[^']*';/.test(sw)) throw new Error('No se encontró VERSION en sw.js');
  writeFileSync(swUrl, sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}-${sha1}';`));

  console.log(`Vigía v${html.match(/const APP_VER = '([^']*)';/)[1]} (${version}) · CSP con ${huellas(html).length} scripts · sw ${version}-${sha1}`);
}
