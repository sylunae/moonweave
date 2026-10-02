# 不可违反的规则（AGENTS改动前必须读）
* 在涉及大范围UI改动之前，必须阅读 `documentation/UI-style.md`。
* 在设计前端交互设计时，必须阅读 `documentation/frontend.md`。
* 涉及文件处理，数据库写入时，必须阅读 `documentation/database.md`。
* 开发结束后无需跑视觉验证，除非用户明确要求。


# 项目定位

本项目是可复用的 Sylunae Electron + Web 前端框架。它提供应用壳、设计系统、响应式布局与桌面容器，不承载任何特定产品的业务逻辑。

本项目是一个音游制谱器，同时也具备网页游玩的功能，兼容多平台。由于是音游，在UI设计上会保证应用的使用体验，而不是网页的滚动式浏览。



# 设计风格

- 延续丝月工坊的现代极简工具软件风格：低饱和中性色、克制阴影、柔和圆角、清晰层级。
- 桌面端采用左侧导航 + 右侧独立内容区；内容区与侧栏通过背景、圆角和轻阴影分层。
- 默认正文不低于 13px，辅助文字通常为 11–12px；不要为了塞入更多内容而牺牲可读性。
- 颜色必须使用 `src/app/theme.ts` 与 `src/styles.css` 中的语义 token，同时保证浅色、深色与高对比可读性；新增颜色时同步更新设置中的全局 CSS 色板。
- Logo 保持现有月亮图形；派生项目可以改名，但除非明确重做品牌，不要随意改变图形比例。

# 架构规则

- 应用名称、导航项和基础文案统一放在 `src/config/app.tsx`；不要在多个组件重复硬编码。
- 页面放在 `src/pages/` 并在 `src/App.tsx` 中懒加载。大型功能继续按页面或功能域拆包。
- UI 优先复用 `src/components/ui/` 的 shadcn/ui 组件；不要使用浏览器原生 `alert`、`confirm` 或 `prompt`。
- 样式以单一来源维护：已有 selector 或 token 能表达时，不新增覆盖补丁，不使用 `!important` 争夺层叠。
- Web 与 Electron 共用 renderer。平台差异通过 `window.sylunae` 能力检测，不通过 user-agent 猜测。
- Electron 必须保持 `contextIsolation: true`、`nodeIntegration: false`，并通过 preload 暴露窄接口；所有 IPC 输入在主进程校验。
- 不把密钥、文件系统能力或任意 shell 执行暴露给 renderer。

# 性能与数据规则

- 高频拖动、输入、播放进度等不得触发整个应用树的持久化；使用局部状态、节流/防抖，并在提交或失焦时写入。
- 大型媒体与二进制数据独立存储；普通设置保持小而可序列化。
- 长列表使用分页、窗口化或增量渲染；避免在 render 中执行昂贵排序、解析和深拷贝。
- Context 按变化频率和数据域拆分；不要创建包含全部业务状态的万能 Store。
- 副作用必须可清理，异步任务要支持取消或忽略过期结果。

# 交付检查

- 至少执行 `npm run typecheck`、`npm test`、`npm run build:web` 和 `npm run build:desktop`。
- UI 修改需检查浅色、深色、760px 以下手机布局和 Electron 标题栏。
- 修改 metadata 时同步检查 `src/config/app.tsx`、`index.html`、`public/site.webmanifest` 与 `package.json`。
