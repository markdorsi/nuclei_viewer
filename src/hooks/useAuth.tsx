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
      const res = await fetch('/api/auth/me', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
        setTenant(data.tenant)
        setTenants(data.tenants || [])
      } else if (res.status === 401) {
        // User not authenticated - clear state
        setUser(null)
        setTenant(null)
        setTenants([])
      } else {
        throw new Error(`Auth check failed: ${res.status}`)
      }
    } catch (error) {
      console.error('Auth check failed:', error)
      // On error, clear auth state
      setUser(null)
      setTenant(null)
      setTenants([])
    } finally {
      setLoading(false)
    }
  }

  const login = () => {
    window.location.href = '/api/auth/login'
  }

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
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