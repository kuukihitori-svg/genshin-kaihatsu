# 二维任务实验室

复用 `world.js` 状态引擎的无运行时依赖沙盘。合成任务链：进入营地 → 触发战斗 → 击败甲乙两名守卫 → 宝箱解锁 → 靠近开箱 → 任务完成。界面明确显示“模拟通过”。

## 打开与启动

直接用浏览器打开 `sandbox/dist/sandbox.html`，可以离线运行，不需要安装依赖。也可以在仓库根目录执行：

```sh
npm start
# 浏览器打开 http://localhost:8000
```

需 Node >=18；HTTP 启动命令另需 Python 3。点击地图空白移动、守卫攻击、宝箱开箱；可用数值输入坐标、最近守卫攻击按钮和“执行下一步示例”。一步仅派发一个引擎动作，完整示例需要 8 步；手动操作后会根据当前状态继续。导入其他配置后停用示例按钮。重置恢复当前场景，载入合成示例恢复默认场景。

## 构建和测试

```sh
npm run build        # 更新 demo.js 与离线单文件 HTML
npm test             # 17 组纯 Node 规则测试
npm run test:browser # Playwright + Chromium 浏览器回归
```

运行和构建不需要 npm 第三方包。浏览器测试需要可解析的 `playwright` 与 `/usr/bin/chromium`（可用 `CHROMIUM_PATH` 指定）；当前云环境已提供。其他机器可在独立测试环境安装 Playwright，不是应用运行依赖。测试通过路由直接提供构建后的 HTML，无外网请求，截图输出 `dist/preview.png`。

本次云端结果：17/17 引擎测试通过；Chromium 验证 SVG 点击移动/攻击、离场、8 步完整链、重复奖励拒绝、错误 JSON、未知字段拒绝且保留原世界、文件导入、死亡阻止开箱与重置、390px 布局无横向溢出；无页面异常。浏览器截图也经目视检查。浏览器启动需要云端允许相应系统调用。

## 输入格式与适配边界

以 `scenarios/camp-demo.json` 为完整可导入模板（schemaVersion=1）。可粘贴或选取 JSON 文件，UTF-8 最大 256 KiB。失败提示保留原世界；不使用 eval，导入文本以 textContent 显示。

- `bounds`：有限数值 minX/maxX/minY/maxY；所有点须在范围内。
- `provenance`：kind、notice、source、version、mapLayer、coordinateSystem 非空字符串。示例为 synthetic。
- `coordinateSystem` 当前只接受 `sandbox-cartesian-v1`：x 向右、y 向下、平面单位，无地理含义；地图层为来源标签，不实现跨层移动。
- `player`：spawn{x,y}、正整数 maxHp。
- `areas`：非空圆形区域数组，id/name/shape=circle/x/y/radius；radius 正有限值。
- `enemies`：非空数组，id/name/groupId/x/y/maxHp（正整数）。
- `combat`：battleAreaId、groupId 必须存在；attackDamage 正整数、attackRange 正有限值、counterDamage 非负整数。
- `chest`：单宝箱 id/name/x/y/interactionRange/unlockGroupId/reward{tokens}。解锁条件显式为指定组全部敌人 hp=0，tokens 非负安全整数。
- `quest`：id/title/steps；步骤 id/title/condition。只支持 enter-area{areaId}、defeat-group{groupId}、open-chest{chestId}，按顺序完成。进入记录永久保留，直线路径经过区域也计入；战斗由终点决定。
- `rules`：movement 只支持 straight-line；可提供 movementNotice/combatNotice/rewardNotice 描述。未知字段、条件、形状、无效引用与重复实体/步骤 ID 均拒绝。

未来来源适配器应先将外部点位转换成以上 schema，再交给 World；保留 source/version/mapLayer 并说明转换后的 coordinateSystem。当前没有真实地图坐标转换器，不能直接导入 BetterGI 路线或空荧点位；点位也不含完整任务逻辑，必须额外显式配置敌人组、解锁条件和任务步骤。来源许可须单独核实。

## 模拟边界

移动瞬时直线，无真实碰撞、层高、体力和寻路；战斗为范围检查与固定伤害，每次成功攻击且组内仍有活敌人时反击一次。离场暂停，返回保留敌人伤害；倒下后只允许重置；重复开箱不会重复奖励。任务阶段是配置条件的结果，不声称复现真实原神任务。

所有默认坐标、人物、任务、奖励均为合成数据。未下载地图或游戏美术，无 3D、OCR、真实游戏连接、键鼠输入或 BetterGI 宿主绑定。模拟通过不代表实机成功；未来宿主适配还须处理导航仅日志报错等行为，不能假定失败一定抛异常。
