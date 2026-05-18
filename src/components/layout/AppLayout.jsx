import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

export default function AppLayout() {
  const { perfil, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.logo}>Gestor<span style={styles.logoAccent}>Doc</span></div>
        <nav style={styles.nav}>
          <NavLink to="/clientes" style={navStyle}>Clientes</NavLink>
        </nav>
        <div style={styles.userArea}>
          <span style={styles.userName}>{perfil?.nombre ?? ''}</span>
          <button onClick={handleLogout} style={styles.logoutBtn}>Salir</button>
        </div>
      </header>

      <main style={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}

const navStyle = ({ isActive }) => ({
  fontSize: '0.88rem',
  fontWeight: 600,
  color: isActive ? '#fff' : 'rgba(255,255,255,0.7)',
  textDecoration: 'none',
  padding: '4px 0',
  borderBottom: isActive ? '2px solid #A5D6A7' : '2px solid transparent',
})

const styles = {
  shell: { minHeight: '100vh', background: '#F5F3EE' },
  header: {
    background: '#1A472A',
    color: '#fff',
    padding: '0 32px',
    height: '56px',
    display: 'flex',
    alignItems: 'center',
    gap: '32px',
  },
  logo: {
    fontFamily: 'Georgia, serif',
    fontWeight: 700,
    fontSize: '1.2rem',
    color: '#fff',
    marginRight: '8px',
  },
  logoAccent: { color: '#A5D6A7' },
  nav: { flex: 1, display: 'flex', gap: '24px' },
  userArea: { display: 'flex', alignItems: 'center', gap: '14px' },
  userName: { fontSize: '0.82rem', color: 'rgba(255,255,255,0.8)' },
  logoutBtn: {
    background: 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.2)',
    color: '#fff',
    borderRadius: '6px',
    padding: '5px 12px',
    fontSize: '0.78rem',
    cursor: 'pointer',
  },
  main: { padding: '0' },
}
