import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import { zipSync, strToU8 } from 'fflate';

const $ = (id) => document.getElementById(id);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  page: 'home',
  colorMode: 'single',
  images: [],
  palette: [],
  api: {
    provider: localStorage.getItem('pf_provider') || 'meshy',
    key: localStorage.getItem('pf_api_key') || '',
    endpoint: localStorage.getItem('pf_api_endpoint') || 'https://api.meshy.ai/openapi/v1'
  },
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
  modelRoot: null,
  parts: [],
  activePart: null,
  tool: 'object',
  selection: new Map(),
  selectionAddMode: 'replace',
  overlayGroup: null,
  selectionDraw: [],
  drawing: false,
  lastHit: null,
  xray: false,
  wire: false,
  aiGenerationTask: null,
  aiSplitTask: null,
  aiColorTask: null,
  aiBusy: false,
  aiStop: false,
  current3mfUrl: null,
  currentThumbnail: null
};

const namedColors = [
  ['rojo', '#e53935'], ['naranja', '#fb8c00'], ['amarillo', '#fdd835'], ['verde', '#43a047'],
  ['turquesa', '#00acc1'], ['azul', '#1e88e5'], ['morado', '#8e24aa'], ['rosa', '#ec407a'],
  ['café', '#6d4c41'], ['beige', '#d7c3a4'], ['gris', '#757575'], ['negro', '#15171b'], ['blanco', '#f2f2f2']
];

function toast(message, type = 'info') {
  const el = $('toast');
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.remove('show'), 4200);
}

function status(message, progress = '') {
  $('globalStatusText').textContent = message;
  $('globalProgress').textContent = progress;
}

function showModal(id) { $(id).classList.remove('hidden'); }
function hideModal(id) { $(id).classList.add('hidden'); }

function showPage(page) {
  state.page = page;
  qsa('.page').forEach(p => p.classList.remove('activePage'));
  const target = page === 'home' ? 'pageHome' : page === 'image3d' ? 'pageImage3d' : 'pageEditor';
  $(target).classList.add('activePage');
  if (page === 'editor') requestAnimationFrame(() => resizeRenderer());
}

