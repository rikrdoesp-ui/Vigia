// Pruebas de los cálculos de Vigía. Se ejecutan con:  node --test tests/
// Cargan el <script> de la app desde index.html en un entorno aislado (sin navegador)
// y prueban las funciones puras: cumplimiento, semáforo, validación y respaldos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const app = scripts.find(s => s.includes('const CATALOG'));
assert.ok(app, 'no se encontró el script de la app en index.html');

// Navegador mínimo: lo justo para que el script cargue sin tocar IndexedDB ni el DOM real.
const dummy = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : dummy), apply: () => dummy, set: () => true });
const ctx = vm.createContext({
  console, setTimeout, clearTimeout, URL, TextEncoder, Blob, Date, Math, JSON, Intl,
  document: { addEventListener() {}, querySelector: () => dummy, querySelectorAll: () => [], documentElement: { dataset: {} }, visibilityState: 'visible' },
  window: { addEventListener() {}, innerWidth: 1280, matchMedia: () => ({ matches: false }) },
  location: { protocol: 'file:', hostname: '' },
  navigator: {},
  localStorage: { getItem: () => null, setItem() {} },
  matchMedia: () => ({ matches: false }),
  indexedDB: { open: () => { throw new Error('sin IndexedDB en pruebas'); } },
});
vm.runInContext(app, ctx, { filename: 'index.html' });
const run = code => vm.runInContext(code, ctx);
// Los objetos creados dentro del entorno aislado tienen otro prototipo: se comparan como JSON.
const plain = v => JSON.parse(JSON.stringify(v));

// Ficha sintética: answers[medida][frente] = 'si' | 'no' | 'na'
function ficha({ projectId = 'prudente', fecha = '2026-10-15', frentes = ['A'], fill = () => 'si', obs = 'Hallazgo' } = {}) {
  const p = run('CATALOG').find(x => x.id === projectId);
  const fs = frentes.map((n, i) => ({ id: 'f' + i + 'xyz', nombre: n }));
  const I = { id: 'i' + Math.random().toString(36).slice(2, 10), projectId, fecha, inspectores: ['Prueba'], acompanamiento: [], contratista: p.contratistas[0],
    frentes: fs, answers: {}, obs: {}, prefill: {}, prefillKeys: [], usarFirma: false, creado: 1, actualizado: 1 };
  run('keysOf')(p).forEach((k, idx) => fs.forEach((f, fi) => {
    const v = fill(k, fi, idx); if (!v) return;
    (I.answers[k] ||= {})[f.id] = v;
    if (v === 'no' && obs) (I.obs[k] ||= {})[f.id] = obs;
  }));
  return I;
}

test('cumplimiento del programa = Sí / (Sí + No); vacío si todo es N/A', () => {
  const progPct = run('progPct');
  // Programa 0 de Prudente tiene 7 medidas: 5 Sí, 2 No -> 5/7
  const I = ficha({ fill: k => (k === '0.0' || k === '0.1') ? 'no' : 'si' });
  assert.equal(progPct(I, 0, I.frentes[0].id), 5 / 7);
  const todoNA = ficha({ fill: k => k.startsWith('0.') ? 'na' : 'si' });
  assert.equal(progPct(todoNA, 0, todoNA.frentes[0].id), null);
});

test('N/A no cuenta en el cálculo', () => {
  const progPct = run('progPct');
  const I = ficha({ fill: k => k === '0.0' ? 'no' : k.startsWith('0.') ? 'na' : 'si' });
  assert.equal(progPct(I, 0, I.frentes[0].id), 0);   // un 0 % sí cuenta
});

test('cumplimiento total = promedio de programas por frente y luego de frentes', () => {
  const stats = run('stats'), cumplTotal = run('cumplTotal');
  // Frente A: todo Sí (100 %). Frente B: programa 0 todo No (0 %), resto Sí.
  const I = ficha({ frentes: ['A', 'B'], fill: (k, fi) => (fi === 1 && k.startsWith('0.')) ? 'no' : 'si' });
  const st = stats(I);
  const nProg = run('CATALOG').find(x => x.id === 'prudente').programas.length;
  assert.equal(st[0].pct, 1);
  assert.ok(Math.abs(st[1].pct - (nProg - 1) / nProg) < 1e-12);
  assert.ok(Math.abs(cumplTotal(st) - (1 + (nProg - 1) / nProg) / 2) < 1e-12);
});

test('semáforo PA-03: ≥ 90 % cumple, 80–89 % alerta, < 80 % no cumple (sin redondear hacia arriba)', () => {
  const nivel = run('nivel');
  assert.equal(nivel(0.9).k, 'ok');
  assert.equal(nivel(0.8999).k, 'warn');
  assert.equal(nivel(0.8).k, 'warn');
  assert.equal(nivel(0.7999).k, 'bad');
  assert.equal(nivel(null), null);
  assert.equal(run('nivelMes')(0.85).t, 'Requiere plan de acción');
});

test('una ficha con "No" sin observación no está completa', () => {
  const completa = run('completa');
  assert.equal(completa(ficha()), true);
  assert.equal(completa(ficha({ fill: k => k === '0.0' ? 'no' : 'si', obs: '' })), false);
  assert.equal(completa(ficha({ fill: k => k === '0.0' ? '' : 'si' })), false);
});

