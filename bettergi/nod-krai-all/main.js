/* BetterGI >= 0.66.0. Routes are experimental; unsupported steps stop here. */
(async function () {
  'use strict';
  const plan = JSON.parse(file.readTextSync('plan.json'));
  if (plan.schemaVersion !== 1) throw new Error('分区计划版本不支持。');
  const mode = settings.mode || '查看分区覆盖';
  const region = plan.catalog.regions.find(p => p.id === (settings.region || '伦波岛'));
  if (!region) throw new Error('分区名称无效。');
  const points = new Map(plan.catalog.targets.map(p => [p.id, p]));
  const routes = new Map(plan.routes.map(p => [p.id, p]));
  const runId = new Date().toISOString().replace(/[^0-9T]/g, '');
  let active = null;
  const state = { schemaVersion: 1, planSha256: plan.planSha256, completed: {} };

  function save(name, value) {
    if (!file.writeTextSync(name, JSON.stringify(value, null, 2))) throw new Error('无法写入 ' + name);
  }
  function event(type, detail) {
    if (!file.writeTextSync(`logs/${runId}.jsonl.txt`, JSON.stringify({ time: new Date().toISOString(), module: active, type, detail })+'\n', true)) throw new Error('无法记录运行日志。');
  }
  function cancelled(e) { return /cancel|取消|中止|ScriptInterrupted/i.test(String(e && (e.message || e))); }
  function distance(a, b) { return Math.hypot(a.x-b.x, a.y-b.y); }
  function readPosition(mapName) {
    const p = genshin.getPositionFromMap(mapName, 0);
    const x = p && (p.x === undefined ? p.X : p.x), y = p && (p.y === undefined ? p.Y : p.y);
    return x != null && y != null && Number.isFinite(Number(x)) && Number.isFinite(Number(y)) && (Number(x)!==0 || Number(y)!==0) ? { x:Number(x), y:Number(y) } : null;
  }
  async function stable(mapName, expected, tolerance) {
    let previous = null, reason = '';
    for (let i=0; i<6; i++) {
      let p = null;
      try { p = readPosition(mapName); } catch (e) { if (cancelled(e)) throw e; reason = String(e.message || e); }
      if (p && previous && distance(p,previous)<5 && (!expected || distance(p,expected)<=tolerance)) return p;
      previous = p; await sleep(300);
    }
    event('position-failed', { mapName, expected, tolerance, previous, reason });
    throw new Error('未取得符合预期的稳定位置，停止当前路段。');
  }
  function ocr(box) {
    const image = captureGameRegion();
    try {
      const result = image.findMulti(RecognitionObject.ocr(Math.round(box[0]*image.width), Math.round(box[1]*image.height), Math.round(box[2]*image.width), Math.round(box[3]*image.height)));
      const rows = [];
      for (let i=0; i<result.count; i++) rows.push({ text:String(result[i].text || '').replace(/\s/g,''), x:result[i].x, y:result[i].y });
      return rows;
    } finally { image.dispose(); }
  }
  function prompt(target) {
    const rows = ocr([.48,.20,.35,.56]);
    const expected = target.kind === 'TeleportWaypoint' ? text => /传送锚点/.test(text) : text => text.includes(target.name.replace(/\s/g,''));
    const match = rows.filter(r => expected(r.text)).sort((a,b)=>a.y-b.y)[0];
    if (!match) return false;
    return !rows.some(r => r.text && r.text!=='F' && r.y<match.y-8 && r.y>match.y-85 && Math.abs(r.x-match.x)<100);
  }
  async function teleport(target) {
    await genshin.returnMainUi();
    event('native-teleport', { id:target.id, mapName:target.mapName });
    await genshin.tp(target.position.x, target.position.y, target.mapName, false);
    await sleep(1000);
    const p = await stable(target.mapName,target.arrival,14);
    const competitor = plan.catalog.targets.find(t => t.id!==target.id && t.mapName===target.mapName && distance(p,t.arrival)+4<distance(p,target.arrival));
    if (competitor) throw new Error('到达位置更接近另一个原生点，不能核验当前目标：'+competitor.id);
    return p;
  }
  async function probe(target) {
    try { return await teleport(target); }
    catch (e) { if (cancelled(e)) throw e; event('unlock-unknown',{id:target.id,reason:String(e.message||e)}); return null; }
    finally { await genshin.returnMainUi(); }
  }
  function completed(target, position) {
    state.completed[target.id] = { verifiedAt:new Date().toISOString(), proof:'native-teleport-and-stable-2d-position', position };
    save('state.json',state); event('target-verified',target.id);
  }
  async function navigate(route) {
    const before = await stable(route.mapName,null,0);
    if (distance(before,route.points[0])>35) throw new Error('距离所选路线起点超过35，停止接线。');
    if (!route.nativeChunks || !route.nativeChunks.length) throw new Error('此路段尚未生成可执行路径。');
    for (let i=0; i<route.nativeChunks.length; i++) {
      const part = route.nativeChunks[i];
      event('navigate-start',{ route:route.id, part:i+1 });
      await pathingScript.runFile(part.file);
      await sleep(250);
      event('navigate-arrived',{ route:route.id, part:i+1, position:await stable(route.mapName,part.end,6) });
    }
  }
  async function unlock(target) {
    const began = Date.now();
    let refined = false;
    while (Date.now()-began<5000) {
      if (prompt(target)) {
        keyPress('F'); await sleep(1500);
        const p = await probe(target);
        if (!p) throw new Error('交互后原生传送核验失败，未写入完成记录。');
        return p;
      }
      await sleep(250);
    }
    const near = await stable(target.mapName,null,0);
    if (distance(near,target.position)<=12 && distance(near,target.position)>2) {
      event('native-final-approach',{ id:target.id, from:near, to:target.position });
      await pathingScript.run(JSON.stringify({ info:{ name:'锚点近距接近',type:'collect',bgi_version:'0.66.0',map_name:target.mapName },
        positions:[{ x:target.position.x,y:target.position.y,type:'target',move_mode:'walk',action:'' }] }));
      await stable(target.mapName,target.position,4);
      for (let i=0; i<8; i++) {
        if (prompt(target)) { keyPress('F'); await sleep(1500);refined=true;break; }
        await sleep(250);
      }
    }
    const p = await probe(target);
    if (p) return p;
    throw new Error(refined ? '交互后原生传送核验失败，未写入完成记录。' : '未找到目标交互，可能存在高度、碰撞或剧情问题；未记为完成。');
  }
  function report() {
    const selected = region.targetIds.map(id => points.get(id));
    const supported = plan.modules.filter(m=>m.status==='reviewed_experimental' && !m.prerequisites.length);
    const summary = { schemaVersion:1, fullCampaignReady:false, packageVersion:plan.packageVersion,
      inventory:plan.catalog.counts, selectedRegion:region.id,
      experimentalTargets:plan.catalog.counts.implemented,
      executableModules:supported.length, gameValidated:0,
      targets:selected.map(t=>({ id:t.id,name:t.name,kind:t.kind,routeStatus:t.routeStatus,routeId:t.routeId,prerequisites:t.prerequisites })),
      gates:plan.gates,
      notice:'原生点位清单不等于可通行路线；没有人工逐帧/逐句完整审看或实机全图跑通的声明。' };
    save('coverage-report.json',summary);
    log.info(`全图清单${plan.catalog.counts.total}点/${plan.catalog.counts.regions}分区；目前可执行${supported.length}个实验路段，实机验收0。`);
    log.info(`${region.id}共${selected.length}点；详情已写入 coverage-report.json。全图自动开图尚未完成。`);
  }

  if (mode==='查看分区覆盖') { report(); return; }
  if (mode!=='运行一个已恢复路段') throw new Error('运行模式无效。');
  const module = plan.modules.find(m=>m.id === (settings.module || '6.0-12'));
  if (!module || !points.has(module.target)) throw new Error('路段编号无效。');
  const destination = points.get(module.target);
  if (destination.region!==region.id) throw new Error('所选分区与路段目标不一致，请按覆盖报告选择。');
  // Validate the whole selected module before opening a map or issuing input.
  if (module.status!=='reviewed_experimental' || module.prerequisites.length) {
    const detail = module.prerequisites.map(id=>plan.gates.find(g=>g.id===id)).filter(Boolean).map(g=>g.message).join('；');
    throw new Error('此路段仍被前置条件或缺失机关模块阻止：'+detail);
  }
  const origin = points.get(module.from);
  if (!origin || origin.mapName!==destination.mapName || !module.steps.length || module.steps.some(step =>
    step.kind==='navigate' ? !routes.has(step.route) || routes.get(step.route).mapName!==destination.mapName || !routes.get(step.route).nativeChunks || !routes.get(step.route).nativeChunks.length :
    step.kind!=='rest' || step.milliseconds<100 || step.milliseconds>15000)) throw new Error('模块缺少路径、地图或机关实现，未开始操作。');
  if (!/^v?(?:0\.(?:6[6-9]|[7-9]\d|\d{3,})\.|[1-9]\d*\.)/.test(getVersion())) throw new Error('需要 BetterGI 0.66.0 或更新版本。');
  if (!Number.isInteger(Number(genshin.width)) || !Number.isInteger(Number(genshin.height)) || Number(genshin.width)<=0 || Number(genshin.height)<=0 || Number(genshin.width)*9!==Number(genshin.height)*16) throw new Error('BetterGI检测到的游戏客户区必须为16:9，2560×1440可用。');
  file.createDirectory('logs'); active=module.id;
  try {
    if (file.isExists('state.json')) {
      try {
        const old = JSON.parse(file.readTextSync('state.json'));
        if (old.planSha256===plan.planSha256 && old.completed && typeof old.completed==='object') state.completed=old.completed;
      } catch (_) { /* A saved record never replaces live verification. */ }
    }
    state.active=active; state.status='running';save('state.json',state);
    event('run-start',{ packageVersion:plan.packageVersion,version:getVersion(),module:active });
    log.info(`${active}：需要对应攻略${module.fromGuideNumber}号起点已开，将前往${module.targetGuideNumber}号。`);
    await genshin.returnMainUi();
    // A destination probe may change maps. Establish the source again before
    // every movement, including after a logged native teleport failure.
    const already = await probe(destination);
    if (already) { completed(destination,already);state.status='selected-module-verified';save('state.json',state);return; }
    await teleport(points.get(module.from));
    for (const step of module.steps) {
      if (step.kind==='navigate') await navigate(routes.get(step.route));
      else if (step.kind==='rest' && step.milliseconds>=100 && step.milliseconds<=15000) await sleep(step.milliseconds);
      else throw new Error('缺失机关执行器，停止当前模块。');
    }
    completed(destination,await unlock(destination));
    state.status='selected-module-verified';save('state.json',state);
    log.info(`${module.id}已核验可传送；这只代表本路段目标，全图尚未完成。`);
  } catch (e) {
    state.status='stopped';state.lastError=String(e.message||e);
    try { save('state.json',state); } catch (_) {}
    if (!cancelled(e)) {
      try { const image=captureGameRegion();try { file.writeImageSync(`logs/${runId}-failed.png`,image.srcMat); } finally { image.dispose(); } } catch (_) {}
    }
    try { event('stopped',String(e.message||e)); } catch (_) {}
    throw e;
  }
})();