function initTooltips() {
  const tip = document.createElement('div');
  tip.id = 'tip';
  document.body.appendChild(tip);
  let timer;
  document.addEventListener('pointerover', (event) => {
    const node = event.target.closest('[data-tip]');
    if (!node) return;
    const text = node.dataset.tip;
    if (!text) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      tip.textContent = text;
      tip.classList.add('show');
      const r = node.getBoundingClientRect();
      const width = Math.min(250, Math.max(160, text.length * 5.2));
      tip.style.width = `${width}px`;
      let left = r.left + r.width / 2 - width / 2;
      left = Math.max(8, Math.min(window.innerWidth - width - 8, left));
      let top = r.bottom + 8;
      if (top + 70 > window.innerHeight) top = r.top - 72;
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(8, top)}px`;
    }, 220);
  });
  document.addEventListener('pointerout', (event) => {
    const node = event.target.closest('[data-tip]');
    if (!node) return;
    clearTimeout(timer);
    tip.classList.remove('show');
  });
}

function loadApiSettings() {
  $('apiProvider').value = 'meshy'; state.api.provider='meshy';
  $('apiKey').value = state.api.key;
  $('apiEndpoint').value = state.api.endpoint;
  updateApiStatus();
}

function updateApiStatus() {
  const dot = $('apiDot');
  const text = $('apiStatus');
  const configured = Boolean(state.api.key);
  dot.classList.toggle('good', configured);
  text.textContent = configured ? 'API configurada localmente' : 'API no configurada';
}

function openApiModal() {
  loadApiSettings();
  showModal('apiModal');
}

function saveApiSettings() {
  state.api.provider = $('apiProvider').value;
  state.api.key = $('apiKey').value.trim();
  state.api.endpoint = $('apiEndpoint').value.trim().replace(/\/$/, '') || 'https://api.meshy.ai/openapi/v1';
  localStorage.setItem('pf_provider', state.api.provider);
  localStorage.setItem('pf_api_key', state.api.key);
  localStorage.setItem('pf_api_endpoint', state.api.endpoint);
  updateApiStatus();
  hideModal('apiModal');
  toast(state.api.key ? 'Configuración IA guardada en este navegador.' : 'API sin clave.');
}

async function fileToDataURL(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function emptyViewSlot(index) {
  const labels = ['Frente', 'Izquierda', 'Atrás', 'Derecha'];
  return `<div class="viewSlot" data-slot="${index}"><span class="slotLabel">${labels[index]}</span><div class="slotPlus">＋</div><small>clic para añadir</small></div>`;
}

function renderViewGrid() {
  const grid = $('viewGrid');
  grid.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const image = state.images[i];
    const wrap = document.createElement('div');
    wrap.className = 'viewSlot';
    wrap.dataset.slot = String(i);
    const label = ['Frente', 'Izquierda', 'Atrás', 'Derecha'][i];
    if (image) {
      wrap.innerHTML = `<img src="${image.url}" alt="${label}"><span class="slotLabel">${label}</span><button class="removeImage" aria-label="Eliminar imagen">×</button>`;
      wrap.querySelector('.removeImage').addEventListener('click', (e) => {
        e.stopPropagation();
        state.images.splice(i, 1);
        renderViewGrid();
      });
    } else {
      wrap.innerHTML = `<span class="slotLabel">${label}</span><div class="slotPlus">＋</div><small>añadir vista</small>`;
    }
    wrap.addEventListener('click', () => $('imageInput').click());
    grid.appendChild(wrap);
  }
  $('imageCount').textContent = `${state.images.length} / 4`;
}

async function addImages(files) {
  const chosen = [...files].filter(f => f.type.startsWith('image/')).slice(0, 4 - state.images.length);
  if (!chosen.length) return;
  for (const file of chosen) {
    const data = await fileToDataURL(file);
    state.images.push({ name: file.name, file, url: URL.createObjectURL(file), data });
  }
  renderViewGrid();
  if (state.colorMode === 'multicolor') analyzePalette();
  toast(`${chosen.length} imagen(es) añadida(s).`);
}

function nearestColorName(hex) {
  const rgb = hexToRgb(hex);
  let best = ['color', '#999999', Infinity];
  for (const [name, ref] of namedColors) {
    const c = hexToRgb(ref);
    const d = (rgb.r - c.r) ** 2 + (rgb.g - c.g) ** 2 + (rgb.b - c.b) ** 2;
    if (d < best[2]) best = [name, ref, d];
  }
  return best[0];
}

function hexToRgb(hex) {
  const s = hex.replace('#', '');
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
}

async function analyzePalette() {
  const first = state.images[0];
  if (!first) return toast('Añade primero una imagen principal.');
  const img = new Image();
  img.src = first.url;
  await img.decode();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const scale = Math.min(1, 160 / Math.max(img.width, img.height));
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const bins = new Map();
  for (let i = 0; i < data.length; i += 16) {
    const a = data[i + 3];
    if (a < 120) continue;
    const r = data[i] >> 5, g = data[i + 1] >> 5, b = data[i + 2] >> 5;
    const key = `${r}-${g}-${b}`;
    bins.set(key, (bins.get(key) || 0) + 1);
  }
  const top = [...bins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  const clusters = [];
  for (const [key, count] of top) {
    const [r, g, b] = key.split('-').map(v => Number(v) * 32 + 16);
    const hex = rgbToHex(r, g, b);
    const distinct = clusters.every(c => {
      const q = hexToRgb(c.hex);
      return ((r - q.r) ** 2 + (g - q.g) ** 2 + (b - q.b) ** 2) > 25 ** 2;
    });
    if (distinct) clusters.push({ hex, name: nearestColorName(hex), count });
    if (clusters.length >= Number($('maxColors').value)) break;
  }
  state.palette = clusters;
  renderPalette();
  toast(`${clusters.length} colores dominantes detectados.`);
}

function renderPalette() {
  const box = $('paletteList');
  box.innerHTML = '';
  if (!state.palette.length) {
    box.innerHTML = '<span class="helper">Pulsa “Analizar colores” para proponer una paleta.</span>';
    return;
  }
  state.palette.forEach((p, i) => {
    const chip = document.createElement('div');
    chip.className = 'paletteChip';
    chip.innerHTML = `<i style="background:${p.hex}"></i><input value="${p.name}" aria-label="Nombre del color"><span class="paletteRemove">×</span>`;
    chip.querySelector('input').addEventListener('input', (e) => p.name = e.target.value.trim());
    chip.querySelector('.paletteRemove').addEventListener('click', () => { state.palette.splice(i, 1); renderPalette(); });
    box.appendChild(chip);
  });
}

function selectColorMode(mode) {
  state.colorMode = mode;
  qsa('[data-color-mode]').forEach(el => el.classList.toggle('selected', el.dataset.colorMode === mode));
  $('multicolorCard').classList.toggle('hiddenCard', mode !== 'multicolor');
  if (mode === 'multicolor' && state.images.length && !state.palette.length) analyzePalette();
}

async function meshyRequest(path, options = {}) {
  if (!state.api.key) throw new Error('Configura tu API Key de Meshy antes de usar IA.');
  if (state.api.provider !== 'meshy') throw new Error('El proveedor seleccionado aún no está implementado en esta versión. Usa Meshy.');
  const res = await fetch(`${state.api.endpoint}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.api.key}`, ...(options.headers || {}) }
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!res.ok) throw new Error(data?.message || `Error HTTP ${res.status}`);
  return data;
}

function setAiModal(title, message, percent = 0) {
  $('aiProgressTitle').textContent = title;
  $('aiProgressMessage').textContent = message;
  $('aiProgressValue').textContent = `${Math.round(percent)}%`;
  $('aiProgressModal').querySelector('.progressRing').style.setProperty('--progress', `${Math.round(percent * 3.6)}deg`);
}

async function pollMeshy(path, id, title) {
  showModal('aiProgressModal');
  state.aiBusy = true;
  state.aiStop = false;
  for (;;) {
    if (state.aiStop) throw new Error('Proceso detenido por el usuario.');
    const data = await meshyRequest(`${path}/${encodeURIComponent(id)}`);
    const pct = Number(data.progress || 0);
    setAiModal(title, data.status === 'SUCCEEDED' ? 'Completado.' : `Estado: ${data.status || 'procesando'}…`, pct);
    if (data.status === 'SUCCEEDED') return data;
    if (['FAILED', 'CANCELED'].includes(data.status)) throw new Error(data.task_error?.message || `La tarea terminó en ${data.status}.`);
    await new Promise(r => setTimeout(r, 3000));
  }
}

function applySingleColor(hex){ for(const p of state.parts){ const mats=Array.isArray(p.mesh.material)?p.mesh.material:[p.mesh.material]; mats.forEach(m=>{if(m?.color)m.color.set(hex); if(m)m.vertexColors=false;}); } refreshPartsList(); }

async function generate3DFromImages() {
  if (!state.images.length) return toast('Necesitas al menos una imagen.');
  if (!state.api.key) return openApiModal();
  if (state.api.provider !== 'meshy') return toast('Usa Meshy como proveedor para este flujo.');
  const resolution = $('geometryResolution').value;
  const texture = $('textureMode').value;
  const poly = $('polycount').value;
  const payload = {
    image_urls: state.images.slice(0, 4).map(x => x.data),
    ai_model: 'meshy-7.1',
    geometry_resolution: resolution,
    should_texture: texture !== 'none',
    enable_pbr: texture === 'pbr',
    texture_resolution: texture === 'pbr' ? '4k' : '2k',
    image_enhancement: true,
    remove_lighting: true,
    should_remesh: false,
    target_formats: ['glb', '3mf'],
    auto_size: $('autoSize').value === 'true',
    origin_at: 'bottom',
    multi_view_thumbnails: true
  };
  if (/^\d+$/.test(poly)) payload.target_polycount = Number(poly);
  const prompt = $('generationPrompt').value.trim();
  if (prompt && texture !== 'none') payload.texture_prompt = prompt;
  try {
    status('Enviando imágenes a IA…');
    const created = await meshyRequest('/multi-image-to-3d', { method: 'POST', body: JSON.stringify(payload) });
    state.aiGenerationTask = created.result;
    const task = await pollMeshy('/multi-image-to-3d', state.aiGenerationTask, 'Creando modelo 3D');
    state.current3mfUrl = task.model_urls?.['3mf'] || null;
    state.currentThumbnail = task.thumbnail_url || null;
    hideModal('aiProgressModal');
    status('Modelo 3D generado.');
    if (task.model_urls?.glb) {
      await loadModelFromUrl(task.model_urls.glb, 'Modelo generado por IA');
      if (state.colorMode === 'single') applySingleColor($('singleColor')?.value || '#b9c3d4');
    }
    if (state.colorMode === 'multicolor') {
      await runAiColorSplit(state.aiGenerationTask);
    }
    toast('Modelo 3D listo.');
    showPage('editor');
  } catch (error) {
    hideModal('aiProgressModal');
    status('Error en IA.');
    toast(error.message || 'No se pudo generar el modelo.', 'error');
  } finally {
    state.aiBusy = false;
  }
}

async function runAiColorSplit(generationTaskId) {
  if (!generationTaskId) return;
  if (!state.palette.length) await analyzePalette();
  const names = state.palette.slice(0, Number($('maxColors').value)).map(p => p.name).filter(Boolean);
  if (!names.length) return;
  status('Separando regiones de color…');
  const payload = {
    input_task_id: generationTaskId,
    mode: 'by_color',
    prompt: names.join(', '),
    target_formats: ['glb', '3mf'],
    layout: 'on_plate',
    connectors: true,
    connector_type: 'cylinder',
    connector_size: 0.35,
    connector_height: 0.2
  };
  const created = await meshyRequest('/print/split', { method: 'POST', body: JSON.stringify(payload) });
  state.aiSplitTask = created.result;
  const task = await pollMeshy('/print/split', state.aiSplitTask, 'Separando por color');
  state.current3mfUrl = task.model_urls?.['3mf'] || state.current3mfUrl;
  if (task.model_urls?.glb) await loadModelFromUrl(task.model_urls.glb, 'Modelo multicolor separado');
  if (state.aiGenerationTask) await prepareMulticolor3MF(state.aiGenerationTask);
  toast(`Separación por color completa: ${task.part_count || names.length} piezas.`);
}

async function prepareMulticolor3MF(generationTaskId) {
  try {
    const payload = { input_task_id: generationTaskId, max_colors: Number($('maxColors').value || 4) };
    const created = await meshyRequest('/print/multi-color', { method: 'POST', body: JSON.stringify(payload) });
    state.aiColorTask = created.result;
    const task = await pollMeshy('/print/multi-color', state.aiColorTask, 'Preparando 3MF multicolor');
    if (task.model_urls?.['3mf']) state.current3mfUrl = task.model_urls['3mf'];
  } catch (error) {
    console.warn('No se pudo generar 3MF multicolor:', error);
  }
}

async function runAISplit() {
  if (!state.activePart && !state.modelRoot) return toast('Carga primero un modelo.');
  if (!state.api.key) return openApiModal();
  if (!state.aiGenerationTask) {
    return toast('Para IA Split, genera el modelo desde Imagen → 3D con Meshy primero.');
  }
  const mode = $('aiSplitMode').value;
  const prompt = $('aiSplitPrompt').value.trim();
  if (mode !== 'auto' && !prompt) return toast('Escribe las partes o colores que quieres separar.');
  try {
    const payload = {
      input_task_id: state.aiGenerationTask,
      mode,
      target_formats: ['glb', '3mf'],
      layout: $('aiLayout').value,
      connectors: $('aiConnectors').checked,
      connector_type: $('jointType').value === 'cube' ? 'cube' : 'cylinder',
      connector_size: 0.35,
      connector_height: 0.2
    };
    if (mode !== 'auto') payload.prompt = prompt;
    const created = await meshyRequest('/print/split', { method: 'POST', body: JSON.stringify(payload) });
    state.aiSplitTask = created.result;
    const task = await pollMeshy('/print/split', state.aiSplitTask, 'Separando modelo con IA');
    state.current3mfUrl = task.model_urls?.['3mf'] || state.current3mfUrl;
    if (task.model_urls?.glb) await loadModelFromUrl(task.model_urls.glb, 'Modelo separado por IA');
    hideModal('aiProgressModal');
    toast(`IA Split completado: ${task.part_count || 'piezas'}.`);
  } catch (error) {
    hideModal('aiProgressModal');
    toast(error.message || 'No se pudo separar con IA.', 'error');
  }
}

function initEditor() {
  if (state.renderer) return;
  const wrap = $('viewportWrap');
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0x090d13);
  state.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
  state.camera.position.set(160, 110, 180);
  state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  state.renderer.outputColorSpace = THREE.SRGBColorSpace;
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  state.renderer.toneMappingExposure = 1.1;
  state.renderer.domElement.id = 'renderCanvas';
  wrap.appendChild(state.renderer.domElement);
  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.dampingFactor = 0.08;
  state.controls.minDistance = 0.1;
  state.controls.maxDistance = 100000;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x162033, 2.3);
  state.scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 3.5); key.position.set(140, 220, 160); state.scene.add(key);
  const fill = new THREE.DirectionalLight(0x8fa8ff, 1.4); fill.position.set(-150, 50, -80); state.scene.add(fill);
  state.overlayGroup = new THREE.Group(); state.scene.add(state.overlayGroup);
  const grid = new THREE.GridHelper(400, 40, 0x273245, 0x161d29); grid.position.y = -0.01; state.scene.add(grid);
  const axes = new THREE.AxesHelper(50); axes.material.transparent = true; axes.material.opacity = 0.22; state.scene.add(axes);
  state.renderer.domElement.addEventListener('pointerdown', onViewportPointerDown);
  state.renderer.domElement.addEventListener('pointermove', onViewportPointerMove);
  state.renderer.domElement.addEventListener('pointerup', onViewportPointerUp);
  state.renderer.domElement.addEventListener('pointerleave', onViewportPointerUp);
  resizeRenderer();
  animate();
}

function resizeRenderer() {
  if (!state.renderer) return;
  const rect = $('viewportWrap').getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  state.camera.aspect = rect.width / rect.height;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(rect.width, rect.height, false);
  const overlay = $('selectionOverlay');
  overlay.width = Math.max(1, Math.round(rect.width * devicePixelRatio));
  overlay.height = Math.max(1, Math.round(rect.height * devicePixelRatio));
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
}

function animate() {
  requestAnimationFrame(animate);
  if (state.controls) state.controls.update();
  if (state.renderer && state.scene && state.camera) state.renderer.render(state.scene, state.camera);
}

function setEditorTool(tool) {
  state.tool = tool;
  qsa('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  const messages = {
    object: 'Selecciona una pieza completa.',
    smart: 'Haz clic en la zona que quieres seleccionar.',
    brush: 'Mantén pulsado y pinta sobre la superficie.',
    lasso: 'Dibuja un lazo alrededor de la zona.',
    trace: 'Dibuja un trazo; PartForge seleccionará un lado.',
    color: 'Haz clic sobre un color de la malla.'
  };
  $('editorHint').textContent = messages[tool] || '';
}

function pointerToNdc(event) {
  const rect = state.renderer.domElement.getBoundingClientRect();
  state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function pick(event) {
  if (!state.camera || !state.renderer) return null;
  pointerToNdc(event);
  state.raycaster.setFromCamera(state.pointer, state.camera);
  const meshes = state.parts.map(p => p.mesh).filter(m => m.visible);
  const hits = state.raycaster.intersectObjects(meshes, true);
  if (!hits.length) return null;
  const hit = hits[0];
  let mesh = hit.object;
  while (mesh.parent && !state.parts.some(p => p.mesh === mesh)) mesh = mesh.parent;
  const part = state.parts.find(p => p.mesh === mesh);
  return part ? { ...hit, mesh, part, screen: pointerToNdc(event) } : null;
}

function onViewportPointerDown(event) {
  if (event.button !== 0) return;
  const point = pointerToNdc(event);
  if (['lasso', 'trace'].includes(state.tool)) {
    state.drawing = true;
    state.selectionDraw = [point];
    drawOverlay();
    state.controls.enabled = false;
    return;
  }
  if (state.tool === 'brush') {
    state.drawing = true;
    state.controls.enabled = false;
  }
  const hit = pick(event);
  if (!hit) return;
  state.lastHit = hit;
  if (state.tool === 'object') {
    setActivePart(hit.part);
  } else if (state.tool === 'smart') {
    applyFaceSelection(hit.mesh, new Set(smartRegion(hit.mesh, hit.faceIndex)), event.shiftKey ? 'add' : state.selectionAddMode);
  } else if (state.tool === 'color') {
    applyFaceSelection(hit.mesh, new Set(colorRegion(hit.mesh, hit.faceIndex)), event.shiftKey ? 'add' : state.selectionAddMode);
  } else if (state.tool === 'brush') {
    paintAt(event, event.shiftKey ? 'add' : state.selectionAddMode);
  }
}

function onViewportPointerMove(event) {
  if (!state.drawing) return;
  if (state.tool === 'lasso' || state.tool === 'trace') {
    const p = pointerToNdc(event); state.selectionDraw.push(p); drawOverlay(); return;
  }
  if (state.tool === 'brush') paintAt(event, state.selectionAddMode === 'replace' ? 'add' : state.selectionAddMode);
}

function onViewportPointerUp(event) {
  if (!state.drawing) return;
  if (state.tool === 'lasso' || state.tool === 'trace') finishDrawSelection();
  state.drawing = false;
  state.controls.enabled = true;
  clearOverlay();
}

function drawOverlay() {
  const c = $('selectionOverlay');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (state.selectionDraw.length < 2) return;
  const sx = c.width / $('viewportWrap').clientWidth;
  const sy = c.height / $('viewportWrap').clientHeight;
  ctx.save();
  ctx.scale(sx, sy);
  ctx.strokeStyle = '#a89bff'; ctx.fillStyle = 'rgba(130,100,255,.09)'; ctx.lineWidth = 2; ctx.beginPath();
  state.selectionDraw.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  if (state.tool === 'lasso') ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
}
function clearOverlay() { const c = $('selectionOverlay'); c.getContext('2d').clearRect(0, 0, c.width, c.height); }

function finishDrawSelection() {
  if (state.selectionDraw.length < 3) return;
  const target = state.activePart?.mesh || state.parts[0]?.mesh;
  if (!target) return;
  const indices = faceIndices(target);
  const selected = new Set();
  for (const i of indices) {
    const c = faceCentroidWorld(target, i);
    const s = worldToScreen(c);
    if (state.tool === 'lasso') {
      if (pointInPolygon(s, state.selectionDraw)) selected.add(i);
    } else {
      const side = lineSide(state.selectionDraw[0], state.selectionDraw[state.selectionDraw.length - 1], s);
      if (side >= 0) selected.add(i);
    }
  }
  applyFaceSelection(target, selected, 'replace');
}

function worldToScreen(point) {
  const r = state.renderer.domElement.getBoundingClientRect();
  const p = point.clone().project(state.camera);
  return { x: (p.x + 1) * 0.5 * r.width, y: (-p.y + 1) * 0.5 * r.height };
}
function pointInPolygon(p, poly) { let inside = false; for (let i=0,j=poly.length-1;i<poly.length;j=i++) { const xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y; const hit=((yi>p.y)!==(yj>p.y))&&(p.x<(xj-xi)*(p.y-yi)/(yj-yi)+xi); if(hit) inside=!inside; } return inside; }
function lineSide(a,b,p){ return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x); }

function faceIndices(mesh) {
  const g = mesh.geometry;
  const triCount = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  return Array.from({length: triCount}, (_, i) => i);
}

const faceCache = new WeakMap();
function faceCentroidWorld(mesh, faceIndex) {
  const g = mesh.geometry, pos = g.attributes.position, idx = g.index;
  const ids = idx ? [idx.getX(faceIndex*3), idx.getX(faceIndex*3+1), idx.getX(faceIndex*3+2)] : [faceIndex*3, faceIndex*3+1, faceIndex*3+2];
  const a = new THREE.Vector3().fromBufferAttribute(pos, ids[0]);
  const b = new THREE.Vector3().fromBufferAttribute(pos, ids[1]);
  const c = new THREE.Vector3().fromBufferAttribute(pos, ids[2]);
  return a.add(b).add(c).multiplyScalar(1/3).applyMatrix4(mesh.matrixWorld);
}
function faceNormalWorld(mesh, faceIndex) {
  const g = mesh.geometry, pos = g.attributes.position, idx = g.index;
  const ids = idx ? [idx.getX(faceIndex*3), idx.getX(faceIndex*3+1), idx.getX(faceIndex*3+2)] : [faceIndex*3, faceIndex*3+1, faceIndex*3+2];
  const a = new THREE.Vector3().fromBufferAttribute(pos, ids[0]);
  const b = new THREE.Vector3().fromBufferAttribute(pos, ids[1]);
  const c = new THREE.Vector3().fromBufferAttribute(pos, ids[2]);
  return b.sub(a).cross(c.sub(a)).normalize().transformDirection(mesh.matrixWorld);
}

function buildAdjacency(mesh) {
  const g = mesh.geometry;
  if (faceCache.has(g)?.adj) return faceCache.get(g).adj;
  const idx = g.index;
  const triCount = idx ? idx.count / 3 : g.attributes.position.count / 3;
  if (triCount > 180000) throw new Error('La malla tiene demasiados triángulos para Smart Region local. Usa IA Split o reduce la malla primero.');
  const edgeMap = new Map();
  const adj = Array.from({length: triCount}, () => []);
  const triVerts = (t) => idx ? [idx.getX(t*3),idx.getX(t*3+1),idx.getX(t*3+2)] : [t*3,t*3+1,t*3+2];
  for (let t=0;t<triCount;t++) {
    const [a,b,c] = triVerts(t);
    for (const [u,v] of [[a,b],[b,c],[c,a]]) {
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      const old = edgeMap.get(key);
      if (old !== undefined) { adj[t].push(old); adj[old].push(t); } else edgeMap.set(key, t);
    }
  }
  const record = faceCache.get(g) || {};
  record.adj = adj; record.triVerts = triVerts;
  faceCache.set(g, record);
  return adj;
}

function smartRegion(mesh, seed) {
  const adj = buildAdjacency(mesh);
  const angleLimit = THREE.MathUtils.degToRad(Number($('smartAngle').value));
  const baseNormal = faceNormalWorld(mesh, seed);
  const out = new Set([seed]);
  const queue = [seed];
  while (queue.length) {
    const t = queue.shift();
    for (const n of adj[t]) {
      if (out.has(n)) continue;
      const dot = THREE.MathUtils.clamp(baseNormal.dot(faceNormalWorld(mesh, n)), -1, 1);
      const angle = Math.acos(dot);
      if (angle <= angleLimit) { out.add(n); queue.push(n); }
    }
    if (out.size > Number($('smartMax')?.value || 30000)) break;
  }
  return [...out];
}

function getFaceColor(mesh, faceIndex) {
  const g = mesh.geometry, color = g.getAttribute('color');
  if (color) {
    const idx = g.index;
    const ids = idx ? [idx.getX(faceIndex*3),idx.getX(faceIndex*3+1),idx.getX(faceIndex*3+2)] : [faceIndex*3,faceIndex*3+1,faceIndex*3+2];
    const a = new THREE.Color().setRGB(color.getX(ids[0]), color.getY(ids[0]), color.getZ(ids[0]));
    const b = new THREE.Color().setRGB(color.getX(ids[1]), color.getY(ids[1]), color.getZ(ids[1]));
    const d = new THREE.Color().setRGB(color.getX(ids[2]), color.getY(ids[2]), color.getZ(ids[2]));
    return new THREE.Color((a.r+b.r+d.r)/3,(a.g+b.g+d.g)/3,(a.b+b.b+d.b)/3);
  }
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return mat?.color ? mat.color.clone() : new THREE.Color(0x999999);
}

function colorRegion(mesh, seed) {
  const adj = buildAdjacency(mesh);
  const seedColor = getFaceColor(mesh, seed);
  const tolerance = Number($('colorTolerance').value) / 100;
  const maxDelta = tolerance * 1.73;
  const out = new Set([seed]);
  const queue = [seed];
  while(queue.length){
    const t = queue.shift();
    for(const n of adj[t]){
      if(out.has(n)) continue;
      const c = getFaceColor(mesh,n);
      const d = Math.sqrt((c.r-seedColor.r)**2+(c.g-seedColor.g)**2+(c.b-seedColor.b)**2);
      if(d<=maxDelta){ out.add(n); queue.push(n); }
    }
    if(out.size>Number($('smartMax')?.value || 30000)) break;
  }
  return [...out];
}

function paintAt(event, mode='add') {
  const hit = pick(event);
  if (!hit) return;
  state.lastHit = hit;
  const radius = Number($('brushSize').value);
  const r2 = radius * radius;
  const selected = new Set();
  for (const i of faceIndices(hit.mesh)) {
    const s = worldToScreen(faceCentroidWorld(hit.mesh,i));
    const dx = s.x - hit.screen.x, dy = s.y - hit.screen.y;
    if (dx*dx+dy*dy <= r2) selected.add(i);
  }
  applyFaceSelection(hit.mesh, selected, mode);
}

function applyFaceSelection(mesh, faces, mode='replace') {
  if (mode === 'replace') state.selection.clear();
  const current = state.selection.get(mesh.uuid) || new Set();
  if (mode === 'subtract') faces.forEach(f => current.delete(f));
  else faces.forEach(f => current.add(f));
  if (current.size) state.selection.set(mesh.uuid, current); else state.selection.delete(mesh.uuid);
  state.activePart = state.parts.find(p=>p.mesh===mesh) || state.activePart;
  refreshSelectionHighlight();
  updateSelectionUI();
}

function selectedFaceCount(){ let total=0; for(const set of state.selection.values()) total+=set.size; return total; }

function refreshSelectionHighlight(){
  state.overlayGroup?.clear();
  for(const part of state.parts){
    const faces=state.selection.get(part.mesh.uuid);
    if(!faces?.size) continue;
    const g=geometryFromFaces(part.mesh,faces,false);
    const mat=new THREE.MeshBasicMaterial({color:0x9e8dff,transparent:true,opacity:.55,side:THREE.DoubleSide,depthTest:false});
    const hi=new THREE.Mesh(g,mat); hi.matrix.copy(part.mesh.matrixWorld); hi.matrixAutoUpdate=false; state.overlayGroup.add(hi);
  }
}

function updateSelectionUI(){
  const n=selectedFaceCount();
  $('selectionBadge').textContent=`${n.toLocaleString('es-CL')} caras seleccionadas`;
  $('selectionBadge').classList.toggle('hiddenBadge',n===0);
}

function geometryFromFaces(mesh, faceSet, cap=true, reverseCap=false){
  const src=mesh.geometry;
  const pos=src.getAttribute('position');
  const uv=src.getAttribute('uv');
  const color=src.getAttribute('color');
  const idx=src.index;
  const positions=[], uvs=[], colors=[], faces=[];
  const originalTriVerts=[];
  const addVertex=(vid)=>{
    const v=new THREE.Vector3().fromBufferAttribute(pos,vid); positions.push(v.x,v.y,v.z);
    if(uv){uvs.push(uv.getX(vid),uv.getY(vid));}
    if(color){colors.push(color.getX(vid),color.getY(vid),color.getZ(vid));}
    return positions.length/3-1;
  };
  const triVerts=(t)=>idx?[idx.getX(t*3),idx.getX(t*3+1),idx.getX(t*3+2)]:[t*3,t*3+1,t*3+2];
  for(const t of faceSet){ const vs=triVerts(t); originalTriVerts.push(vs); faces.push([addVertex(vs[0]),addVertex(vs[1]),addVertex(vs[2])]); }
  if(cap){
    const loops=boundaryLoops(triVerts,faceSet);
    for(const loop of loops){
      if(loop.length<3) continue;
      const pts=loop.map(vid=>new THREE.Vector3().fromBufferAttribute(pos,vid));
      const normal=newelNormal(pts);
      const ref=Math.abs(normal.y)<.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);
      const u=new THREE.Vector3().crossVectors(ref,normal).normalize();
      const v=new THREE.Vector3().crossVectors(normal,u).normalize();
      const origin=pts[0];
      const pts2=pts.map(p=>new THREE.Vector2(p.clone().sub(origin).dot(u),p.clone().sub(origin).dot(v)));
      const tris=THREE.ShapeUtils.triangulateShape(pts2,[]);
      const map=new Map(); loop.forEach((vid,i)=>map.set(vid,addVertex(vid)));
      for(const tri of tris){
        const a=map.get(loop[tri[0]]), b=map.get(loop[tri[1]]), c=map.get(loop[tri[2]]);
        faces.push(reverseCap?[a,c,b]:[a,b,c]);
      }
    }
  }
  const out=new THREE.BufferGeometry();
  out.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  if(uv && uvs.length) out.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  if(color && colors.length) out.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  const flat=[]; for(const f of faces) flat.push(f[0],f[1],f[2]); out.setIndex(flat); out.computeVertexNormals(); out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

function newelNormal(pts){
  const n=new THREE.Vector3(); for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length]; n.x+=(a.y-b.y)*(a.z+b.z); n.y+=(a.z-b.z)*(a.x+b.x); n.z+=(a.x-b.x)*(a.y+b.y);} return n.normalize();
}

function boundaryLoops(triVerts, faceSet){
  const edgeCounts=new Map();
  const edgeVertices=new Map();
  for(const t of faceSet){ const [a,b,c]=triVerts(t); for(const [u,v] of [[a,b],[b,c],[c,a]]){const key=u<v?`${u}_${v}`:`${v}_${u}`; edgeCounts.set(key,(edgeCounts.get(key)||0)+1); edgeVertices.set(key,[u,v]);} }
  const edges=[...edgeCounts.keys()].filter(k=>edgeCounts.get(k)===1).map(k=>edgeVertices.get(k));
  const adjacency=new Map();
  for(const [a,b] of edges){if(!adjacency.has(a))adjacency.set(a,[]);if(!adjacency.has(b))adjacency.set(b,[]);adjacency.get(a).push(b);adjacency.get(b).push(a);}
  const visited=new Set(), loops=[];
  for(const [a,b] of edges){const key=a<b?`${a}_${b}`:`${b}_${a}`;if(visited.has(key))continue;const loop=[a], start=a;let prev=-1,current=b;visited.add(key);let guard=0;while(guard++<edges.length+4){loop.push(current);const ns=(adjacency.get(current)||[]).filter(x=>x!==prev);const next=ns.find(x=>{const k=current<x?`${current}_${x}`:`${x}_${current}`;return !visited.has(k);});if(next===undefined){break;}const k=current<next?`${current}_${next}`:`${next}_${current}`;visited.add(k);prev=current;current=next;if(current===start)break;}if(loop.length>=3)loops.push(loop);}return loops;
}

function replacePartMeshes(targetPart, baseMesh, pieceMesh){
  const old=targetPart.mesh;
  const idx=state.parts.indexOf(targetPart);
  if(idx<0) return;
  state.scene.remove(old);
  targetPart.mesh=baseMesh;
  targetPart.name=old.name+' (base)';
  baseMesh.name=targetPart.name;
  state.scene.add(baseMesh);
  const piece={mesh:pieceMesh,name:old.name+' (separada)',created:true};
  pieceMesh.name=piece.name; state.parts.splice(idx+1,0,piece); state.scene.add(pieceMesh);
  state.activePart=piece;
  state.selection.clear();
  refreshPartsList(); refreshSelectionHighlight(); updateSelectionUI(); frameAll();
}

function detachSelected(){
  if(!state.activePart) return toast('Selecciona una pieza.');
  const sets=[...state.selection.entries()];
  if(!sets.length){ return splitObjectComponents(state.activePart); }
  const seal=$('sealCut').checked;
  const entry=sets.find(([uuid])=>uuid===state.activePart.mesh.uuid);
  if(!entry) return toast('La selección activa no pertenece a la pieza activa.');
  const set=entry[1]; const total=faceIndices(state.activePart.mesh).length;
  if(set.size===0 || set.size===total) return toast('Selecciona una parte, no toda la pieza.');
  status('Separando y preparando bordes…');
  try{
    const baseSet=new Set(faceIndices(state.activePart.mesh).filter(f=>!set.has(f)));
    const baseGeom=geometryFromFaces(state.activePart.mesh,baseSet,seal,false);
    const pieceGeom=geometryFromFaces(state.activePart.mesh,set,seal,true);
    const mat=cloneMaterial(state.activePart.mesh.material);
    const base=new THREE.Mesh(baseGeom,mat); copyTransform(state.activePart.mesh,base);
    const piece=new THREE.Mesh(pieceGeom,cloneMaterial(state.activePart.mesh.material)); copyTransform(state.activePart.mesh,piece);
    replacePartMeshes(state.activePart,base,piece);
    state.selectionAddMode='replace';toast('Pieza separada. Revisa “Analizar impresión” antes de exportar.');
    status('Separación completada.');
  }catch(error){ console.error(error); toast(`No se pudo separar: ${error.message || error}`,'error'); status('Error al separar.'); }
}

function cloneMaterial(material){ if(Array.isArray(material)) return material.map(m=>{const c=m.clone(); return c;}); const c=material?.clone ? material.clone() : new THREE.MeshStandardMaterial({color:0xbfc7d4,roughness:.6,metalness:.05}); return c; }
function copyTransform(a,b){b.position.copy(a.position);b.quaternion.copy(a.quaternion);b.scale.copy(a.scale);b.updateMatrixWorld(true);}

function splitObjectComponents(part){
  const mesh=part.mesh; const adj=buildAdjacency(mesh); const triCount=adj.length; const seen=new Uint8Array(triCount); const comps=[];
  for(let i=0;i<triCount;i++){if(seen[i])continue;const q=[i];seen[i]=1;const c=[];while(q.length){const t=q.pop();c.push(t);for(const n of adj[t])if(!seen[n]){seen[n]=1;q.push(n);}}comps.push(c);} 
  if(comps.length<2) return toast('La pieza no tiene componentes desconectados. Usa Smart region, pincel o lazo.');
  state.scene.remove(mesh); const idx=state.parts.indexOf(part); state.parts.splice(idx,1);
  comps.forEach((c,k)=>{const g=geometryFromFaces(mesh,new Set(c),true,false);const m=new THREE.Mesh(g,cloneMaterial(mesh.material));copyTransform(mesh,m);const p={mesh:m,name:`${part.name} — componente ${k+1}`};state.parts.splice(idx+k,0,p);state.scene.add(m);});
  refreshPartsList(); frameAll(); toast(`${comps.length} componentes separados.`);
}

function setActivePart(part){
  state.activePart=part; $('activeName').value=part?.name||''; qsa('.partRow').forEach(r=>r.classList.toggle('active',r.dataset.uuid===part?.mesh.uuid));
}

function refreshPartsList(){
  const box=$('partsList'); box.innerHTML=''; $('partCount').textContent=state.parts.length;
  if(!state.parts.length){box.innerHTML='<div class="emptyParts">Sin piezas.</div>';return;}
  state.parts.forEach((p,i)=>{const row=document.createElement('div');row.className='partRow'+(p===state.activePart?' active':'');row.dataset.uuid=p.mesh.uuid;const color=getBaseColor(p.mesh.material);row.innerHTML=`<i class="partSwatch" style="background:${color}"></i><b>${escapeHtml(p.name)}</b><small>${triCount(p.mesh).toLocaleString('es-CL')}</small>`;row.addEventListener('click',()=>setActivePart(p));box.appendChild(row);});
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function triCount(mesh){return mesh.geometry.index?mesh.geometry.index.count/3:mesh.geometry.attributes.position.count/3;}
function getBaseColor(mat){const m=Array.isArray(mat)?mat[0]:mat;return m?.color?`#${m.color.getHexString()}`:'#9aa5b5';}

function clearModel(){
  if(state.modelRoot){state.scene.remove(state.modelRoot);state.modelRoot=null;}
  state.parts=[];state.activePart=null;state.selection.clear();state.overlayGroup?.clear();$('editorName').textContent='Sin modelo';$('meshStatus').textContent='Sin modelo';$('meshInfo').textContent='';refreshPartsList();updateSelectionUI();
}

function materialForLoadedMesh(mesh){
  if(Array.isArray(mesh.material)) return mesh.material.map(m=>m?.clone?.()||new THREE.MeshStandardMaterial({color:0xbfc7d4,roughness:.6}));
  if(mesh.material?.isMaterial) return mesh.material.clone();
  return new THREE.MeshStandardMaterial({color:0xbfc7d4,roughness:.58,metalness:.04,vertexColors:Boolean(mesh.geometry?.getAttribute('color'))});
}
function normalizeLoadedObject(object){
  object.traverse(o=>{if(o.isMesh){o.material=materialForLoadedMesh(o);o.castShadow=false;o.receiveShadow=true; if(o.geometry){o.geometry.computeBoundingBox();o.geometry.computeBoundingSphere();}}});
  const box=new THREE.Box3().setFromObject(object); const center=box.getCenter(new THREE.Vector3()); object.position.sub(center); object.updateMatrixWorld(true); return object;
}

async function loadModelFromFile(file){
  initEditor();
  const ext=file.name.split('.').pop().toLowerCase();
  const buf=await file.arrayBuffer();
  let object;
  if(ext==='stl'){
    const g=new STLLoader().parse(buf); object=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0xb7c1d0,roughness:.55,metalness:.03}));
  }else if(ext==='obj') object=new OBJLoader().parse(new TextDecoder().decode(buf));
  else if(ext==='ply'){const g=new PLYLoader().parse(buf);g.computeVertexNormals();object=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0xb7c1d0,roughness:.58,vertexColors:Boolean(g.getAttribute('color'))}));}
  else if(ext==='3mf') object=new ThreeMFLoader().parse(buf);
  else if(ext==='glb'||ext==='gltf') object=await parseGLTF(buf);
  else throw new Error('Formato no soportado.');
  clearModel(); state.modelRoot=normalizeLoadedObject(object); state.scene.add(state.modelRoot); collectParts(state.modelRoot);
  $('editorName').textContent=file.name; status(`Cargado: ${file.name}`); frameAll();
}

