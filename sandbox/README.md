# 任务、战斗与宝箱测试引擎

这是第一版纯JavaScript规则引擎，不需要原神、BetterGI、GPU或第三方依赖。它用于验证任务步骤、战斗触发和宝箱解锁的状态变化。

当前文件：

- `world.js`：Node/浏览器通用状态引擎，导出 `World`。
- `scenarios/camp-demo.json`：合成演示场景，所有坐标和规则均为示例，并非真实原神任务数据。
- `test-world.cjs`：16组规则测试。

在工作区根目录运行：

```text
node sandbox/test-world.cjs
```

演示规则：进入营地 → 击败两名守卫 → 宝箱解除锁定 → 靠近并交互开箱 → 任务完成。未满足条件时不能开箱，重复交互不重复发奖励。还检查交互距离、离场、死亡与重置。

## 接口

```js
const { World } = require('./world.js');
const scenario = require('./scenarios/camp-demo.json');
const world = new World(scenario);
world.dispatch({ type: 'move', x: 54, y: 44 });
world.dispatch({ type: 'attack', targetId: 'guard-a' });
console.log(world.snapshot());
```

支持动作：`move`、`attack`、`interact`、`reset`。场景声明出生点、区域、敌人组、交互距离、战斗参数、奖励和任务条件。节点引用、有限数值、重复ID和未知条件会进行校验。

## 当前范围

移动为二维直线，战斗为简化固定伤害规则。尚未实现原神地图底图、真实任务导入、三维碰撞、真实战斗、OCR、BetterGI宿主适配或交互界面。模拟通过只说明配置规则成立，不代表在真实游戏中通过。

用户已要求改到云端任务继续。后续开发优先完成交互沙盘、场景导入和测试报告；真实点位需要记录来源、地图层和坐标系，并单独补充任务规则。原有本地原神脚本和宿主模拟工具未纳入本仓库。
