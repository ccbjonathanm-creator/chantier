const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), dest = path.join(root, 'dist');
fs.mkdirSync(dest, { recursive: true });
// Liste positive : aucune migration SQL, test ou configuration ne devient un asset public.
for (const name of ['index.html','sw.js','manifest.json','favicon.ico','install-pwa.js','garde-style.js','mesure.js','js','css','assets','icons','vendor']) {
  fs.cpSync(path.join(root,name), path.join(dest,name), { recursive: true });
}
