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
  console, setTimeout, clearTimeout, performance, URL, TextEncoder, Blob, Date, Math, JSON, Intl,
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

test('versión corta visible con dos decimales (ej. 1.00, 1.01)', () => {
  const m = html.match(/const APP_VER = '([^']+)';/);
  assert.ok(m, 'falta APP_VER en index.html');
  assert.match(m[1], /^\d+\.\d{2}$/);
});

test('versiones de la app y del service worker coinciden', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const a = html.match(/const APP_VERSION = '([^']+)'/)[1];
  assert.ok(sw.includes(`const VERSION = '${a}-`), 'corre  node tools/publicar.mjs  después de cambiar index.html');
});

test('el redondeo nunca contradice el semáforo', () => {
  const pct = run('pctTxt');
  assert.equal(pct(0.896, 0), '89.6%');
  assert.equal(pct(0.795, 0), '79.5%');
  assert.equal(pct(0.8999996, 0), '89.999%');
  assert.equal(pct(0.86, 0), '86%');
  assert.equal(pct(0.9, 0), '90%');
  assert.equal(pct(1, 0), '100%');
});

const prudente = () => run('CATALOG').find(x => x.id === 'prudente');
const formatoAntiguo = () => { const f = plain(run('congelarFormato')(prudente())); f.edicion = 'ANTIGUA'; f.programas[0].medidas.reverse(); return f; };

test('la ficha conserva el formulario con el que se llenó', () => {
  const I = { ...ficha(), formato: formatoAntiguo() };
  const n = prudente().programas[0].medidas.length;
  assert.equal(run('proj')(I).edicion, 'ANTIGUA');
  assert.equal(run('medida')(I, '0.0').texto, prudente().programas[0].medidas[n - 1]);
  assert.equal(run('proj')({ projectId: 'prudente' }).edicion, prudente().edicion);
});

test('los indicadores siguen la medida por su texto, no por su posición', () => {
  const claveEn = run('claveEn'), p = prudente();
  const I = { ...ficha(), formato: formatoAntiguo() }, n = p.programas[0].medidas.length;
  assert.equal(claveEn(I, p, '0.0'), `0.${n - 1}`);
  I.formato.programas[0].medidas[n - 1] = 'Medida que ya no existe en el catálogo';
  assert.equal(claveEn(I, p, '0.0'), null);
  // "No" en la medida 0 del catálogo, guardada en otra posición en las dos fichas antiguas
  const k = `0.${n - 1}`;
  run('S').list = ['2026-09-10', '2026-10-10'].map(fecha => ({ ...ficha({ fecha, fill: x => x === k ? 'no' : 'si' }), formato: formatoAntiguo() }));
  const d = run('datosInd')('prudente', { desde: '2026-09', hasta: '2026-10', txt: '' });
  const r = d.rec.find(x => x.k === '0.0');
  assert.ok(r, 'la recurrencia debe atribuirse a la medida correcta');
  assert.equal(r.veces, 2);
  assert.equal(d.rec.length, 1);
});

test('respaldo: solo acepta el formulario oficial (el PDF nunca imprime textos traídos de un archivo)', () => {
  const sanitizar = run('sanitizar');
  assert.throws(() => sanitizar({ inspeccion: { ...ficha(), formato: formatoAntiguo() } }), /formulario distinto/);
  const oficial = plain(run('congelarFormato')(prudente()));
  assert.equal(sanitizar({ inspeccion: { ...ficha(), formato: oficial } }).I.formato.edicion, prudente().edicion);
  const retocado = plain(oficial); retocado.programas[2].medidas[0] += ' (texto agregado)';
  assert.throws(() => sanitizar({ inspeccion: { ...ficha(), formato: retocado } }), /formulario distinto/);
  assert.equal(sanitizar({ inspeccion: ficha() }).I.formato.edicion, prudente().edicion);
  const malo = formatoAntiguo(); malo.programas[0].num = '<img src=x onerror=alert(1)>';
  assert.throws(() => sanitizar({ inspeccion: { ...ficha(), formato: malo } }), /formulario/);
  const malo2 = formatoAntiguo(); malo2.programas[0].medidas = 'no es lista';
  assert.throws(() => sanitizar({ inspeccion: { ...ficha(), formato: malo2 } }), /formulario/);
});

