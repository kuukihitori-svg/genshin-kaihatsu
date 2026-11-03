# 纳塔开图研究记录

本轮按“画面、音轨、可见文字 → 坐标与前置条件 → 原生导航 → 结果核验”机制制作首批路线。实际可执行范围为某橙sama纳塔5.0 P2的3→6号。其余地区保留来源索引与完整点位目录，不声称已实现自动路线。

## 原始来源

| 范围 | 原攻略 | 已核对内容 |
| --- | --- | --- |
| 5.0，52个编号点 | [BV1xysNe1Ec4](https://www.bilibili.com/video/BV1xysNe1Ec4/) | 18段目录；本轮分析P1地图和P2音视频 |
| 5.2，38个编号点 | [BV1fzSKY5Ew7](https://www.bilibili.com/video/BV1fzSKY5Ew7/) | 11段目录及任务前置标题，未分析路线 |
| 5.5，40个编号点 | [BV1eGoYYAECW](https://www.bilibili.com/video/BV1eGoYYAECW/) | 14段目录及任务前置标题，未分析路线 |
| 全部静态点位 | [BetterGI 0.66.0 tp.json](https://github.com/babalae/better-genshin-impact/blob/0.66.0/BetterGenshinImpact/GameTask/AutoTrackPath/Assets/tp.json) | 原始文件Git blob与SHA-256已核对，目录含独立地图 |

`sources.json`只保存公开的分段名称、CID、时长和来源链接，没有签名播放地址。媒体、原始网页、逐帧审计、自动音轨转写和截图存放于本轮 `/workspace/natlan-research`，未提交到Git或导入包。

## P2恢复与边界

完整视频305.536秒，1080p，约30fps。视频哈希 `dff9f9eb1bf34e12425db2dcaaf8c99c415d3b9ea419cab2d9ff1298fe4e93bb`。全片9,165帧依次解码，4,777帧具有绝对地图匹配或最长2秒的连续光流位置观测；不使用未定位帧自动补线。3个地图控制点加3个交叉检查点的最大误差约2.06像素。

音轨用faster-whisper small生成63段转写；关键机制按画面对照核对，包含同音错字，未当作人工逐字听校。平台字幕需要登录，未取得完整字幕轨。画面文字另做3秒采样OCR，核对营地剧情和交互关键画面，未声称完整逐条字幕验收。

1→2→3有未揭示小地图、嵴锋龙附身和爬升，未生成猜测路径。3→4为普通滑翔与落地接近，营地可触发剧情。4→5的语音明确把龙能力说明为加速手段，因此用普通步行沿地面路径替代，需实机验证。5→6末段地图纹理不足，舍弃低可信匹配，只保留视频连续可见的草地、浅台阶至已知神像目标的原生接近段；该约90坐标单位末段须优先实机校准。

路线点的帧号、时间、匹配内点数与来源保存在 `p2.navigation.json`；执行包的 `evidence.json`为其副本。程序逻辑模拟成功与真实游戏路线验收分开记录，当前实机验收数为0。

## 重现

核心构建和测试不需要视频分析环境：

```sh
npm run test:natlan
npm run build:natlan -- --zip dist/纳塔分区开图-0.1.0.zip
```

重新分析须准备对应原始媒体与已记录的对齐数据，再在分析虚拟环境执行：

```sh
python tools/track_natlan_p2.py --media /path/to/study-p2.mp4 --alignment /path/to/p2-alignment.json --out /path/to/p2-audit.json
python tools/import_natlan_route_p2.py --audit /path/to/p2-audit.json --asr /path/to/p2-asr.json --burned-text /path/to/p2-burned-text.json
python tools/build_natlan.py
```

`track_natlan_p2.py`限定了本次源媒体哈希、参考帧和小地图布局，不能用于其他视频；它只输出位置观测，不推断通行或龙能力。首批路线导入器只导出已说明的段落，不把光流丢失、机关未知或不同地图中的同号点转成自动路线。

本轮可用分析依赖：OpenCV headless 5.0.0.93、NumPy 2.5.4、yt-dlp 2026.10.26、faster-whisper 1.2.1、rapidocr-onnxruntime 1.4.4。语音输入经ffmpeg转为16kHz单声道float32数组后送入转写器，避免本环境PyAV音频打开接口不兼容。原始转写只保留在研究工作区。
