// API utility with automatic authentication
export const apiCall = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('authToken')
  
  const headers: HeadersInit = {
    ...options.headers,
  }
  
  // Only set Content-Type if not FormData (let browser set it for FormData)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  
  console.log('🔵 API call:', url, 'with token:', !!token)
  console.log('🔵 Request headers:', headers)
  console.log('🔵 Request options:', options)
  
  const response = await fetch(url, {
    ...options,
    headers,
  })
  
  console.log('🟢 API response:', response.status, response.statusText)
  console.log('🟢 Response headers:', Object.fromEntries(response.headers.entries()))
  
  if (!response.ok) {
    const errorText = await response.text()
    console.error('API error response:', errorText)
    throw new Error(`API call failed: ${response.status} ${response.statusText}`)
  }
  
  const contentType = response.headers.get('content-type')
  console.log('🟢 Content-Type:', contentType)
  
  if (contentType && contentType.includes('application/json')) {
    const data = await response.json()
    console.log('🟢 JSON Response data:', data)
    return data
  }
  
  const textData = await response.text()
  console.log('🟢 Text Response data:', textData)
  return response
}

export default apiCall