function parseGLTF(buf){return new Promise((resolve,reject)=>new GLTFLoader().parse(buf,'',g=>resolve(g.scene),reject));}

async function loadModelFromUrl(url,name='Modelo'){
  initEditor();
  status('Descargando modelo…');
  const res=await fetch(url); if(!res.ok) throw new Error(`No se pudo descargar el modelo (${res.status}).`);
  const buf=await res.arrayBuffer(); const object=await parseGLTF(buf);
  clearModel(); state.modelRoot=normalizeLoadedObject(object); state.scene.add(state.modelRoot); collectParts(state.modelRoot); $('editorName').textContent=name; frameAll(); status('Modelo listo.');
}

function collectParts(root){
  state.parts=[]; root.traverse(o=>{if(o.isMesh){state.parts.push({mesh:o,name:o.name||`Pieza ${state.parts.length+1}`});o.name=state.parts[state.parts.length-1].name;}}); refreshPartsList(); setActivePart(state.parts[0]||null); updateModelInfo();
}
function updateModelInfo(){const tris=state.parts.reduce((a,p)=>a+triCount(p.mesh),0);$('meshStatus').textContent=state.parts.length?`${state.parts.length} piezas`:'Sin modelo';$('meshInfo').textContent=tris?`${tris.toLocaleString('es-CL')} triángulos`:'';$('meshStatusDot').classList.toggle('good',Boolean(state.parts.length));}

