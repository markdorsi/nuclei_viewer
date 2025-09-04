import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiCall } from '../utils/api'

export default function Dashboard() {
  const { tenant } = useAuth()
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchStats = async () => {
      if (!tenant) return
      
      try {
        setLoading(true)
        setError(null)
        const data = await apiCall(`/api/t/${tenant.slug}/stats`)
        setStats(data)
      } catch (err) {
        console.error('Failed to fetch stats:', err)
        setError('Failed to load dashboard stats')
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [tenant])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <dt className="text-sm font-medium text-gray-500 truncate">Total Findings</dt>
            <dd className="mt-1 text-3xl font-semibold text-gray-900">{stats?.totalFindings || 0}</dd>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <dt className="text-sm font-medium text-gray-500 truncate">Critical</dt>
            <dd className="mt-1 text-3xl font-semibold text-red-600">{stats?.critical || 0}</dd>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <dt className="text-sm font-medium text-gray-500 truncate">High</dt>
            <dd className="mt-1 text-3xl font-semibold text-orange-600">{stats?.high || 0}</dd>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <dt className="text-sm font-medium text-gray-500 truncate">Companies</dt>
            <dd className="mt-1 text-3xl font-semibold text-gray-900">{stats?.companies || 0}</dd>
          </div>
        </div>
      </div>

      <div className="mt-8 bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900">Recent Scans</h3>
          <div className="mt-4">
            <p className="text-sm text-gray-500">No recent scans available</p>
          </div>
        </div>
      </div>
    </div>
  )
}