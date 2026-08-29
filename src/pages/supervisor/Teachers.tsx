import { Layout } from '../../components/Layout'
import { TeacherListView } from '../../components/TeacherListView'

export function SupervisorTeachers() {
  return (
    <Layout title="إدارة المعلمين" subtitle="جميع معلمي المدرسة">
      <div className="page-head">
        <h2>المعلمون</h2>
        <p>عرض حالة حسابات المعلمين والحلقات المسندة إليهم.</p>
      </div>
      <TeacherListView />
    </Layout>
  )
}
