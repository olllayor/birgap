import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow, format } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date): string {
  return format(new Date(date), 'MMM dd, yyyy')
}

export function formatDateTime(date: string | Date): string {
  return format(new Date(date), 'MMM dd, yyyy HH:mm:ss')
}

export function formatTimeAgo(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

export const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-yellow-900/20 text-yellow-100 border-yellow-800',
  IN_REVIEW: 'bg-blue-900/20 text-blue-100 border-blue-800',
  CLOSED: 'bg-green-900/20 text-green-100 border-green-800',
  ACTIVE: 'bg-green-900/20 text-green-100 border-green-800',
  SUSPENDED: 'bg-red-900/20 text-red-100 border-red-800',
}

export const ROLE_COLORS: Record<string, string> = {
  USER: 'bg-slate-900/20 text-slate-100 border-slate-800',
  MODERATOR: 'bg-purple-900/20 text-purple-100 border-purple-800',
  ADMIN: 'bg-amber-900/20 text-amber-100 border-amber-800',
}

export const REASON_COLORS: Record<string, string> = {
  SPAM: 'bg-orange-900/20 text-orange-100 border-orange-800',
  HARASSMENT: 'bg-red-900/20 text-red-100 border-red-800',
  HATE_SPEECH: 'bg-red-900/20 text-red-100 border-red-800',
  SEXUAL_CONTENT: 'bg-pink-900/20 text-pink-100 border-pink-800',
  VIOLENCE: 'bg-red-900/20 text-red-100 border-red-800',
  IMPERSONATION: 'bg-purple-900/20 text-purple-100 border-purple-800',
  OTHER: 'bg-gray-900/20 text-gray-100 border-gray-800',
}

export function getStatusColor(status: string): string {
  return STATUS_COLORS[status] || 'bg-slate-900/20 text-slate-100 border-slate-800'
}

export function getRoleColor(role: string): string {
  return ROLE_COLORS[role] || 'bg-slate-900/20 text-slate-100 border-slate-800'
}

export function getReasonColor(reason: string): string {
  return REASON_COLORS[reason] || 'bg-slate-900/20 text-slate-100 border-slate-800'
}
