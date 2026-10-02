export const currentText = (zh: string, en: string) => typeof document !== 'undefined' && document.documentElement.lang.startsWith('zh') ? zh : en
