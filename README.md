# Vigia

Vigía — Control y Seguimiento Ambiental. App web instalable (un solo `index.html`) que funciona sin internet.

## Pruebas

Requiere Node 20 o más reciente, sin instalar nada:

```
node --test
```

Prueban los cálculos de cumplimiento, el semáforo del PA-03, los indicadores, el saneamiento de respaldos y el texto del PDF, cargando el script de `index.html`.

## Publicar una versión

Al cambiar `index.html`, actualizar juntas `APP_VERSION` en `index.html` y `VERSION` en `sw.js` (fecha-hora + primeros 10 caracteres del SHA-1 de `index.html`), para que los teléfonos instalados reciban la actualización.
