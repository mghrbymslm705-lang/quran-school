import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth, defaultPathForRole } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { Login } from './pages/Login'

import { SupervisorDashboard } from './pages/supervisor/Dashboard'
import { SupervisorStudents } from './pages/supervisor/Students'
import { SupervisorCircles } from './pages/supervisor/Circles'
import { SupervisorTeachers } from './pages/supervisor/Teachers'
import { CircleDetail } from './pages/supervisor/CircleDetail'
import { StudentFilePage } from './pages/supervisor/StudentFilePage'
import { TeacherFilePage } from './pages/supervisor/TeacherFilePage'
import { AuditPage } from './pages/supervisor/AuditPage'
import { ReportsCenter } from './pages/supervisor/ReportsCenter'
import { Settings } from './pages/supervisor/Settings'
import { DataManagement } from './pages/supervisor/DataManagement'
import { About } from './pages/About'

import { TeacherDashboard } from './pages/teacher/Dashboard'
import { TeacherStudents } from './pages/teacher/Students'
import { TeacherCircles } from './pages/teacher/Circles'
import { TeacherDaily } from './pages/teacher/Daily'

export default function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="centered-screen">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to={user ? defaultPathForRole(user.role) : '/login'} replace />}
      />
      <Route path="/login" element={<Login />} />

      {/* مسارات المشرف */}
      <Route
        path="/supervisor/dashboard"
        element={
          <ProtectedRoute allow={['supervisor']}>
            <SupervisorDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/supervisor/students"
        element={
          <ProtectedRoute allow={['supervisor']}>
            <SupervisorStudents />
          </ProtectedRoute>
        }
      />
      <Route
        path="/supervisor/circles"
        element={
          <ProtectedRoute allow={['supervisor']}>
            <SupervisorCircles />
          </ProtectedRoute>
        }
      />
      <Route
        path="/supervisor/teachers"
        element={
          <ProtectedRoute allow={['supervisor']}>
            <SupervisorTeachers />
          </ProtectedRoute>
        }
      />
      <Route
        path="/supervisor/circle/:id"
        element={
          <ProtectedRoute allow={['supervisor']}>
            <CircleDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/supervisor/student/:id"
        element={
          <ProtectedRoute allow={['supervisor']}>
            <StudentFilePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/supervisor/teacher/:id"
        element={
          <ProtectedRoute allow={['supervisor']}>
            <TeacherFilePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/supervisor/audit"
        element={
          <ProtectedRoute allow={['supervisor']}>
            <AuditPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/supervisor/reports"
        element={
          <ProtectedRoute allow={['supervisor']}>
            <ReportsCenter />
          </ProtectedRoute>
        }
      />
      <Route
        path="/supervisor/settings"
        element={
          <ProtectedRoute allow={['supervisor']}>
            <Settings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/supervisor/data-management"
        element={
          <ProtectedRoute allow={['supervisor']}>
            <DataManagement />
          </ProtectedRoute>
        }
      />

      <Route
        path="/about"
        element={
          <ProtectedRoute allow={['supervisor', 'teacher']}>
            <About />
          </ProtectedRoute>
        }
      />

      {/* مسارات المعلم */}
      <Route
        path="/teacher/dashboard"
        element={
          <ProtectedRoute allow={['teacher', 'supervisor']}>
            <TeacherDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/students"
        element={
          <ProtectedRoute allow={['teacher', 'supervisor']}>
            <TeacherStudents />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/circles"
        element={
          <ProtectedRoute allow={['teacher', 'supervisor']}>
            <TeacherCircles />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/daily"
        element={
          <ProtectedRoute allow={['teacher', 'supervisor']}>
            <TeacherDaily />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to={user ? defaultPathForRole(user.role) : '/login'} replace />} />
    </Routes>
  )
}
