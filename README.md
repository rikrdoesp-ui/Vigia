# Vigia

Vigía — Control y Seguimiento Ambiental. App web instalable (un solo `index.html`) que funciona sin internet.

## Pruebas

Requiere Node 20 o más reciente, sin instalar nada:

```
node --test
```

Prueban los cálculos de cumplimiento, el semáforo del PA-03, los indicadores, el saneamiento de respaldos, el texto del PDF y la seguridad (CSP, versión de jsPDF, que no haya llamadas de red), cargando el script de `index.html`.

## Publicar una versión

Después de cualquier cambio en `index.html`, y antes del commit:

```
node tools/publicar.mjs
node --test
```

`tools/publicar.mjs` sube la versión corta visible (+0.01 sobre la del último commit: 1.00 → 1.01…; para un cambio grande: `node tools/publicar.mjs 2.00`), pone la versión con fecha y hora, recalcula la política de seguridad (CSP) y actualiza `sw.js` para que los teléfonos instalados reciban la actualización. **Si no se corre, la app publicada queda en blanco**: la CSP solo deja ejecutar los scripts cuya huella conoce. Las pruebas lo detectan.

## Seguridad

- La app no envía datos a ningún sitio: todo queda en el navegador del dispositivo. La CSP (`connect-src 'none'`, sin sitios externos) lo garantiza aunque entrara código malicioso.
- Solo se ejecutan los dos scripts de `index.html`, identificados por su huella SHA-256.
- jsPDF 4.2.1 incluido, verificado con el checksum publicado en npm. Las fotos de los respaldos importados se vuelven a dibujar antes de guardarlas.
