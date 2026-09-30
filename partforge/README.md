# PartForge 3D

Herramienta web para preparación de piezas 3D: visor, selección inteligente, separación de regiones, componentes desconectados, encajes macho/hembra, reparación básica y exportación STL/OBJ/3MF.

## Abrir
La aplicación vive en `/partforge/` dentro de este repositorio y está pensada para GitHub Pages.

## Flujo principal
1. Carga STL/OBJ/PLY/GLB/GLTF/3MF.
2. Selecciona una región o usa Smart Detach.
3. Previsualiza antes de separar.
4. Separa la pieza y cierra la interfaz cuando es posible.
5. Selecciona la pieza extraída y crea un encaje con diámetro, profundidad y holgura.
6. Distribuye y exporta las piezas para continuar en un slicer.

## IA
El panel IA 3D permite conectar un endpoint de generación/segmentación. Incluye integración opcional con Meshy mediante API desde navegador. Para producción se recomienda un backend/proxy seguro; nunca publiques una clave privada en el frontend.

## Privacidad
El procesamiento geométrico local se realiza en el navegador. Los modelos solo salen del navegador cuando el usuario usa una integración externa de IA/API.

## Compatibilidad
Chrome/Edge actuales son el objetivo principal, con WebGL 2 y APIs modernas del navegador.
