VENTA3D PRO v3

Cambios principales:
- Tiempo de impresión por horas + minutos.
- Fecha y hora exactas de pedido y entrega.
- Cuenta regresiva de entrega: días, horas y minutos.
- Alertas de notificación cuando una entrega entra en las próximas 24 horas mientras la app está abierta.
- Moneda configurable (CLP, USD, EUR, ARS, BRL, MXN, PEN, COP).
- Producto y cliente se escriben directamente; los guardados solo aparecen como sugerencias.
- Catálogos reutilizables sin repetir campos en Nueva venta.
- Dashboard de próximas entregas.
- Historial con estado y cuenta regresiva.
- Tiempo de productos guardados también en horas + minutos.
- Service Worker actualizado a v3 para evitar caché de la versión anterior.

GitHub Pages:
Sube/reemplaza index.html y sw.js en la raíz del repositorio.
Mantén manifest.json, iconos y favicon.
Después abre la URL de GitHub Pages en Chrome.
Si sigue apareciendo la versión antigua, cierra la pestaña/PWA y vuelve a abrirla; el Service Worker v3 elimina la caché anterior.