test('observaciones iguales en varios frentes se agrupan', () => {
  const I = ficha({ frentes: ['CI-2AN', 'CI-16AN', 'CI-3'], fill: (k, fi) => k === '1.0' ? 'no' : 'si' });
  I.obs['1.0'][I.frentes[2].id] = 'Otra cosa';
  const g = run('obsAgrupada')(I, '1.0');
  assert.deepEqual(plain(g.map(x => x.fs)), [['CI-2AN', 'CI-16AN'], ['CI-3']]);
});

test('indicadores: el mapa programa × mes cuenta todas las fichas del mes (no fijo en 2)', () => {
  const fichas = [1, 2, 3].map(d => ficha({ fecha: `2026-10-0${d}` }));
  run('S').list = fichas;
  const d = run('datosInd')('prudente', { desde: '2026-10', hasta: '2026-10', txt: '' });
  assert.equal(d.mapa[0][0].n, 3);
  assert.equal(d.mensual[0].fichas.length, 3);
});

test('medidas recurrentes: detecta "No" consecutivo', () => {
  const fichas = ['2026-08-10', '2026-09-10', '2026-10-10'].map((f, i) => ficha({ fecha: f, fill: k => (k === '2.1' && i > 0) ? 'no' : 'si' }));
  run('S').list = fichas;
  const d = run('datosInd')('prudente', { desde: '2026-08', hasta: '2026-10', txt: '' });
  const r = d.rec.find(x => x.k === '2.1');
  assert.ok(r);
  assert.equal(r.veces, 2);
  assert.equal(r.racha, 2);
  assert.equal(r.ultimaSigue, true);
});

test('respaldo: se rechaza un proyecto desconocido y se limpian datos inválidos', () => {
  const sanitizar = run('sanitizar');
  assert.throws(() => sanitizar({ inspeccion: { projectId: 'otro', frentes: [{ id: 'abcd1', nombre: 'X' }] } }), /proyecto/);
  const raw = ficha();
  const fid = raw.frentes[0].id;
  raw.answers['0.0'][fid] = 'quizás';            // respuesta inválida
  raw.answers['0.1'][fid] = 'N/A';               // formato viejo, se acepta
  raw.fecha = '15/10/2026';                      // fecha en formato incorrecto
  const { I, fotos, omitidas } = sanitizar({
    inspeccion: raw,
    fotos: [
      { key: '0.0', frontId: fid, orig: 'javascript:alert(1)', composite: 'x', thumb: 'x' },
      { key: '0.0', frontId: fid, orig: 'data:image/jpeg;base64,AAAA', composite: 'data:image/jpeg;base64,AAAA', thumb: 'data:image/jpeg;base64,AAAA', shapes: [{ type: 'circle', x1: 5, y1: -1, x2: 0.5, y2: 0.5 }] },
    ],
  });
  assert.equal(I.answers['0.0'], undefined);
  assert.equal(I.answers['0.1'][fid], 'na');
  assert.equal(I.fecha, '');
  assert.equal(fotos.length, 1);
  assert.equal(omitidas, 1);
  assert.deepEqual(plain(fotos[0].shapes[0]),{ type: 'circle', x1: 1, y1: 0, x2: 0.5, y2: 0.5 });
});

test('texto del PDF: símbolos fuera de la fuente se cambian o se quitan', () => {
  assert.equal(run('pdfTxt')('pH ≥ 6 → ok ✓ ñáé'), 'pH >= 6 -> ok v ñáé');
  assert.deepEqual(plain(run('charsNoPDF')('CO₂ y 😀')), ['₂', '😀']);
});

test('seguridad: la CSP coincide con los scripts y bloquea conexiones externas', async () => {
  const { huellas, csp, CSP_RE } = await import('../tools/publicar.mjs');
  const m = html.match(CSP_RE);
  assert.ok(m, 'falta la etiqueta Content-Security-Policy en index.html');
  // Si alguien cambia index.html sin correr tools/publicar.mjs, la app quedaría en blanco: esta prueba lo detecta.
  assert.equal(m[1], csp(huellas(html)), 'la CSP está desactualizada: corre  node tools/publicar.mjs');
  assert.ok(html.indexOf(m[0]) < html.indexOf('<script>'), 'la CSP debe ir antes de los scripts');
  assert.match(m[1], /connect-src 'none'/);
  assert.doesNotMatch(m[1], /script-src[^;]*unsafe/, 'los scripts deben ir por huella, nunca con unsafe-inline');
  assert.doesNotMatch(m[1], /https?:/, 'la CSP no debe permitir ningún sitio externo');
});

test('seguridad: librería PDF sin las vulnerabilidades conocidas (jsPDF ≥ 4.2.1)', () => {
  const v = html.match(/jsPDF - PDF Document creation from JavaScript\s*\*\s*Version (\d+)\.(\d+)\.(\d+)/);
  assert.ok(v, 'no se encontró la versión de jsPDF');
  const [, a, b, c] = v.map(Number);
  assert.ok(a > 4 || (a === 4 && (b > 2 || (b === 2 && c >= 1))), `jsPDF ${a}.${b}.${c} es anterior a 4.2.1`);
});

test('seguridad: la app no hace llamadas de red', () => {
  assert.doesNotMatch(app, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
});

test('versiones de la app y del service worker coinciden', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const a = html.match(/const APP_VERSION = '([^']+)'/)[1];
  assert.ok(sw.includes(`const VERSION = '${a}-`), 'corre  node tools/publicar.mjs  después de cambiar index.html');
});

test('porcentajes con los decimales de cada proyecto', () => {
  assert.equal(run('pctTxt')(0.8567, 1), '85.7%');
  assert.equal(run('pctTxt')(0.8567, 0), '86%');
  assert.equal(run('pctTxt')(null), '—');
});
