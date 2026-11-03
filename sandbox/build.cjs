const fs=require('node:fs'),path=require('node:path');
const dir=__dirname;
const demo='const DEMO_SCENE = '+fs.readFileSync(path.join(dir,'scenarios/camp-demo.json'),'utf8').replace(/</g,'\\u003c')+';';
fs.writeFileSync(path.join(dir,'demo.js'),demo);
let html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
html=html.replace('<link rel="stylesheet" href="style.css">',()=>'<style>'+fs.readFileSync(path.join(dir,'style.css'),'utf8')+'</style>');
for(const file of ['world.js','demo.js','app.js'])html=html.replace(`<script src="${file}"></script>`,()=>'<script>'+fs.readFileSync(path.join(dir,file),'utf8').replace(/<\/script/gi,'<\\/script')+'</script>');
fs.mkdirSync(path.join(dir,'dist'),{recursive:true});fs.writeFileSync(path.join(dir,'dist/sandbox.html'),html);
console.log('Built sandbox/dist/sandbox.html (offline, no dependencies)');
