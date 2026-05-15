import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <p style={{ color: '#6B6B6B', fontFamily: 'sans-serif' }}>Cargando…</p>
    </div>
  )

  if (!user) return <Navigate to="/login" replace />

  return children
}
