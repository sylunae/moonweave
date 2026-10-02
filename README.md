# Moonweave

基于 React + TypeScript + Vite + Electron 的 4K 下落式节奏谱面编辑器。界面使用 Moonweave 应用壳，编辑器轨道与谱面格式兼容 `Moonweave-legacy`。

## 当前功能

- 独立的谱面配置、制谱编辑器与试玩占位页面
- Note / Hold 放置、多选拖动、Hold 双端调整与删除
- 区域选择、复制、粘贴、镜像、撤回与重做
- BPM / Offset 联动、分拍吸附、时间轴缩放与音频同步播放
- `.moon.json` 导入导出、桌面端本地音频索引和版本备份
- Moonweave 深色主视觉及可编辑的浅色/深色色板
- Web 与 Electron 双端、响应式侧栏和安全 preload

谱面试玩的渲染、判定与粒子逻辑尚未迁移，当前页面仅展示谱面摘要。

## 开始开发

```bash
npm install
npm run dev:web
npm run dev:desktop
```

常用检查与构建：

```bash
npm run typecheck
npm test
npm run check
npm run build:web
npm run build:desktop
npm run package:win
```

`npm run dev` 会同时启动 Web 与 Electron 开发进程，通常更推荐根据目标平台单独运行对应命令。Web 产物位于 `dist/`，Electron 产物位于 `out/`，安装包位于 `release/`。

## 主要代码入口

- 应用名称与导航：`src/config/app.tsx`
- 谱面状态与文件操作：`src/features/chart/ChartProvider.tsx`
- 轨道编辑器：`src/features/chart/ChartEditor.tsx`
- 页面：`src/pages/ChartSetupPage.tsx`、`src/pages/ChartEditorPage.tsx`
- 默认颜色与运行时色板：`src/app/theme.ts`
- 字号、圆角与布局：`src/styles.css`
- Electron 窗口与 IPC：`electron/main/index.ts`
- SEO 与网页 metadata：`index.html`
- 桌面打包 metadata：`package.json` 的 `build`
- 图标：`public/moonweave-logo.png` 与 `build/icon.png`（使用同一份 Moonweave PNG）

添加新的 shadcn/ui 组件：

```bash
npx shadcn@latest add <component>
```

## 性能约定

- 页面通过 `React.lazy` 拆包；仅把会持续存在的全局 UI 放入 `App.tsx`。
- 侧栏拖动使用 `requestAnimationFrame` 直接更新 CSS 变量，只在拖动结束时持久化。
- 偏好设置与谱面数据分域；播放进度不写入持久化快照。
- Electron 只通过 `contextBridge` 暴露最小 API，renderer 不直接访问 Node.js。
- 媒体数据独立存储，谱面 JSON 只保留本地路径索引。

## 授权

代码采用 MIT License。字体授权与来源见 `public/fonts/`。
