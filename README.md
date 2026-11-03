# genshin-kaihatsu

轻量二维任务、战斗触发与宝箱解锁测试沙盘，所有默认数据均为合成示例。

已提供[伦波岛 P2 0.2.4 实验版](bettergi/nod-krai-p2/README.md)，针对神像已点亮、相关剧情未完成的账号。用户已确认原生传送测试成功；本次重新恢复246个途经点，增加步行分段核验、两次升降机启动提示与原生落地动作，取消斜坡处盲按T。1→2近似路线及5→6步行变体仍待实机验收。`npm run build:bettergi` 重建路线包，`npm run test:bettergi` 运行30项宿主模拟检查。

[挪德卡莱分区开发包](bettergi/nod-krai-all/README.md)包含145个原生点、10个分区的清单，以及25段恢复坐标，其中21段开放单独测试。默认只输出覆盖报告；月球机关、任务锚点与部分角色机制尚缺，**全图自动开图尚未完成，实机验收为0**。`npm run build:campaign` 构建；`npm run test:campaign` 运行11项证据检查和13项宿主模拟。完整状态及下一步见[开发记录](video-study/nod-krai-progress.md)。

攻略视频分析流程支持公开媒体收集、自动语音转写、全帧定位审计、可选OCR、原帧回看和原生地图坐标对齐。12个分P已全帧顺序处理；关键动作抽帧与转写交叉核对，不等同于完整人工逐帧、逐句听音或全字幕审看。见[来源索引](video-study/nod-krai.sources.json)和[视频研究说明](video-study/README.md)。

直接打开 [离线 HTML](sandbox/dist/sandbox.html)，或运行 `npm start` 后访问 http://localhost:8000。

`npm test` 运行规则测试，`npm run build` 重建离线产物。操作说明、输入格式、实际验证结果与模拟边界见 [沙盘 README](sandbox/README.md)。
