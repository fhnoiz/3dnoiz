import * as THREE from "three";
const ORT_URL="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/esm/ort.webgpu.min.js";
const MODEL_BASE="https://huggingface.co/cgb/triposr-onnx-webgpu/resolve/main";
const CACHE_NAME="partforge-triposr-q8-v1";
const MODEL_URL=MODEL_BASE+"/triplane_q8.onnx";
const DATA_URL=MODEL_BASE+"/triplane_q8.onnx.data";
const DECODER_URL=MODEL_BASE+"/decoder.onnx";
let ortPromise=null;
let sessionsPromise=null;

async function getOrt(){
  if(globalThis.ort)return globalThis.ort;
  if(!ortPromise)ortPromise=new Promise((resolve,reject)=>{
    const existing=document.querySelector('script[data-partforge-ort]');
    if(existing){
      existing.addEventListener("load",()=>resolve(globalThis.ort));
      existing.addEventListener("error",()=>reject(new Error("No se pudo cargar ONNX Runtime Web.")));
      return;
    }
    const s=document.createElement("script");
    s.dataset.partforgeOrt="1";
    s.src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.js";
    s.onload=()=>globalThis.ort?resolve(globalThis.ort):reject(new Error("ONNX Runtime Web se cargó pero no expuso ort."));
    s.onerror=()=>reject(new Error("No se pudo cargar ONNX Runtime Web 1.30.0."));
    document.head.appendChild(s);
  });
  return ortPromise;
}

async function cachedBytes(url,label,onProgress){
  let cache=null;
  try{cache=await caches.open(CACHE_NAME);}catch{}
  try{
    const hit=cache?await cache.match(url):null;
    if(hit){
      onProgress?.(label+" · cache");
      return new Uint8Array(await hit.arrayBuffer());
    }
  }catch{}
  onProgress?.(label+" · descargando");
  const res=await fetch(url,{mode:"cors"});
  if(!res.ok)throw new Error("No se pudo descargar "+label+" ("+res.status+").");
  const total=Number(res.headers.get("content-length")||0);
  const reader=res.body?.getReader();
  if(!reader){
    const buf=new Uint8Array(await res.arrayBuffer());
    try{await cache?.put(url,new Response(buf));}catch{}
    return buf;
  }
  const chunks=[];let loaded=0;
  for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    if(value){chunks.push(value);loaded+=value.byteLength;}
    onProgress?.(label+" · "+(total?Math.round(loaded/total*100):Math.round(loaded/1048576)+" MB")+"%");
  }
  const out=new Uint8Array(loaded);let off=0;
  for(const ch of chunks){out.set(ch,off);off+=ch.length;}
  try{await cache?.put(url,new Response(out));}catch{}
  return out;
}

async function loadSessions(onProgress){
  if(sessionsPromise)return sessionsPromise;
  sessionsPromise=(async()=>{
    if(!("gpu" in navigator))throw new Error("Tu navegador no expone WebGPU. Usa Chrome/Edge actualizado con una GPU compatible.");
    const ort=await getOrt();
    ort.env.logLevel="error";
    onProgress?.("Motor neural local · preparando");
    const [modelData,externalData,decoderData]=await Promise.all([
      cachedBytes(MODEL_URL,"Modelo 3D 485 MB",onProgress),
      cachedBytes(DATA_URL,"Pesos del modelo",onProgress),
      cachedBytes(DECODER_URL,"Decodificador",onProgress)
    ]);
    onProgress?.("Inicializando GPU…");
    const triplane=await ort.InferenceSession.create(modelData,{
      executionProviders:["webgpu"],
      graphOptimizationLevel:"all",
      externalData:[{path:"./triplane_q8.onnx.data",data:externalData}]
    });
    const decoder=await ort.InferenceSession.create(decoderData,{
      executionProviders:["webgpu","wasm"],
      graphOptimizationLevel:"all"
    });
    return {ort,triplane,decoder};
  })();
  try{return await sessionsPromise}catch(e){sessionsPromise=null;throw e;}
}

async function loadImage(url){
  const img=new Image();img.src=url;await img.decode();return img;
}

