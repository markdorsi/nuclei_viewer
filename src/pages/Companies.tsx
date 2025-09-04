import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import { PlusIcon } from '@heroicons/react/24/outline'

export default function Companies() {
  const { tenant } = useAuth()
  const queryClient = useQueryClient()
  const [isAddingCompany, setIsAddingCompany] = useState(false)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [newCompanySlug, setNewCompanySlug] = useState('')

  const { data: companies, isLoading } = useQuery({
    queryKey: ['companies', tenant?.id],
    queryFn: async () => {
      const res = await fetch(`/api/t/${tenant?.slug}/companies`)
      if (!res.ok) throw new Error('Failed to fetch companies')
      return res.json()
    },
    enabled: !!tenant
  })

  const createCompany = useMutation({
    mutationFn: async (data: { name: string; slug: string }) => {
      const res = await fetch(`/api/t/${tenant?.slug}/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      if (!res.ok) throw new Error('Failed to create company')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies', tenant?.id] })
      setIsAddingCompany(false)
      setNewCompanyName('')
      setNewCompanySlug('')
    }
  })

  const handleAddCompany = () => {
    if (newCompanyName && newCompanySlug) {
      createCompany.mutate({ name: newCompanyName, slug: newCompanySlug })
    }
  }

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Companies</h1>
        <button
          onClick={() => setIsAddingCompany(true)}
          className="mt-3 sm:mt-0 inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          <PlusIcon className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
          Add Company
        </button>
      </div>

      {isAddingCompany && (
        <div className="mt-6 bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg font-medium text-gray-900">Add New Company</h3>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  Company Name
                </label>
                <input
                  type="text"
                  id="name"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  placeholder="Acme Corp"
                />
              </div>
              <div>
                <label htmlFor="slug" className="block text-sm font-medium text-gray-700">
                  Slug (URL-friendly identifier)
                </label>
                <input
                  type="text"
                  id="slug"
                  value={newCompanySlug}
                  onChange={(e) => setNewCompanySlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  placeholder="acme-corp"
                />
              </div>
            </div>
            <div className="mt-4 flex space-x-3">
              <button
                onClick={handleAddCompany}
                disabled={!newCompanyName || !newCompanySlug || createCompany.isPending}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {createCompany.isPending ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => {
                  setIsAddingCompany(false)
                  setNewCompanyName('')
                  setNewCompanySlug('')
                }}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 bg-white shadow overflow-hidden sm:rounded-md">
        {isLoading ? (
          <div className="px-4 py-5 sm:p-6">
            <div className="animate-pulse space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        ) : companies?.length > 0 ? (
          <ul className="divide-y divide-gray-200">
            {companies.map((company: any) => (
              <li key={company.id}>
                <div className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{company.name}</p>
                      <p className="text-sm text-gray-500">Slug: {company.slug}</p>
                    </div>
                    <div className="text-sm text-gray-500">
                      {company.findingsCount || 0} findings • {company.scansCount || 0} scans
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-5 sm:p-6">
            <p className="text-sm text-gray-500">No companies found. Add your first company to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}