test('N/A precargada sin confirmar: la ficha no está completa y el PDF se bloquea', () => {
  const I = ficha(), f = I.frentes[0].id;
  I.answers['0.0'][f] = 'na'; I.prefill['0.0'] = { [f]: true };
  assert.equal(run('completa')(I), false);
  assert.equal(run('stats')(I)[0].pre, 1);
  run('S').insp = I; run('S').fotos = [];
  assert.ok(run('validar')().errs.some(e => e.t.includes('sin confirmar')));
  delete I.prefill['0.0'][f];
  assert.equal(run('completa')(I), true);
  assert.ok(!run('validar')().errs.some(e => e.t.includes('sin confirmar')));
  run('S').insp = null;
});

test('un error al guardar en el dispositivo nunca llega vacío', async () => {
  // Base de datos falsa: la escritura falla y, como en los navegadores, t.error todavía es null en ese momento
  const DB = run('DB'), real = DB.db;
  DB.db = { transaction() {
    const t = { error: null };
    t.objectStore = () => ({ put() { setTimeout(() => t.onerror({ target: { error: null } }), 0); return {}; }, index: () => ({ getAllKeys: () => ({}) }), delete() {} });
    return t;
  } };
  try {
    for (const intento of [() => DB.put('inspecciones', { id: 'x' }), () => DB.guardarFicha({ id: 'x' }, [], false)]) {
      const e = await intento().then(() => null, err => err);
      assert.ok(e, 'debe rechazar');
      assert.equal(typeof e.message, 'string');
      assert.ok(e.message.length > 0);
    }
  } finally { DB.db = real; }
});

test('exportar: filtra por proyecto y por rango de meses', () => {
  const f = run('fichasParaExportar');
  run('S').list = [ficha({ fecha: '2026-09-30' }), ficha({ fecha: '2026-10-01' }), ficha({ fecha: '2026-11-15' }), { ...ficha(), fecha: '' }, ficha({ projectId: 'rodeo', fecha: '2026-10-05' })];
  assert.equal(f(['prudente']).length, 4, 'sin rango entran todas, también la ficha sin fecha');
  assert.equal(f(['prudente'], '2026-10', '2026-10').length, 1);
  assert.equal(f(['prudente'], '2026-10').length, 2, 'solo "desde"');
  assert.equal(f(['prudente'], '', '2026-10').length, 2, 'solo "hasta": la ficha sin fecha no entra');
  assert.equal(f(['prudente', 'rodeo'], '2026-10', '2026-10').length, 2);
});

test('exportar: una foto sin marcas viaja una sola vez', () => {
  const sin = run('fotoSinCopia'), a = 'data:image/jpeg;base64,AAAA', b = 'data:image/jpeg;base64,BBBB';
  assert.equal(sin({ orig: a, composite: a }).composite, null);
  assert.equal(sin({ orig: a, composite: b }).composite, b);
  assert.equal(sin({ orig: a, composite: null }).composite, null);
});

test('fichas sin respaldar', () => {
  const sin = run('sinRespaldo'), A = run('A'), I = { ...ficha(), actualizado: 100 };
  A.respaldos = {};
  assert.equal(sin(I), true);
  A.respaldos = { [I.id]: 100 };
  assert.equal(sin(I), false);
  I.actualizado = 101;
  assert.equal(sin(I), true);
  const solo = ficha({ fill: () => '' }), f = solo.frentes[0].id;
  solo.answers['0.0'] = { [f]: 'na' }; solo.prefill['0.0'] = { [f]: true }; solo.actualizado = 5;
  assert.equal(sin(solo), false, 'una ficha solo con N/A precargadas no tiene trabajo que respaldar');
  // "Ocultar" esconde el aviso solo hasta que la ficha vuelve a cambiar
  A.respaldos = {}; run('S').list = [I];
  assert.match(run('avisoRespaldo')(), /sin respaldar/);
  A.respaldoOculto = 200;
  assert.equal(run('avisoRespaldo')(), '');
  I.actualizado = 201;
  assert.match(run('avisoRespaldo')(), /sin respaldar/);
  A.respaldos = {}; A.respaldoOculto = 0;
});

