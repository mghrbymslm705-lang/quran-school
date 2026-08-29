import { useEffect, useState } from 'react'
import { subscribe, getData } from './store'
import type { SchoolData } from '../types'

// خطّاف للاشتراك في طبقة البيانات وإعادة الرسم عند أي تغيير.
export function useSchoolData<T>(selector: (data: SchoolData) => T): T {
  const [value, setValue] = useState<T>(() => selector(getData()))

  useEffect(() => {
    const update = () => setValue(selector(getData()))
    update()
    return subscribe(update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return value
}