function frameAll(){if(!state.parts.length)return;const box=new THREE.Box3();state.parts.forEach(p=>{if(p.mesh.visible)box.expandByObject(p.mesh);});if(box.isEmpty())return;const center=box.getCenter(new THREE.Vector3());const size=box.getSize(new THREE.Vector3());const max=Math.max(size.x,size.y,size.z);const dist=max/(2*Math.tan(THREE.MathUtils.degToRad(state.camera.fov/2)))*1.35;state.controls.target.copy(center);const dir=new THREE.Vector3(.95,.65,1.1).normalize();state.camera.position.copy(center).add(dir.multiplyScalar(dist));state.camera.near=Math.max(.001,dist/1000);state.camera.far=Math.max(1000,dist*10);state.camera.updateProjectionMatrix();state.controls.update();}
function view(axis){if(!state.parts.length)return;const box=new THREE.Box3();state.parts.forEach(p=>box.expandByObject(p.mesh));const center=box.getCenter(new THREE.Vector3());const size=box.getSize(new THREE.Vector3());const max=Math.max(size.x,size.y,size.z);const dist=max*2.0;let dir=axis==='front'?new THREE.Vector3(0,0,1):axis==='top'?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);state.camera.position.copy(center).add(dir.multiplyScalar(dist));state.controls.target.copy(center);state.controls.update();}
function toggleWire(){state.wire=!state.wire;state.parts.forEach(p=>{p.mesh.material.wireframe=state.wire;});}
function toggleXray(){state.xray=!state.xray;state.parts.forEach(p=>{if(Array.isArray(p.mesh.material))p.mesh.material.forEach(m=>m.transparent=state.xray);else{p.mesh.material.transparent=state.xray;p.mesh.material.opacity=state.xray?.42:1;}});}

