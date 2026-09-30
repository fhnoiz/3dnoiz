import { chromium } from "playwright";
import fs from "node:fs";

fs.writeFileSync("/tmp/test-object.svg", `
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
  <rect width="240" height="240" fill="white"/>
  <circle cx="120" cy="120" r="72" fill="#d24a4a"/>
  <rect x="105" y="52" width="30" height="38" rx="8" fill="#222"/>
</svg>`);

fs.writeFileSync("/tmp/test-model.stl", `solid test
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 20 0 0
    vertex 0 20 0
  endloop
endfacet
facet normal 0 0 1
  outer loop
    vertex 20 0 0
    vertex 20 20 0
    vertex 0 20 0
  endloop
endfacet
endsolid test
`);

const browser = await chromium.launch({headless:true});
const page = await browser.newPage();
const errors = [];
const blockedPaid = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if(m.type() === "error") errors.push(m.text()); });
page.on("request", req => {
  const u = req.url().toLowerCase();
  if (u.includes("api.meshy.ai") || u.includes("api.tripo.ai") || u.includes("/openapi/v1")) blockedPaid.push(u);
});

try {
  await page.goto("http://127.0.0.1:4173/partforge/?test=smoke", {waitUntil:"networkidle", timeout:30000});
  await page.locator("#bootError").waitFor({state:"hidden", timeout:10000});

  await page.getByRole("button", {name:"Imagen → 3D"}).click();
  await page.locator("#imageInput").setInputFiles("/tmp/test-object.svg");
  await page.locator("#views img").waitFor({state:"visible", timeout:5000});
  await page.waitForTimeout(200);
  await page.locator("#generate").click();
  await page.waitForTimeout(1500);
  const genInfo = await page.locator("#genInfo").textContent();
  if (!genInfo.includes("Modelo local creado")) { const status = await page.locator("#statusText").textContent(); const progress = await page.locator("#progressMsg").textContent(); const imgCount = await page.locator("#views img").count(); throw new Error("La generación local no produjo un modelo: genInfo=" + genInfo + " status=" + status + " progress=" + progress + " imgs=" + imgCount + " errors=" + JSON.stringify(errors)); }

  await page.getByRole("button", {name:"Editor 3D"}).click();
  await page.locator("#modelInput").setInputFiles("/tmp/test-model.stl");
  await page.waitForTimeout(1800);
  const meshInfo = await page.locator("#meshInfo").textContent();
  if (!meshInfo.includes("1 pieza")) { const status = await page.locator("#statusText").textContent(); throw new Error("STL no se pudo cargar en el editor: meshInfo=" + meshInfo + " status=" + status + " errors=" + JSON.stringify(errors)); }

  if (!(await page.locator("#viewer canvas").count())) throw new Error("El visor 3D no se inicializó.");
  if (await page.locator("#bootError").isVisible()) throw new Error("PartForge mostró el error de arranque.");
  if (blockedPaid.length) throw new Error("Se detectó una llamada a IA de pago: " + blockedPaid[0]);

  const forbidden = errors.filter(x => /Failed to resolve module specifier "three"|Cannot read properties of undefined \(reading '0'\)/.test(x));
  if (forbidden.length) throw new Error("Error conocido detectado: " + forbidden.join(" | "));

  console.log(JSON.stringify({generation:genInfo, editor:meshInfo, errors, blockedPaid}));
} finally {
  await browser.close();
}
