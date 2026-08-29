import { useAuth } from '../../auth/AuthContext'
import { Layout } from '../../components/Layout'
import { StudentListView } from '../../components/StudentListView'
import { getTeacher } from '../../data/store'

export function TeacherStudents() {
  const { user } = useAuth()
  const teacher = getTeacher(user?.teacherId)
  const circleIds = teacher?.circleIds ?? []

  return (
    <Layout title="طلابي" subtitle="الطلاب المسندون إلى حلقاتك فقط">
      <div className="page-head">
        <h2>طلابي</h2>
        <p>عرض ملفات الطلاب المسجلين في حلقاتك.</p>
      </div>
      <StudentListView circleIds={circleIds} canAdd={false} />
    </Layout>
  )
}
