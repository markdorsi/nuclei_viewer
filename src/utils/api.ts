// API utility with automatic authentication
export const apiCall = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('authToken')
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  }
  
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  
  console.log('API call:', url, 'with token:', !!token)
  
  const response = await fetch(url, {
    ...options,
    headers,
  })
  
  console.log('API response:', response.status, response.statusText)
  
  if (!response.ok) {
    const errorText = await response.text()
    console.error('API error response:', errorText)
    throw new Error(`API call failed: ${response.status} ${response.statusText}`)
  }
  
  const contentType = response.headers.get('content-type')
  if (contentType && contentType.includes('application/json')) {
    return response.json()
  }
  
  return response
}

export default apiCall