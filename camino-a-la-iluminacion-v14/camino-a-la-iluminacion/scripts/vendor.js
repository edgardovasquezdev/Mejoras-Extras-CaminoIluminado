/* Copia las librerías del frontend desde node_modules a /vendor (autoalojadas: sin CDN, con CSP estricta). */
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..');
const copiar = (de, a) => {
  const destino = path.join(raiz, 'vendor', a);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  let datos = fs.readFileSync(path.join(raiz, 'node_modules', de));
  if (/\.(css|js)$/.test(de)) datos = Buffer.from(datos.toString().replace(/\/\/# sourceMappingURL=.*$/gm, '').replace(/\/\*# sourceMappingURL=.*?\*\//g, ''));
  fs.writeFileSync(destino, datos);
};
copiar('bootstrap/dist/css/bootstrap.min.css', 'bootstrap/bootstrap.min.css');
copiar('bootstrap/dist/js/bootstrap.bundle.min.js', 'bootstrap/bootstrap.bundle.min.js');
copiar('leaflet/dist/leaflet.css', 'leaflet/leaflet.css');
copiar('leaflet/dist/leaflet.js', 'leaflet/leaflet.js');
for (const i of fs.readdirSync(path.join(raiz, 'node_modules/leaflet/dist/images'))) copiar('leaflet/dist/images/' + i, 'leaflet/images/' + i);
for (const w of [400, 500, 600, 700]) copiar(`@fontsource/inter/files/inter-latin-${w}-normal.woff2`, `inter/inter-latin-${w}-normal.woff2`);
for (const w of [400, 600, 700]) copiar(`@fontsource/fraunces/files/fraunces-latin-${w}-normal.woff2`, `fraunces/fraunces-latin-${w}-normal.woff2`);
console.log('vendor listo');
