import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../hooks/useAuth";
import { CloudArrowUpIcon, DocumentIcon, XCircleIcon, TrashIcon, ExclamationTriangleIcon, BuildingOfficeIcon, ChevronDownIcon, PlusIcon } from "@heroicons/react/24/outline";

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB max
const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks

export default function Scans() {
  const { tenant } = useAuth();
  const token = localStorage.getItem('authToken');
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [scanName, setScanName] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'complete' | 'error'>('idle');
  const [error, setError] = useState<string>("");
  const [currentChunk, setCurrentChunk] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [selectedScans, setSelectedScans] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletingScans, setDeletingScans] = useState<Set<string>>(new Set());
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);
  const [pollingAttempt, setPollingAttempt] = useState(0);
  const [maxPollingAttempts, setMaxPollingAttempts] = useState(0);
  const [showCompanySelector, setShowCompanySelector] = useState<string | null>(null);
  const [isAssociating, setIsAssociating] = useState(false);
  const [selectedUploadCompany, setSelectedUploadCompany] = useState<string>('');
  const [showCreateCompany, setShowCreateCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanySlug, setNewCompanySlug] = useState('');
  const [isCreatingCompany, setIsCreatingCompany] = useState(false);
  
  const uploadIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Query to list scans (keeping existing functionality)
  console.log('🔒 Auth state - Token exists:', !!token, 'Tenant:', tenant?.slug)
  
  const { data: scans, isLoading: isLoadingScans } = useQuery({
    queryKey: ['scans', tenant?.slug],
    queryFn: async () => {
      console.log('🔍 Fetching scans for tenant:', tenant?.slug)
      const timestamp = new Date().getTime();
      const url = `/api/t/${tenant?.slug}/scans/list?_t=${timestamp}`;
      console.log('🌐 Request URL:', url)
      
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cache-Control': 'no-cache'
        }
      })
      
      console.log('🌐 Response status:', res.status)
      console.log('🌐 Response headers:', Object.fromEntries(res.headers.entries()))
      
      if (!res.ok) {
        const errorText = await res.text()
        console.error('🚨 API Error:', res.status, errorText)
        throw new Error(`Failed to fetch scans: ${res.status}`)
      }
      
      const data = await res.json()
      console.log('📄 Scans fetched:', data)
      console.log('📊 Number of scans:', Array.isArray(data) ? data.length : 'Not array')
      
      return data
    },
    enabled: !!token && !!tenant?.slug
  })

  const { data: companies } = useQuery({
    queryKey: ['companies', tenant?.slug],
    queryFn: async () => {
      const res = await fetch(`/api/t/${tenant?.slug}/companies`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (!res.ok) throw new Error('Failed to fetch companies')
      return res.json()
    },
    enabled: !!token && !!tenant?.slug
  })
  
  console.log('📊 Query state - Loading:', isLoadingScans, 'Data count:', scans?.length)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (showCompanySelector) {
        setShowCompanySelector(null);
      }
    };
    
    if (showCompanySelector) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showCompanySelector]);

  const calculateChunks = (fileSize: number, chunkSize: number) => {
    return Math.ceil(fileSize / chunkSize);
  }

  const uploadChunk = async (
    file: File,
    uploadId: string,
    chunkIndex: number,
    totalChunks: number,
    chunkSize: number
  ) => {
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    
    const response = await fetch(
      `/api/t/${tenant?.slug}/scans/chunk?uploadId=${uploadId}&index=${chunkIndex}&total=${totalChunks}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
        },
        body: chunk,
        signal: abortControllerRef.current?.signal
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to upload chunk ${chunkIndex + 1}`);
    }

    return response.json();
  }

  const startChunkedUpload = async () => {
    if (!selectedFile) return;

    setError("");
    setUploadStatus('uploading');
    setUploadProgress(0);
    abortControllerRef.current = new AbortController();

    try {
      // Step 1: Start upload session
      const startRes = await fetch(`/api/t/${tenant?.slug}/scans/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          scanName: scanName || selectedFile.name,
          contentType: selectedFile.type || "application/octet-stream",
          fileSize: selectedFile.size,
          companyId: selectedUploadCompany || null,
          companyName: selectedUploadCompany ? companies?.find((c: any) => c.id === selectedUploadCompany)?.name : null
        }),
      });

      if (!startRes.ok) {
        const error = await startRes.json();
        throw new Error(error.message || error.error || "Failed to start upload");
      }

      const { uploadId, maxChunkBytes } = await startRes.json();
      uploadIdRef.current = uploadId;
      
      const chunkSize = maxChunkBytes || DEFAULT_CHUNK_SIZE;
      const chunks = calculateChunks(selectedFile.size, chunkSize);
      setTotalChunks(chunks);

      // Step 2: Upload chunks
      for (let i = 0; i < chunks; i++) {
        if (abortControllerRef.current?.signal.aborted) {
          throw new Error('Upload aborted');
        }

        setCurrentChunk(i + 1);
        
        await uploadChunk(selectedFile, uploadId, i, chunks, chunkSize);
        
        const progress = Math.round(((i + 1) / chunks) * 100);
        setUploadProgress(progress);
      }

      // Step 3: Complete upload
      const completeRes = await fetch(`/api/t/${tenant?.slug}/scans/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ uploadId }),
      });

      if (!completeRes.ok) {
        const error = await completeRes.json();
        throw new Error(error.message || "Failed to complete upload");
      }

      setUploadStatus('complete');
      const uploadedScanName = scanName || selectedFile?.name;
      setSelectedFile(null);
      setScanName("");
      setSelectedUploadCompany('');
      uploadIdRef.current = null;
      setIsProcessingUpload(true);
      
      console.log('✅ Upload complete, invalidating cache for tenant:', tenant?.slug)
      
      // Polling mechanism to wait for scan to appear
      let attempts = 0;
      const maxAttempts = 12; // Poll for up to 2 minutes (12 * 10s)
      setMaxPollingAttempts(maxAttempts);
      
      while (attempts < maxAttempts) {
        attempts++;
        setPollingAttempt(attempts);
        console.log(`🔄 Polling attempt ${attempts}/${maxAttempts} for scan to appear`);
        
        // Wait before checking (exponential backoff)
        const delay = Math.min(1000 + (attempts * 500), 5000); // 1s, 1.5s, 2s... max 5s
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Force cache invalidation and refetch
        await queryClient.invalidateQueries({ queryKey: ["scans", tenant?.slug] });
        await queryClient.refetchQueries({ queryKey: ["scans", tenant?.slug] });
        
        // Check if our scan appeared
        const currentScans = queryClient.getQueryData(["scans", tenant?.slug]) as any[];
        const scanAppeared = currentScans?.some(scan => 
          scan.key.includes(uploadedScanName?.split('.')[0]) || 
          scan.key.includes(new Date().toISOString().split('T')[0])
        );
        
        if (scanAppeared) {
          console.log('✅ Scan appeared after', attempts, 'attempts');
          break;
        }
        
        if (attempts >= maxAttempts) {
          console.log('⚠️ Scan did not appear after maximum polling attempts');
          setError('Upload completed but scan is taking longer than expected to appear. Please refresh the page.');
        }
      }
      
      setIsProcessingUpload(false);
      setPollingAttempt(0);
      setMaxPollingAttempts(0);
      
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.message || "Upload failed");
      setUploadStatus('error');
      setIsProcessingUpload(false);
      setPollingAttempt(0);
      setMaxPollingAttempts(0);
      
      // Try to abort the upload session
      if (uploadIdRef.current) {
        try {
          await fetch(`/api/t/${tenant?.slug}/scans/abort`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ uploadId: uploadIdRef.current }),
          });
        } catch (abortErr) {
          console.error('Failed to abort upload:', abortErr);
        }
      }
    }
  };

  const cancelUpload = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    if (uploadIdRef.current) {
      try {
        await fetch(`/api/t/${tenant?.slug}/scans/abort`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ uploadId: uploadIdRef.current }),
        });
      } catch (err) {
        console.error('Failed to abort upload:', err);
      }
    }
    
    setUploadStatus('idle');
    setUploadProgress(0);
    setCurrentChunk(0);
    setTotalChunks(0);
    uploadIdRef.current = null;
  };

  const deleteScans = async () => {
    if (selectedScans.size === 0) return;
    
    const scanKeys = Array.from(selectedScans);
    setIsDeleting(true);
    setDeletingScans(new Set(scanKeys));
    setError("");
    
    try {
      console.log('🗑️ Deleting scans:', scanKeys);
      console.log('🔑 Token:', token ? 'present' : 'missing');
      console.log('🏢 Tenant:', tenant?.slug);
      
      const response = await fetch(`/api/t/${tenant?.slug}/scans/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ scanKeys })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete scans');
      }

      const result = await response.json();
      console.log('Delete result:', result);
      
      // Clear selection and refresh the list
      setSelectedScans(new Set());
      
      // Add a small delay to ensure the delete operation completes on the server
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Force a complete cache invalidation and refetch
      await queryClient.invalidateQueries({ queryKey: ["scans", tenant?.slug] });
      await queryClient.refetchQueries({ queryKey: ["scans", tenant?.slug] });
      
    } catch (err: any) {
      console.error('Delete error:', err);
      setError(err.message || "Failed to delete scans");
    } finally {
      setIsDeleting(false);
      setDeletingScans(new Set());
    }
  };

  const toggleScanSelection = (scanKey: string) => {
    const newSelection = new Set(selectedScans);
    if (newSelection.has(scanKey)) {
      newSelection.delete(scanKey);
    } else {
      newSelection.add(scanKey);
    }
    setSelectedScans(newSelection);
  };

  const selectAllScans = () => {
    if (scans && scans.length > 0) {
      setSelectedScans(new Set(scans.map((scan: any) => scan.key)));
    }
  };

  const clearSelection = () => {
    setSelectedScans(new Set());
  };

  const createCompany = async () => {
    if (!newCompanyName || !newCompanySlug) return null;
    
    setIsCreatingCompany(true);
    try {
      const response = await fetch(`/api/t/${tenant?.slug}/companies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          name: newCompanyName, 
          slug: newCompanySlug 
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create company');
      }

      const newCompany = await response.json();
      
      // Refresh companies list
      await queryClient.invalidateQueries({ queryKey: ["companies", tenant?.slug] });
      
      // Select the new company for upload
      setSelectedUploadCompany(newCompany.id);
      setShowCreateCompany(false);
      setNewCompanyName('');
      setNewCompanySlug('');
      
      return newCompany.id;
    } catch (err: any) {
      console.error('Create company error:', err);
      setError(err.message || "Failed to create company");
      return null;
    } finally {
      setIsCreatingCompany(false);
    }
  };

  const associateScanWithCompany = async (scanKey: string, companyId: string) => {
    setIsAssociating(true);
    setError("");
    
    try {
      const response = await fetch(`/api/t/${tenant?.slug}/scans/associate`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ scanKey, companyId })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to associate scan with company');
      }

      // Refresh scans list to show updated associations
      await queryClient.invalidateQueries({ queryKey: ["scans", tenant?.slug] });
      setShowCompanySelector(null);
      
    } catch (err: any) {
      console.error('Association error:', err);
      setError(err.message || "Failed to associate scan with company");
    } finally {
      setIsAssociating(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large. Maximum size is ${Math.round(MAX_FILE_SIZE / (1024 * 1024 * 1024))}GB`)
      return
    }

    setError('')
    setUploadStatus('idle')
    setUploadProgress(0)
    setSelectedFile(file)
    setCurrentChunk(0)
    setTotalChunks(0)
    
    // Auto-generate scan name if not provided
    if (!scanName) {
      const today = new Date().toISOString().split('T')[0]
      const baseName = file.name.split('.')[0]
      setScanName(`${baseName}-${today}`)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Scan Upload</h1>
        <p className="mt-2 text-sm text-gray-600">
          Upload security scan files up to 5GB using chunked uploads. Files are stored in Netlify Blobs with multi-tenant isolation.
        </p>
      </div>

      {/* Upload Card */}
      <div className="bg-white shadow sm:rounded-lg mb-8">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Upload Scan File</h3>
          
          {/* Scan Name Input */}
          <div className="mb-4">
            <label htmlFor="scan-name" className="block text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              type="text"
              id="scan-name"
              value={scanName}
              onChange={(e) => setScanName(e.target.value)}
              disabled={uploadStatus === 'uploading'}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm disabled:opacity-50"
              placeholder="nuclei-2024-09-05.jsonl"
            />
          </div>

          {/* Company Selector */}
          <div className="mb-4">
            <label htmlFor="company-select" className="block text-sm font-medium text-gray-700">
              Company <span className="text-gray-500">(Optional)</span>
            </label>
            {!showCreateCompany ? (
              <div className="mt-1 flex space-x-2">
                <select
                  id="company-select"
                  value={selectedUploadCompany}
                  onChange={(e) => setSelectedUploadCompany(e.target.value)}
                  disabled={uploadStatus === 'uploading'}
                  className="flex-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm disabled:opacity-50"
                >
                  <option value="">No Company</option>
                  {companies?.map((company: any) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowCreateCompany(true)}
                  disabled={uploadStatus === 'uploading'}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  <PlusIcon className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="mt-1 space-y-2 p-3 border border-indigo-200 rounded-md bg-indigo-50">
                <div className="text-sm font-medium text-gray-700">Create New Company</div>
                <input
                  type="text"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  disabled={isCreatingCompany}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm disabled:opacity-50"
                  placeholder="Company Name"
                />
                <input
                  type="text"
                  value={newCompanySlug}
                  onChange={(e) => setNewCompanySlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  disabled={isCreatingCompany}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm disabled:opacity-50"
                  placeholder="company-slug"
                />
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={createCompany}
                    disabled={!newCompanyName || !newCompanySlug || isCreatingCompany}
                    className="flex-1 inline-flex justify-center items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                  >
                    {isCreatingCompany ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateCompany(false);
                      setNewCompanyName('');
                      setNewCompanySlug('');
                    }}
                    disabled={isCreatingCompany}
                    className="flex-1 inline-flex justify-center items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* File Input */}
          <div className="mb-4">
            <label htmlFor="file-upload" className="block text-sm font-medium text-gray-700">
              File
            </label>
            <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
              <div className="space-y-1 text-center">
                <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400" />
                <div className="flex text-sm text-gray-600">
                  <label
                    htmlFor="file-upload"
                    className="relative cursor-pointer bg-white rounded-md font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-indigo-500"
                  >
                    <span>Upload a file</span>
                    <input
                      id="file-upload"
                      name="file-upload"
                      type="file"
                      className="sr-only"
                      accept=".json,.jsonl,.xml,.txt"
                      onChange={handleFileSelect}
                      disabled={uploadStatus === 'uploading'}
                    />
                  </label>
                  <p className="pl-1">or drag and drop</p>
                </div>
                <p className="text-xs text-gray-500">
                  JSON, JSONL, XML, TXT up to 5GB
                </p>
              </div>
            </div>
          </div>

          {/* Selected File Info */}
          {selectedFile && (
            <div className="mb-4 p-3 bg-gray-50 rounded-md">
              <p className="text-sm text-gray-900">
                <strong>Selected:</strong> {selectedFile.name} ({formatFileSize(selectedFile.size)})
              </p>
              {totalChunks > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Will be uploaded in {totalChunks} chunks
                </p>
              )}
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Upload Progress */}
          {uploadStatus === 'uploading' && (
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>Uploading chunk {currentChunk} of {totalChunks}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            </div>
          )}

          {/* Success Message */}
          {uploadStatus === 'complete' && !isProcessingUpload && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-800">Upload complete!</p>
            </div>
          )}

          {/* Processing Message */}
          {isProcessingUpload && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <div className="flex items-center">
                <div className="animate-spin mr-2 h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                <div className="flex-1">
                  <p className="text-sm text-blue-800">Processing upload and waiting for scan to appear...</p>
                  {maxPollingAttempts > 0 && (
                    <p className="text-xs text-blue-600 mt-1">
                      Checking attempt {pollingAttempt} of {maxPollingAttempts} (scans can take up to 2 minutes to appear)
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            {uploadStatus !== 'uploading' && !isProcessingUpload ? (
              <button
                onClick={startChunkedUpload}
                disabled={!selectedFile || isProcessingUpload}
                className="inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CloudArrowUpIcon className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
                Upload
              </button>
            ) : (
              <button
                onClick={cancelUpload}
                className="inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                <XCircleIcon className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
                Cancel Upload
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scans List */}
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6 relative">
          {/* Loading overlay during delete */}
          {isDeleting && (
            <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10">
              <div className="text-center">
                <div className="animate-spin mx-auto h-8 w-8 border-4 border-red-600 border-t-transparent rounded-full mb-2"></div>
                <p className="text-sm text-gray-600">Deleting selected scans...</p>
              </div>
            </div>
          )}
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-900">Uploaded Scans</h3>
            {scans && scans.length > 0 && (
              <div className="flex items-center space-x-2">
                {selectedScans.size > 0 && (
                  <>
                    <span className="text-sm text-gray-600">
                      {selectedScans.size} selected
                    </span>
                    <button
                      onClick={clearSelection}
                      disabled={isDeleting}
                      className="text-sm text-indigo-600 hover:text-indigo-900 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Clear
                    </button>
                    <button
                      onClick={deleteScans}
                      disabled={isDeleting}
                      className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isDeleting ? (
                        <>
                          <div className="animate-spin -ml-0.5 mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                          Deleting...
                        </>
                      ) : (
                        <>
                          <TrashIcon className="-ml-0.5 mr-2 h-4 w-4" aria-hidden="true" />
                          Delete Selected
                        </>
                      )}
                    </button>
                  </>
                )}
                <button
                  onClick={selectAllScans}
                  disabled={isDeleting}
                  className="text-sm text-indigo-600 hover:text-indigo-900 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Select All
                </button>
              </div>
            )}
          </div>
          
          {isLoadingScans ? (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-2 text-sm text-gray-500">Loading scans...</p>
            </div>
          ) : scans?.length > 0 ? (
            <div className="overflow-hidden">
              <ul className="divide-y divide-gray-200">
                {scans.map((scan: any, index: number) => {
                  const isBeingDeleted = deletingScans.has(scan.key);
                  return (
                    <li key={scan.key || index} className={`py-3 transition-all duration-200 ${isBeingDeleted ? 'opacity-60 pointer-events-none bg-red-50' : ''}`}>
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={selectedScans.has(scan.key)}
                          onChange={() => toggleScanSelection(scan.key)}
                          disabled={isDeleting || isBeingDeleted}
                          className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        
                        {isBeingDeleted ? (
                          <div className="relative">
                            <TrashIcon className="h-6 w-6 text-red-400 animate-pulse" />
                            <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping"></div>
                          </div>
                        ) : (
                          <DocumentIcon className="h-6 w-6 text-gray-400" />
                        )}
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className={`text-sm font-medium truncate ${isBeingDeleted ? 'text-red-600 line-through' : 'text-gray-900'}`}>
                                {scan.key.split('/').pop()}
                              </p>
                              <div className="flex items-center space-x-4">
                                <p className={`text-sm ${isBeingDeleted ? 'text-red-400' : 'text-gray-500'}`}>
                                  {formatFileSize(scan.size)} • {formatDate(scan.uploadedAt)}
                                </p>
                                {!isBeingDeleted && (
                                  <div className="relative">
                                    <button
                                      onClick={() => setShowCompanySelector(showCompanySelector === scan.key ? null : scan.key)}
                                      disabled={isAssociating}
                                      className="inline-flex items-center space-x-1 text-xs text-indigo-600 hover:text-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 rounded disabled:opacity-50"
                                    >
                                      <BuildingOfficeIcon className="h-3 w-3" />
                                      <span>{scan.companyName || 'No Company'}</span>
                                      <ChevronDownIcon className="h-3 w-3" />
                                    </button>
                                    
                                    {showCompanySelector === scan.key && (
                                      <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-10 max-h-40 overflow-y-auto">
                                        <div className="p-1">
                                          <button
                                            onClick={() => associateScanWithCompany(scan.key, '')}
                                            disabled={isAssociating}
                                            className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 rounded disabled:opacity-50"
                                          >
                                            No Company
                                          </button>
                                          {companies?.map((company: any) => (
                                            <button
                                              key={company.id}
                                              onClick={() => associateScanWithCompany(scan.key, company.id)}
                                              disabled={isAssociating}
                                              className={`w-full text-left px-3 py-2 text-xs rounded disabled:opacity-50 ${
                                                scan.companyId === company.id 
                                                  ? 'bg-indigo-100 text-indigo-900' 
                                                  : 'text-gray-700 hover:bg-gray-100'
                                              }`}
                                            >
                                              {company.name}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                            {isBeingDeleted && (
                              <div className="flex items-center ml-3">
                                <ExclamationTriangleIcon className="h-4 w-4 text-red-500 mr-1" />
                                <span className="text-xs text-red-600 font-medium bg-red-100 px-2 py-1 rounded-full">
                                  DELETING
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="text-center py-8">
              <DocumentIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-sm text-gray-500">No scans uploaded yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}