import { Layout } from '../../components/Layout'
import { CircleListView } from '../../components/CircleListView'

export function SupervisorCircles() {
  return (
    <Layout title="إدارة الحلقات" subtitle="جميع حلقات المدرسة">
      <div className="page-head">
        <h2>الحلقات</h2>
        <p>عرض الحلقات والمعلمين المسؤولين وعدد الطلاب في كل حلقة.</p>
      </div>
      <CircleListView />
    </Layout>
  )
}
