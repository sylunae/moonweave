# Moonweave AI 制谱文件协议 v1

## 一、适用范围与导入入口

交付 UTF-8 JSON 文件，在编辑器右侧 **AI 制谱** 中选择文件或粘贴。最大 4 MiB，最多 50,000 个音符或操作，最终谱面最多 50,000 个音符。没有 agent 或在线服务依赖，Web/Electron 使用同一协议。

AI 文件只编辑音符；无 target 的首次完整导入还可应用初始 BPM、offset 和 BPM 变化点。媒体文件单独管理，不接受路径、音频二进制、滚动特效或任意代码。曲名/作者在软件内填写。

## 二、时间和拍子（必须遵守）

| 名称 | 定义 |
| --- | --- |
| 音频时间 | 原始完整音频开头为 0，包含静音；单位 ms，可有小数 |
| BPM 的一拍 | 一个四分音符，不是整音符或一个小节 |
| beat 0 | 位于音频绝对时间 `song.offset` |
| 负 beat | 允许弱起，只要换算后的音频时间不小于 0 |
| 恒速换算 | `timeMs = offset + beat * 60000 / bpm` |
| 变速换算 | 按各 BPM 区间积分，以 offset 处累计拍数为零；变化点不重置拍数 |
| BPM 变化点 | `{ "time": 毫秒, "bpm": 新速度 }`，从 time 生效，严格按 time 递增 |
| 拍细分 | 半拍 = 0.5 beat；四分之一拍 = 0.25 beat；八分音符 = 0.5 beat |
| 编辑器 subdivision | 每拍细分数量，例如 4 表示每拍四格，不是拍号 |
| 轨道 | 左到右 0、1、2、3，整数 |
| 区间 | `[start,end)`：起点包含，终点不包含；长条尾可恰好等于 end |

例如 BPM 120、offset 1000ms：beat 0 → 1000ms；beat 0.5 → 1250ms；beat 1 → 1500ms；beat -1 → 500ms。若在 2000ms 改为 240 BPM，beat 2 → 2000ms，beat 4 → 2500ms。

`unit` 只控制音符和 range 的坐标：

- `"ms"`：单点 `time`，长条 `time/endTime`，range.start/end 为毫秒。
- `"beat"`：单点 `beat`，长条 `beat/endBeat`，range.start/end 为拍。

**song.duration、song.offset、song.bpmChanges[].time 永远使用毫秒，即使 unit 是 beat。** 不接收小节坐标，不自动吸附。音符起点必须 `< duration`，长条终点可以 `= duration`。错误落点不会被静默截断。

## 三、顶层字段

| 字段 | 约束 |
| --- | --- |
| format | 固定 `"moonweave-ai-chart"` |
| version | 固定数字 1；这是格式版本，不是谱面修订号 |
| requestId | 非空字符串，1–128 字符；每一新批次唯一 |
| mode | `replace` / `segment` / `patch` |
| unit | `ms` / `beat` |
| song | 必须有 audioName、duration、bpm、offset、bpmChanges |
| target | 上下文使用 `{chartId,revision}`；续改可用 `{afterRequestId,notesRevision}`；分段和 patch 必填 |
| range | segment/patch 必填 `{start,end}`，replace 必须省略 |
| notes | replace/segment 必填数组，patch 必须省略 |
| operations | patch 必填数组，其他模式必须省略 |

未定义字段会报错；不要在交付文件顶层添加 `$schema`、说明、置信度或分析报告。Schema 文件可以给外部工具校验，但不嵌入交付数据。

song.audioName 必须与软件加载的原音频文件名完全相同，duration 与软件实测时长误差不得大于 1ms。建议从 WAV 采样帧数读取精确时长，或使用软件上下文中的值。文件名和时长不是内容指纹，必须由用户保证是同一份原音频。

BPM 为 20–400 的有限数值；offset 为有限毫秒数，绝对值不超过音频时长；BPM 变化点必须在 `[0,duration)` 内，时间严格递增，BPM 同样为 20–400。上下文任务的 song 节奏表必须与软件一致。所有数值使用 JSON 数字，不能是字符串或 null。

## 四、音符

毫秒示例：

```json
[
  { "id": "verse-01-001", "kind": "note", "lane": 0, "time": 1000 },
  { "id": "verse-01-002", "kind": "hold", "lane": 2, "time": 1500, "endTime": 2500 }
]
```

对应拍坐标示例（BPM 120，offset 1000ms，无变速）：

```json
[
  { "id": "verse-01-001", "kind": "note", "lane": 0, "beat": 0 },
  { "id": "verse-01-002", "kind": "hold", "lane": 2, "beat": 1, "endBeat": 3 }
]
```

ID 为 1–128 字符的非空字符串，整谱唯一。长条终点严格晚于起点；单点不能有终点。不能混合两套坐标，不能复制上下文音符中的 editable 等辅助字段。

同轨同刻重复、同轨长条重叠、长条内部单点均为错误；长条尾同刻接下一单点或长条允许。不同轨可以同刻有音符。格式校验不负责判断难度、同时按键上限、音乐性或同指连打是否适合玩家，这些由制谱要求与试听决定。

## 五、三种模式

### replace：完整替换

