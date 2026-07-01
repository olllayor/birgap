'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { apiClient } from '@/lib/api'

export default function RootPage() {
  const router = useRouter()

  useEffect(() => {
    const token = apiClient.getToken()
    if (token) {
      router.push('/admin')
    } else {
      router.push('/login')
    }
  }, [router])

  return null
}
