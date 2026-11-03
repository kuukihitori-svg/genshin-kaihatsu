/* BetterGI >= 0.66.0; native teleport, localization and path execution only. */
(async function () {
  'use strict';
  const plan = JSON.parse(file.readTextSync('plan.json'));
  const catalogue = JSON.parse(file.readTextSync('catalogue.json'));
  const points = new Map(catalogue.points.map(p => [p.key, p]));
  const mode = settings.mode || '仅原生定位自检';
  const modes = ['仅原生定位自检', '仅原生传送测试', '执行已审阅路线', '核验分区已开点'];
  if (!modes.includes(mode)) throw new Error('运行模式无效。');
  if (plan.schemaVersion !== 1 || catalogue.schemaVersion !== 1) throw new Error('路线或点位目录版本无效。');
  const executing = mode === '执行已审阅路线';
  const audit = mode === '核验分区已开点';
  const persistent = executing || audit;
  const selectedGroup = settings.routeGroup || plan.groups[0].name;
  const runId = new Date().toISOString().replace(/[^0-9T]/g, '');
  let state = { schemaVersion: 1, planRevision: plan.revision, completed: {}, attempts: {} };
  let activeKey = null, activeSegment = null;

  function fail(message, code) { const e = new Error(message); e.code = code; return e; }
  function cancelled(e) { return /cancel|取消|中止|ScriptInterrupted|OperationCanceled/i.test(String(e && (e.message || e))); }
  function point(key) { const p = points.get(key); if (!p) throw fail('未知点位：' + key, 'DATA'); return p; }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function logEvent(type, detail) {
    const row = { time: new Date().toISOString(), runId, type, target: activeKey, segment: activeSegment, detail };
    if (!file.writeTextSync(`logs/${runId}.jsonl.txt`, JSON.stringify(row) + '\n', true)) throw fail('无法保存运行日志。', 'IO');
  }
  function save(extra) {
    if (!persistent) return;
    Object.assign(state, { activeKey, activeSegment, updatedAt: new Date().toISOString() }, extra || {});
    if (!file.writeTextSync('state.json', JSON.stringify(state, null, 2))) throw fail('无法保存断点。', 'IO');
  }
  function screenshot(label) {
    const img = captureGameRegion();
    try { file.writeImageSync(`logs/${runId}-${label}.png`, img.srcMat); } finally { img.dispose(); }
  }
  function nativePoint(value) {
    if (!value) return null;
    const x = value.x === undefined ? value.X : value.x;
    const y = value.y === undefined ? value.Y : value.y;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) return null;
    return { x, y };
  }
  function readPosition(mapName) {
    try { return nativePoint(genshin.getPositionFromMap(mapName, 0)); }
    catch (e) { if (cancelled(e)) throw e; logEvent('position-read-failed', { mapName, reason: String(e.message || e) }); return null; }
  }
  async function stablePosition(mapName, expected, tolerance = 12) {
    let previous = null, consistent = 0;
    for (let n = 0; n < 8; n++) {
      const p = readPosition(mapName);
      const close = p && (!expected || distance(p, expected) <= tolerance);
      consistent = close && previous && distance(p, previous) <= 3 ? consistent + 1 : 0;
      if (consistent >= 2) return p;
      previous = p;
      await sleep(300);
    }
    throw fail('未取得连续稳定且符合预期的落点；请处理剧情、检查地图资源或当前图层后再续跑。', 'POSITION');
  }
  function environment() {
    const version = String(getVersion()).replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!version || (+version[1] === 0 && +version[2] < 66)) throw fail('需要 BetterGI 0.66.0 或更新版本。', 'VERSION');
    const w = Number(genshin.width), h = Number(genshin.height);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || w * 9 !== h * 16) {
      throw fail(`实际游戏客户区 ${w}×${h} 不符合16:9，请调整窗口并重新捕获。`, 'RESOLUTION');
    }
    const img = captureGameRegion();
    try {
      const data = { bgiVersion: getVersion(), gameWidth: w, gameHeight: h,
        captureWidth: img.width, captureHeight: img.height, dpi: Number(genshin.screenDpiScale) || null };
      logEvent('environment', data); return data;
    } finally { img.dispose(); }
  }
  async function nativeCheck(env) {
    const mapName = settings.diagnosticMap || 'Teyvat';
    if (!['Teyvat', 'AncientSacredMountain'].includes(mapName)) throw fail('自检地图无效。', 'DATA');
    const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), mapName, environment: env, samples: [] };
    const read = fn => {
      try { const value = fn(); return value == null ? { ok: false, reason: '空值或无效值' } : { ok: true, value }; }
      catch (e) { if (cancelled(e)) throw e; return { ok: false, reason: String(e.message || e) }; }
    };
    try {
      for (let i = 0; i < 4; i++) {
        report.samples.push({
          default: read(() => nativePoint(genshin.getPositionFromMap(mapName, 0))),
          sift: read(() => nativePoint(genshin.getPositionFromMapWithMatchingMethod(mapName, 'SIFT', 0))),
          orientation: read(() => { const a = genshin.getCameraOrientation(); return typeof a === 'number' && a >= 0 && a < 360 ? a : null; })
        });
        if (i < 3) await sleep(350);
      }
      const stable = method => report.samples.every((s, i, list) => s[method].ok && (!i || distance(s[method].value, list[i - 1][method].value) <= 3));
      report.summary = { defaultStable: stable('default'), siftStable: stable('sift'),
        orientationReadable: report.samples.every(s => s.orientation.ok) };
      report.summary.matchersAgree = report.summary.defaultStable && report.summary.siftStable &&
        report.samples.every(s => distance(s.default.value, s.sift.value) <= 8);
      log.info('原生定位自检结果：' + JSON.stringify(report.summary));
      log.info('连续稳定只表示读数一致；请核对实际站位。未进行点击、传送或移动。');
    } finally {
      if (!file.writeTextSync('native-check.json', JSON.stringify(report, null, 2))) throw fail('无法保存自检报告。', 'IO');
    }
  }
  async function teleportRaw(p, verifyArrival = true) {
    logEvent('native-teleport', { key: p.key, mapName: p.mapName, x: p.x, y: p.y });
    await genshin.returnMainUi();
    if (p.mapName === 'Teyvat') await genshin.tp(p.x, p.y);
    else await genshin.tp(p.x, p.y, p.mapName, false);
    if (!verifyArrival) return null;
    await sleep(800);
    return stablePosition(p.mapName, p.arrival, 12);
  }
  function witnessFor(p) {
    const pair = plan.witnesses[p.mapName];
    if (!pair) throw fail('此地图尚无已确认的核验起点。', 'WITNESS');
    if (settings.witnessKey && point(settings.witnessKey).mapName !== p.mapName) throw fail('自定义核验起点与目标不属于同一地图。', 'WITNESS');
    const keys = [settings.witnessKey || pair[0], pair[1]];
    const candidate = keys.map(k => point(k)).find(q => q.key !== p.key && q.mapName === p.mapName && distance(q.arrival, p.arrival) >= 60);
    if (!candidate) throw fail('缺少同地图且足够远的已开核验起点。', 'WITNESS');
    return candidate;
  }
  function rejectAmbiguousArrival(p) {
    const neighbours = catalogue.points.filter(q => q.key !== p.key && q.mapName === p.mapName && distance(q.arrival, p.arrival) <= 24);
    if (neighbours.length) throw fail(`点位 ${p.key} 与 ${neighbours.map(q => q.key).join('、')} 的二维落点过近，当前接口不能区分高度，保留未知。`, 'AMBIGUOUS');
  }
  async function proveUnlocked(p) {
    rejectAmbiguousArrival(p);
    const witness = witnessFor(p);
    // Force a spatially distinct origin: a silent native failure while standing
    // beside a locked target must never manufacture a completion proof.
    const before = await teleportRaw(witness);
    const after = await teleportRaw(p);
    if (distance(before, after) < 36) throw fail('未观察到由远处起点抵达目标的位移。', 'VERIFY_UNKNOWN');
    const proof = { kind: 'native-teleport-from-distant-witness', witness: witness.key,
      mapName: p.mapName, from: before, arrival: after, checkedAt: new Date().toISOString(), runId };
    logEvent('unlock-proven', { key: p.key, proof }); return proof;
  }
  async function probe(p) {
    try { return await proveUnlocked(p); }
    catch (e) {
      if (cancelled(e) || e.code === 'IO') throw e;
      logEvent('unlock-unknown', { key: p.key, reason: String(e.message || e) });
      return null;
    }
  }
  function mark(p, proof) {
    if (!proof || proof.runId !== runId) throw fail('缺少本次运行的解锁证明。', 'VERIFY_UNKNOWN');
    state.completed[p.key] = proof;
    state.attempts[p.key] = { status: 'verified', time: proof.checkedAt };
    save(); log.info(`${p.areas.join(' / ')} · ${p.tpId} 已核验可传送。`);
  }
  function interaction(p) {
    const img = captureGameRegion();
    try {
      const results = img.findMulti(RecognitionObject.ocr(Math.round(img.width * .48), Math.round(img.height * .2),
        Math.round(img.width * .38), Math.round(img.height * .56)));
      const rows = [];
      for (let i = 0; i < results.count; i++) {
        const r = results[i]; rows.push({ text: String(r.text || '').replace(/\s/g, ''), x: r.x, y: r.y });
      }
      const expected = p.type === 'TeleportWaypoint' ? /^传送锚点$/ :
        p.type === 'Goddess' ? /^七天神像(?:[-·]火)?$/ : new RegExp('^' + p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
      const candidates = rows.filter(r => expected.test(r.text)).sort((a, b) => a.y - b.y);
      if (candidates.length !== 1) return false;
      const chosen = candidates[0];
      return !rows.some(r => r.text !== 'F' && r.y < chosen.y - 8 && r.y > chosen.y - 90 && Math.abs(r.x - chosen.x) < 120);
    } finally { img.dispose(); }
  }
  async function unlock(p) {
    // Require the real interaction at the route endpoint; never blind-press F.
    for (let n = 0; n < 16; n++) {
      if (interaction(p)) {
        keyPress('F'); await sleep(1600);
        // The camp in P2 can start a quest immediately after unlocking. Leave
        // dialogue choices to the player; never send movement or skip keys here.
        const limit = Math.max(30, Math.min(600, Number(settings.storyTimeoutSeconds) || 180)) * 1000;
        let ready = 0, previous = null;
        for (let elapsed = 0; elapsed < limit; elapsed += 1500) {
          const current = readPosition(p.mapName);
          ready = current && previous && distance(current, previous) <= 3 ? ready + 1 : 0;
          if (ready >= 2) { await genshin.returnMainUi(); return; }
          if (elapsed === 0) log.info('等待回到游戏主界面；若触发剧情，请手动处理当前对话。');
          previous = current; await sleep(1500);
        }
        throw fail('剧情等待超时。请处理当前剧情后重新运行同一组，已开点会重新核验。', 'STORY');
      }
      await sleep(250);
    }
    throw fail(`${p.key} 未出现唯一且居首的正确交互提示，请检查站位、机关或剧情。`, 'INTERACTION');
  }
  function validateGroup(group) {
    if (!group || group.status !== 'reviewed-experimental' || !group.stages.length) throw fail('此分区尚未完成路线审阅，不能执行。', 'UNREVIEWED');
    for (const stage of group.stages) {
      const destination = point(stage.target), start = point(stage.start);
      if (start.mapName !== destination.mapName) throw fail('路段跨越独立地图，必须拆分。', 'DATA');
      if (stage.requires.length) throw fail('此路段仍需前置任务：' + stage.requires.join('、'), 'PREREQUISITE');
      if (!stage.fragments.length) throw fail('缺少路线片段。', 'DATA');
      for (const fragment of stage.fragments) {
        if (!/^[a-z0-9-]+$/.test(fragment.id)) throw fail('路线文件名无效。', 'DATA');
        const native = JSON.parse(file.readTextSync(`routes/${fragment.id}.json`));
        if (native.info.map_name !== destination.mapName || !Array.isArray(native.positions) || !native.positions.length ||
          !Array.isArray(fragment.positions) || native.positions.length !== fragment.positions.length ||
          !native.positions.every((p, i) => typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y) &&
            ['x', 'y', 'type', 'move_mode', 'action'].every(k => p[k] === fragment.positions[i][k])) ||
          distance(native.positions[native.positions.length - 1], fragment.end) > .01) throw fail('原生路线与计划不一致。', 'DATA');
      }
    }
  }
  async function execute() {
    const group = plan.groups.find(g => g.name === selectedGroup);
    validateGroup(group);
    for (const stage of group.stages) {
      activeKey = stage.target; activeSegment = null; save({ status: 'running', selectedGroup });
      const p = point(stage.target);
      // Old checkpoints never skip a fresh account/game-state check.
      const existing = await probe(p);
      if (existing) { mark(p, existing); continue; }
      const start = point(stage.start);
      const startProof = await probe(start);
      if (!startProof) throw fail(`起点 ${start.areas.join('/')}（${start.tpId}）尚未核验可用，请先手动点亮该神像/锚点，再续跑此组。`, 'START_UNKNOWN');
      for (const fragment of stage.fragments) {
        activeSegment = fragment.id; save();
        logEvent('navigate-start', { id: fragment.id });
        await pathingScript.runFile(`routes/${fragment.id}.json`);
        const arrival = await stablePosition(p.mapName, fragment.end, fragment.tolerance);
        logEvent('navigate-arrived', { id: fragment.id, arrival });
      }
      await unlock(p);
      const proof = await probe(p);
      if (!proof) throw fail(`${p.key} 交互后仍未通过原生传送核验，未记为完成。`, 'VERIFY_UNKNOWN');
      mark(p, proof);
    }
    activeKey = null; activeSegment = null;
    save({ status: 'selected-group-verified' });
    log.info('本次选择的已审阅路段已核验完成；其他纳塔点位的覆盖情况见 coverage.json。');
  }
  async function auditArea() {
    const area = settings.auditArea || '坚岩隘谷';
    const selected = catalogue.points.filter(p => p.scope === 'standard' && p.areas[0] === area);
    if (!selected.length) throw fail('核验分区无效。', 'DATA');
    // This explicitly selected mode teleports between points; it does not press F
    // or infer "locked" from native API/OCR/localization failure.
    const report = { schemaVersion: 1, runId, area, source: catalogue.reference, results: [] };
    for (const p of selected) {
      activeKey = p.key; activeSegment = null;
      const proof = await probe(p);
      if (proof) mark(p, proof);
      else { delete state.completed[p.key]; state.attempts[p.key] = { status: 'unknown', checkedAt: new Date().toISOString() }; save(); }
      report.results.push({ key: p.key, status: proof ? 'verified' : 'unknown', proof });
    }
    if (!file.writeTextSync('unlock-report.json', JSON.stringify(report, null, 2))) throw fail('无法保存核验报告。', 'IO');
    activeKey = null; save({ status: 'area-audit-finished' });
    log.info(`分区核验结束：${report.results.filter(r => r.status === 'verified').length}/${selected.length} 已确认，其余保留未知。`);
  }
  try {
    file.createDirectory('logs');
    logEvent('run-start', { packageVersion: plan.packageVersion, mode, selectedGroup });
    log.info(`纳塔开图 ${plan.packageVersion}；${mode}。`);
    const env = environment();
    if (mode === '仅原生定位自检') { await nativeCheck(env); return; }
    if (mode === '仅原生传送测试') {
      const p = point(settings.teleportTarget || 'Teyvat:1166');
      await teleportRaw(p, false);
      log.info('原生传送接口已返回；未运行路线或写开图断点。'); return;
    }
    if (file.isExists('state.json')) {
      try {
        const previous = JSON.parse(file.readTextSync('state.json'));
        if (previous.schemaVersion === 1 && previous.planRevision === plan.revision &&
          previous.completed && typeof previous.completed === 'object' && !Array.isArray(previous.completed) &&
          previous.attempts && typeof previous.attempts === 'object' && !Array.isArray(previous.attempts)) state = previous;
      } catch (_) { logEvent('checkpoint-ignored', '旧断点格式损坏，全部点位仍需重新核验。'); }
    }
    if (executing) await execute(); else await auditArea();
  } catch (e) {
    if (persistent) {
      if (activeKey) { delete state.completed[activeKey]; state.attempts[activeKey] = { status: 'unknown', reason: String(e.message || e) }; }
      try { screenshot('stopped'); } catch (_) {}
      try { save({ status: cancelled(e) ? 'cancelled' : 'stopped', lastError: String(e.message || e) }); } catch (_) {}
    }
    log.error('纳塔脚本停止：' + String(e.message || e));
    throw e;
  }
})();
