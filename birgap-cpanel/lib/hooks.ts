'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, Report, AdminUser, Metric, AuditLogEntry, ListResponse } from './api'

// Reports Hooks
export function useReports(page: number = 1, status?: string) {
  return useQuery({
    queryKey: ['reports', page, status],
    queryFn: async () => {
      const params = new URLSearchParams({ page: page.toString(), limit: '10' })
      if (status) params.append('status', status)
      return apiClient.get<ListResponse<Report>>(`/admin/reports?${params}`)
    },
    staleTime: 30000,
  })
}

export function useReport(id: string) {
  return useQuery({
    queryKey: ['report', id],
    queryFn: () => apiClient.get<Report>(`/admin/reports/${id}`),
    enabled: !!id,
    staleTime: 30000,
  })
}

export function useReviewReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { reportId: string; action: 'review' | 'dismiss'; reason?: string }) =>
      apiClient.post(`/admin/reports/${data.reportId}/${data.action}`, { reason: data.reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
  })
}

// User Hooks
export function useUsers(page: number = 1, search?: string, role?: string, status?: string) {
  return useQuery({
    queryKey: ['users', page, search, role, status],
    queryFn: async () => {
      const params = new URLSearchParams({ page: page.toString(), limit: '10' })
      if (search) params.append('search', search)
      if (role) params.append('role', role)
      if (status) params.append('status', status)
      return apiClient.get<ListResponse<AdminUser>>(`/admin/users?${params}`)
    },
    staleTime: 30000,
  })
}

export function useUser(id: string) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: () => apiClient.get<AdminUser>(`/admin/users/${id}`),
    enabled: !!id,
    staleTime: 30000,
  })
}

export function useSuspendUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { userId: string; reason?: string }) =>
      apiClient.post(`/admin/users/${data.userId}/suspend`, { reason: data.reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useUnsuspendUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      apiClient.post(`/admin/users/${userId}/unsuspend`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useChangeUserRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { userId: string; role: 'USER' | 'MODERATOR' | 'ADMIN' }) =>
      apiClient.post(`/admin/users/${data.userId}/role`, { role: data.role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useResetUserStrikes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      apiClient.post(`/admin/users/${userId}/reset-strikes`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

// Analytics Hooks
export function useAnalytics(metricKind: string, days: number = 30, dimension?: string) {
  return useQuery({
    queryKey: ['analytics', metricKind, days, dimension],
    queryFn: async () => {
      const params = new URLSearchParams({
        metricKind,
        days: days.toString(),
      })
      if (dimension) params.append('dimension', dimension)
      return apiClient.get<Metric>(`/admin/analytics?${params}`)
    },
    staleTime: 60000,
  })
}

// Audit Log Hooks
export function useAuditLog(page: number = 1, filters?: Record<string, string>) {
  return useQuery({
    queryKey: ['audit-log', page, filters],
    queryFn: async () => {
      const params = new URLSearchParams({ page: page.toString(), limit: '20' })
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          if (value) params.append(key, value)
        })
      }
      return apiClient.get<ListResponse<AuditLogEntry>>(`/admin/audit-log?${params}`)
    },
    staleTime: 30000,
  })
}
