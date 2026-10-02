import { useI18n } from '@/app/i18n'

export function PageLoader({ label }: { label?: string }) {
  const { text } = useI18n()
  return <div className="page-loader" role="status"><span className="spinner" /><span>{label ?? text('正在加载页面…', 'Loading page…')}</span></div>
}
