import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const failures = []
const requireMatch = (condition, message) => { if (!condition) failures.push(message) }

for (const page of ['src/pages/HomePage.tsx', 'src/pages/CreatorPage.tsx', 'src/pages/ProfilePage.tsx']) {
  const source = read(page)
  requireMatch(source.includes("from '@/components/layout/AppScreen'"), `${page}: 必须使用 AppScreen 布局组件`)
  requireMatch(source.includes('<AppScreen '), `${page}: 页面根节点必须是 AppScreen`)
  requireMatch(source.includes('data-scroll-region') || source.includes('<ScrollRegion '), `${page}: 可滚动内容必须显式标记为 ScrollRegion`)
}

const home = read('src/pages/HomePage.tsx')
const creator = read('src/pages/CreatorPage.tsx')
const profile = read('src/pages/ProfilePage.tsx')
requireMatch(home.includes('className="game-lobby') && home.includes('game-chart-grid') && home.includes('<Dialog '), '大厅必须保持游戏选曲 Grid + 覆盖式详情结构')
requireMatch(creator.includes('className="creator-console') && creator.includes('creator-cartridge-grid') && creator.includes('creator-uplink'), '创作者中心必须保持作品槽位 + 发布终端结构')
requireMatch(!creator.includes('creator-metrics') && !creator.includes('creator-table'), '创作者中心禁止恢复 KPI Dashboard 或后台表格')
requireMatch(profile.includes('className="player-profile') && profile.includes('player-card') && profile.includes('record-score-stack'), '个人资料必须保持玩家卡 + 战绩陈列结构')

const styles = read('src/styles.css')
requireMatch(styles.includes('.content-shell:is(.route-home, .route-uploads, .route-profile) { overflow: hidden; }'), '社区页面的 content-shell 必须禁止整页滚动')
requireMatch(/\.game-lobby, \.creator-console, \.player-profile \{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s.test(styles), '社区页面根节点必须固定为 100% 高度并隐藏溢出')
requireMatch(styles.includes('.app-screen [data-scroll-region]'), '局部滚动区域必须由 data-scroll-region 统一管理')

if (failures.length) {
  console.error(`UI layout contract failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('UI layout contract passed: fixed viewport roots and explicit scroll regions are present.')
