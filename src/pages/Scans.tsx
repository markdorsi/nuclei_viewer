import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import { CloudArrowUpIcon, PlayIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'
import { apiCall } from '../utils/api'
import { uploadFileInChunks } from '../utils/chunkedUpload'

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800'
}

export default function Scans() {
  const { tenant } = useAuth()
  const queryClient = useQueryClient()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<string>('')
  const [newCompanyName, setNewCompanyName] = useState<string>('')
  const [isCreatingCompany, setIsCreatingCompany] = useState<boolean>(false)
  const [fileInputKey, setFileInputKey] = useState<number>(0)
  const [uploadMessage, setUploadMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [isChunkedUpload, setIsChunkedUpload] = useState<boolean>(false)
  const [selectedScans, setSelectedScans] = useState<Set<string>>(new Set())

  const { data: scans, isLoading, error: scansError } = useQuery({
    queryKey: ['scans', tenant?.id],
    queryFn: async () => {
      console.log('🔴 SCANS QUERY: Starting for tenant:', tenant?.slug)
      const result = await apiCall(`/api/t/${tenant?.slug}/scans`)
      console.log('🔴 SCANS QUERY: Result:', result)
      return result
    },
    enabled: !!tenant
  })

  const { data: companies, error: companiesError } = useQuery({
    queryKey: ['companies', tenant?.id],
    queryFn: async () => {
      console.log('🔴 COMPANIES QUERY: Starting for tenant:', tenant?.slug)
      const result = await apiCall(`/api/t/${tenant?.slug}/companies`)
      console.log('🔴 COMPANIES QUERY: Result:', result)
      return result
    },
    enabled: !!tenant
  })

  const cleanupScans = useMutation({
    mutationFn: async () => {
      return apiCall(`/.netlify/functions/cleanup?action=clean&tenant=${tenant?.slug}`)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['scans', tenant?.id] })
      queryClient.invalidateQueries({ queryKey: ['companies', tenant?.id] })
      setUploadMessage({ 
        type: 'success', 
        text: `Cleanup completed! Removed ${data.removed?.chunkScans || 0} chunk files and ${data.removed?.blobCompanies || 0} blob companies.` 
      })
      setTimeout(() => setUploadMessage(null), 5000)
    },
    onError: (error: Error) => {
      setUploadMessage({ 
        type: 'error', 
        text: `Cleanup failed: ${error.message}` 
      })
      setTimeout(() => setUploadMessage(null), 5000)
    }
  })

  const processScan = useMutation({
    mutationFn: async (scanId: string) => {
      return apiCall(`/.netlify/functions/process-scan?tenant=${tenant?.slug}`, {
        method: 'POST',
        body: JSON.stringify({ scanId })
      })
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['scans', tenant?.id] })
      setUploadMessage({ 
        type: 'success', 
        text: `Processing completed! Found ${data.findingsCount || 0} findings.` 
      })
      setTimeout(() => setUploadMessage(null), 5000)
    },
    onError: (error: Error) => {
      setUploadMessage({ 
        type: 'error', 
        text: `Processing failed: ${error.message}` 
      })
      setTimeout(() => setUploadMessage(null), 5000)
    }
  })

  const processSelectedScans = useMutation({
    mutationFn: async (scanIds: string[]) => {
      console.log('Processing', scanIds.length, 'selected scans')
      
      const results = []
      for (const scanId of scanIds) {
        try {
          const result = await apiCall(`/.netlify/functions/process-scan?tenant=${tenant?.slug}`, {
            method: 'POST',
            body: JSON.stringify({ scanId })
          })
          results.push({ scanId, success: true, result })
        } catch (error) {
          results.push({ scanId, success: false, error })
        }
      }
      return results
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['scans', tenant?.id] })
      const successful = results.filter(r => r.success).length
      const failed = results.filter(r => !r.success).length
      const totalFindings = results
        .filter(r => r.success)
        .reduce((sum, r) => sum + (r.result.findingsCount || 0), 0)
      
      setUploadMessage({ 
        type: successful > 0 ? 'success' : 'error', 
        text: `Processing completed! ${successful} successful, ${failed} failed. Total findings: ${totalFindings}` 
      })
      setSelectedScans(new Set()) // Clear selection after processing
      setTimeout(() => setUploadMessage(null), 8000)
    },
    onError: (error: Error) => {
      setUploadMessage({ 
        type: 'error', 
        text: `Processing failed: ${error.message}` 
      })
      setTimeout(() => setUploadMessage(null), 5000)
    }
  })

  // Selection helpers
  const handleSelectScan = (scanId: string, checked: boolean) => {
    const newSelected = new Set(selectedScans)
    if (checked) {
      newSelected.add(scanId)
    } else {
      newSelected.delete(scanId)
    }
    setSelectedScans(newSelected)
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const pendingScans = scans?.filter((scan: any) => scan.status === 'pending') || []
      setSelectedScans(new Set(pendingScans.map((scan: any) => scan.id)))
    } else {
      setSelectedScans(new Set())
    }
  }

  const pendingScans = scans?.filter((scan: any) => scan.status === 'pending') || []
  const allPendingSelected = pendingScans.length > 0 && pendingScans.every((scan: any) => selectedScans.has(scan.id))

  const uploadScan = useMutation({
    mutationFn: async ({ file, companyId, companyName }: { file: File; companyId?: string; companyName?: string }) => {
      // Use chunked upload for files larger than 2MB to be safe
      if (file.size > 2 * 1024 * 1024) {
        console.log('🔴 UPLOAD: Using chunked upload for large file:', file.size)
        setIsChunkedUpload(true)
        
        return uploadFileInChunks({
          file,
          tenantSlug: tenant?.slug || '',
          companyId,
          companyName,
          onProgress: (progress) => {
            console.log('🔴 UPLOAD: Chunked upload progress:', progress)
            setUploadProgress(progress)
          }
        })
      } else {
        // Use regular upload for smaller files
        console.log('🔴 UPLOAD: Using regular upload for small file:', file.size)
        setIsChunkedUpload(false)
        
        const formData = new FormData()
        formData.append('file', file)
        if (companyId) {
          formData.append('companyId', companyId)
        }
        if (companyName) {
          formData.append('companyName', companyName)
        }
        
        return apiCall(`/api/t/${tenant?.slug}/upload`, {
          method: 'POST',
          body: formData
        })
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['scans', tenant?.id] })
      queryClient.invalidateQueries({ queryKey: ['companies', tenant?.id] })
      // Reset form state
      setSelectedFile(null)
      setSelectedCompany('')
      setNewCompanyName('')
      setIsCreatingCompany(false)
      setUploadProgress(0)
      setIsChunkedUpload(false)
      // Force file input reset by changing key
      setFileInputKey(prev => prev + 1)
      // Show success message
      const sizeText = data.fileSize ? `(${(data.fileSize / 1024 / 1024).toFixed(2)}MB)` : ''
      setUploadMessage({ 
        type: 'success', 
        text: `File uploaded successfully! ${sizeText}${data.message ? ' - ' + data.message : ''}` 
      })
      // Clear message after 5 seconds
      setTimeout(() => setUploadMessage(null), 5000)
    },
    onError: (error: Error) => {
      setUploadMessage({ 
        type: 'error', 
        text: `Upload failed: ${error.message}` 
      })
      setUploadProgress(0)
      setIsChunkedUpload(false)
      // Clear error message after 5 seconds
      setTimeout(() => setUploadMessage(null), 5000)
    }
  })

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('🔴 FILE SELECT: Event triggered')
    const file = e.target.files?.[0]
    console.log('🔴 FILE SELECT: Selected file:', file)
    
    if (file) {
      // Show info for large files that will use chunked upload
      if (file.size > 2 * 1024 * 1024) {
        setUploadMessage({ 
          type: 'success', 
          text: `Large file detected (${(file.size / 1024 / 1024).toFixed(2)}MB). Will use chunked upload.` 
        })
        setTimeout(() => setUploadMessage(null), 5000)
      } else {
        setUploadMessage(null) // Clear any previous messages
      }
      
      setSelectedFile(file)
      console.log('🔴 FILE SELECT: File set in state:', file.name, file.size)
    }
  }

  const handleUpload = () => {
    console.log('🔴 UPLOAD: Button clicked')
    console.log('🔴 UPLOAD: Selected file:', selectedFile)
    console.log('🔴 UPLOAD: Selected company:', selectedCompany)
    console.log('🔴 UPLOAD: New company name:', newCompanyName)
    console.log('🔴 UPLOAD: Is creating company:', isCreatingCompany)
    console.log('🔴 UPLOAD: Companies available:', companies?.length || 0)
    
    if (selectedFile) {
      console.log('🔴 UPLOAD: Starting upload mutation...')
      
      // If creating new company, pass the name
      if (isCreatingCompany && newCompanyName.trim()) {
        uploadScan.mutate({ 
          file: selectedFile, 
          companyName: newCompanyName.trim()
        })
      } 
      // If existing company selected
      else if (selectedCompany) {
        uploadScan.mutate({ 
          file: selectedFile, 
          companyId: selectedCompany 
        })
      }
      // Otherwise, let server create from filename
      else {
        uploadScan.mutate({ 
          file: selectedFile 
        })
      }
    } else {
      console.log('🔴 UPLOAD: Upload blocked - missing file')
    }
  }

  // Debug logging for render
  console.log('🔴 RENDER: tenant:', tenant)
  console.log('🔴 RENDER: scans data:', scans)
  console.log('🔴 RENDER: companies data:', companies)
  console.log('🔴 RENDER: companies details:', JSON.stringify(companies))
  console.log('🔴 RENDER: selectedFile:', selectedFile)
  console.log('🔴 RENDER: selectedCompany:', selectedCompany)
  console.log('🔴 RENDER: isLoading:', isLoading)
  console.log('🔴 RENDER: scansError:', scansError)
  console.log('🔴 RENDER: companiesError:', companiesError)
  console.log('🔴 RENDER: Upload button disabled?', !selectedFile || uploadScan.isPending || (companies && companies.length > 0 && !selectedCompany))

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Scans</h1>
        <div className="flex space-x-3">
          {selectedScans.size > 0 && (
            <button
              onClick={() => processSelectedScans.mutate(Array.from(selectedScans))}
              disabled={processSelectedScans.isPending}
              className="inline-flex items-center px-3 py-2 border border-transparent shadow-sm text-sm leading-4 font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              <PlayIcon className="h-4 w-4 mr-2" />
              {processSelectedScans.isPending ? 'Processing...' : `Process ${selectedScans.size} Selected`}
            </button>
          )}
          <button
            onClick={() => cleanupScans.mutate()}
            disabled={cleanupScans.isPending}
            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
          >
            {cleanupScans.isPending ? 'Cleaning...' : 'Clean Up Borked Uploads'}
          </button>
        </div>
      </div>

      <div className="mt-6 bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900">Upload Scan File</h3>
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="company" className="block text-sm font-medium text-gray-700">
                Company
              </label>
              <div className="mt-1 space-y-2">
                <div className="flex items-center">
                  <input
                    type="radio"
                    id="existing-company"
                    name="company-type"
                    checked={!isCreatingCompany}
                    onChange={() => setIsCreatingCompany(false)}
                    className="mr-2"
                  />
                  <label htmlFor="existing-company" className="text-sm">
                    {companies && companies.length > 0 ? 'Select existing company' : 'Auto-create from filename'}
                  </label>
                </div>
                
                {!isCreatingCompany && companies && companies.length > 0 && (
                  <select
                    id="company"
                    value={selectedCompany}
                    onChange={(e) => setSelectedCompany(e.target.value)}
                    className="ml-6 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  >
                    <option value="">Choose a company...</option>
                    {companies?.map((company: any) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                )}
                
                {!isCreatingCompany && (!companies || companies.length === 0) && (
                  <p className="ml-6 text-sm text-gray-500">
                    Company will be created automatically from the filename
                  </p>
                )}
                
                <div className="flex items-center">
                  <input
                    type="radio"
                    id="new-company"
                    name="company-type"
                    checked={isCreatingCompany}
                    onChange={() => setIsCreatingCompany(true)}
                    className="mr-2"
                  />
                  <label htmlFor="new-company" className="text-sm">Create new company</label>
                </div>
                
                {isCreatingCompany && (
                  <input
                    type="text"
                    placeholder="Enter company name"
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    className="ml-6 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                )}
              </div>
            </div>

            <div>
              <label htmlFor="file" className="block text-sm font-medium text-gray-700">
                Scan File (Nuclei JSONL or Nmap)
              </label>
              <div className="mt-1 flex items-center">
                <input
                  key={fileInputKey}
                  type="file"
                  id="file"
                  accept=".jsonl,.json,.xml,.txt"
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />
              </div>
              {selectedFile && (
                <p className="mt-2 text-sm text-gray-500">
                  Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
                </p>
              )}
            </div>

            <div className="space-y-3">
              <button
                onClick={handleUpload}
                disabled={
                  !selectedFile || 
                  uploadScan.isPending ||
                  (isCreatingCompany && !newCompanyName.trim()) ||
                  (!isCreatingCompany && companies && companies.length > 0 && !selectedCompany)
                }
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                <CloudArrowUpIcon className="-ml-1 mr-2 h-5 w-5" />
                {uploadScan.isPending ? 
                  (isChunkedUpload ? `Uploading chunks... ${Math.round(uploadProgress)}%` : 'Uploading...') 
                  : 'Upload Scan'
                }
              </button>
              
              {uploadScan.isPending && isChunkedUpload && (
                <div className="w-full">
                  <div className="flex justify-between text-sm text-gray-600 mb-1">
                    <span>Upload progress</span>
                    <span>{Math.round(uploadProgress)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-indigo-600 h-2 rounded-full transition-all duration-300" 
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
            
            {uploadMessage && (
              <div className={clsx(
                'mt-3 p-3 rounded-md text-sm',
                uploadMessage.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
              )}>
                {uploadMessage.text}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 bg-white shadow overflow-hidden sm:rounded-md">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Recent Scans</h3>
            {pendingScans.length > 0 && (
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={allPendingSelected}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm text-gray-700">Select all pending</span>
              </label>
            )}
          </div>
        </div>
        {isLoading ? (
          <div className="px-4 pb-5 sm:px-6">
            <div className="animate-pulse space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        ) : scans?.length > 0 ? (
          <ul className="divide-y divide-gray-200">
            {scans.map((scan: any) => (
              <li key={scan.id}>
                <div className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center flex-1">
                      {scan.status === 'pending' && (
                        <input
                          type="checkbox"
                          checked={selectedScans.has(scan.id)}
                          onChange={(e) => handleSelectScan(scan.id, e.target.checked)}
                          className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded mr-4"
                        />
                      )}
                      <div className="flex-1">
                        <div className="flex items-center">
                          <p className="text-sm font-medium text-gray-900">{scan.fileName}</p>
                          <span className={clsx(
                            'ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                            statusColors[scan.status as keyof typeof statusColors]
                          )}>
                            {scan.status}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center text-sm text-gray-500">
                          <span>{scan.company?.name}</span>
                          <span className="mx-2">•</span>
                          <span>{scan.scanType}</span>
                          <span className="mx-2">•</span>
                          <span>{new Date(scan.scanDate).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    {scan.status === 'pending' && !selectedScans.has(scan.id) && (
                      <button
                        onClick={() => processScan.mutate(scan.id)}
                        disabled={processScan.isPending}
                        className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-indigo-600 bg-indigo-100 hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                      >
                        {processScan.isPending ? 'Processing...' : 'Process Scan'}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 pb-5 sm:px-6">
            <p className="text-sm text-gray-500">No scans found. Upload your first scan to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}