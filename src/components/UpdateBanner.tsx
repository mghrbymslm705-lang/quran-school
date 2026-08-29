import { useAppVersion } from '../hooks/useAppVersion'

// شريط اكتشاف التحديثات: يظهر فقط عند توفر إصدار جديد، ولا يفرض إعادة التحميل.
export function UpdateBanner() {
  const { updateAvailable, applyUpdate, dismiss } = useAppVersion()
  if (!updateAvailable) return null
  return (
    <div className="update-banner" role="alert">
      <span className="update-banner-icon" aria-hidden>
        {'🔄'}
      </span>
      <span className="update-banner-text">يتوفر تحديث جديد للتطبيق</span>
      <div className="update-banner-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={applyUpdate}>
          تحديث الآن
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
          لاحقًا
        </button>
      </div>
    </div>
  )
}
