import { useAuth } from '../../auth/AuthContext'
import { Layout } from '../../components/Layout'
import { CircleListView } from '../../components/CircleListView'
import { getTeacher } from '../../data/store'

export function TeacherCircles() {
  const { user } = useAuth()
  const teacher = getTeacher(user?.teacherId)

  return (
    <Layout title="حلقاتي" subtitle="الحلقات المسندة إليك فقط">
      <div className="page-head">
        <h2>حلقاتي</h2>
        <p>عرض الحلقات التي تشرف عليها وطلابها.</p>
      </div>
      <CircleListView teacherId={teacher?.id} />
    </Layout>
  )
}
