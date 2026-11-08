# MIDI 直接生成与修改谱面

默认只需提示词与 MIDI；修改时再附旧 chart.json。AI 直接交付完整新 chart.json，不需要上下文、音频分析报告、版本摘要或续改脚本。

## 首次制作

把 `02-chart-prompt.md`、`03-protocol.md` 和 MIDI 发给 AI，说「开始制谱」。未指定编排偏好时使用提示词默认值。AI 直接按 MIDI 制作，不询问是否原版、是否和音频一致。

## 修改谱面

把相同提示词、MIDI、旧 chart.json 与修改要求发给 AI。也可使用 `04-revision-prompt.md`。旧文件就是基线，无需说明是否已应用；AI 沿用原谱节奏和元数据，输出完整新谱面。

## 应用到当前谱面，包括 MIDI 音频版

新建谱面并选择 MIDI 渲染音频后，打开编辑器「AI 制谱」，保持默认勾选「套用完整谱面（无需原上下文）」，选择旧 JSON → 校验并预览 → 应用本批修改。

支持原生 chart.json，以及旧 moonweave-ai-chart 的完整 replace 或覆盖整首的 segment 文件。无需重新导出上下文，也不要求旧音频名、时长、chartId 或 revision 与当前谱面一致。

套用会替换当前全部音符，采用源谱面的 BPM、offset 与变速点，保留当前音频、时长、曲名、背景、封面和特效。时间保持原来的绝对毫秒，不自动拉伸或平移；音符或节奏事件超出当前音频时长时会报错，不静默裁剪。应用前可预览增删改数量，应用后可整批撤销。

仅覆盖局部的 segment 和 patch 不能当作完整谱面套用；segment 区间覆盖源歌曲完整时长时会自动识别为整曲。需要使用上下文绑定的分段/补丁导入时，取消勾选套用模式。

如需把原生 chart.json 创建为独立新作品，也可使用「我的谱面 → 导入」。JSON 不嵌入媒体，作为新作品导入时可能需要重新选择媒体。

## 文件

- `02-chart-prompt.md`：直接制作与修改的主提示词。
- `03-protocol.md`：原生 chart.json 字段和时间规则。
- `04-revision-prompt.md`：修改旧谱面的简短提示词。
- `01-analysis-prompt.md`：仅在需要结构报告时选用，不是制谱前置步骤。

`legacy-ai-import-protocol.md`、`moonweave-ai-chart.schema.json`、`continue-chart.mjs` 和 `examples/standalone.json` 属于保留的旧 AI 批次导入流程，默认不用提供给 AI。编辑器导出上下文功能仍保留供该旧流程使用。