function hideActive(){if(!state.activePart)return;state.activePart.mesh.visible=false;refreshSelectionHighlight();}
function soloActive(){if(!state.activePart)return;state.parts.forEach(p=>p.mesh.visible=p===state.activePart);frameAll();}
function duplicateActive(){if(!state.activePart)return;const clone=state.activePart.mesh.clone();clone.geometry=state.activePart.mesh.geometry.clone();clone.material=cloneMaterial(state.activePart.mesh.material);clone.position.x+=state.activePart.mesh.geometry.boundingBox?.getSize(new THREE.Vector3()).x||10;const p={mesh:clone,name:state.activePart.name+' copia'};state.scene.add(clone);const idx=state.parts.indexOf(state.activePart);state.parts.splice(idx+1,0,p);refreshPartsList();setActivePart(p);}
function deleteActive(){if(!state.activePart)return;state.scene.remove(state.activePart.mesh);state.parts=state.parts.filter(p=>p!==state.activePart);state.activePart=state.parts[0]||null;refreshPartsList();frameAll();}

function analyzePrintability(){
  if(!state.parts.length)return toast('Carga un modelo.');
  const report=[];let bad=0;
  for(const p of state.parts){const open=countBoundaryEdges(p.mesh.geometry);const deg=countDegenerate(p.mesh.geometry);report.push(`${p.name}: ${open===0?'cerrada':'bordes abiertos '+open}${deg?' · '+deg+' degenerados':''}`);if(open||deg)bad++;}
  openReportModal(report,bad);
}
function countBoundaryEdges(geometry){const idx=geometry.index;const triCount=idx?idx.count/3:geometry.attributes.position.count/3;const map=new Map();for(let t=0;t<triCount;t++){const vs=idx?[idx.getX(t*3),idx.getX(t*3+1),idx.getX(t*3+2)]:[t*3,t*3+1,t*3+2];for(const [a,b] of [[vs[0],vs[1]],[vs[1],vs[2]],[vs[2],vs[0]]]){const k=a<b?`${a}_${b}`:`${b}_${a}`;map.set(k,(map.get(k)||0)+1);}}return [...map.values()].filter(v=>v===1).length;}
function countDegenerate(g){const pos=g.attributes.position,idx=g.index;const n=idx?idx.count/3:pos.count/3;let c=0;for(let t=0;t<n;t++){const vs=idx?[idx.getX(t*3),idx.getX(t*3+1),idx.getX(t*3+2)]:[t*3,t*3+1,t*3+2];const a=new THREE.Vector3().fromBufferAttribute(pos,vs[0]),b=new THREE.Vector3().fromBufferAttribute(pos,vs[1]),d=new THREE.Vector3().fromBufferAttribute(pos,vs[2]);if(new THREE.Triangle(a,b,d).getArea()<1e-9)c++;}return c;}
function openReportModal(report,bad){$('modalReport')?.remove();const modal=document.createElement('div');modal.id='modalReport';modal.className='modal';modal.innerHTML=`<div class="modalCard"><div class="modalHeader"><div><span class="eyebrow">ANÁLISIS</span><h3>Comprobación de impresión</h3></div><button class="iconButton">×</button></div><div class="modalBody"><div class="warningBox">${bad?`Hay ${bad} pieza(s) que requieren revisión.`:'No se detectaron bordes abiertos ni triángulos degenerados en el análisis básico.'}</div><div class="notice" style="margin-top:10px">${report.map(escapeHtml).join('<br>')}</div></div></div>`;document.body.appendChild(modal);modal.querySelector('button').addEventListener('click',()=>modal.remove());}

