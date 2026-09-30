const $ = (id) => document.getElementById(id);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const S = {page:"home",mode:"single",images:[],palette:[],generated:null,three:null,Orbit:null,scene:null,camera:null,renderer:null,controls:null,parts:[],active:null,tool:"object",selected:new Map(),addMode:"replace",brush:18,angle:30,tol:28,wire:false,xray:false,lastHit:null,liso:[],lassoPoints:[],lassoActive:false,lassoPart:null,lassoCanvas:null,lassoCtx:null};

function toast(msg,type="info"){ $("statusText").textContent=msg; setTimeout(()=>{if($("statusText").textContent===msg)$("statusText").textContent="Listo.";},4200); }
function status(msg,p=""){ $("statusText").textContent=msg; $("statusProgress").textContent=p; }
function modal(id,on){ $(id).classList.toggle("hidden",!on); }
function page(p){ S.page=p; $$(".page").forEach(x=>x.classList.remove("active")); $("page-"+p).classList.add("active"); $$(".navb").forEach(b=>b.classList.toggle("active",b.dataset.page===p)); if(p==="editor")setTimeout(resize,50); }
function tipInit(){const t=$("tip");$$("[data-tip]").forEach(n=>{n.addEventListener("mouseenter",()=>{t.textContent=n.dataset.tip;t.style.display="block";const r=n.getBoundingClientRect();t.style.left=Math.min(innerWidth-290,Math.max(8,r.left))+"px";t.style.top=(r.bottom+8)+"px";});n.addEventListener("mouseleave",()=>t.style.display="none");});}
function closeModalEvents(){ $$("[data-close]").forEach(b=>b.onclick=()=>modal(b.dataset.close,false)); $("progressClose").onclick=()=>modal("progressModal",false); }

