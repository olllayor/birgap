// API client for BirGap admin backend
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api'

interface RequestOptions extends RequestInit {
  headers?: Record<string, string>
}

class ApiClient {
  private baseUrl: string
  private token: string | null = null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('adminToken')
    }
  }

  setToken(token: string) {
    this.token = token
    if (typeof window !== 'undefined') {
      localStorage.setItem('adminToken', token)
    }
  }

  getToken(): string | null {
    return this.token
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    return headers
  }

  async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const headers = {
      ...this.getHeaders(),
      ...options.headers,
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      })

      if (!response.ok) {
        // Handle 401 Unauthorized
        if (response.status === 401) {
          this.token = null
          if (typeof window !== 'undefined') {
            localStorage.removeItem('adminToken')
            window.location.href = '/login'
          }
        }
        throw new Error(`API Error: ${response.status}`)
      }

      const data = await response.json()
      return data
    } catch (error) {
      console.error('API request failed:', error)
      throw error
    }
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' })
  }

  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async put<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async patch<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' })
  }
}

export const apiClient = new ApiClient(API_BASE_URL)

// Type definitions for API responses
export interface Report {
  id: string
  createdAt: string
  reportedById: string
  messageId: string
  reason: 'SPAM' | 'HARASSMENT' | 'HATE_SPEECH' | 'SEXUAL_CONTENT' | 'VIOLENCE' | 'IMPERSONATION' | 'OTHER'
  status: 'OPEN' | 'IN_REVIEW' | 'CLOSED'
  message: string
  reportedUser: {
    id: string
    username: string
    avatar?: string
  }
}

export interface AdminUser {
  id: string
  username: string
  phone: string
  role: 'USER' | 'MODERATOR' | 'ADMIN'
  status: 'ACTIVE' | 'SUSPENDED'
  strikeCount: number
  createdAt: string
  updatedAt: string
}

export interface AnalyticsMetric {
  date: string
  value: number
}

export interface Metric {
  kind: 'MESSAGES_SENT_DIRECT' | 'MESSAGES_SENT_GROUP' | 'DAU' | 'NEW_USERS' | 'REPORTS_OPENED' | 'REPORTS_RESOLVED' | 'USERS_SUSPENDED'
  dimension?: string
  data: AnalyticsMetric[]
}

export interface AuditLogEntry {
  id: string
  action: string
  targetType: string
  targetId?: string
  actorId: string
  actor: {
    username: string
  }
  metadata: Record<string, unknown>
  createdAt: string
}

export interface ListResponse<T> {
  data: T[]
  pagination: {
    total: number
    page: number
    pageSize: number
    hasMore: boolean
  }
}