test('política de privacidad: texto aprobado (sin leyes, sin hospedaje, sin avisos)', () => {
  const t = run('privHTML')();
  assert.match(t, /Última actualización: /);
  for (const f of ['canales previamente autorizados', 'guarda los respaldos en un lugar seguro', 'Esta política puede actualizarse.', 'consulta con tu supervisor de ambiente', 'Cada inspector es responsable de las fichas que registra'])
    assert.ok(t.includes(f), 'falta: ' + f);
  for (const f of ['no lo prestes', 'versión vigente', 'Ley 81', 'Decreto', 'ANTAI', 'GitHub', 'autorice tu institución', '@'])
    assert.ok(!t.includes(f), 'no debería decir: ' + f);
  assert.equal((t.match(/<h2>/g) || []).length, 10);
});

test('porcentajes con los decimales de cada proyecto', () => {
  assert.equal(run('pctTxt')(0.8567, 1), '85.7%');
  assert.equal(run('pctTxt')(0.8567, 0), '86%');
  assert.equal(run('pctTxt')(null), '—');
});

test('inicio: una ficha completa toda en N/A no rompe la tarjeta del proyecto', () => {
  const I = ficha({ fill: () => 'na' });
  assert.equal(run('completa')(I), true);
  run('S').list = [I];
  const p = run('CATALOG').find(x => x.id === 'prudente');
  assert.match(run('tarjetaProyecto')(p), /sin porcentaje/);
  run('S').list = [];
});

test('Burunga/PTAR AE: planes "1." y medidas "1.1" también en fichas guardadas sin esa numeración', () => {
  const I = ficha({ projectId: 'ptar-ae' });
  I.formato = plain(run('congelarFormato')(run('CATALOG').find(x => x.id === 'ptar-ae')));
  I.formato.programas.forEach(pr => { delete pr.num; delete pr.numsTxt; });
  const p = run('proj')(I);
  assert.equal(p.programas[1].num, '2.');
  assert.deepEqual(plain(p.programas[1].nums), ['2.1', '2.2', '2.3']);
});

/* ---------- Importación de respaldos: robustez ---------- */
const IMG_OK = 'data:image/jpeg;base64,AAAA';

test('respaldo: claves heredadas ("constructor", "__proto__") no pasan como respuesta ni como frente', () => {
  assert.equal(run('ans')({ answers: { '0.0': { f1: 'constructor' } } }, '0.0', 'f1'), '');
  assert.equal(run('ans')({ answers: { '0.0': { f1: 'si' } } }, '0.0', 'f1'), 'si');
  const raw = ficha(), fid = raw.frentes[0].id;
  raw.answers['0.0'][fid] = 'constructor';
  const foto = frontId => ({ key: '0.0', frontId, orig: IMG_OK, composite: null, thumb: IMG_OK });
  const { I, fotos } = run('sanitizar')({ inspeccion: raw, fotos: [foto('constructor'), foto('__proto__'), foto(fid)] });
  assert.equal(I.answers['0.0'], undefined);
  assert.equal(fotos.length, 1);
});

test('respaldo: un id de frente repetido se descarta y no mezcla datos', () => {
  const raw = ficha({ frentes: ['A'] }), fid = raw.frentes[0].id;
  raw.frentes = [{ id: fid, nombre: 'Primero' }, { id: fid, nombre: 'Repetido' }];
  const { I } = run('sanitizar')({ inspeccion: raw, fotos: [] });
  assert.equal(I.frentes.length, 1);
  assert.equal(I.frentes[0].nombre, 'Primero');
});

