import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Icon } from './components/Icon'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { Dashboard } from './pages/Dashboard'
import { LayoutTickContext } from './lib/motion'

const Auth = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Auth })))
const BulkImport = lazy(() => import('./pages/BulkImport').then((m) => ({ default: m.BulkImport })))
const BuyerMap = lazy(() => import('./pages/BuyerMap').then((m) => ({ default: m.BuyerMap })))
const Chat = lazy(() => import('./pages/Chat').then((m) => ({ default: m.Chat })))
const Lookup = lazy(() => import('./pages/Lookup').then((m) => ({ default: m.Lookup })))
const NewOrder = lazy(() => import('./pages/NewOrder').then((m) => ({ default: m.NewOrder })))
const Outcomes = lazy(() => import('./pages/Outcomes').then((m) => ({ default: m.Outcomes })))
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))
const StoreDashboard = lazy(() => import('./pages/StoreDashboard').then((m) => ({ default: m.StoreDashboard })))
const Stores = lazy(() => import('./pages/Stores').then((m) => ({ default: m.Stores })))
const AddStore = lazy(() => import('./pages/AddStore').then((m) => ({ default: m.AddStore })))

function RouteFallback() {
  return (
    <div className="preview-loading card">
      <Icon name="refresh" size={20} className="spin" />
      Loading…
    </div>
  )
}

const SIDEBAR_KEY = 'verafo.sidebarCollapsed'

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    mq.addEventListener?.('change', onChange)
    setMatches(mq.matches)
    return () => mq.removeEventListener?.('change', onChange)
  }, [query])
  return matches
}

export function App() {
  const location = useLocation()
  const belowLg = useMedia('(max-width: 1023px)')
  const belowMd = useMedia('(max-width: 767px)')
  const [userCollapsed, setUserCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1')
  const [mobileOpen, setMobileOpen] = useState(false)

  const collapsed = !belowMd && (belowLg ? true : userCollapsed)
  const [layoutTick, setLayoutTick] = useState(0)
  const firstRender = useRef(true)

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, userCollapsed ? '1' : '0')
  }, [userCollapsed])

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setLayoutTick((t) => t + 1)
  }, [collapsed, mobileOpen])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const shell = (
    <LayoutTickContext.Provider value={layoutTick}>
      <div className={`app${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' sidebar-open' : ''}`}>
      <Sidebar
        collapsed={collapsed}
        mobileOpen={belowMd && mobileOpen}
        onToggle={() => (belowMd ? setMobileOpen(false) : setUserCollapsed((c) => !c))}
        onNavigate={() => setMobileOpen(false)}
      />
      <Topbar onMenu={() => setMobileOpen(true)} />
      <main className={`main${location.pathname === '/chat' ? ' chat-main' : ''}`}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/lookup" element={<Lookup />} />
            <Route path="/orders/new" element={<NewOrder />} />
            <Route path="/orders/pending" element={<Outcomes />} />
            <Route path="/outcomes" element={<Navigate to="/orders/pending" replace />} />
            <Route path="/map" element={<BuyerMap />} />
            <Route path="/stores" element={<Stores />} />
            <Route path="/stores/add" element={<AddStore />} />
            <Route path="/stores/:id" element={<StoreDashboard />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/import" element={<BulkImport />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      </div>
    </LayoutTickContext.Provider>
  )

  if (location.pathname === '/login') {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Auth />
      </Suspense>
    )
  }

  return shell
}
