const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://sandbox.test/**', route=>route.fulfill({contentType:'text/html',body:require('node:fs').readFileSync(path.join(__dirname,'dist/sandbox.html'),'utf8')}));
 await page.goto('http://sandbox.test/');
 await page.click('#interact');assert.match(await page.textContent('#feedback'),/CHEST_LOCKED/);
 await page.click('#attack');assert.match(await page.textContent('#feedback'),/OUTSIDE_BATTLE_AREA/);
 // Actual SVG click moves into camp, and accessible SVG entity attacks.
 const map=page.locator('#map');await map.scrollIntoViewIfNeeded();const box=await map.boundingBox();
 await page.mouse.click(box.x+box.width*.50,box.y+box.height*.44);
 await page.getByRole('button',{name:'守卫甲 20/20',exact:true}).locator('circle').click();
 assert.match(await page.textContent('#enemies'),/守卫甲：10/);
 await page.fill('#x','12');await page.fill('#y','50');await page.locator('#move button').click();
 assert.match(await page.textContent('#log'),/battle-exit/);
 await page.click('#reset');
 for(let i=0;i<8;i++)await page.click('#step');
 assert.match(await page.textContent('#stats'),/任务完成（模拟通过）/);
 assert.match(await page.textContent('#stats'),/代币 10/);
 await page.click('#interact');assert.match(await page.textContent('#feedback'),/ALREADY_OPENED/);
 await page.screenshot({path:path.join(__dirname,'dist/preview.png'),fullPage:true});
 const scene=JSON.parse(await page.inputValue('#json'));
 await page.fill('#json','{broken');await page.click('#import');assert.match(await page.textContent('#import-result'),/导入失败/);
 assert.match(await page.textContent('#stats'),/代币 10/);
 const unsupported=structuredClone(scene);unsupported.chest.unlockCondition={type:'unknown'};
 await page.fill('#json',JSON.stringify(unsupported));await page.click('#import');assert.match(await page.textContent('#import-result'),/不支持字段/);
 scene.player.maxHp=1;scene.title='<img src=x onerror=alert(1)>';
 await page.setInputFiles('#file',{name:'death.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(scene))});
 await page.waitForFunction(()=>document.querySelector('#import-result').textContent.includes('校验通过'));
 await page.fill('#x','54');await page.fill('#y','44');await page.locator('#move button').click();await page.click('#attack');
 assert.match(await page.textContent('#stats'),/角色倒下/);
 await page.click('#interact');assert.match(await page.textContent('#feedback'),/PLAYER_DEAD/);
 await page.click('#reset');assert.match(await page.textContent('#stats'),/生命 1\/1/);
 assert.deepEqual(errors,[]);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS Chromium: SVG movement/attack, exit, full chain, duplicate reward, malformed/unsupported import, file import, death/reset, mobile layout; no page errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
