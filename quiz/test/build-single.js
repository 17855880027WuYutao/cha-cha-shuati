// 打包单文件版：node test/build-single.js [示例题库.docx]
// 把 JSZip / 解析器 / 界面 / 示例题库全部塞进一个 .html，不用服务器，本地打开就能用。
// 示例题库默认用自造的 samples/dirty.docx；不传且文件不存在时就不内嵌。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readB64 = (p) => fs.readFileSync(path.join(ROOT, p)).toString('base64');

const sampleRel = process.argv[2] || 'samples/dirty.docx';
const sampleAbs = path.join(ROOT, sampleRel);
const sampleName = path.basename(sampleRel);
const sampleB64 = fs.existsSync(sampleAbs) ? readB64(sampleRel) : null;
if (!sampleB64) console.warn('没找到示例题库', sampleRel, '，单文件版不内嵌示例');

let html = read('index.html');
const vendor = read('vendor/jszip.min.js');
const parse = read('js/parse.js');
const app = read('js/app.js');
const quiz = read('js/quiz.js');

const inline = (code) => '<script>\n' + code + '\n</script>';

html = html.replace('<script src="vendor/jszip.min.js"></script>', () => inline('/* JSZip 3.10.1 (MIT) */\n' + vendor));
html = html.replace('<script src="js/parse.js"></script>', () => inline(parse));
html = html.replace('<script src="js/quiz.js"></script>', () => inline(quiz));
html = html.replace('<script src="js/app.js"></script>', () => {
  const emb = sampleB64
    ? '<script>window.__EMBEDDED_SAMPLE__={"name":' + JSON.stringify(sampleName) + ',"b64":"' + sampleB64 + '"};</script>'
    : '';
  return emb + '\n' + inline(app);
});

if (/<script src="(vendor|js)\//.test(html)) throw new Error('还有没内联的脚本');

html = html.replace('<title>刷题解析台</title>', '<title>刷题解析台（单文件版）</title>');
html = html.replace('<span class="ver">v0.1</span>', '<span class="ver">v0.1 单文件</span>');

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, '刷题解析台.html');
fs.writeFileSync(out, html);
console.log('写出', out, (html.length / 1024).toFixed(0) + 'KB');
