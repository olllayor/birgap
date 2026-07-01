import { Sidebar } from '@/components/Sidebar'
import { Providers } from '@/components/Providers'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Providers>
      <div className="flex h-screen bg-background">
        <Sidebar />
        <main className="flex-1 overflow-auto md:ml-64">
          <div className="p-4 md:p-8">{children}</div>
        </main>
      </div>
    </Providers>
  )
}
