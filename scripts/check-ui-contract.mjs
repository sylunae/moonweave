import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const requireMatch = (condition, message) => { if (!condition) failures.push(message) }
const read = (path) => {
  const absolute = resolve(root, path)
  if (!existsSync(absolute)) { failures.push(`${path}: required UI source is missing`); return '' }
  return readFileSync(absolute, 'utf8')
}

const styles = read('src/styles.css')
const app = read('src/App.tsx')
// Moonweave has chart-library/editor/playtest routes, rather than the old community pages.
for (const [route, page, className] of [
  ['manage', 'ChartManagementPage', 'chart-management-page'],
  ['editor', 'ChartEditorPage', 'editor-page'],
  ['playtest', 'PlaytestPage', 'playtest-page'],
]) {
  const source = read(`src/pages/${page}.tsx`)
  requireMatch(app.includes(`lazy(() => import('@/pages/${page}'))`), `${page}: page must remain lazy-loaded`)
  requireMatch(source.includes(className), `${page}: fixed workspace root is missing`)
  requireMatch(new RegExp(`\\.content-shell\\.route-${route} \\{[^}]*overflow:\\s*hidden;`).test(styles), `${route}: content shell must prevent whole-page scrolling`)
}

const library = read('src/pages/ChartManagementPage.tsx')
requireMatch(/className="chart-library-list"[^>]*data-scroll-region/.test(library), 'Chart library list must explicitly mark its scroll region')
requireMatch(/\.chart-management-page \{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/.test(styles), 'Chart library must stay within a fixed-height workspace')
requireMatch(/\.chart-library-list \{[^}]*overflow-y:\s*auto;/.test(styles), 'Chart library scrolling must remain local to the list')
requireMatch(/\.editor-workspace \{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/.test(styles), 'Editor workspace must remain fixed and hide overflow')

const aiDialog = read('src/features/chart/ai/AiChartDialog.tsx')
requireMatch(aiDialog.includes('className="ai-chart-body" data-scroll-region'), 'AI dialog must mark its local scroll region')
requireMatch(/\.ai-chart-dialog \{[^}]*max-height:/.test(styles), 'AI dialog must fit the viewport')
requireMatch(/\.ai-chart-body \{[^}]*overflow-y:\s*auto;/.test(styles), 'AI dialog body must scroll independently')

// Preserve the additional community contract if those optional pages are reintroduced.
for (const page of ['src/pages/HomePage.tsx', 'src/pages/CreatorPage.tsx', 'src/pages/ProfilePage.tsx'].filter((page) => existsSync(resolve(root, page)))) {
  const source = read(page)
  requireMatch(source.includes("from '@/components/layout/AppScreen'"), `${page}: 必须使用 AppScreen 布局组件`)
  requireMatch(source.includes('<AppScreen '), `${page}: 页面根节点必须是 AppScreen`)
  requireMatch(source.includes('data-scroll-region') || source.includes('<ScrollRegion '), `${page}: 可滚动内容必须显式标记为 ScrollRegion`)
}

if (failures.length) {
  console.error(`UI layout contract failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('UI layout contract passed: fixed viewport roots and explicit scroll regions are present.')
