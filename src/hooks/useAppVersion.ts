import { useEffect, useRef, useState } from 'react'

const BUILD_KEY = 'app_loaded_version'

// يكتشف وجود إصدار جديد من التطبيق عبر مقارنة ملف version.json بالنسخة المحمّلة حاليًا.
// لا يفرض تحديثًا أبدًا: يظهر شريطًا اختياريًا، والتحديث يتم فقط عند ضغط المستخدم على
// «تحديث الآن»، فلا يُفقد أي نموذج مفتوح يحتوي بيانات غير محفوظة.
export function useAppVersion() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const dismissed = useRef(false)

  useEffect(() => {
    let active = true
    const check = async () => {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        const version = String(data?.version || '')
        if (!version) return
        const loaded = localStorage.getItem(BUILD_KEY)
        if (loaded && loaded !== version && !dismissed.current) {
          if (active) setUpdateAvailable(true)
        } else {
          localStorage.setItem(BUILD_KEY, version)
        }
      } catch {
        /* الشبكة غير متاحة — سيعاد المحاولة لاحقًا */
      }
    }
    check()
    const id = window.setInterval(check, 5 * 60 * 1000)
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    return () => {
      active = false
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const applyUpdate = async () => {
    const sw = navigator.serviceWorker
    if (!sw) {
      window.location.reload()
      return
    }
    let reloaded = false
    const reload = () => {
      if (!reloaded) {
        reloaded = true
        window.location.reload()
      }
    }
    sw.addEventListener('controllerchange', reload)
    try {
      const reg = await sw.getRegistration()
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      } else if (reg) {
        await reg.update()
      }
    } catch {
      /* تجاهل أخطاء الـ Service Worker */
    }
    window.setTimeout(reload, 1500)
  }

  const dismiss = () => {
    dismissed.current = true
    setUpdateAvailable(false)
  }

  return { updateAvailable, applyUpdate, dismiss }
}
