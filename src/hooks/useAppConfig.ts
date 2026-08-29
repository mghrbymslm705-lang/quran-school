import { useEffect, useState } from 'react'

export interface AppConfig {
  appUrl: string
  whatsappNumber: string
  environment: string
}

let cached: AppConfig | null = null

// يجلب الإعدادات العامة من الخادم (الرابط الرسمي ورقم واتساب المشرف).
// هذه القيم مركزية في البيئة ولا تُحفظ في الكود، فيكون الرابط المشترك ثابتًا
// وخاليًا من localhost في الإنتاج.
export function useAppConfig(): AppConfig | null {
  const [cfg, setCfg] = useState<AppConfig | null>(cached)
  useEffect(() => {
    if (cached) return
    let active = true
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d) {
          cached = d as AppConfig
          setCfg(d as AppConfig)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return cfg
}
