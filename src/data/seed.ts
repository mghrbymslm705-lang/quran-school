// ⚠️ بيانات تجريبية (DEMO) منفصلة بوضوح عن بيانات المدرسة الحقيقية.
// تُستخدم فقط للتطوير والاختبار في هذه المرحلة الأولية.
// عند ربط النظام بقاعدة بيانات حقيقية، تُستبدل هذه الطبقة بالكامل.

import type { SchoolData, Student, Circle, Teacher, User } from '../types'

const today = new Date().toISOString().slice(0, 10)

const users: User[] = [
  {
    id: 'u-admin',
    username: 'admin',
    email: 'admin@school.edu',
    password: 'admin123',
    name: 'أ. محمد العتيبي',
    role: 'supervisor',
    active: true
  },
  {
    id: 'u-t1',
    username: 'teacher1',
    email: 'teacher1@school.edu',
    password: 'teacher123',
    name: 'أ. عبدالله الحمدان',
    role: 'teacher',
    active: true,
    teacherId: 't1'
  },
  {
    id: 'u-t2',
    username: 'teacher2',
    email: 'teacher2@school.edu',
    password: 'teacher123',
    name: 'أ. سارة القحطاني',
    role: 'teacher',
    active: true,
    teacherId: 't2'
  },
  {
    id: 'u-t3',
    username: 'teacher3',
    email: 'teacher3@school.edu',
    password: 'teacher123',
    name: 'أ. خالد المطيري',
    role: 'teacher',
    active: false,
    teacherId: 't3'
  }
]

const teachers: Teacher[] = [
  { id: 't1', userId: 'u-t1', name: 'أ. عبدالله الحمدان', phone: '0501112222', active: true, circleIds: ['c1', 'c2'] },
  { id: 't2', userId: 'u-t2', name: 'أ. سارة القحطاني', phone: '0503334444', active: true, circleIds: ['c3'] },
  { id: 't3', userId: 'u-t3', name: 'أ. خالد المطيري', phone: '0505556666', active: false, circleIds: [] }
]

const circles: Circle[] = [
  { id: 'c1', name: 'حلقة الصباح', teacherId: 't1', studentIds: ['s1', 's2', 's3', 's4'], scheduleNote: 'يوميًا ٨:٠٠ – ١٠:٠٠' },
  { id: 'c2', name: 'حلقة المساء', teacherId: 't1', studentIds: ['s5', 's6', 's7'], scheduleNote: 'يوميًا ١٧:٠٠ – ١٩:٠٠' },
  { id: 'c3', name: 'حلقة العصر', teacherId: 't2', studentIds: ['s8', 's9', 's10', 's11', 's12'], scheduleNote: 'يوميًا ١٥:٠٠ – ١٧:٠٠' }
]

const students: Student[] = [
  { id: 's1', name: 'يوسف الراشد', circleId: 'c1', guardianName: 'عبدالعزيز الراشد', guardianPhone: '0551110001', enrollmentDate: '2024-09-01' },
  { id: 's2', name: 'عمر السبيعي', circleId: 'c1', guardianName: 'فهد السبيعي', guardianPhone: '0551110002', enrollmentDate: '2024-09-01' },
  { id: 's3', name: 'محمد الزهراني', circleId: 'c1', guardianName: 'سعيد الزهراني', guardianPhone: '0551110003', enrollmentDate: '2024-09-15' },
  { id: 's4', name: 'أحمد القرني', circleId: 'c1', guardianName: 'ناصر القرني', guardianPhone: '0551110004', enrollmentDate: '2024-10-01' },
  { id: 's5', name: 'عبدالرحمن الدوسري', circleId: 'c2', guardianName: 'ماجد الدوسري', guardianPhone: '0551110005', enrollmentDate: '2024-09-01' },
  { id: 's6', name: 'سلمان العنزي', circleId: 'c2', guardianName: 'بدر العنزي', guardianPhone: '0551110006', enrollmentDate: '2024-09-10' },
  { id: 's7', name: 'فيصل الحربي', circleId: 'c2', guardianName: 'تركي الحربي', guardianPhone: '0551110007', enrollmentDate: '2024-09-20' },
  { id: 's8', name: 'نواف الشمري', circleId: 'c3', guardianName: 'مشعل الشمري', guardianPhone: '0551110008', enrollmentDate: '2024-09-01' },
  { id: 's9', name: 'ريان الغامدي', circleId: 'c3', guardianName: 'وليد الغامدي', guardianPhone: '0551110009', enrollmentDate: '2024-09-05' },
  { id: 's10', name: 'طلال المطيري', circleId: 'c3', guardianName: 'سعد المطيري', guardianPhone: '0551110010', enrollmentDate: '2024-09-12' },
  { id: 's11', name: 'جابر التميمي', circleId: 'c3', guardianName: 'راكان التميمي', guardianPhone: '0551110011', enrollmentDate: '2024-09-18' },
  { id: 's12', name: 'سلطان البقمي', circleId: 'c3', guardianName: 'عبدالله البقمي', guardianPhone: '0551110012', enrollmentDate: '2024-10-02' }
]

export function buildSeedData(): SchoolData {
  return {
    users,
    teachers,
    circles,
    students,
    // سجل يومي واحد تجريبي لليوم لإظهار الإحصائيات بشكل حيّ (قابل للتوسعة)
    daily: [
      {
        date: today,
        circleId: 'c1',
        entries: [
          { studentId: 's1', attendance: 'on_time', memorization: 'heard', revision: 'reviewed' },
          { studentId: 's2', attendance: 'on_time', memorization: 'not_heard', revision: 'not_reviewed' },
          { studentId: 's3', attendance: 'late', memorization: 'not_recorded', revision: 'not_recorded' },
          { studentId: 's4', attendance: 'on_time', memorization: 'heard', revision: 'reviewed' }
        ]
      }
    ]
  }
}
