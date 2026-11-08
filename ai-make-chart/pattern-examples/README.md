# 4K 配置学习案例

每个 JSON 同时包含易读配置、说明和原生谱面对象，供 AI 学习与人工修改。

- `01`、`02`、`03` 保留用户给出的配置；`04`–`08` 是 AI 补充示例，尚未经过用户确认。
- `configuration.sequence` 按时间先后排列；`"14"` 表示轨道 1 和 4 同刻双押，不是先 1 后 4。轨道标签使用 1–4，原生 `chart.notes[].lane` 使用 0–3。
- `chart` 内部遵循 `../03-protocol.md` 的原生格式：音符使用毫秒 `time`，长按使用 `endTime`。外层是学习资料格式，不能直接作为原生谱面导入；需要导入时单独导出 `chart` 对象。
- 演示统一使用 120 BPM、相邻落点 500ms、offset 0。用户提供的是轨道配置，没有提供节奏；这里的时间只是演示，不是原案例的音乐事实，也不是通用配谱规则。
- 没有配套音频、MIDI 或音高标注。用途说明均为配置意图，不代表已验证与某首音乐匹配。实际使用时应根据音乐调整时间与密度，重新生成整谱唯一的 ID。
- `08` 包含长按，序列只记录音符起点，持续终点查看 `configuration.holds` 和 `chart.notes`。
- `relatedExamples` 连接重鼓基础版和加强版，便于对照单个重音从双押变为三押时的配置差异。

| 文件 | 配置 | 来源 |
| --- | --- | --- |
| 01-drum-and-pulse.json | 2 / 3 / 14 / 3 / 2 | 用户 |
| 02-drum-strong-accent.json | 2 / 3 / 124 / 3 / 2 | 用户 |
| 03-stable-melody.json | 1 / 2 / 3 / 4 / 3 / 2 / 1 | 用户 |
| 04-repeated-tone.json | 2 / 2 / 2 | AI 补充 |
| 05-alternating-pulse.json | 2 / 3 / 2 / 3 / 2 / 3 / 2 / 3 | AI 补充 |
| 06-repeated-phrase.json | 1 / 2 / 3 / 2 / 1 / 2 / 3 / 2 | AI 补充 |
| 07-melody-with-accent.json | 1 / 2 / 34 / 2 / 1 | AI 补充 |
| 08-sustain-and-pulse.json | 1（长按） / 3 / 4 / 3 / 4 | AI 补充 |
