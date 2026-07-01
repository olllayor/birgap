'use client'

import { useReports, useUsers, useAnalytics } from '@/lib/hooks'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { AlertCircle, Users, TrendingUp, Loader } from 'lucide-react'
import { formatDate } from '@/lib/utils'

const METRIC_OPTIONS = [
  { value: 'DAU', label: 'Daily Active Users' },
  { value: 'MESSAGES_SENT_DIRECT', label: 'Direct Messages' },
  { value: 'MESSAGES_SENT_GROUP', label: 'Group Messages' },
  { value: 'NEW_USERS', label: 'New Users' },
  { value: 'REPORTS_OPENED', label: 'Reports Opened' },
  { value: 'REPORTS_RESOLVED', label: 'Reports Resolved' },
  { value: 'USERS_SUSPENDED', label: 'Users Suspended' },
]

export default function AdminDashboard() {
  const router = useRouter()
  const [selectedMetric, setSelectedMetric] = useState('DAU')
  
  const { data: reportsData, isLoading: reportsLoading } = useReports(1)
  const { data: usersData, isLoading: usersLoading } = useUsers(1)
  const { data: analyticsData, isLoading: analyticsLoading } = useAnalytics(selectedMetric)

  const openReports = reportsData?.data?.filter((r) => r.status === 'OPEN').length || 0
  const totalUsers = usersData?.pagination?.total || 0
  const suspendedUsers =
    usersData?.data?.filter((u) => u.status === 'SUSPENDED').length || 0

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Welcome to the BirGap admin panel
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MetricCard
          title="Open Reports"
          value={openReports}
          icon={AlertCircle}
          color="text-red-500"
          onClick={() => router.push('/admin/reports')}
        />
        <MetricCard
          title="Total Users"
          value={totalUsers}
          icon={Users}
          color="text-blue-500"
          onClick={() => router.push('/admin/users')}
        />
        <MetricCard
          title="Suspended Users"
          value={suspendedUsers}
          icon={Users}
          color="text-orange-500"
        />
        <MetricCard
          title="Metrics Tracked"
          value={METRIC_OPTIONS.length}
          icon={TrendingUp}
          color="text-green-500"
        />
      </div>

      {/* Analytics Chart */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-foreground mb-4">Analytics</h2>
          <div className="flex flex-wrap gap-2">
            {METRIC_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setSelectedMetric(option.value)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedMetric === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {analyticsLoading ? (
          <div className="flex items-center justify-center h-80">
            <Loader className="animate-spin" size={32} />
          </div>
        ) : analyticsData?.data && analyticsData.data.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={analyticsData.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" stroke="var(--muted-foreground)" />
              <YAxis stroke="var(--muted-foreground)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: 'var(--foreground)' }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--primary)"
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-80 flex items-center justify-center text-muted-foreground">
            No data available
          </div>
        )}
      </div>

      {/* Recent Reports */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold text-foreground mb-4">Recent Reports</h2>
        {reportsLoading ? (
          <div className="flex items-center justify-center p-4">
            <Loader className="animate-spin" size={24} />
          </div>
        ) : reportsData?.data && reportsData.data.length > 0 ? (
          <div className="space-y-3">
            {reportsData.data.slice(0, 5).map((report) => (
              <div
                key={report.id}
                className="flex items-center justify-between p-3 bg-muted/20 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer"
                onClick={() => router.push(`/admin/reports`)}
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {report.reportedUser.username}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {report.reason}
                  </p>
                </div>
                <span
                  className={`text-xs font-semibold px-2 py-1 rounded-md ${
                    report.status === 'OPEN'
                      ? 'bg-red-900/20 text-red-100'
                      : report.status === 'IN_REVIEW'
                      ? 'bg-yellow-900/20 text-yellow-100'
                      : 'bg-green-900/20 text-green-100'
                  }`}
                >
                  {report.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No reports yet</p>
        )}
      </div>
    </div>
  )
}

function MetricCard({
  title,
  value,
  icon: Icon,
  color,
  onClick,
}: {
  title: string
  value: number
  icon: React.ComponentType<{ size?: number }>
  color: string
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-card border border-border rounded-lg p-6 ${
        onClick ? 'cursor-pointer hover:border-primary transition-colors' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-sm">{title}</p>
          <p className="text-3xl font-bold text-foreground mt-2">{value}</p>
        </div>
        <Icon className={`${color}`} size={32} />
      </div>
    </div>
  )
}
