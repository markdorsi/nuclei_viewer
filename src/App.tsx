import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Findings from './pages/Findings'
import Companies from './pages/Companies'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import Login from './pages/Login'
import AuthCallback from './pages/AuthCallback'

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="findings" element={<Findings />} />
            <Route path="companies" element={<Companies />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </AuthProvider>
    </Router>
  )
}

export default App