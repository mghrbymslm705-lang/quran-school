import { useState } from 'react'
import { Layout } from '../components/Layout'
import { useAuth } from '../auth/AuthContext'
import { usePwaInstall } from '../hooks/usePwaInstall'
import { useAppConfig } from '../hooks/useAppConfig'
import { IconBrandWhatsapp, IconDownload, IconShare } from '../components/icons'
import {
  canContactSupervisor,
  canInstallApp,
  canShareApp,
  buildWhatsappLink,
  buildTeacherShareMessage,
  defaultContactMessage,
  WHATSAPP_NUMBER,
  APP_NAME
} from '../utils/appFeatures'

export function About() {
  const { user } = useAuth()
  const role = user?.role ?? 'teacher'
  const { canInstall, install } = usePwaInstall()
  const cfg = useAppConfig()
  const [toast, setToast] = useState('')
  const [installHelp, setInstallHelp] = useState(false)

  // الرابط الرسمي ورقم واتساب يأتيان من إعدادات الخادم (مركزي، بلا localhost في الإنتاج).
  // عند الوصول عبر نفق/مجال غير رسمي (مثل localhost في الإعدادات) نستخدم أصل الصفحة الحالي.
  const cfgUrl = cfg?.appUrl
  const appUrl =
    cfgUrl && !/localhost|127\.0\.0\.1/.test(cfgUrl) ? cfgUrl : window.location.origin
  const whatsappNumber = cfg?.whatsappNumber || WHATSAPP_NUMBER

  const contact = canContactSupervisor(role)
  const installAllowed = canInstallApp(role)
  const share = canShareApp(role)

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2600)
  }

  const onInstall = async () => {
    if (canInstall) {
      const ok = await install()
      showToast(ok ? 'تم تثبيت التطبيق' : 'تم الإلغاء')
    } else {
      setInstallHelp(true)
    }
  }

  // «مشاركة التطبيق مع الأساتذة» — مشرف فقط.
  const onShare = async () => {
    const text = buildTeacherShareMessage(appUrl)
    const data = { title: APP_NAME, text, url: appUrl }
    try {
      if (navigator.share) {
        await navigator.share(data)
        showToast('تمت المشاركة')
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(appUrl)
        showToast('تم نسخ رابط التطبيق، يمكنك مشاركته مع الأساتذة.')
      } else {
        showToast('يمكنك نسخ الرابط من شريط العنوان ومشاركته مع الأساتذة.')
      }
    } catch {
      /* المستخدم ألغى المشاركة — لا شيء */
    }
  }

  // نسخ الرابط الرسمي مباشرة من الحقل الظاهر.
  const copyLink = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(appUrl)
        showToast('تم نسخ الرابط الرسمي')
      } else {
        showToast('يمكنك تحديد الرابط ونسخه')
      }
    } catch {
      showToast('يمكنك تحديد الرابط ونسخه')
    }
  }

  return (
    <Layout title="حول التطبيق" subtitle="التواصل والمشاركة وتثبيت التطبيق">
      <div className="stack-lg">
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{APP_NAME}</div>
              <div className="card-sub">إدارة المدرسة القرآنية من أي جهاز عبر رابط واحد</div>
            </div>
          </div>
          <p className="about-sub">
            تطبيق مركزي واحد لكل المستخدمين: يدخل كل مشرف ومعلم بحسابه الخاص، وأي تحديث جديد يصل للجميع
            عبر نفس الرابط. يمكنك التواصل مع المشرف، ومشاركة التطبيق، وتثبيته على هاتفك أو حاسوبك.
          </p>
        </div>

        <div className="about-actions">
          {contact && (
            <a
              className="card about-action"
              href={buildWhatsappLink(whatsappNumber, defaultContactMessage())}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="about-action-icon whatsapp">
                <IconBrandWhatsapp size={24} />
              </div>
              <div className="about-action-body">
                <div className="about-action-title">التواصل مع المشرف</div>
                <div className="about-action-sub">عبر واتساب — رسالة جاهزة</div>
              </div>
            </a>
          )}

          {installAllowed && (
            <button className="card about-action" onClick={onInstall} type="button">
              <div className="about-action-icon">
                <IconDownload size={24} />
              </div>
              <div className="about-action-body">
                <div className="about-action-title">تثبيت التطبيق</div>
                <div className="about-action-sub">
                  {canInstall ? 'اضغط للتثبيت على جهازك' : 'متاح على المتصفحات المدعومة'}
                </div>
              </div>
            </button>
          )}

          {share && (
            <div className="card about-action">
              <div className="about-action-icon">
                <IconShare size={24} />
              </div>
              <div className="about-action-body">
                <div className="about-action-title">مشاركة التطبيق مع الأساتذة</div>
                <div className="about-action-sub">الرابط الرسمي للتطبيق — انسخه وأرسله:</div>
                <div className="share-link-row">
                  <input
                    className="input share-link-input"
                    value={appUrl}
                    readOnly
                    dir="ltr"
                    aria-label="الرابط الرسمي للتطبيق"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button className="btn btn-soft btn-sm" type="button" onClick={copyLink}>
                    نسخ الرابط
                  </button>
                </div>
                <button className="btn btn-primary btn-sm share-btn" type="button" onClick={onShare}>
                  مشاركة عبر الجهاز
                </button>
              </div>
            </div>
          )}
        </div>

        {installHelp && (
          <div className="card">
            <div className="card-title">كيفية تثبيت التطبيق</div>
            <ul className="about-steps">
              <li>في متصفح Chrome أو Edge على الحاسوب: افتح قائمة المتصفح (⋮) واختر «تثبيت التطبيق» أو Install app.</li>
              <li>على الهاتف (Android): من قائمة المتصفح اختر «إضافة إلى الشاشة الرئيسية».</li>
              <li>على iPhone (Safari): اضغط زر المشاركة ثم «أضف إلى الشاشة الرئيسية».</li>
            </ul>
          </div>
        )}
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </Layout>
  )
}