notes 替换整谱全部音符，空数组表示清空。无 target 的文件只能导入没有音符、特效、BPM 变化点的空谱面，同时应用 song 中的节奏设置；原初始 BPM/offset 可不同，预览会显示将采用的值。

已有谱面必须提供当前上下文 target 或有效的续改 target，节奏设置不能改变。应用会保留当前歌曲信息、音频、背景、封面和特效。

### segment：重做一段

先移除“起点在 range 内且长条尾不越过 range.end”的已有音符，再加入 notes。本次所有新音符须满足同样的完整包含条件。

跨入本段、跨出本段的已有长条都会保留，不会被自动裁剪。如果新音符与它们冲突，会整批报错。要修改这些长条，应扩大区间并重新导出上下文。下一段起点处的音符由下一段负责，避免重复归属。

### patch：按 ID 增删改

使用相同顶层字段，但以 operations 替代 notes，例如：

```json
[
  { "op": "add", "note": { "id": "verse-01-new", "kind": "note", "lane": 3, "beat": 2 } },
  { "op": "update", "note": { "id": "verse-01-002", "kind": "hold", "lane": 1, "beat": 1, "endBeat": 3 } },
  { "op": "delete", "id": "verse-01-001" }
]
```

这里仅展示 unit: beat 时的 operations 值，不能单独作为导入文件。add 的 ID 必须不存在；update/delete 的 ID 必须存在。update 给出完整新音符，保留 ID，可改轨道、起止位置或类型。单批不能多次操作同一 ID，操作结果统一校验，不依赖操作顺序逐个解决碰撞。旧音符与更新后的音符都必须完整位于 range 中。

## 六、上下文、版本与事务

`moonweave-ai-context.json` 是参考资料，不是导入文件。其中的 outputTemplate 才是交付文件模板；默认 unit 为 ms。若改为 beat，必须同步改音符字段与 range 的单位。

revision 是音乐内容的 SHA-256 摘要，包含歌曲身份元数据、节奏表、音符、特效与最近 AI 批次，不包含播放位置、缩放和背景/封面。它是冲突检测值，不是鉴权凭据。目标谱面不符或 revision 变化时拒绝应用，预览后再编辑也会触发检查。不要自行计算或改写 target 来覆盖用户编辑。

校验不写库；有任何错误就整批拒绝。校验最多显示 100 个问题，修复后重新校验。通过后展示增删改数量，用户点击应用才提交。整批修改进入同一次撤销记录，随后经现有保存队列持久化；保存失败会显示“已应用但保存失败”，不会假称已保存，也不会悄悄回滚用户在这期间的新编辑。

应用前会停止播放。最近 200 个 requestId 随谱面保存，重复请求拒绝；撤销同时恢复请求记录，可以重新应用被撤销的批次。完整已应用结果可以作为续改基线，无需每次重新导出上下文。


## 七、基于上一版完整结果续改

可选 target 形式（与 `{chartId,revision}` 二选一，不能混合字段）：

```json
{
  "afterRequestId": "上一版已成功应用的 requestId",
  "notesRevision": "sha256:上一版全部毫秒音符的摘要"
}
```

编辑器要求 afterRequestId 等于当前谱面最近一次 AI 批次，notesRevision 等于当前全部音符摘要，同时严格校验 song 的音频身份与节奏表。新 requestId 仍须唯一。此 target 可用于 replace/segment/patch；推荐每轮完整 replace/ms，便于保存下一轮完整基线。首次无 target 导入规则不变。相同批次与内容的谱面副本也可接收续改，这种 target 绑定已应用内容，不绑定库内 chartId。

摘要算法：每个已应用音符映射为 `[id,kind,lane,time,endTime或null]`，使用 JavaScript `JSON.stringify` 将每行编码成字符串，以默认 `.sort()`（UTF-16 字符序）排序，然后用逗号连接、两侧加方括号；对该 UTF-8 文本计算 SHA-256 小写十六进制，加 `sha256:` 前缀。没有空白或换行。必须从旧版全部音符计算，不是从本轮新音符或只从本段音符计算。音符输入顺序不影响摘要。

附带的 `continue-chart.mjs` 完成上述计算并生成 requestId。它只接受完整 replace/ms 基线，不自动推断局部结果、拍坐标或是否已成功应用；这些由 AI 保留并由用户确认。脚本沿用上一版 song，不改 BPM/offset。

手动改变音符会触发摘要冲突；改变节奏会触发 song 冲突；应用其他 AI 批次、撤销到其他版本会触发批次或摘要冲突。仅改变播放位置、缩放、曲名、封面、背景或特效不影响续改基线，这些当前内容会被保留。预览和实际应用之间仍使用完整 aiChartBase 检查，期间发生编辑必须重新校验。旧 `{chartId,revision}` 的严格版本检查保持不变。


## 将旧完整谱面套用到其他音频

编辑器「AI 制谱」现默认开启「套用完整谱面（无需原上下文）」。完整 replace 文件可直接用于 MIDI 渲染音频版等其他谱面，不受旧 target、音频名、时长匹配或旧批次记录约束。套用保留当前音频与元数据，使用文件中的音符和节奏设置；仍检查当前时长边界、碰撞和预览后修改，并支持整批撤销。覆盖源歌曲整首的 segment 同样支持套用；局部 segment 和 patch 不支持套用，取消勾选后仍按本文的上下文绑定规则校验。