test('respaldo: fotos excesivas se descartan (tamaño y cantidad por ficha)', () => {
  const raw = ficha(), fid = raw.frentes[0].id;
  const f = { key: '0.0', frontId: fid, orig: IMG_OK, composite: null, thumb: IMG_OK };
  const grande = { ...f, orig: 'data:image/jpeg;base64,' + 'A'.repeat(15 * 1048576 + 1) };
  const r = run('sanitizar')({ inspeccion: raw, fotos: [grande, f] });
  assert.equal(r.fotos.length, 1);
  assert.equal(r.omitidas, 1);
  const muchas = run('sanitizar')({ inspeccion: raw, fotos: Array.from({ length: 501 }, () => f) });
  assert.equal(muchas.fotos.length, 500);
  assert.equal(muchas.omitidas, 1);
});

test('respaldo: un archivo mayor al tope se rechaza con aviso antes de leerlo', async () => {
  run('var __msg = null; toast = m => { __msg = m; }');
  await run('importar')({ size: 601 * 1048576, text: () => { throw new Error('no debía leerse'); } });
  assert.match(run('__msg'), /600 MB/);
});

test('respaldo: una imagen de más de 40 MP no se dibuja', async () => {
  run("toJpeg = () => 'data:image/jpeg;base64,AAAA'");
  run('loadImg = async () => ({ naturalWidth: 9000, naturalHeight: 5000 })');   // 45 MP
  let r = await run('redibujarFotos')([{ orig: IMG_OK, composite: null }]);
  assert.equal(r.malas, 1);
  run('loadImg = async () => ({ naturalWidth: 1280, naturalHeight: 960 })');
  r = await run('redibujarFotos')([{ orig: IMG_OK, composite: null }]);
  assert.equal(r.malas, 0);
  assert.equal(r.fotos.length, 1);
});

test('ceder() resuelve aunque no exista scheduler.yield (Safari, node)', async () => {
  await run('ceder')();
  const cede = run('plazo')();
  await cede();
});

test('tema: sin valor guardado sigue al sistema; un valor guardado manda', () => {
  const getTheme = run('getTheme');
  const con = (guardado, oscuroSO) => { ctx.localStorage = { getItem: () => guardado, setItem() {}, removeItem() {} }; run(`mqOscuro.matches = ${oscuroSO}`); return getTheme(); };
  assert.equal(con(null, false), 'light');
  assert.equal(con(null, true), 'dark');
  assert.equal(con('light', true), 'light');
  assert.equal(con('dark', false), 'dark');
  assert.equal(con('constructor', true), 'dark');   // valor raro = como si no hubiera
  run('mqOscuro.matches = false');
});

/* ---------- Operación y Mantenimiento Panamá (grupo de tres formularios) ---------- */
const OYM = { 'oym-ptar': ['R-PA03-10', 6, 33, 'PTAR'], 'oym-ebar': ['R-PA03-08', 6, 34, 'EBAR'], 'oym-oc': ['R-PA03-09', 10, 55, 'OC'] };

test('OyM Panamá: tres tipos con sus códigos y conteos, numeración 1. / 1.1 y prefijo de frente vacío', () => {
  for (const [id, [cod, np, nm, sig]] of Object.entries(OYM)) {
    const p = run('CATALOG').find(x => x.id === id);
    assert.equal(p.codigo, cod); assert.equal(p.grupo, 'oym-panama'); assert.equal(p.prefijoFrente, '');
    assert.equal(p.programas.length, np);
    assert.equal(p.programas.reduce((a, pr) => a + pr.medidas.length, 0), nm);
    const I = ficha({ projectId: id }); I.formato = plain(run('congelarFormato')(p));
    const q = run('proj')(I);
    assert.equal(q.programas[0].num, '1.'); assert.equal(q.programas[1].num, '2.');
    assert.equal(q.programas[1].nums[0], '2.1'); assert.equal(q.programas[0].nums[1], '1.2');
    assert.equal(run('fileBase')({ ...I, fecha: '2026-11-05' }), `FCSA OyM Panamá ${sig} NOV-26`);
  }
  assert.equal(run('unidad')('oym-panama').codigo, 'R-PA03-08 · R-PA03-09 · R-PA03-10');
  assert.equal(run('UNIDADES').filter(u => u.id === 'oym-panama').length, 1);
});