function createLocalJoint(){
  if(!state.activePart || state.parts.length<2) return toast('Necesitas al menos dos piezas. Selecciona la pieza donde irá el macho y haz clic sobre la superficie.');
  const openA=countBoundaryEdges(state.activePart.mesh.geometry);
  const otherForCheck=state.parts.find(p=>p!==state.activePart && p.mesh.visible);
  if(openA>0 || (otherForCheck && countBoundaryEdges(otherForCheck.mesh.geometry)>0)) toast('Aviso: una de las mallas tiene bordes abiertos. El encaje local puede fallar; usa reparar o Auto Split con conectores.','error');
  if(!state.lastHit || state.lastHit.mesh!==state.activePart.mesh) return toast('Haz clic sobre la superficie de la pieza activa para fijar el punto del conector.');
  const partner=state.parts.find(p=>p!==state.activePart && p.mesh.visible); if(!partner) return toast('No hay otra pieza visible para crear el alojamiento.');
  const worldPoint=state.lastHit.point.clone(); const worldNormal=faceNormalWorld(state.activePart.mesh,state.lastHit.faceIndex);
  const size=Number($('jointSize').value)||4; const depth=Number($('jointDepth').value)||3; const gap=Number($('jointGap').value)||0.15; const type=$('jointType').value;
  if(type==='magnet'){return createMagnetJoint(partner,worldPoint,worldNormal,size,depth,gap);}
  try{
    const cyl = type==='cube' ? new THREE.BoxGeometry(size,size,depth*2,1,1,1) : new THREE.CylinderGeometry(size/2,size/2,depth*2,32);
    const pin = new Brush(cyl); orientBrush(pin,worldPoint,worldNormal,depth); pin.updateMatrixWorld(true);
    const activeBrush=new Brush(state.activePart.mesh.geometry.clone()); copyTransform(state.activePart.mesh,activeBrush); activeBrush.updateMatrixWorld(true);
    const partnerBrush=new Brush(partner.mesh.geometry.clone()); copyTransform(partner.mesh,partnerBrush); partnerBrush.updateMatrixWorld(true);
    const evaluator=new Evaluator(); evaluator.useGroups=false;
    const male=evaluator.evaluate(activeBrush,pin,ADDITION);
    const socketBrush = type==='cube' ? new Brush(new THREE.BoxGeometry(size+gap,size+gap,depth*2.2)) : new Brush(new THREE.CylinderGeometry(size/2+gap,size/2+gap,depth*2.2,32));
    orientBrush(socketBrush,worldPoint,worldNormal,depth); socketBrush.updateMatrixWorld(true);
    const female=evaluator.evaluate(partnerBrush,socketBrush,SUBTRACTION);
    male.material=cloneMaterial(state.activePart.mesh.material); female.material=cloneMaterial(partner.mesh.material);
    state.scene.remove(state.activePart.mesh,partner.mesh); state.activePart.mesh=male; partner.mesh=female; state.scene.add(male,female); refreshPartsList(); frameAll(); toast('Unión creada. Verifica el encaje con “Analizar impresión”.');
  }catch(error){console.error(error);toast(`No se pudo crear la unión: ${error.message||error}`,'error');}
}
function createMagnetJoint(partner,point,normal,size,depth,gap){
  try{
    const activeBrush=new Brush(state.activePart.mesh.geometry.clone()); copyTransform(state.activePart.mesh,activeBrush); activeBrush.updateMatrixWorld(true);
    const partnerBrush=new Brush(partner.mesh.geometry.clone()); copyTransform(partner.mesh,partnerBrush); partnerBrush.updateMatrixWorld(true);
    const socketA=new Brush(new THREE.CylinderGeometry(size/2+gap,size/2+gap,depth,32)); orientBrush(socketA,point,normal,depth);socketA.updateMatrixWorld(true);
    const socketB=new Brush(new THREE.CylinderGeometry(size/2+gap,size/2+gap,depth,32)); orientBrush(socketB,point.clone().add(normal.clone().multiplyScalar(depth*1.5)),normal.clone().negate(),depth);socketB.updateMatrixWorld(true);
    const ev=new Evaluator();ev.useGroups=false;const a=ev.evaluate(activeBrush,socketA,SUBTRACTION);const b=ev.evaluate(partnerBrush,socketB,SUBTRACTION);a.material=cloneMaterial(state.activePart.mesh.material);b.material=cloneMaterial(partner.mesh.material);state.scene.remove(state.activePart.mesh,partner.mesh);state.activePart.mesh=a;partner.mesh=b;state.scene.add(a,b);refreshPartsList();frameAll();toast('Alojamientos para imanes creados.');
  }catch(e){toast(`No se pudo crear el alojamiento para imán: ${e.message||e}`,'error');}
}
function orientBrush(brush,point,normal,depth){brush.position.copy(point);const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),normal.clone().normalize());brush.quaternion.copy(q);brush.position.add(normal.clone().normalize().multiplyScalar(depth/2));}