function fileURL(file){return URL.createObjectURL(file);}
async function fileData(file){return await new Promise((ok,err)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=err;r.readAsDataURL(file);});}
async function addImages(files){const f=[...files].filter(x=>x.type.startsWith("image/")).slice(0,4-S.images.length);for(const file of f)S.images.push({file,url:fileURL(file),data:await fileData(file)});renderViews();if(S.mode==="multi"&&!S.palette.length)analyzePalette();}
function renderViews(){const box=$("views"),names=["Frente","Izquierda","Atrás","Derecha"];box.innerHTML="";for(let i=0;i<4;i++){const d=document.createElement("div");d.className="slot";if(S.images[i]){d.innerHTML="<img src=\""+S.images[i].url+"\" alt=\""+names[i]+"\"><span>"+names[i]+"</span><button class=\"x\">×</button>";d.querySelector(".x").onclick=(e)=>{e.stopPropagation();URL.revokeObjectURL(S.images[i].url);S.images.splice(i,1);renderViews();};}else{d.innerHTML="<div class=\"plus\">＋</div><b>"+names[i]+"</b>";d.onclick=()=>$("imageInput").click();}box.appendChild(d);}}
function hexToRgb(h){return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]}
function rgbHex(r,g,b){return "#"+[r,g,b].map(x=>Math.max(0,Math.min(255,Math.round(x))).toString(16).padStart(2,"0")).join("")}
function nearestName(h){const refs=[["Rojo","#e53935"],["Naranja","#fb8c00"],["Amarillo","#fdd835"],["Verde","#43a047"],["Azul","#1e88e5"],["Morado","#8e24aa"],["Rosa","#ec407a"],["Café","#6d4c41"],["Gris","#757575"],["Negro","#14161b"],["Blanco","#f2f2f2"]];const a=hexToRgb(h);let best=refs[0][0],bd=1e9;for(const r of refs){const b=hexToRgb(r[1]),d=(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;if(d<bd){bd=d;best=r[0]}}return best}
async function imageRaster(url){const img=new Image();img.src=url;await img.decode();const sc=Math.min(1,220/Math.max(img.width,img.height));const c=document.createElement("canvas");c.width=Math.max(16,Math.round(img.width*sc));c.height=Math.max(16,Math.round(img.height*sc));const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(img,0,0,c.width,c.height);return {w:c.width,h:c.height,d:x.getImageData(0,0,c.width,c.height).data};}
function foreground(r){const {w,h,d}=r,mask=new Uint8Array(w*h),bg=[];for(let x=0;x<w;x++){for(const y of [0,h-1]){const i=(y*w+x)*4;bg.push([d[i],d[i+1],d[i+2]])}}for(let y=0;y<h;y++){for(const x of [0,w-1]){const i=(y*w+x)*4;bg.push([d[i],d[i+1],d[i+2]])}}const av=bg.reduce((a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],[0,0,0]).map(v=>v/bg.length);for(let i=0;i<w*h;i++){const q=i*4,dist=Math.hypot(d[q]-av[0],d[q+1]-av[1],d[q+2]-av[2]);mask[i]=dist>32?1:0;}return {w,h,d,mask};}
function sample(v,u,yy){const x=Math.max(0,Math.min(v.w-1,Math.round(u*(v.w-1)))),y=Math.max(0,Math.min(v.h-1,Math.round((1-yy)*(v.h-1))));return v.mask[y*v.w+x]===1}
function sampleColor(v,u,yy){const x=Math.max(0,Math.min(v.w-1,Math.round(u*(v.w-1)))),y=Math.max(0,Math.min(v.h-1,Math.round((1-yy)*(v.h-1))));const i=(y*v.w+x)*4;return [v.d[i],v.d[i+1],v.d[i+2]]}
async function analyzePalette(){if(!S.images[0])return toast("Agrega una imagen primero.");try{const v=foreground(await imageRaster(S.images[0].url)),m=new Map();for(let y=0;y<v.h;y+=2)for(let x=0;x<v.w;x+=2){const k=y*v.w+x;if(!v.mask[k])continue;const i=k*4,rr=Math.round(v.d[i]/32)*32,gg=Math.round(v.d[i+1]/32)*32,bb=Math.round(v.d[i+2]/32)*32,q=rr+"-"+gg+"-"+bb;m.set(q,(m.get(q)||0)+1)}const top=[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,+$("maxColors").value);S.palette=top.map(([k])=>{const [r,g,b]=k.split("-").map(Number),hex=rgbHex(r,g,b);return {hex,name:nearestName(hex)}});renderPalette();}catch(err){toast(err?.message||"No se pudieron analizar los colores.","error");}}
function renderPalette(){const b=$("palette");b.innerHTML="";for(const p of S.palette){const d=document.createElement("div");d.className="chip";d.innerHTML="<i style=\"background:"+p.hex+"\"></i><input value=\""+p.name+"\"><button>×</button>";d.querySelector("input").oninput=e=>p.name=e.target.value;d.querySelector("button").onclick=()=>{S.palette=S.palette.filter(x=>x!==p);renderPalette()};b.appendChild(d)}}
function setMode(mode){S.mode=mode;$$(".choice").forEach(x=>x.classList.toggle("active",x.dataset.mode===mode));$("multiBox").classList.toggle("hidden",mode!=="multi");if(mode==="multi"&&!S.palette.length&&S.images.length)analyzePalette();}

function voxelModel(views,n,depth,mode,pal){const occ=new Uint8Array(n*n*n),idx=(x,y,z)=>z*n*n+y*n+x;for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){const u=x/(n-1),v=y/(n-1);let ok=views.f?sample(views.f,u,v):true;if(ok&&views.b)ok=sample(views.b,1-u,v);if(ok&&views.l)ok=sample(views.l,z/(n-1),v);if(ok&&views.r)ok=sample(views.r,1-z/(n-1),v);if(!views.l&&!views.r){const dx=(u-.5)/.48,rad=Math.sqrt(Math.max(0,1-dx*dx));if(Math.abs(z-(n-1)/2)>rad*n*.45)ok=false;}if(ok)occ[idx(x,y,z)]=1}const groups=new Map(),add=(ci,face)=>{if(!groups.has(ci))groups.set(ci,[]);groups.get(ci).push(face)};for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){const id=idx(x,y,z);if(!occ[id])continue;let ci=0;if(mode==="multi"&&pal?.length){const rgb=views.f?sampleColor(views.f,(x+.5)/n,(y+.5)/n):[190,198,210];let bd=1e9;pal.forEach((p,i)=>{const c=hexToRgb(p.hex),dd=(rgb[0]-c[0])**2+(rgb[1]-c[1])**2+(rgb[2]-c[2])**2;if(dd<bd){bd=dd;ci=i}})}const x0=x/n-.5,x1=(x+1)/n-.5,y0=y/n-.5,y1=(y+1)/n-.5,z0=z/n-.5,z1=(z+1)/n-.5;if(x===0||!occ[idx(x-1,y,z)])add(ci,[[x0,y0,z0],[x0,y1,z0],[x0,y1,z1],[x0,y0,z1]]);if(x===n-1||!occ[idx(x+1,y,z)])add(ci,[[x1,y0,z1],[x1,y1,z1],[x1,y1,z0],[x1,y0,z0]]);if(y===0||!occ[idx(x,y-1,z)])add(ci,[[x0,y0,z1],[x1,y0,z1],[x1,y0,z0],[x0,y0,z0]]);if(y===n-1||!occ[idx(x,y+1,z)])add(ci,[[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]]);if(z===0||!occ[idx(x,y,z-1)])add(ci,[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]]);if(z===n-1||!occ[idx(x,y,z+1)])add(ci,[[x0,y0,z1],[x0,y1,z1],[x1,y1,z1],[x1,y0,z1]])}const out=[];for(const [ci,faces] of groups){const pos=[],ind=[];let k=0;for(const f of faces){for(const q of f)pos.push(q[0]*depth,q[1]*depth,q[2]*depth);ind.push(k,k+1,k+2,k,k+2,k+3);k+=4}out.push({positions:new Float32Array(pos),indices:new Uint32Array(ind),color:mode==="multi"&&pal?.[ci]?pal[ci].hex:"#b8c2d1"})}return out}
async function generate(){if(!S.images.length)return toast("Necesitas al menos una imagen.");modal("progressModal",true);$("progressTitle").textContent="PartForge Local";try{$("progressBar").style.width="10%";const vs=[];for(let i=0;i<S.images.length;i++){vs[i]=foreground(await imageRaster(S.images[i].url));$("progressMsg").textContent="Analizando vista "+(i+1)+" de "+S.images.length;await new Promise(r=>setTimeout(r,10))}$("progressBar").style.width="55%";const n=$("quality").value==="ultra"?46:$("quality").value==="high"?38:30;S.generated=voxelModel({f:vs[0],l:vs[1],b:vs[2],r:vs[3]},n,Math.max(5,+$("heightMm").value||50),S.mode,S.palette.length?S.palette:[{hex:"#b8c2d1",name:"Principal"}]);if(!S.generated.length)throw new Error("No se pudo reconstruir un volumen con estas vistas.");$("progressBar").style.width="100%";$("genInfo").textContent="Modelo local creado: "+S.generated.length+" malla(s).";modal("progressModal",false);toast("Modelo creado sin IA externa.");}catch(err){modal("progressModal",false);$("genInfo").textContent="Error: "+(err?.message||"no se pudo crear.");toast(err?.message||"No se pudo crear el modelo local.","error");}}
function downloadBlob(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function ensureThree(){if(S.three)return S.three;try{S.three=await import("three");S.Orbit=(await import("three/addons/controls/OrbitControls.js")).OrbitControls;return S.three}catch(err){throw new Error("No se pudo cargar el motor 3D gratuito. Recarga con Ctrl+F5. Detalle: "+(err?.message||err));}}
function colorMat(c="#b8c2d1",vertexColors=false){return new S.three.MeshStandardMaterial({color:c,vertexColors,roughness:.56,metalness:.03,side:S.three.DoubleSide})}
function normalizeMeshMaterial(mesh){
  if(!mesh.material) mesh.material=colorMat();
  else if(Array.isArray(mesh.material)) mesh.material=mesh.material.map(m=>m?.clone?.()||colorMat());
  else if(mesh.material?.isMaterial) mesh.material=mesh.material.clone();
  if(mesh.geometry?.attributes?.color){
    const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    mats.forEach(m=>{if(m)m.vertexColors=true});
  }
}
function prepareLoadedObject(root){
  root.traverse(o=>{
    if(!o.isMesh)return;
    normalizeMeshMaterial(o);
    if(o.geometry?.attributes?.position){
      if(!o.geometry.attributes.normal)o.geometry.computeVertexNormals?.();
      o.geometry.computeBoundingBox?.();
      o.geometry.computeBoundingSphere?.();
      delete o.userData.pfAdj;
    }
  });
  return root;
}
function geom(d){const g=new S.three.BufferGeometry();g.setAttribute("position",new S.three.BufferAttribute(d.positions,3));g.setIndex(new S.three.BufferAttribute(d.indices,1));g.computeVertexNormals();return g}

async function bootEditor(){
  const T=await ensureThree();
  if(S.renderer)return;
  const v=$("viewer");
  S.scene=new T.Scene();
  S.scene.background=new T.Color(0x080b10);
  S.camera=new T.PerspectiveCamera(45,1,.01,100000);
  S.camera.position.set(120,90,150);
  S.renderer=new T.WebGLRenderer({antialias:true,powerPreference:"high-performance"});
  S.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  S.renderer.outputColorSpace=T.SRGBColorSpace;
  v.appendChild(S.renderer.domElement);
  S.controls=new S.Orbit(S.camera,S.renderer.domElement);
  S.controls.enableDamping=true;
  S.controls.dampingFactor=.08;
  S.scene.add(new T.HemisphereLight(0xffffff,0x1a2130,2.2));
  const l=new T.DirectionalLight(0xffffff,3); l.position.set(100,180,120); S.scene.add(l);
  const fill=new T.DirectionalLight(0x7c8cff,1.2); fill.position.set(-120,70,-80); S.scene.add(fill);
  S.grid=new T.GridHelper(400,40,0x293345,0x161c28); S.scene.add(S.grid);
  S.overlay=new T.Group(); S.scene.add(S.overlay);
  S.renderer.domElement.addEventListener("pointerdown",pointerDown);
  S.renderer.domElement.addEventListener("pointermove",pointerMove);
  window.addEventListener("pointerup",pointerUp);
  window.addEventListener("pointercancel",pointerUp);
  S.lassoCanvas=document.createElement("canvas");
  S.lassoCanvas.style.position="absolute";
  S.lassoCanvas.style.inset="0";
  S.lassoCanvas.style.width="100%";
  S.lassoCanvas.style.height="100%";
  S.lassoCanvas.style.pointerEvents="none";
  $("viewer").appendChild(S.lassoCanvas);
  S.lassoCtx=S.lassoCanvas.getContext("2d");
  requestAnimationFrame(loop);
  resize();
}

function loop(){if(S.renderer&&S.scene)S.renderer.render(S.scene,S.camera);if(S.controls)S.controls.update();requestAnimationFrame(loop)}
function resize(){if(!S.renderer)return;const r=$("viewer").getBoundingClientRect();S.camera.aspect=r.width/r.height;S.camera.updateProjectionMatrix();S.renderer.setSize(r.width,r.height,false);if(S.lassoCanvas){S.lassoCanvas.width=Math.max(1,Math.floor(r.width*devicePixelRatio));S.lassoCanvas.height=Math.max(1,Math.floor(r.height*devicePixelRatio));S.lassoCtx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0)}}
function clearScene(){for(const p of S.parts)S.scene.remove(p.mesh);S.parts=[];S.active=null;S.selected.clear();refreshParts()}
function loadGenerated(){if(!S.generated)return toast("Genera primero un modelo.");bootEditor().then(()=>{clearScene();for(let i=0;i<S.generated.length;i++){const d=S.generated[i],m=new S.three.Mesh(geom(d),colorMat(d.color));m.name=S.mode==="multi"?"Color "+(i+1):"Modelo";S.scene.add(m);S.parts.push({mesh:m,name:m.name})}setActive(S.parts[0]);frame();page("editor")})}
async function load3d(file){
  const ext=file.name.split(".").pop().toLowerCase();
  if(ext==="json")return loadProject(file);
  status("Cargando "+file.name+"…");
  try{
    await bootEditor();clearScene();const U=URL.createObjectURL(file);
    try{
      let root=null;
      if(ext==="stl"){
        const L=(await import("three/addons/loaders/STLLoader.js")).STLLoader,g=new L().parse(await file.arrayBuffer());g.computeVertexNormals?.();root=new S.three.Mesh(g,colorMat());
      }else if(ext==="obj"){
        const L=(await import("three/addons/loaders/OBJLoader.js")).OBJLoader;root=new L().parse(await file.text());
      }else if(ext==="ply"){
        const L=(await import("three/addons/loaders/PLYLoader.js")).PLYLoader,g=new L().parse(await file.arrayBuffer());g.computeVertexNormals?.();root=new S.three.Mesh(g,colorMat("#ffffff",Boolean(g.getAttribute("color"))));
      }else if(ext==="glb"||ext==="gltf"){
        const L=(await import("three/addons/loaders/GLTFLoader.js")).GLTFLoader;root=(await new L().loadAsync(U)).scene;
      }else if(ext==="3mf"){
        const L=(await import("three/addons/loaders/3MFLoader.js")).ThreeMFLoader;root=new L().parse(await file.arrayBuffer());
      }else throw new Error("Formato no compatible: "+ext);
      prepareLoadedObject(root);S.scene.add(root);root.updateMatrixWorld(true);
      root.traverse(o=>{if(o.isMesh)S.parts.push({mesh:o,name:o.name||"Pieza "+(S.parts.length+1)})});
      if(!S.parts.length)throw new Error("El archivo no contiene mallas 3D reconocibles.");
      setActive(S.parts[0]);frame();page("editor");status("Modelo cargado: "+file.name);toast("Modelo cargado correctamente.");
    }finally{URL.revokeObjectURL(U)}
  }catch(err){status("Error al cargar el modelo.");toast(err?.message||"No se pudo cargar el archivo.","error")}
}


