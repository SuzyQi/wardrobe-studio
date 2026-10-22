const test=require('node:test'),assert=require('node:assert/strict'),K=require('../color-core.js'),C=require('../core.js'),Cloud=require('../cloud.js');
function photo(w,h,draw){const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(draw(x,y),4*(y*w+x));return K.analyze(data,w,h);}
test('main-color suggestions ignore transparent padding, combine blue shades, and distinguish multicolor prints',()=>{
 const a=photo(40,60,(x,y)=>x<6||x>34||y<4||y>54?[0,0,0,0]:x%6===0?[250,250,250,255]:x%2?[50,100,175,255]:[125,165,210,255]);assert.equal(a.mainColor,'blue');
 assert.equal(photo(30,30,(x,y)=>x<15?[170,35,40,255]:[35,130,55,255]).mainColor,'unknown'); // opaque full-frame: no reliable garment/background separation
 assert.equal(photo(40,40,(x,y)=>x<4||x>35||y<4||y>35?[0,0,0,0]:x<20?[170,35,40,255]:[35,130,55,255]).mainColor,'multi');
 assert.equal(photo(40,40,(x,y)=>x<4||x>35||y<4||y>35?[0,0,0,0]:x===5?[25,25,25,255]:[220,208,184,255]).mainColor,'beige');
 assert.equal(K.family(220,217,200),'beige');assert.equal(K.family(200,201,201),'gray');
});
test('edge-connected white background is excluded; plain white and complex photographs stay uncertain',()=>{
 assert.equal(photo(40,40,(x,y)=>x>8&&x<30&&y>3&&y<37?[55,115,185,255]:[255,255,255,255]).mainColor,'blue');
 assert.equal(photo(30,30,()=>[255,255,255,255]).mainColor,'unknown');
 assert.equal(photo(30,30,(x,y)=>[x*8,y*8,80,255]).mainColor,'unknown');
 assert.equal(photo(30,30,(x,y)=>x<3||x>26||y<3||y>26?[0,0,0,0]:[249,249,247,255]).mainColor,'white');
});
test('main color and human-readable color remain independent through backups and cloud manifests',()=>{
 const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0f8AAAAASUVORK5CYII=';
 const g={id:'g1',name:'The Simone',category:'dresses',aspect:.7,color:'Chocolate Havana',mainColor:'brown',colorSource:'manual',image:PNG,thumb:PNG,original:PNG};
 const record=C.validateBackup({app:'wardrobe-studio',version:2,garments:[g],outfits:[]}).garments[0];assert.equal(record.color,g.color);assert.equal(record.mainColor,'brown');assert.equal(Cloud.metadata(record).colorSource,'manual');assert.equal(Cloud.metadata(record).mainColor,'brown');assert(!Object.hasOwn(C.garmentDetails({color:'Chocolate Havana'}),'mainColor'));
 assert.throws(()=>C.garmentDetails({mainColor:'invalid'}),/主色/);assert(K.matches(g,['blue','brown']));assert(!K.matches(g,['blue']));assert(K.matches({color:'navy'},['unknown']));
});
