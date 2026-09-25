// Inline the pond bed as a data URL so WebGL can read it even from file:// (where image pixels are cross-origin).
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const data=(await readFile(`${root}assets/pond.jpg`)).toString('base64');
await writeFile(`${root}assets/pond-data.js`,`window.POND_IMAGE='data:image/jpeg;base64,${data}';\n`);
console.log('已生成 assets/pond-data.js');