test('OyM Panamá: las erratas de EBAR están corregidas', () => {
  const todas = id => run('CATALOG').find(x => x.id === id).programas.flatMap(p => p.medidas);
  assert.ok(todas('oym-ebar').includes('Se prohíbe la quema dentro de los sitios del proyecto'));
  assert.ok(todas('oym-ebar').some(m => m.startsWith('El área está libre')));
  assert.ok(!todas('oym-ebar').some(m => /lo sitios|esta libre/.test(m)));
});

test('numeración decimal solo en Burunga/PTAR AE y OyM; Prudente sigue sin ella', () => {
  const I = ficha({ projectId: 'prudente' }); I.formato = plain(run('congelarFormato')(run('CATALOG').find(x => x.id === 'prudente')));
  assert.equal(run('proj')(I).programas[1].num, undefined);
  const B = ficha({ projectId: 'burunga-este' }); B.formato = plain(run('congelarFormato')(run('CATALOG').find(x => x.id === 'burunga-este')));
  assert.equal(run('proj')(B).programas[1].num, '2.');
});

test('OyM Panamá: aviso mensual por grupo (una ficha de cualquier tipo cubre el mes) y fichas del grupo', () => {
  const Real = ctx.Date;
  ctx.Date = class extends Real { constructor(...a) { a.length ? super(...a) : super(2026, 10, 25, 12); } };
  try {
    const S = run('S'), nombres = () => run('avisosMes')().filter(a => a.p.id === 'oym-panama');
    S.list = [];
    assert.equal(nombres().length, 1); assert.equal(nombres()[0].p.nombre, 'Operación y Mantenimiento Panamá');
    assert.equal(run('avisosMes')().filter(a => a.p.id.startsWith('oym-') && a.p.id !== 'oym-panama').length, 0);
    S.list = [ficha({ projectId: 'oym-oc', fecha: '2026-11-03' })];
    assert.equal(nombres().length, 0);
    assert.equal(run('fichasDe')('oym-panama').length, 1);
    assert.equal(run('fichasDe')('oym-ptar').length, 0);   // fichasDe de un tipo suelto no recibe el grupo entero
    assert.equal(run('unidadDe')('oym-oc'), 'oym-panama');
    // el grupo se desactiva como unidad
    run('A').inactivos = ['oym-panama']; assert.equal(run('activo')('oym-ebar'), false); run('A').inactivos = [];
    S.list = [];
  } finally { ctx.Date = Real; }
});

test('OyM Panamá: Inicio, vista del grupo, Indicadores y diálogo de nueva ficha se dibujan sin error', () => {
  ctx.history = { state: null, pushState() {}, replaceState() {}, back() {} }; ctx.location.hash = '';
  const S = run('S'); S.list = [ficha({ projectId: 'oym-ebar', fecha: '2026-11-03' }), ficha({ projectId: 'oym-oc', fecha: '2026-11-04' })];
  run('renderProyectos')();
  run('renderProyecto')('oym-panama');
  S.ind = { projectId: 'oym-panama', periodo: '12m', desde: '', hasta: '' };
  run('renderInd')();
  assert.equal(S.ind.projectId, 'oym-ptar');   // un id de grupo abre su primer tipo
  const modal0 = ctx.modal; let cfg; ctx.modal = c => { cfg = c; };
  run('dlgNueva')('oym-panama', true); ctx.modal = modal0;
  assert.deepEqual([...cfg.body.matchAll(/<input type="radio"[^>]*value="([^"]+)"/g)].map(m => m[1]), ['oym-ptar', 'oym-ebar', 'oym-oc']);
  assert.ok(!/class="f nt"[^>]*hidden/.test(cfg.body));   // el selector de tipo se ve cuando el grupo viene fijo
  S.list = []; S.ind = null;
});