function makeMaskFromBorder(data,w,h){
  const a=data;
  let br=0,bg=0,bb=0,n=0;
  const add=(x,y)=>{const i=(y*w+x)*4;br+=a[i];bg+=a[i+1];bb+=a[i+2];n++;};
  for(let x=0;x<w;x++){add(x,0);add(x,h-1);}
  for(let y=1;y<h-1;y++){add(0,y);add(w-1,y);}
  br/=n;bg/=n;bb/=n;
  const mask=new Uint8Array(w*h);
  for(let i=0;i<w*h;i++){
    const q=i*4,dist=Math.hypot(a[q]-br,a[q+1]-bg,a[q+2]-bb);
    mask[i]=dist>24?1:0;
  }
  // Keep only the connected foreground touching the strongest interior components.
  const visited=new Uint8Array(w*h),queue=[],components=[];
  for(let i=0;i<w*h;i++)if(mask[i]&&!visited[i]){
    let count=0,x0=w,y0=h,x1=0,y1=0;queue.length=0;queue.push(i);visited[i]=1;
    for(let qi=0;qi<queue.length;qi++){
      const p=queue[qi],x=p%w,y=(p/w)|0;count++;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
        const ni=ny*w+nx;if(mask[ni]&&!visited[ni]){visited[ni]=1;queue.push(ni);}
      }
    }
    if(count>Math.max(16,w*h*.002))components.push({count,x0,y0,x1,y1});
  }
  components.sort((a,b)=>b.count-a.count);
  const best=components[0];
  if(!best)return {mask};
  const keep=new Uint8Array(w*h);
  // Keep all pixels in large components that overlap the main object's bounding region.
  for(const c of components.slice(0,6)){
    if(c.x1>=best.x0&&c.x0<=best.x1&&c.y1>=best.y0&&c.y0<=best.y1){
      for(let y=c.y0;y<=c.y1;y++)for(let x=c.x0;x<=c.x1;x++)if(mask[y*w+x])keep[y*w+x]=1;
    }
  }
  return {mask:keep};
}

async function prepareInput(url){
  const img=await loadImage(url);
  const max=Math.min(1200,Math.max(img.width,img.height));
  const s=Math.min(1,max/Math.max(img.width,img.height));
  const w=Math.max(64,Math.round(img.width*s)),h=Math.max(64,Math.round(img.height*s));
  const src=document.createElement("canvas");src.width=w;src.height=h;
  const sx=src.getContext("2d",{willReadFrequently:true});sx.drawImage(img,0,0,w,h);
  const srcData=sx.getImageData(0,0,w,h), rgba=srcData.data;
  let hasAlpha=false;for(let i=3;i<rgba.length;i+=4){if(rgba[i]<250){hasAlpha=true;break;}}
  let mask;
  if(hasAlpha){mask=new Uint8Array(w*h);for(let i=0;i<w*h;i++)mask[i]=rgba[i*4+3]>18?1:0;}
  else mask=makeMaskFromBorder(rgba,w,h).mask;
  let x0=w,y0=h,x1=-1,y1=-1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  if(x1<0)throw new Error("No pude separar el objeto del fondo. Usa una foto con fondo limpio.");
  const bw=x1-x0+1,bh=y1-y0+1,pad=Math.max(4,Math.round(Math.max(bw,bh)*.04));
  x0=Math.max(0,x0-pad);y0=Math.max(0,y0-pad);x1=Math.min(w-1,x1+pad);y1=Math.min(h-1,y1+pad);
  const cw=x1-x0+1,ch=y1-y0+1,side=Math.max(cw,ch),square=document.createElement("canvas");
  square.width=side;square.height=side;
  const q=square.getContext("2d");q.fillStyle="rgb(128,128,128)";q.fillRect(0,0,side,side);
  const tmp=document.createElement("canvas");tmp.width=cw;tmp.height=ch;
  const tx=tmp.getContext("2d");const cut=tx.createImageData(cw,ch);
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
    const si=((y+y0)*w+(x+x0))*4,di=(y*cw+x)*4;
    cut.data[di]=rgba[si];cut.data[di+1]=rgba[si+1];cut.data[di+2]=rgba[si+2];cut.data[di+3]=mask[(y+y0)*w+(x+x0)]?255:0;
  }
  tx.putImageData(cut,0,0);
  const target=side*.85,scale=target/side,dx=(side-cw*scale)/2,dy=(side-ch*scale)/2;
  q.drawImage(tmp,dx,dy,cw*scale,ch*scale);
  const out=document.createElement("canvas");out.width=512;out.height=512;
  out.getContext("2d").drawImage(square,0,0,512,512);
  const data=out.getContext("2d").getImageData(0,0,512,512).data;
  const arr=new Float32Array(1*3*512*512),plane=512*512;
  for(let y=0;y<512;y++)for(let x=0;x<512;x++){
    const i=(y*512+x)*4,k=y*512+x;
    arr[k]=data[i]/255;arr[plane+k]=data[i+1]/255;arr[2*plane+k]=data[i+2]/255;
  }
  return {tensorData:arr,canvas:out};
}

