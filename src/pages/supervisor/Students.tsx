import { Layout } from '../../components/Layout'
import { StudentListView } from '../../components/StudentListView'

export function SupervisorStudents() {
  return (
    <Layout title="إدارة الطلاب" subtitle="قائمة جميع طلاب المدرسة">
      <div className="page-head">
        <h2>الطلاب</h2>
        <p>عرض وإدارة بيانات جميع الطلاب في المدرسة.</p>
      </div>
      <StudentListView canAdd />
    </Layout>
  )
}
