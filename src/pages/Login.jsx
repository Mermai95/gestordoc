import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function Login() {
  const { login } = useAuth()
  const navigate  = useNavigate()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState(null)
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login({ email, password })
      navigate('/clientes')
    } catch (err) {
      setError('Email o contraseña incorrectos')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>Gestor<span style={styles.logoAccent}>Doc</span></div>
        <p style={styles.subtitle}>Acceso para gestores</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              style={styles.input}
              placeholder="tu@gestoria.com"
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={styles.input}
              placeholder="••••••••"
            />
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} style={styles.btn}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#F5F3EE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  card: {
    background: '#fff',
    border: '1px solid #D8D4CB',
    borderRadius: '12px',
    padding: '40px 36px',
    width: '100%',
    maxWidth: '380px',
  },
  logo: {
    fontFamily: 'Georgia, serif',
    fontWeight: 700,
    fontSize: '1.6rem',
    color: '#1A472A',
    marginBottom: '6px',
  },
  logoAccent: { color: '#52b788' },
  subtitle: {
    fontSize: '0.85rem',
    color: '#6B6B6B',
    marginBottom: '28px',
  },
  form: { display: 'flex', flexDirection: 'column', gap: '16px' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '0.82rem', fontWeight: 600, color: '#1C1C1C' },
  input: {
    padding: '10px 12px',
    border: '1px solid #D8D4CB',
    borderRadius: '8px',
    fontSize: '0.9rem',
    outline: 'none',
    fontFamily: 'inherit',
  },
  error: {
    fontSize: '0.82rem',
    color: '#E65100',
    background: '#FFF3E0',
    padding: '8px 12px',
    borderRadius: '6px',
  },
  btn: {
    background: '#1A472A',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '12px',
    fontSize: '0.9rem',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: '4px',
  },
}
