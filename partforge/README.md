# PartForge 3D

Web app estática para GitHub Pages enfocada en separar modelos 3D, preparar piezas para impresión y crear encajes.

## Funciones
- STL / OBJ / PLY / GLB / GLTF / 3MF
- visor 3D con órbita, zoom y vistas
- selección por clic
- Smart Detach por continuidad de caras y ángulo entre normales
- selección por componentes conectados
- selección aproximada por color
- cierre/cap de los bordes de la separación
- diagnóstico básico de malla
- encajes cilíndricos y cuadrados mediante CSG cuando el motor está disponible
- exportación STL, OBJ, 3MF y proyecto JSON
- distribución en placa
- modo X-Ray y wireframe

## Librerías
- Three.js 0.186.1
- three-mesh-bvh 0.9.15 / three-bvh-csg 0.0.18 mediante ESM CDN

## Nota sobre IA
La segmentación semántica (por ejemplo, entender "ojo", "nariz" u "oreja") requiere un modelo especializado o una API. PartForge deja ese flujo aislado para no exponer claves privadas en GitHub Pages.