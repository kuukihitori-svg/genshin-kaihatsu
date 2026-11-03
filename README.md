# genshin-kaihatsu

轻量二维任务、战斗触发与宝箱解锁测试沙盘，所有默认数据均为合成示例。

已提供[伦波岛 P2 BetterGI 开图脚本实验版](bettergi/nod-krai-p2/README.md)，针对神像已点亮、相关剧情未完成的账号。包含原生定位自检、原生方位点与12段导航、升降台交互、剧情恢复、目标解锁核验与失败记录；不再强制选点或传送神像。`npm run build:bettergi` 重建路线包，`npm run test:bettergi` 运行宿主模拟回归；真实游戏尚未验收。

攻略视频分析流程支持下载、按时间戳采样、原帧回看和地图坐标对齐。原视频全部 15,612 帧已顺序解码处理，途经点保留匹配/人工量图/连续飞行插值等来源，见 [视频研究说明](video-study/README.md)。

直接打开 [离线 HTML](sandbox/dist/sandbox.html)，或运行 `npm start` 后访问 http://localhost:8000。

`npm test` 运行规则测试，`npm run build` 重建离线产物。操作说明、输入格式、实际验证结果与模拟边界见 [沙盘 README](sandbox/README.md)。