function refreshParts(){const box=$("parts");box.innerHTML="";for(const p of S.parts){const b=document.createElement("button");b.className="part"+(p===S.active?" active":"");b.textContent=p.name;b.onclick=()=>setActive(p);box.appendChild(b)}$("meshInfo").textContent=S.parts.length+" pieza(s)"+(S.active?" · "+S.active.name:"")}
function setActive(p){S.active=p;if(p)$("partName").value=p.name;refreshParts()}
function frame(){if(!S.parts.length)return;const T=S.three,b=new T.Box3();S.parts.filter(p=>p.mesh.visible).forEach(p=>b.expandByObject(p.mesh));if(b.isEmpty())return;const c=b.getCenter(new T.Vector3()),s=b.getSize(new T.Vector3()),d=Math.max(s.x,s.y,s.z)*2.2;S.controls.target.copy(c);S.camera.position.copy(c).add(new T.Vector3(d,d*.7,d));S.controls.update()}
function invalidateAdj(mesh){if(mesh?.userData)delete mesh.userData.pfAdj}
function triIds(mesh,f){
  const g=mesh.geometry,p=g.attributes.position,ix=g.index;
  return ix?[ix.getX(f*3),ix.getX(f*3+1),ix.getX(f*3+2)]:[f*3,f*3+1,f*3+2];
}
function faceCenter(m,f){
  const ids=triIds(m,f),p=m.geometry.attributes.position,T=S.three;
  const a=new T.Vector3().fromBufferAttribute(p,ids[0]),b=new T.Vector3().fromBufferAttribute(p,ids[1]),c=new T.Vector3().fromBufferAttribute(p,ids[2]);
  return a.add(b).add(c).multiplyScalar(1/3).applyMatrix4(m.matrixWorld);
}
function faceNormal(m,f){
  const ids=triIds(m,f),p=m.geometry.attributes.position,T=S.three;
  const a=new T.Vector3().fromBufferAttribute(p,ids[0]),b=new T.Vector3().fromBufferAttribute(p,ids[1]),c=new T.Vector3().fromBufferAttribute(p,ids[2]);
  return b.sub(a).cross(c.sub(a)).normalize().transformDirection(m.matrixWorld);
}
function materialIndexAtFace(mesh,f){
  const g=mesh.geometry;
  if(!g.groups?.length)return 0;
  const start=f*3;
  for(const gr of g.groups){
    const gs=gr.start,ge=gr.start+gr.count;
    if(start>=gs&&start<ge)return gr.materialIndex||0;
  }
  return 0;
}
function faceColor(mesh,f){
  const g=mesh.geometry,ca=g.attributes.color,ids=triIds(mesh,f);
  if(ca){
    let r=0,gg=0,b=0;
    ids.forEach(id=>{r+=ca.getX(id);gg+=ca.getY(id);b+=ca.getZ(id)});
    return [r/3*255,gg/3*255,b/3*255];
  }
  const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];
  const m=mats[Math.min(materialIndexAtFace(mesh,f),mats.length-1)]||mats[0];
  const col=m?.color;
  return col?[col.r*255,col.g*255,col.b*255]:[184,194,209];
}
function colorDistance(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])}
function buildFaceAdjacency(mesh){
  const n=triCount(mesh),emap=new Map(),adj=Array.from({length:n},()=>[]);
  const add=(a,b,f)=>{const k=a<b?a+"_"+b:b+"_"+a;let q=emap.get(k);if(!q){q=[];emap.set(k,q)}q.push(f)};
  for(let f=0;f<n;f++){const ids=triIds(mesh,f);add(ids[0],ids[1],f);add(ids[1],ids[2],f);add(ids[2],ids[0],f)}
  for(const q of emap.values())if(q.length>1)for(let i=0;i<q.length;i++)for(let j=i+1;j<q.length;j++){adj[q[i]].push(q[j]);adj[q[j]].push(q[i])}
  mesh.userData.pfAdj={triCount:n,adj}; return adj;
}
function adjacency(mesh){return mesh.userData?.pfAdj?.triCount===triCount(mesh)?mesh.userData.pfAdj.adj:buildFaceAdjacency(mesh)}
function projectFace(mesh,f){
  const r=S.renderer.domElement.getBoundingClientRect(),v=faceCenter(mesh,f).project(S.camera);
  return {x:(v.x*.5+.5)*r.width,y:(-v.y*.5+.5)*r.height,z:v.z};
}
function faceVisible(mesh,f){
  const p=projectFace(mesh,f),r=S.renderer.domElement.getBoundingClientRect(),ndc=new S.three.Vector2((p.x/r.width)*2-1,-(p.y/r.height)*2+1),rc=new S.three.Raycaster();
  rc.setFromCamera(ndc,S.camera);
  const hit=rc.intersectObject(mesh,true)[0];
  return !!hit && hit.object===mesh && Math.abs((hit.faceIndex??f)-f)<=1;
}
function screenDistance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function pointToSegmentDistance(p,a,b){
  const abx=b.x-a.x,aby=b.y-a.y,den=abx*abx+aby*aby;
  const t=den?Math.max(0,Math.min(1,((p.x-a.x)*abx+(p.y-a.y)*aby)/den)):0;
  return Math.hypot(p.x-(a.x+t*abx),p.y-(a.y+t*aby));
}
function rayPick(e){
  if(!S.camera||!S.renderer)return null;
  const r=S.renderer.domElement.getBoundingClientRect(),n=new S.three.Vector2((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1),rc=new S.three.Raycaster();
  rc.setFromCamera(n,S.camera);
  const hits=rc.intersectObjects(S.parts.map(p=>p.mesh).filter(m=>m.visible),true);
  if(!hits.length)return null;
  let o=hits[0].object;
  while(o.parent&&!S.parts.some(p=>p.mesh===o))o=o.parent;
  const p=S.parts.find(x=>x.mesh===o);
  return p?{hit:hits[0],part:p,mesh:o,ndc:n}:null;
}
function selectFaces(ctx){
  const m=ctx.mesh,n=triCount(m),set=new Set(),seed=ctx.hit.faceIndex??0,T=S.three;
  if(S.tool==="smart"){
    const a=adjacency(m),q=[seed],seen=new Uint8Array(n);seen[seed]=1;
    const base=faceNormal(m,seed),cos=Math.cos(T.MathUtils.degToRad(S.angle));
    for(let i=0;i<q.length;i++){
      const f=q[i];set.add(f);
      for(const nb of a[f])if(!seen[nb]&&base.dot(faceNormal(m,nb))>=cos){seen[nb]=1;q.push(nb)}
    }
  }else if(S.tool==="brush"){
    const c=projectFace(m,seed);
    for(let f=0;f<n;f++){const p=projectFace(m,f);if(Math.hypot(p.x-c.x,p.y-c.y)<=S.brush*2.2&&faceVisible(m,f))set.add(f)}
  }else if(S.tool==="color"){
    const seedColor=faceColor(m,seed),tol=Math.max(1,Math.min(100,+S.tol))/100*441.67;
    for(let f=0;f<n;f++)if(colorDistance(seedColor,faceColor(m,f))<=tol)set.add(f);
  }else{
    set.add(seed);
  }
  return set;
}
function highlight(){
  if(!S.overlay)return;
  S.overlay.clear();
  const T=S.three;
  for(const p of S.parts){
    const set=S.selected.get(p.mesh.uuid);
    if(!set?.size)continue;
    const g=p.mesh.geometry,pos=g.attributes.position,a=[];
    for(const f of set){const ids=triIds(p.mesh,f);for(const id of ids)a.push(pos.getX(id),pos.getY(id),pos.getZ(id))}
    if(!a.length)continue;
    const hg=new T.BufferGeometry();hg.setAttribute("position",new T.Float32BufferAttribute(a,3));hg.computeVertexNormals();
    const hm=new T.Mesh(hg,new T.MeshBasicMaterial({color:0x9b82ff,transparent:true,opacity:.52,side:T.DoubleSide,depthTest:false}));
    hm.applyMatrix4(p.mesh.matrixWorld);S.overlay.add(hm);
  }
}
function applySel(mesh,set){
  const old=S.selected.get(mesh.uuid)||new Set(),n=S.addMode==="add"?new Set([...old,...set]):S.addMode==="subtract"?new Set([...old].filter(x=>!set.has(x))):new Set(set);
  if(n.size)S.selected.set(mesh.uuid,n);else S.selected.delete(mesh.uuid);
  highlight();
}
function eventPoint(e){const r=S.renderer.domElement.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top}}
function pointInPoly(x,y,p){
  let inside=false;
  for(let i=0,j=p.length-1;i<p.length;j=i++){
    const xi=p[i].x,yi=p[i].y,xj=p[j].x,yj=p[j].y;
    const hit=((yi>y)!=(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi);
    if(hit)inside=!inside;
  }
  return inside;
}
function facePointScreen(mesh,f){return projectFace(mesh,f)}
function lassoMove(e){
  if(S.lassoActive){
    const p=eventPoint(e),last=S.lassoPoints[S.lassoPoints.length-1];
    if(!last||screenDistance(p,last)>2){S.lassoPoints.push(p);drawLasso()}
  }
}
function pointerMove(e){
  if(S.lassoActive){lassoMove(e);return}
  if(!S.painting)return;
  const c=rayPick(e);
  if(c&&c.mesh===S.paintMesh)applySel(c.mesh,selectFaces(c));
}
function drawLasso(){
  if(!S.lassoCtx)return;
  const r=$("viewer").getBoundingClientRect();S.lassoCtx.clearRect(0,0,r.width,r.height);
  if(S.lassoPoints.length<2)return;
  S.lassoCtx.beginPath();S.lassoCtx.moveTo(S.lassoPoints[0].x,S.lassoPoints[0].y);
  for(let i=1;i<S.lassoPoints.length;i++)S.lassoCtx.lineTo(S.lassoPoints[i].x,S.lassoPoints[i].y);
  S.lassoCtx.strokeStyle="#9b82ff";S.lassoCtx.lineWidth=2;S.lassoCtx.setLineDash([8,5]);S.lassoCtx.stroke();S.lassoCtx.setLineDash([]);
}
function finishLasso(){
  if(!S.lassoPart||S.lassoPoints.length<3){S.lassoPoints=[];S.lassoPart=null;S.lassoActive=false;S.controls&&(S.controls.enabled=true);drawLasso();return}
  const m=S.lassoPart.mesh,n=triCount(m),set=new Set();
  for(let f=0;f<n;f++){
    const p=facePointScreen(m,f);
    const inside=S.tool==="trace"?S.lassoPoints.some((q,i)=>pointToSegmentDistance(p,q,S.lassoPoints[(i+1)%S.lassoPoints.length])<=Math.max(3,S.brush)):pointInPoly(p.x,p.y,S.lassoPoints);
    if(inside&&faceVisible(m,f))set.add(f);
  }
  applySel(m,set);
  S.lassoPoints=[];S.lassoPart=null;S.lassoActive=false;S.controls&&(S.controls.enabled=true);drawLasso();
}
function pointerUp(){S.painting=false;S.paintMesh=null;if(S.lassoActive)finishLasso()}
function pointerDown(e){
  const c=rayPick(e);if(!c)return;
  S.lastHit=c;
  if(S.tool==="object"){setActive(c.part);return}
  if(S.tool==="plane")return;
  if(S.tool==="lasso"||S.tool==="trace"){
    S.lassoActive=true;S.lassoPart=c.part;S.lassoPoints=[eventPoint(e)];S.controls&&(S.controls.enabled=false);drawLasso();return;
  }
  if(S.tool==="brush"){S.painting=true;S.paintMesh=c.mesh;S.controls&&(S.controls.enabled=false)}
  applySel(c.mesh,selectFaces(c));
}


function boundaryLoops(mesh,set){
  const g=mesh.geometry,ix=g.index,n=triCount(mesh),emap=new Map();
  const add=(a,b,f,sel)=>{const k=a<b?a+"_"+b:b+"_"+a;let q=emap.get(k);if(!q){q=[];emap.set(k,q)}q.push({a,b,f,sel})};
  for(let f=0;f<n;f++){const ids=triIds(mesh,f),sel=set.has(f);add(ids[0],ids[1],f,sel);add(ids[1],ids[2],f,sel);add(ids[2],ids[0],f,sel)}
  const edges=[];
  for(const q of emap.values()){
    const has=q.some(x=>x.sel),not=q.some(x=>!x.sel);
    if(has&&not){const e=q.find(x=>x.sel);edges.push([e.a,e.b])}
    else if(has&&q.length===1){edges.push([q[0].a,q[0].b])}
  }
  const adj=new Map();
  for(const [a,b] of edges){if(!adj.has(a))adj.set(a,[]);if(!adj.has(b))adj.set(b,[]);adj.get(a).push(b);adj.get(b).push(a)}
  const used=new Set(),loops=[];
  for(const [a,b] of edges){
    const ek=Math.min(a,b)+"_"+Math.max(a,b);if(used.has(ek))continue;
    const loop=[a],start=a;let prev=-1,cur=a;
    for(let guard=0;guard<Math.max(64,edges.length*2);guard++){
      const nexts=(adj.get(cur)||[]).filter(x=>x!==prev);
      const next=nexts.find(x=>!used.has(Math.min(cur,x)+"_"+Math.max(cur,x))) ?? nexts[0];
      if(next==null)break;
      used.add(Math.min(cur,next)+"_"+Math.max(cur,next));
      if(next===start)break;
      loop.push(next);prev=cur;cur=next;
    }
    if(loop.length>=3)loops.push(loop);
  }
  return loops;
}
function allBoundaryLoops(mesh){
  const n=triCount(mesh),ix=mesh.geometry.index,emap=new Map();
  const add=(a,b)=>{const k=a<b?a+"_"+b:b+"_"+a;let q=emap.get(k);if(!q){q=[];emap.set(k,q)}q.push(1)};
  for(let f=0;f<n;f++){const ids=triIds(mesh,f);add(ids[0],ids[1]);add(ids[1],ids[2]);add(ids[2],ids[0])}
  const edges=[...emap.entries()].filter(([,q])=>q.length===1).map(([k])=>k.split("_").map(Number));
  const adj=new Map();for(const [a,b] of edges){if(!adj.has(a))adj.set(a,[]);if(!adj.has(b))adj.set(b,[]);adj.get(a).push(b);adj.get(b).push(a)}
  const used=new Set(),loops=[];
  for(const [a,b] of edges){
    const ek=Math.min(a,b)+"_"+Math.max(a,b);if(used.has(ek))continue;
    const loop=[a],start=a;let prev=-1,cur=a;
    for(let guard=0;guard<Math.max(64,edges.length*2);guard++){
      const ns=(adj.get(cur)||[]).filter(x=>x!==prev);
      const next=ns.find(x=>!used.has(Math.min(cur,x)+"_"+Math.max(cur,x))) ?? ns[0];
      if(next==null)break;
      used.add(Math.min(cur,next)+"_"+Math.max(cur,next));if(next===start)break;
      loop.push(next);prev=cur;cur=next;
    }
    if(loop.length>=3)loops.push(loop);
  }
  return loops;
}
function capTriangles(mesh,loop){
  const T=S.three,p=mesh.geometry.attributes.position,pts3=loop.map(id=>new T.Vector3().fromBufferAttribute(p,id));
  if(pts3.length<3)return null;
  const normal=new T.Vector3();for(let i=0;i<pts3.length;i++){const a=pts3[i],b=pts3[(i+1)%pts3.length];normal.x+=(a.y-b.y)*(a.z+b.z);normal.y+=(a.z-b.z)*(a.x+b.x);normal.z+=(a.x-b.x)*(a.y+b.y)}
  if(normal.lengthSq()<1e-10)return null;normal.normalize();
  const base=pts3[0],maxDev=Math.max(...pts3.map(q=>Math.abs(q.clone().sub(base).dot(normal))));
  const box=mesh.geometry.boundingBox;const diag=box?box.min.distanceTo(box.max):1;
  if(maxDev>Math.max(.02,diag*.02))return null;
  const ax=Math.abs(normal.x),ay=Math.abs(normal.y),az=Math.abs(normal.z),uv=pts3.map(v=>ax>=ay&&ax>=az?new T.Vector2(v.z,v.y):ay>=az?new T.Vector2(v.x,v.z):new T.Vector2(v.x,v.y));
  const tris=T.ShapeUtils.triangulateShape(uv,[]);
  return {pts3,tris,normal};
}
function appendCap(pos,ind,mesh,loop,reverse=false){
  const cap=capTriangles(mesh,loop);if(!cap)return false;
  const start=pos.length/3;
  for(const v of cap.pts3)pos.push(v.x,v.y,v.z);
  for(const t of cap.tris){
    const a=t[0]+start,b=t[1]+start,c=t[2]+start;
    const va=new S.three.Vector3(pos[a*3],pos[a*3+1],pos[a*3+2]),vb=new S.three.Vector3(pos[b*3],pos[b*3+1],pos[b*3+2]),vc=new S.three.Vector3(pos[c*3],pos[c*3+1],pos[c*3+2]);
    const n=vb.clone().sub(va).cross(vc.clone().sub(va));
    const flip=n.dot(cap.normal)<0;
    if((flip&&!reverse)||(!flip&&reverse))ind.push(a,c,b);else ind.push(a,b,c);
  }
  return true;
}
function geometryFromFaces(mesh,set,cap=false,reverseCap=false){
  const T=S.three,g=mesh.geometry,p=g.attributes.position,pos=[],ind=[];let k=0;
  for(const f of set){const ids=triIds(mesh,f);for(const id of ids)pos.push(p.getX(id),p.getY(id),p.getZ(id));ind.push(k,k+1,k+2);k+=3}
  let capped=0;
  if(cap){for(const loop of boundaryLoops(mesh,set))if(appendCap(pos,ind,mesh,loop,reverseCap))capped++}
  const ng=new T.BufferGeometry();ng.setAttribute("position",new T.Float32BufferAttribute(pos,3));ng.setIndex(ind);ng.computeVertexNormals();return {geometry:ng,capped};
}
function faceComponents(mesh){
  const n=triCount(mesh),a=adjacency(mesh),seen=new Uint8Array(n),out=[];
  for(let s=0;s<n;s++)if(!seen[s]){const q=[s],set=new Set();seen[s]=1;for(let i=0;i<q.length;i++){const f=q[i];set.add(f);for(const z of a[f])if(!seen[z]){seen[z]=1;q.push(z)}}out.push(set)}
  return out;
}
function activeMaterial(mesh){return cloneMaterial(mesh.material)}
function detach(){
  if(!S.active)return toast("Selecciona una pieza.");
  const set=S.selected.get(S.active.mesh.uuid);if(!set?.size)return toast("Selecciona una región.");
  const total=triCount(S.active.mesh),rest=new Set();for(let i=0;i<total;i++)if(!set.has(i))rest.add(i);
  if(!rest.size)return toast("La selección ocupa toda la pieza.");
  const seal=$("cap")?.checked!==false,old=S.active,idx=S.parts.indexOf(old);
  const baseOut=geometryFromFaces(old.mesh,rest,seal,false),pieceOut=geometryFromFaces(old.mesh,set,seal,true);
  const base=new S.three.Mesh(baseOut.geometry,activeMaterial(old.mesh)),piece=new S.three.Mesh(pieceOut.geometry,activeMaterial(old.mesh));
  base.matrix.copy(old.mesh.matrix);piece.matrix.copy(old.mesh.matrix);base.matrixAutoUpdate=false;piece.matrixAutoUpdate=false;
  S.scene.remove(old.mesh);S.scene.add(base,piece);
  S.parts.splice(idx,1,{mesh:base,name:old.name+" base"},{mesh:piece,name:old.name+" separada"});
  invalidateAdj(base);invalidateAdj(piece);S.selected.clear();setActive(S.parts[idx+1]);refreshParts();highlight();
  const msg=seal&&(!baseOut.capped||!pieceOut.capped)?"Separación creada; una parte del borde no era suficientemente plana para cerrarla automáticamente.":"Separación creada y borde cerrado.";
  toast(msg);
}
function splitComponents(){
  if(!S.active)return toast("Selecciona una pieza.");
  const m=S.active.mesh,comps=faceComponents(m);if(comps.length<2)return toast("La pieza ya es un solo componente.");
  const idx=S.parts.indexOf(S.active),old=S.active,created=[];
  for(let i=0;i<comps.length;i++){const out=geometryFromFaces(m,comps[i],$("cap")?.checked!==false,false);const nm=new S.three.Mesh(out.geometry,activeMaterial(m));nm.matrix.copy(m.matrix);nm.matrixAutoUpdate=false;nm.name=old.name+" componente "+(i+1);S.scene.add(nm);created.push({mesh:nm,name:nm.name})}
  S.scene.remove(old.mesh);S.parts.splice(idx,1,...created);S.active=created[0];S.selected.clear();refreshParts();frame();highlight();toast("Componentes separados: "+created.length);
}


function cloneMaterial(m){return Array.isArray(m)?m.map(x=>x.clone()):m.clone()}
function connectorGeometry(type,size,depth,negative=false){
  const T=S.three;
  if(type==="dovetail"){
    const w=size,h=Math.max(size*.6,1),shape=new T.Shape();
    shape.moveTo(-w*.5,-h*.5);shape.lineTo(w*.5,-h*.5);shape.lineTo(w*.35,h*.5);shape.lineTo(-w*.35,h*.5);shape.closePath();
    const g=new T.ExtrudeGeometry(shape,{depth:depth*2,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,0,-depth);return g;
  }
  if(type==="snap")return new T.BoxGeometry(size*1.15,depth*2,size*.8);
  return new T.CylinderGeometry(size/2,size/2,depth*2,40);
}
function makeBrushFromMesh(mesh){
  const {Brush}=S.csg;const b=new Brush(mesh.geometry.clone());b.position.copy(mesh.position);b.quaternion.copy(mesh.quaternion);b.scale.copy(mesh.scale);b.updateMatrixWorld(true);return b;
}
function placeTool(geo,point,normal,offset=0){
  const T=S.three,tool=new S.csg.Brush(geo);
  tool.position.copy(point).add(normal.clone().multiplyScalar(offset));
  tool.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),normal.clone().normalize());
  tool.updateMatrixWorld(true);return tool;
}
async function makeJoint(){
  if(!S.active||S.parts.length<2||!S.lastHit)return toast("Selecciona la pieza activa y haz clic en la superficie donde irá el conector.");
  const partner=S.parts.find(p=>p!==S.active&&p.mesh.visible);if(!partner)return toast("Necesitas otra pieza visible para el alojamiento.");
  const point=S.lastHit.hit.point.clone(),normal=faceNormal(S.active.mesh,S.lastHit.hit.faceIndex).normalize();
  const T=S.three,size=Math.max(.8,+$("jointSize").value||4),depth=Math.max(.5,+$("jointDepth").value||3),gap=Math.max(0,+$("jointGap").value||.15),type=$("joint").value;
  const pb=new T.Box3().setFromObject(partner.mesh).expandByScalar(depth+size*2);
  if(!pb.containsPoint(point))return toast("La segunda pieza no está cerca del punto del conector. Coloca las piezas enfrentadas o selecciona otra pieza.");
  try{
    const [csg,bvh]=await Promise.all([import("three-bvh-csg"),import("three-mesh-bvh")]);S.csg={...csg,...bvh};
    const {Brush,Evaluator,ADDITION,SUBTRACTION}=S.csg,ev=new Evaluator();ev.useGroups=false;
    const activeBrush=makeBrushFromMesh(S.active.mesh),partnerBrush=makeBrushFromMesh(partner.mesh);
    const plug=placeTool(connectorGeometry(type,size,depth),point,normal,0);
    let activeOut,partnerOut;
    if(type==="dowel"){
      const socketA=placeTool(connectorGeometry("plug",size+gap,depth*.75),point,normal,depth*.55);
      const socketB=placeTool(connectorGeometry("plug",size+gap,depth*.75),point,normal.clone().negate(),depth*.55);
      activeOut=ev.evaluate(activeBrush,socketA,SUBTRACTION);
      partnerOut=ev.evaluate(partnerBrush,socketB,SUBTRACTION);
      activeOut.material=activeMaterial(S.active.mesh);partnerOut.material=activeMaterial(partner.mesh);
      const pinGeo=connectorGeometry("plug",size-gap,depth*1.35),pin=new T.Mesh(pinGeo,colorMat("#d3d9e4"));
      pin.position.copy(point).add(normal.clone().multiplyScalar(depth*.65));pin.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),normal);pin.updateMatrixWorld(true);pin.name="Pasador";
      S.scene.add(pin);S.parts.push({mesh:pin,name:"Pasador"});replaceJoint(partner,partnerOut,S.active,activeOut);toast("Pasador y alojamientos creados.");
      return;
    }
    const maleGeo=connectorGeometry(type,size,depth),femaleGeo=connectorGeometry(type==="dovetail"?"dovetail":type,size+gap*2,depth*1.12);
    const male=placeTool(maleGeo,point,normal,-depth*.45);
    const female=placeTool(femaleGeo,point,normal.clone().negate(),depth*.45);
    activeOut=ev.evaluate(activeBrush,male,ADDITION);
    partnerOut=ev.evaluate(partnerBrush,female,SUBTRACTION);
    activeOut.material=activeMaterial(S.active.mesh);partnerOut.material=activeMaterial(partner.mesh);
    replaceJoint(partner,partnerOut,S.active,activeOut);
    toast(type==="magnet"?"Alojamientos para imán creados.":type==="snap"?"Snap-fit creado con holgura.":type==="dovetail"?"Dovetail creado.":"Conector macho/hembra creado.");
  }catch(err){
    toast("No se pudo crear la unión. Prueba Reparar automáticamente y vuelve a intentarlo. "+(err?.message||""),"error");
  }
}
function replaceJoint(partner,female,active,male){
  S.scene.remove(partner.mesh,active.mesh);partner.mesh=female;active.mesh=male;
  normalizeMeshMaterial(partner.mesh);normalizeMeshMaterial(active.mesh);S.scene.add(partner.mesh,active.mesh);
  invalidateAdj(partner.mesh);invalidateAdj(active.mesh);refreshParts();frame();
}