function cloneMeshForExport(mesh){const c=mesh.clone();c.geometry=mesh.geometry.clone();c.material=cloneMaterial(mesh.material);c.position.copy(mesh.position);c.quaternion.copy(mesh.quaternion);c.scale.copy(mesh.scale);c.updateMatrixWorld(true);return c;}
function exportActive(format){if(!state.activePart)return toast('Selecciona una pieza.');const obj=new THREE.Group();obj.add(cloneMeshForExport(state.activePart.mesh));obj.updateMatrixWorld(true);exportGroup(obj,format,slug(state.activePart.name));}
function exportAll(format){if(!state.parts.length)return toast('No hay piezas.');const obj=new THREE.Group();state.parts.filter(p=>p.mesh.visible).forEach(p=>obj.add(cloneMeshForExport(p.mesh)));obj.updateMatrixWorld(true);exportGroup(obj,format,'partforge-piezas');}
function exportGroup(group,format,name){group.updateMatrixWorld(true);try{if(format==='stl'){const data=new STLExporter().parse(group,{binary:true});downloadBlob(new Blob([data],{type:'application/octet-stream'}),name+'.stl');}else if(format==='obj'){const data=new OBJExporter().parse(group);downloadBlob(new Blob([data],{type:'text/plain'}),name+'.obj');}else if(format==='3mf'){export3MF(group,name);}else if(format==='json'){downloadBlob(new Blob([JSON.stringify(projectSnapshot(),null,2)],{type:'application/json'}),name+'.json');}}catch(e){console.error(e);toast(`Exportación falló: ${e.message||e}`,'error');}}
function slug(s){return String(s||'partforge').toLowerCase().replace(/[^a-z0-9áéíóúñ_-]+/gi,'-').replace(/-+/g,'-').replace(/^-|-$/g,'')||'partforge';}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

