// حالات واجهة مشتركة: تحميل / فارغ / خطأ.
// تفصل بين حالات Loading و Empty و Error حتى لا تظهر "لا توجد بيانات" أثناء التحميل.
import type { ReactNode } from 'react'

export function LoadingState({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return (
    <div className="state-loading" role="status" aria-live="polite">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function ErrorState({ children }: { children: ReactNode }) {
  return (
    <div className="state-error" role="alert">
      <span className="state-error-icon" aria-hidden>
        !
      </span>
      <span>{children}</span>
    </div>
  )
}
