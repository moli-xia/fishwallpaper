import {cp,mkdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await import('./embed.mjs');
// Replace only the web files; dist/ also holds the macOS app, its disk image and the Android APK.
const files=['index.html','style.css','core.js','art.js','gl.js','scene.js','audio.js','app.js','project.json','assets/pond.jpg','assets/pond-data.js','assets/favicon.svg','assets/ARTWORK.md'];
for(const file of files)await rm(`${root}dist/${file}`,{force:true});
await mkdir(`${root}dist/assets`,{recursive:true});
for(const file of files)await cp(`${root}${file}`,`${root}dist/${file}`);
console.log('静态项目已构建至 dist/；可直接打开 index.html 或导入 Wallpaper Engine。');
