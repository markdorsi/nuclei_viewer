import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'

export default function Settings() {
  const { tenant, user } = useAuth()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('integrations')

  const { data: integrations } = useQuery({
    queryKey: ['integrations', tenant?.id],
    queryFn: async () => {
      const res = await fetch(`/api/t/${tenant?.slug}/integrations`)
      if (!res.ok) throw new Error('Failed to fetch integrations')
      return res.json()
    },
    enabled: !!tenant
  })

  const { data: userIntegrations } = useQuery({
    queryKey: ['user-integrations', tenant?.id, user?.id],
    queryFn: async () => {
      const res = await fetch(`/api/t/${tenant?.slug}/user-integrations`)
      if (!res.ok) throw new Error('Failed to fetch user integrations')
      return res.json()
    },
    enabled: !!tenant && !!user
  })

  const saveIntegration = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(`/api/t/${tenant?.slug}/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      if (!res.ok) throw new Error('Failed to save integration')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations', tenant?.id] })
    }
  })

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      <div className="mt-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('integrations')}
              className={`${
                activeTab === 'integrations'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              Integrations
            </button>
            <button
              onClick={() => setActiveTab('my-connections')}
              className={`${
                activeTab === 'my-connections'
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              My Connections
            </button>
          </nav>
        </div>
      </div>

      {activeTab === 'integrations' && (
        <div className="mt-6 space-y-6">
          <div className="bg-white shadow sm:rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg font-medium text-gray-900">Linear Integration</h3>
              <p className="mt-1 text-sm text-gray-500">
                Configure Linear integration for reading and creating issues.
              </p>
              <div className="mt-4 space-y-4">
                <div>
                  <label htmlFor="linear-team" className="block text-sm font-medium text-gray-700">
                    Team ID
                  </label>
                  <input
                    type="text"
                    id="linear-team"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    placeholder="TEAM-123"
                  />
                </div>
                <div>
                  <label htmlFor="linear-label" className="block text-sm font-medium text-gray-700">
                    Label Prefix (optional)
                  </label>
                  <input
                    type="text"
                    id="linear-label"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    placeholder="security-"
                  />
                </div>
                <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                  Save Linear Settings
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white shadow sm:rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg font-medium text-gray-900">Jira Integration</h3>
              <p className="mt-1 text-sm text-gray-500">
                Configure Jira integration for reading and creating issues.
              </p>
              <div className="mt-4 space-y-4">
                <div>
                  <label htmlFor="jira-project" className="block text-sm font-medium text-gray-700">
                    Project Key
                  </label>
                  <input
                    type="text"
                    id="jira-project"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    placeholder="SEC"
                  />
                </div>
                <div>
                  <label htmlFor="jira-jql" className="block text-sm font-medium text-gray-700">
                    JQL Filter (optional)
                  </label>
                  <input
                    type="text"
                    id="jira-jql"
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                    placeholder="labels = 'security' AND status != 'Done'"
                  />
                </div>
                <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                  Save Jira Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'my-connections' && (
        <div className="mt-6 space-y-6">
          <div className="bg-white shadow sm:rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg font-medium text-gray-900">Personal API Tokens</h3>
              <p className="mt-1 text-sm text-gray-500">
                Add your personal API tokens to create issues in Linear or Jira.
              </p>
              
              <div className="mt-6 space-y-6">
                <div>
                  <h4 className="text-sm font-medium text-gray-900">Linear API Token</h4>
                  <div className="mt-2">
                    <input
                      type="password"
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      placeholder="lin_api_..."
                    />
                    <button className="mt-2 inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                      Save Token
                    </button>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-gray-900">Jira API Token</h4>
                  <div className="mt-2">
                    <input
                      type="password"
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      placeholder="Your Jira API token"
                    />
                    <button className="mt-2 inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                      Save Token
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}