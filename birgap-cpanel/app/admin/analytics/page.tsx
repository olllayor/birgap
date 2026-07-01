'use client'

import { useAnalytics } from '@/lib/hooks'
import { useState } from 'react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { Loader, Download } from 'lucide-react'

const METRIC_OPTIONS = [
  { value: 'MESSAGES_SENT_DIRECT', label: 'Direct Messages Sent' },
  { value: 'MESSAGES_SENT_GROUP', label: 'Group Messages Sent' },
  { value: 'DAU', label: 'Daily Active Users' },
  { value: 'NEW_USERS', label: 'New Users' },
  { value: 'REPORTS_OPENED', label: 'Reports Opened' },
  { value: 'REPORTS_RESOLVED', label: 'Reports Resolved' },
  { value: 'USERS_SUSPENDED', label: 'Users Suspended' },
]

const DAY_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
]

const CHART_TYPES = [
  { value: 'line', label: 'Line Chart' },
  { value: 'bar', label: 'Bar Chart' },
]

export default function AnalyticsPage() {
  const [selectedMetric, setSelectedMetric] = useState('DAU')
  const [days, setDays] = useState(30)
  const [chartType, setChartType] = useState<'line' | 'bar'>('line')

  const { data, isLoading } = useAnalytics(selectedMetric, days)

  const handleExport = () => {
    if (!data?.data) return

    const csv = [
      ['Date', 'Value'],
      ...data.data.map((d) => [d.date, d.value]),
    ]
      .map((row) => row.join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedMetric}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Analytics</h1>
        <p className="text-muted-foreground mt-2">
          View application metrics and trends
        </p>
      </div>

      {/* Controls */}
      <div className="bg-card border border-border rounded-lg p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Metric Selection */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Metric
            </label>
            <select
              value={selectedMetric}
              onChange={(e) => setSelectedMetric(e.target.value)}
              className="w-full p-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
            >
              {METRIC_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Time Range */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Time Range
            </label>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-full p-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
            >
              {DAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Chart Type */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Chart Type
            </label>
            <select
              value={chartType}
              onChange={(e) => setChartType(e.target.value as 'line' | 'bar')}
              className="w-full p-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
            >
              {CHART_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Export Button */}
        <div className="flex justify-end">
          <button
            onClick={handleExport}
            disabled={!data?.data || data.data.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Download size={18} />
            Export as CSV
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold text-foreground mb-6">
          {METRIC_OPTIONS.find((m) => m.value === selectedMetric)?.label}
        </h2>

        {isLoading ? (
          <div className="flex items-center justify-center h-96">
            <Loader className="animate-spin" size={32} />
          </div>
        ) : data?.data && data.data.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            {chartType === 'line' ? (
              <LineChart data={data.data}>
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
                <Legend wrapperStyle={{ color: 'var(--foreground)' }} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--primary)"
                  dot={false}
                  isAnimationActive={false}
                  name={METRIC_OPTIONS.find((m) => m.value === selectedMetric)?.label}
                />
              </LineChart>
            ) : (
              <BarChart data={data.data}>
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
                <Legend wrapperStyle={{ color: 'var(--foreground)' }} />
                <Bar
                  dataKey="value"
                  fill="var(--primary)"
                  name={METRIC_OPTIONS.find((m) => m.value === selectedMetric)?.label}
                />
              </BarChart>
            )}
          </ResponsiveContainer>
        ) : (
          <div className="h-96 flex items-center justify-center text-muted-foreground">
            No data available for the selected period
          </div>
        )}
      </div>

      {/* Stats Table */}
      {data?.data && data.data.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((row, idx) => (
                <tr
                  key={idx}
                  className="border-b border-border hover:bg-muted/20 transition-colors"
                >
                  <td className="px-6 py-4 text-foreground">{row.date}</td>
                  <td className="px-6 py-4 font-semibold text-foreground">
                    {row.value.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