function bilinear120(triplane,x,y,z){
  const C=40,W=64,H=64;
  const sample=(plane,u,v,c)=>{
    // align_corners=false
    let fx=(u*.5+.5)*W-.5,fy=(v*.5+.5)*H-.5;
    let x0=Math.floor(fx),y0=Math.floor(fy),tx=fx-x0,ty=fy-y0;
    if(x0<0){x0=0;tx=0;} if(y0<0){y0=0;ty=0;}
    const x1=Math.min(W-1,x0+1),y1=Math.min(H-1,y0+1);
    if(x0>=W-1){x0=W-1;tx=0;} if(y0>=H-1){y0=H-1;ty=0;}
    const base=(plane*C+c)*H*W;
    const a=triplane[base+y0*W+x0],b=triplane[base+y0*W+x1],cc=triplane[base+y1*W+x0],d=triplane[base+y1*W+x1];
    return a+(b-a)*tx+(cc-a)*ty+(a-b-cc+d)*tx*ty;
  };
  const out=new Float32Array(C*3);
  for(let c=0;c<C;c++){out[c]=sample(0,x,y,c);out[C+c]=sample(1,x,z,c);out[2*C+c]=sample(2,y,z,c);}
  return out;
}

async function makeTripoGeometry(url,quality,onProgress){
  const {ort,triplane,decoder}=await loadSessions(onProgress);
  onProgress?.("Preparando fotografía…");
  const prep=await prepareInput(url);
  onProgress?.("Codificando imagen en la GPU…");
  const result=await triplane.run({image:new ort.Tensor("float32",prep.tensorData,[1,3,512,512])});
  const triData=result.triplane.data;
  const res=quality==="ultra"?128:quality==="high"?112:96;
  const total=res*res*res,density=new Float32Array(total);
  const radius=.87,chunk=32768;
  for(let start=0;start<total;start+=chunk){
    const n=Math.min(chunk,total-start),pts=new Float32Array(n*3),feat=new Float32Array(n*120);
    for(let i=0;i<n;i++){
      const p=start+i,z=(p/(res*res))|0,rem=p-z*res*res,y=(rem/res)|0,x=rem-y*res;
      const xx=(x/(res-1)*2-1)*radius,yy=(y/(res-1)*2-1)*radius,zz=(z/(res-1)*2-1)*radius;
      pts[i*3]=xx;pts[i*3+1]=yy;pts[i*3+2]=zz;
      feat.set(bilinear120(triData,xx/radius,yy/radius,zz/radius),i*120);
    }
    const decIn=decoder.inputNames[0],decOut=decoder.outputNames[0];
    const dec=await decoder.run({[decIn]:new ort.Tensor("float32",feat,[n,120])});
    density.set(dec[decOut].data,start);
    onProgress?.("Reconstruyendo volumen · "+Math.round((start+n)/total*100)+"%");
  }
  onProgress?.("Extrayendo superficie…");
  const {MarchingCubes}=await import("three/addons/objects/MarchingCubes.js");
  const mat=new THREE.MeshStandardMaterial({color:0xd4d9e5,roughness:.58,metalness:.02,side:S.three.DoubleSide});
  const maxPoly=quality==="ultra"?3000000:quality==="high"?2200000:1500000;
  const mc=new MarchingCubes(res,mat,false,false,maxPoly);
  mc.isolation=25;
  let p=0;
  for(let z=0;z<res;z++)for(let y=0;y<res;y++)for(let x=0;x<res;x++)mc.setCell(x,y,z,density[p++]);
  mc.generateBufferGeometry();
  let g=mc.geometry.clone();
  if(!g.attributes.position?.count)throw new Error("El motor neural no encontró una superficie 3D válida.");
  try{
    const {mergeVertices}=await import("three/addons/utils/BufferGeometryUtils.js");
    g=mergeVertices(g,1e-5);
  }catch{}
  g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
  // TripoSR canonical coordinates are normalized; fit to the user's requested height.
  const h=+document.getElementById("heightMm").value||50;
  const size=g.boundingBox.max.clone().sub(g.boundingBox.min),scale=h/(size.y||Math.max(size.x,size.z)||1);
  g.translate(-(g.boundingBox.min.x+g.boundingBox.max.x)/2,-(g.boundingBox.min.y+g.boundingBox.max.y)/2,-(g.boundingBox.min.z+g.boundingBox.max.z)/2);
  g.scale(scale,scale,scale);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
  return {positions:new Float32Array(g.attributes.position.array),indices:g.index?new Uint32Array(g.index.array):new Uint32Array(Array.from({length:g.attributes.position.count},(_,i)=>i)),color:"#d4d9e5",engine:"TripoSR WebGPU"};
}

export {makeTripoGeometry};
