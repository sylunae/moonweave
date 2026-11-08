# Moonweave 原生 chart.json 格式

默认直接生成原生谱面文件。应用到当前谱面时，使用「AI 制谱」默认的「套用完整谱面」模式；作为新作品导入时，使用「我的谱面 → 导入」。无需编辑器上下文、target、revision、requestId 或续改脚本。

## 完整文件示例

```json
{
  "version": 1,
  "title": "曲名",
  "artist": "",
  "audioPath": "",
  "audioName": "",
  "backgroundPath": "",
  "backgroundName": "",
  "backgroundType": "",
  "backgroundVideoStartTime": 0,
  "coverPath": "",
  "coverName": "",
  "bpm": 120,
  "bpmChanges": [],
  "effects": [],
  "offset": 0,
  "duration": 10000,
  "notes": [
    { "id": "phrase-001", "kind": "note", "lane": 0, "time": 1000 },
    { "id": "phrase-002", "kind": "hold", "lane": 2, "time": 1500, "endTime": 2500 }
  ],
  "aiImportHistory": [],
  "settings": { "editorZoom": 230 }
}
```

例子只说明字段，不能用示例音符代替实际制谱。

## 时间与音符

- 所有时间均为毫秒，可有小数。一拍为四分音符，八分音符为 0.5 拍，十六分音符为 0.25 拍。
- 首次制作以 MIDI tick 0 为时间零点，按 MIDI tempo map 换算绝对毫秒，offset 默认 0。初始 bpm 使用 MIDI 在 tick 0 生效的速度；未指定 tempo 时使用 MIDI 默认 120 BPM。bpmChanges 使用绝对毫秒，按时间严格递增，不重复列出初始速度。
- BPM 支持 20–400。超出时可用等效的半速/倍速表示，保留所有音符实际毫秒落点；不能调整音符播放速度。
- 无音频时，duration 使用 MIDI 最后事件与音符终点的最大毫秒值再加 1000ms 尾部空间，最小 1000ms；这是谱面工作时长，不声称是实测音频时长。媒体名称和路径均留空，不追问 WAV 文件名或音频长度。
- 后续在编辑器选择播放音频并按需要调整偏移即可。不要把音频与 MIDI 是否同版设为制谱前置条件。
- notes 为完整音符数组。lane 为左到右 0–3 的整数，kind 为 note 或 hold。id 非空且整谱唯一。单点只有 time；长条增加 endTime，且 endTime > time。不得输出 beat/endBeat。
- 音符起点须满足 0 ≤ time < duration；长条终点可等于 duration。同轨不能同刻重复、长条重叠或在持条内部放音符；尾部同刻衔接下一音符允许。
- offset 是节拍网格第 0 拍的绝对时间；音符已是绝对毫秒，不再重复加 offset。

## 修改旧谱面

用户附上的旧 chart.json 就是本轮基线，不询问它是否已导入或已应用。直接修改 notes 并交付完整新 chart.json，保留未修改音符的 ID。除用户要求修改节奏或元数据外，保留原文件其他字段（包括未知字段）、BPM、offset、变速点、duration、特效和媒体引用；不执行媒体引用。

旧谱面自身节奏表是修改基准，MIDI 提供编排素材；未要求整体平移时不整体移动已有音符。只修改指定段落时，其他段落保留，但仍输出完整文件。新音符应落在旧谱面 duration 内；缺少局部持续终点时自行采用保守短条或单点，不暂停询问。

## 导入方式

原生 JSON 可通过「AI 制谱 → 套用完整谱面」应用到当前作品，替换音符并采用源节奏设置，保留当前媒体、时长、曲名和特效，支持预览与整批撤销。也可通过「我的谱面 → 导入」作为新作品载入。JSON 不嵌入媒体，作为新作品导入时可能需要重新选择媒体。

套用支持旧 AI replace 完整文件及覆盖源歌曲整首时长的 segment 文件，会忽略源 target 和音频身份绑定。音符时间不自动缩放或平移；所有音符及节奏设置仍须在当前时长内合法。局部 segment/patch 不能作为完整谱面套用，需取消勾选套用后按旧协议导入。

旧的可选批次导入协议保留在 `legacy-ai-import-protocol.md`，对应 `moonweave-ai-chart.schema.json` 和 `continue-chart.mjs`。默认生成流程不使用这些文件。