async function exportOne(format){
  if(!S.active)return toast("Selecciona una pieza.");
  try{
    if(format==="stl"){
      const E=(await import("three/addons/exporters/STLExporter.js")).STLExporter;
      downloadBlob(new Blob([new E().parse(S.active.mesh,{binary:true})],{type:"application/octet-stream"}),safeFileName(S.active.name)+".stl");
    }else if(format==="obj"){
      const E=(await import("three/addons/exporters/OBJExporter.js")).OBJExporter;
      downloadBlob(new Blob([new E().parse(S.active.mesh)],{type:"text/plain"}),safeFileName(S.active.name)+".obj");
    }else if(format==="3mf")await export3MF();
  }catch(err){toast(err?.message||"No se pudo exportar.","error")}
}
function safeFileName(s){return String(s||"PartForge").replace(/[\\/:*?"<>|]+/g,"_").slice(0,80)}
function colorHexOfMesh(mesh){
  const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material],m=mats[0];return "#"+(m?.color?m.color.getHexString():"b8c2d1");
}


async function export3MF(){
  const {zipSync,strToU8}=await import("fflate");
  const colors=[],colorIndex=new Map(),objects=[];
  const fmt4=n=>Number(n.toFixed(4));
  const addColor=hex=>{if(!colorIndex.has(hex)){colorIndex.set(hex,colors.length);colors.push(hex)}return colorIndex.get(hex)};
  for(const p of S.parts.filter(x=>x.mesh.visible)){
    const g=p.mesh.geometry,pos=g.attributes.position,ix=g.index;
    const verts=[];for(let i=0;i<pos.count;i++){const v=new S.three.Vector3().fromBufferAttribute(pos,i).applyMatrix4(p.mesh.matrixWorld);verts.push([fmt4(v.x),fmt4(v.y),fmt4(v.z)])}
    const tris=[];for(let i=0;i<(ix?ix.count:pos.count);i+=3)tris.push([ix?ix.getX(i):i,ix?ix.getX(i+1):i+1,ix?ix.getX(i+2):i+2]);
    objects.push({name:p.name,verts,tris,color:addColor(colorHexOfMesh(p.mesh))});
  }
  if(!objects.length)return toast("No hay piezas para exportar.");
  const matXml=`<basematerials id="2">${colors.map((c,i)=>`<base name="Color ${i+1}" displaycolor="${c}"/>`).join("")}</basematerials>`;
  let objectXml="",build=[];
  objects.forEach((o,i)=>{const id=10+i;
    objectXml+=`<object id="${id}" type="model" name="${escapeXml(o.name)}" pid="2" pindex="${o.color}"><mesh><vertices>${o.verts.map(v=>`<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`).join("")}</vertices><triangles>${o.tris.map(t=>`<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join("")}</triangles></mesh></object>`;build.push(`<item objectid="${id}"/>`)});
  const model=`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="es-CL" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${matXml}${objectXml}</resources><build>${build.join("")}</build></model>`;
  const rel=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  const types=`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const zip=zipSync({"[Content_Types].xml":strToU8(types),"_rels/.rels":strToU8(rel),"3D/3dmodel.model":strToU8(model)},{level:6});
  downloadBlob(new Blob([zip],{type:"application/vnd.ms-package.3dmanufacturing-3dmodel+xml"}),"partforge-multicolor.3mf");
}
function escapeXml(s){return String(s).replace(/[<>&'"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;",'"':"&quot;"}[c]))}


function meshDiagnostics(mesh){
  const g=mesh.geometry,n=triCount(mesh),ix=g.index,edgeMap=new Map(),dups=new Map();let degenerate=0;
  for(let f=0;f<n;f++){
    const ids=triIds(mesh,f),a=new S.three.Vector3().fromBufferAttribute(g.attributes.position,ids[0]),b=new S.three.Vector3().fromBufferAttribute(g.attributes.position,ids[1]),c=new S.three.Vector3().fromBufferAttribute(g.attributes.position,ids[2]);
    if(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq()<1e-12)degenerate++;
    const key=[...ids].sort((x,y)=>x-y).join("_");dups.set(key,(dups.get(key)||0)+1);
    [[ids[0],ids[1]],[ids[1],ids[2]],[ids[2],ids[0]]].forEach(([u,v])=>{const k=u<v?u+"_"+v:v+"_"+u;edgeMap.set(k,(edgeMap.get(k)||0)+1)});
  }
  let boundary=0,nonManifold=0;for(const q of edgeMap.values()){if(q===1)boundary++;if(q>2)nonManifold++}
  const duplicateFaces=[...dups.values()].filter(v=>v>1).length,components=faceComponents(mesh).length;
  const box=g.boundingBox||g.computeBoundingBox();const size=box.max.clone().sub(box.min);
  return {triangles:n,boundary,nonManifold,degenerate,duplicateFaces,components,size,watertight:boundary===0&&nonManifold===0&&degenerate===0};
}
function report(){
  if(!S.parts.length)return toast("No hay piezas.");
  const rows=[],allGood=[];
  for(const p of S.parts){const d=meshDiagnostics(p.mesh);allGood.push(d.watertight);rows.push(`${p.name}
  Triángulos: ${d.triangles.toLocaleString("es-CL")}
  Bordes abiertos: ${d.boundary}
  Bordes no-manifold: ${d.nonManifold}
  Triángulos degenerados: ${d.degenerate}
  Caras duplicadas: ${d.duplicateFaces}
  Componentes: ${d.components}
  Medidas: ${d.size.x.toFixed(2)} × ${d.size.y.toFixed(2)} × ${d.size.z.toFixed(2)} mm
  Estado: ${d.watertight?"✓ cerrada / imprimible":"⚠ requiere reparación"}
`)}
  $("report").textContent=rows.join("\n");modal("reportModal",true);
}
async function repairAuto(){
  if(!S.parts.length)return toast("No hay piezas.");
  try{
    const B=await import("three/addons/utils/BufferGeometryUtils.js");
    let repaired=0,holes=0;
    for(const p of S.parts){
      let g=p.mesh.geometry.clone();g= B.mergeVertices(g,1e-5);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
      const temp=new S.three.Mesh(g,p.mesh.material),loops=allBoundaryLoops(temp);
      if(loops.length){
        const faces=new Set(Array.from({length:triCount(temp)},(_,i)=>i)),out=geometryFromFaces(temp,faces,true,false).geometry;
        g=out;holes+=loops.length;
      }
      g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
      p.mesh.geometry.dispose();p.mesh.geometry=g;normalizeMeshMaterial(p.mesh);invalidateAdj(p.mesh);repaired++;
    }
    refreshParts();highlight();report();toast(`Reparación local completada: ${repaired} pieza(s), ${holes} borde(s) tratado(s).`);
  }catch(err){toast("No se pudo completar la reparación automática: "+(err?.message||""),"error")}
}
function projectData(){
  return {app:"PartForge 3D Local",version:"3.0",savedAt:new Date().toISOString(),mode:S.mode,parts:S.parts.map(p=>{const g=p.mesh.geometry,pos=g.attributes.position,ix=g.index;return {name:p.name,color:colorHexOfMesh(p.mesh),position:p.mesh.position.toArray(),quaternion:p.mesh.quaternion.toArray(),scale:p.mesh.scale.toArray(),positions:Array.from(pos.array),indices:ix?Array.from(ix.array):null}})};
}
async function loadProject(file){
  try{
    const data=JSON.parse(await file.text());if(data.app!=="PartForge 3D Local"||!Array.isArray(data.parts))throw new Error("No es un proyecto PartForge válido.");
    await bootEditor();clearScene();for(const d of data.parts){const mesh=new S.three.Mesh(geom({positions:new Float32Array(d.positions),indices:new Uint32Array(d.indices||Array.from({length:d.positions.length/3},(_,i)=>i))}),colorMat(d.color||"#b8c2d1"));mesh.position.fromArray(d.position||[0,0,0]);mesh.quaternion.fromArray(d.quaternion||[0,0,0,1]);mesh.scale.fromArray(d.scale||[1,1,1]);mesh.name=d.name||"Pieza";S.scene.add(mesh);S.parts.push({mesh,name:mesh.name})}
    S.mode=data.mode||"single";setActive(S.parts[0]||null);frame();page("editor");toast("Proyecto cargado correctamente.");
  }catch(err){toast(err?.message||"Proyecto inválido.","error")}
}


function events(){
  $$("[data-page]").forEach(b=>b.onclick=()=>page(b.dataset.page));
  $("donateTop").onclick=()=>modal("donateModal",true);$("loadTop").onclick=()=>$("modelInput").click();
  $("addImages").onclick=()=>$("imageInput").click();$("imageInput").onchange=e=>addImages(e.target.files);
  $("clearImages").onclick=()=>{S.images.forEach(x=>URL.revokeObjectURL(x.url));S.images=[];S.palette=[];renderViews();renderPalette()};
  $$(".choice").forEach(b=>b.onclick=()=>setMode(b.dataset.mode));$("analyze").onclick=analyzePalette;$("addColor").onclick=()=>{S.palette.push({name:"Color",hex:"#999999"});renderPalette()};$("maxColors").onchange=()=>{if(S.images.length)analyzePalette()};$("generate").onclick=generate;$("openGenerated").onclick=loadGenerated;
  $("saveGenerated").onclick=()=>{if(!S.generated)return toast("Genera primero un modelo.");const payload={app:"PartForge 3D Local",version:"3.0",mode:S.mode,heightMm:+$("heightMm").value,pieces:S.generated.map((d,i)=>({name:S.mode==="multi"?"Color "+(i+1):"Modelo",color:d.color,positions:Array.from(d.positions),indices:Array.from(d.indices)}))};downloadBlob(new Blob([JSON.stringify(payload)],{type:"application/json"}),"partforge-generado.json")};
  $("loadEditor").onclick=()=>$("modelInput").click();$("modelInput").onchange=e=>{const f=e.target.files?.[0];if(f)load3d(f);e.target.value=""};
  $$("[data-tool]").forEach(b=>b.onclick=()=>{S.tool=b.dataset.tool;$$("[data-tool]").forEach(x=>x.classList.toggle("active",x===b));$("cutBox").classList.toggle("hidden",S.tool!=="plane");status(S.tool==="plane"?"Configura el plano y ejecuta el corte.":"Herramienta: "+b.textContent.trim())});
  $("brush").oninput=e=>S.brush=+e.target.value;$("angle").oninput=e=>S.angle=+e.target.value;$("tol").oninput=e=>S.tol=+e.target.value;
  $("addSel").onclick=()=>S.addMode="add";$("subSel").onclick=()=>S.addMode="subtract";$("clearSel").onclick=()=>{S.selected.clear();highlight()};$("invertSel").onclick=()=>{if(!S.active)return;const n=triCount(S.active.mesh),cur=S.selected.get(S.active.mesh.uuid)||new Set(),inv=new Set();for(let i=0;i<n;i++)if(!cur.has(i))inv.add(i);S.selected.set(S.active.mesh.uuid,inv);highlight()};
  $("detach").onclick=detach;$("split").onclick=splitComponents;$("runCut").onclick=cutByPlane;
  $("partName").onchange=e=>{if(S.active){S.active.name=e.target.value.trim()||S.active.name;S.active.mesh.name=S.active.name;refreshParts()}};
  $("solo").onclick=()=>{if(S.active)S.parts.forEach(p=>p.mesh.visible=p===S.active)};$("hide").onclick=()=>{if(S.active)S.active.mesh.visible=false};
  $("dup").onclick=()=>{if(!S.active)return;const c=S.active.mesh.clone();c.geometry=S.active.mesh.geometry.clone();c.material=cloneMaterial(S.active.mesh.material);c.position.x+=8;prepareLoadedObject(c);S.scene.add(c);S.parts.push({mesh:c,name:S.active.name+" copia"});refreshParts()};
  $("del").onclick=()=>{if(!S.active)return;S.scene.remove(S.active.mesh);S.parts=S.parts.filter(p=>p!==S.active);setActive(S.parts[0]||null)};
  $("front").onclick=()=>view("front");$("top").onclick=()=>view("top");$("side").onclick=()=>view("side");$("frame").onclick=frame;
  $("wire").onclick=()=>{S.wire=!S.wire;S.parts.forEach(p=>{const ms=Array.isArray(p.mesh.material)?p.mesh.material:[p.mesh.material];ms.forEach(m=>m.wireframe=S.wire)})};
  $("xray").onclick=()=>{S.xray=!S.xray;S.parts.forEach(p=>{const ms=Array.isArray(p.mesh.material)?p.mesh.material:[p.mesh.material];ms.forEach(m=>{m.transparent=S.xray;m.opacity=S.xray?.4:1})})};
  $("makeJoint").onclick=makeJoint;$("expStl").onclick=()=>exportOne("stl");$("expObj").onclick=()=>exportOne("obj");$("exp3mf").onclick=()=>exportOne("3mf");
  $("expJson").onclick=()=>downloadBlob(new Blob([JSON.stringify(projectData(),null,2)],{type:"application/json"}),"partforge-proyecto.json");
  $("repair").onclick=report;$("repairAuto").onclick=repairAuto;window.addEventListener("resize",resize);
}


async function cutByPlane(){
  if(!S.active)return toast("Selecciona una pieza.");
  const nx=+$("cutNx").value||0,ny=+$("cutNy").value||0,nz=+$("cutNz").value||1,offset=+$("cutOffset").value||0,result=$("cutResult").value;
  const normal=new S.three.Vector3(nx,ny,nz);if(normal.lengthSq()<1e-8)return toast("La normal del plano no puede ser cero.");
  normal.normalize();
  try{
    const [csg,bvh]=await Promise.all([import("three-bvh-csg"),import("three-mesh-bvh")]);S.csg={...csg,...bvh};
    const {Brush,Evaluator,INTERSECTION}=S.csg,ev=new Evaluator();ev.useGroups=false,old=S.active;
    const box=new S.three.Box3().setFromObject(old.mesh),center=box.getCenter(new S.three.Vector3()),size=box.getSize(new S.three.Vector3()),L=Math.max(size.x,size.y,size.z)*4+50;
    const planePoint=center.clone().add(normal.clone().multiplyScalar(offset));
    const makeHalf=(sign)=>{const g=new S.three.BoxGeometry(L,L,L),b=new Brush(g);const n=normal.clone().multiplyScalar(sign);b.position.copy(planePoint).add(n.clone().multiplyScalar(L*.5));b.quaternion.setFromUnitVectors(new S.three.Vector3(0,0,1),n.normalize());b.updateMatrixWorld(true);return b};
    const base=makeBrushFromMesh(old.mesh),pos=ev.evaluate(base,makeHalf(1),INTERSECTION),neg=ev.evaluate(base,makeHalf(-1),INTERSECTION);
    pos.material=activeMaterial(old.mesh);neg.material=activeMaterial(old.mesh);
    const idx=S.parts.indexOf(old);S.scene.remove(old.mesh);
    if(result==="keepPositive"){S.scene.add(pos);S.parts[idx]={mesh:pos,name:old.name+" corte +"}}
    else if(result==="keepNegative"){S.scene.add(neg);S.parts[idx]={mesh:neg,name:old.name+" corte -"}}
    else{S.scene.add(pos,neg);S.parts.splice(idx,1,{mesh:pos,name:old.name+" A"},{mesh:neg,name:old.name+" B"})}
    S.active=S.parts[idx];S.selected.clear();refreshParts();frame();toast(result==="both"?"Corte realizado: 2 piezas.":"Corte realizado.");
  }catch(err){toast("No se pudo ejecutar el corte. La malla puede no ser cerrada o válida. Prueba Reparar automáticamente. "+(err?.message||""),"error")}
}

function view(axis){
window.addEventListener("error",e=>{if(e?.message){$("bootText").textContent=e.message;modal("bootError",true)}});window.addEventListener("unhandledrejection",e=>{if(e?.reason){$("bootText").textContent=e.reason.message||String(e.reason);modal("bootError",true)}});
events();tipInit();closeModalEvents();renderViews();
page("home");