function export3MF(group,name){
  const objects=[];const colors=[];
  group.traverse(m=>{if(!m.isMesh||!m.geometry?.attributes?.position)return;const color=getBaseColor(m.material);let c=color;let ci=colors.indexOf(c);if(ci<0){colors.push(c);ci=colors.length-1;}const pos=m.geometry.attributes.position;const idx=m.geometry.index;const verts=[];const tris=[];const vCount=pos.count;for(let i=0;i<vCount;i++){const v=new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(m.matrixWorld);verts.push(v);}for(let i=0;i<(idx?idx.count:vCount);i+=3){tris.push([idx?idx.getX(i):i,idx?idx.getX(i+1):i+1,idx?idx.getX(i+2):i+2]);}objects.push({name:m.name||`Pieza ${objects.length+1}`,verts,tris,colorIndex:ci});});
  const matRes=colors.length?`<basematerials id="2">${colors.map((c,i)=>`<base name="c${i}" displaycolor="${c.toUpperCase()}"/>`).join('')}</basematerials>`:'';
  let ids='';let modelObjects='';const builds=[];objects.forEach((o,i)=>{const id=10+i;modelObjects+=`<object id="${id}" type="model" pid="2" pindex="${o.colorIndex}"><mesh><vertices>${o.verts.map(v=>`<vertex x="${fmt(v.x)}" y="${fmt(v.y)}" z="${fmt(v.z)}"/>`).join('')}</vertices><triangles>${o.tris.map(t=>`<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('')}</triangles></mesh></object>`;builds.push(`<item objectid="${id}"/>`);});