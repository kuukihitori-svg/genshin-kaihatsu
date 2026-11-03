# genshin-kaihatsu

轻量二维任务、战斗触发与宝箱解锁测试沙盘，所有默认数据均为合成示例。

新增[纳塔分区开图首版](bettergi/natlan/README.md)：按原生定位、传送、导航和逐点核验机制，实现5.0 P2的3→6号首批路线（3段、73个来源点），适合部分神像已亮、世界任务未完成的账号分段测试。目录包含167处纳塔点位，远古圣山使用独立地图；其余自动路线未完成，现有路线未实机验收。`npm run test:natlan` 运行宿主和构建检查，`npm run build:natlan -- --zip dist/纳塔分区开图-0.1.0.zip` 生成导入包。

已提供[伦波岛 P2 BetterGI 开图脚本实验版](bettergi/nod-krai-p2/README.md)，针对神像已点亮、相关剧情未完成的账号。包含原生定位自检、独立原生传送测试、原生方位点与12段导航、升降台交互、剧情恢复及失败记录；地图传送直接调用 BetterGI 的 `genshin.tp()`，已移除通用地图点选和地图面板OCR。`npm run build:bettergi` 重建路线包，`npm run test:bettergi` 运行宿主模拟回归；原生选点偏移和实机路线仍待验收。

攻略视频分析流程支持下载、按时间戳采样、原帧回看和地图坐标对齐。原视频全部 15,612 帧已顺序解码处理，途经点保留匹配/人工量图/连续飞行插值等来源，见 [视频研究说明](video-study/README.md)。

直接打开 [离线 HTML](sandbox/dist/sandbox.html)，或运行 `npm start` 后访问 http://localhost:8000。

`npm test` 运行规则测试，`npm run build` 重建离线产物。操作说明、输入格式、实际验证结果与模拟边界见 [沙盘 README](sandbox/README.md)。
