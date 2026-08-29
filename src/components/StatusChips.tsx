import type { AttendanceState, MemorizationState, RevisionState } from '../types'

function cls(tone: string) {
  return 'chip chip-' + tone
}

export function AttendanceChip({ status }: { status: string }) {
  switch (status) {
    case 'on_time':
      return <span className={cls('success')}>حضر في الوقت</span>
    case 'late':
      return <span className={cls('warning')}>لم يحضر في الوقت</span>
    case 'excused_absent':
      return <span className={cls('muted')}>غياب بعذر</span>
    default:
      return <span className={cls('ghost')}>لم يسجّل</span>
  }
}

export function MemorizationChip({ status }: { status: string }) {
  switch (status) {
    case 'heard':
      return <span className={cls('success')}>سمع اللوح</span>
    case 'not_heard':
      return <span className={cls('warning')}>لم يسمع اللوح</span>
    default:
      return <span className={cls('ghost')}>لم يسجّل</span>
  }
}

export function RevisionChip({ status }: { status: string }) {
  switch (status) {
    case 'reviewed':
      return <span className={cls('success')}>راجع الورد</span>
    case 'not_reviewed':
      return <span className={cls('warning')}>لم يراجع</span>
    default:
      return <span className={cls('ghost')}>لم يسجّل</span>
  }
}

export function Chip({ tone, children }: { tone: 'success' | 'warning' | 'muted' | 'ghost' | 'danger'; children: React.ReactNode }) {
  return <span className={cls(tone)}>{children}</span>
}
