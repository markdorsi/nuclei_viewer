import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

interface User {
  id: string
  email: string
  name: string
  avatar?: string
  tenantId?: string
  role?: string
}

interface Tenant {
  id: string
  name: string
  slug: string
}

interface AuthContextType {
  user: User | null
  tenant: Tenant | null
  tenants: Tenant[]
  loading: boolean
  login: () => void
  logout: () => void
  switchTenant: (tenantId: string) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem('authToken')
      if (!token) {
        // No token found
        setUser(null)
        setTenant(null)
        setTenants([])
        setLoading(false)
        return
      }

      // Decode JWT token to get user info (basic decode, not verification)
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        
        // Check if token is expired
        if (payload.exp && payload.exp < Date.now() / 1000) {
          localStorage.removeItem('authToken')
          setUser(null)
          setTenant(null)
          setTenants([])
          setLoading(false)
          return
        }

        // Set user from token payload
        setUser({
          id: payload.userId || payload.sub,
          email: payload.email,
          name: payload.name,
          avatar: payload.picture,
          tenantId: payload.tenantId,
        })

        // Set tenant from token payload
        setTenant({
          id: payload.tenantId,
          name: payload.domain ? payload.domain.split('.')[0].toUpperCase() + ' Organization' : 'Default Tenant',
          slug: payload.tenantSlug || payload.domain?.split('.')[0] || 'default'
        })
        
        setTenants([{
          id: payload.tenantId,
          name: payload.domain ? payload.domain.split('.')[0].toUpperCase() + ' Organization' : 'Default Tenant',
          slug: payload.tenantSlug || payload.domain?.split('.')[0] || 'default'
        }])
        
      } catch (decodeError) {
        console.error('Failed to decode token:', decodeError)
        localStorage.removeItem('authToken')
        setUser(null)
        setTenant(null)
        setTenants([])
      }
    } catch (error) {
      console.error('Auth check failed:', error)
      setUser(null)
      setTenant(null)
      setTenants([])
    } finally {
      setLoading(false)
    }
  }

  const login = () => {
    window.location.href = '/login.html'
  }

  const logout = async () => {
    try {
      // Remove token from localStorage
      localStorage.removeItem('authToken')
      setUser(null)
      setTenant(null)
      setTenants([])
      navigate('/login')
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  const switchTenant = async (tenantId: string) => {
    try {
      const res = await fetch('/api/auth/switch-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
        credentials: 'include' // Include cookies
      })
      if (res.ok) {
        const data = await res.json()
        setTenant(data.tenant)
        window.location.reload()
      }
    } catch (error) {
      console.error('Tenant switch failed:', error)
    }
  }

  return (
    <AuthContext.Provider value={{ user, tenant, tenants, loading, login, logout, switchTenant }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}