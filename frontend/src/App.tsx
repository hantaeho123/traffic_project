import { Component, type ReactNode } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import AppsPage from './pages/AppsPage'
import CameraDetailPage from './pages/CameraDetailPage'
import CamerasPage from './pages/CamerasPage'
import MapPage from './pages/MapPage'
import RegisterPage from './pages/RegisterPage'
import StatsPage from './pages/StatsPage'
import SystemPage from './pages/SystemPage'

const NAV = [
  { to: '/', label: '지도' },
  { to: '/cameras', label: '전체 보기' },
  { to: '/register', label: 'CCTV 등록' },
  { to: '/stats', label: '점유율 통계' },
  { to: '/apps', label: '응용 분석' },
  { to: '/system', label: '시스템' },
]

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error)
      return (
        <div className="page">
          <h1>화면 오류</h1>
          <pre className="error" style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error.stack || this.state.error)}</pre>
          <button onClick={() => this.setState({ error: null })}>다시 시도</button>
        </div>
      )
    return this.props.children
  }
}

export default function App() {
  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">도로 CCTV 혼잡도</span>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <span className="spacer" />
        <span className="muted">점유율 = 차량 픽셀 / 도로 픽셀</span>
      </header>
      <main className="content">
        <ErrorBoundary>
        <Routes>
          <Route path="/" element={<MapPage />} />
          <Route path="/cameras" element={<CamerasPage />} />
          <Route path="/cameras/:id" element={<CameraDetailPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/apps" element={<AppsPage />} />
          <Route path="/system" element={<SystemPage />} />
        </Routes>
        </ErrorBoundary>
      </main>
    </div>
  )
}
