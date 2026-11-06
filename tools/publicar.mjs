// Prepara index.html y sw.js para publicar una versión nueva de Vigía.
//   node tools/publicar.mjs            -> versión con la fecha y hora actuales
//   node tools/publicar.mjs 2026.11.06-1500
// Hace tres cosas, en este orden:
//   1. Pone APP_VERSION en index.html.
//   2. Recalcula la política de seguridad (CSP): solo se ejecutan los scripts de la app, identificados
//      por su huella SHA-256, y se bloquea toda conexión a otros sitios.
//   3. Pone en sw.js la misma versión + los 10 primeros caracteres del SHA-1 de index.html,
//      para que los dispositivos instalados reciban la actualización.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
  const version = process.argv[2] || `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  if (!/^\d{4}\.\d{2}\.\d{2}-\d{4}$/.test(version)) throw new Error('Versión inválida: ' + version);

  let html = readFileSync(new URL('index.html', root), 'utf8');

  // 1. Versión de la app
  if (!/const APP_VERSION = '[^']*';/.test(html)) throw new Error('No se encontró APP_VERSION en index.html');
  html = html.replace(/const APP_VERSION = '[^']*';/, `const APP_VERSION = '${version}';`);

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

  console.log(`Vigía ${version} · CSP con ${huellas(html).length} scripts · sw ${version}-${sha1}`);
}
