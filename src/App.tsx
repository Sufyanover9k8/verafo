import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { Skeleton } from './components/primitives/Skeleton'
import { LayoutTickContext } from './lib/motion'
import { useSession } from './lib/session'
import { useStoreScope } from './lib/store'

// Dashboard pulls in recharts (charts) — lazy-load it like every other route so
// the initial bundle every user downloads (including on the login screen)
// doesn't carry chart-library weight before we even know they're signed in.
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const Auth = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Auth })))
const Onboarding = lazy(() => import('./pages/Onboarding').then((m) => ({ default: m.Onboarding })))
const Orders = lazy(() => import('./pages/Orders').then((m) => ({ default: m.Orders })))
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
    <div className="stack">
      <div className="kpi-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div className="card" key={i}>
            <Skeleton width="50%" height={12} />
            <Skeleton width="70%" height={22} />
            <Skeleton width="100%" height={28} />
          </div>
        ))}
      </div>
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
  const { session, loading: sessionLoading } = useSession()
  const { role, loading: scopeLoading, needsStore } = useStoreScope()

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

  const isAdmin = role === 'admin'

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
            <Route path="/orders" element={<Orders />} />
            <Route path="/lookup" element={<Lookup />} />
            <Route path="/orders/new" element={<NewOrder />} />
            <Route path="/orders/pending" element={<Outcomes />} />
            <Route path="/outcomes" element={<Navigate to="/orders/pending" replace />} />
            <Route path="/map" element={<BuyerMap />} />
            {isAdmin && <Route path="/stores" element={<Stores />} />}
            {isAdmin && <Route path="/stores/add" element={<AddStore />} />}
            {isAdmin && <Route path="/stores/:id" element={<StoreDashboard />} />}
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

  // 1. Still confirming whether anyone is signed in.
  if (sessionLoading) return <RouteFallback />

  // 2. Not signed in → the login screen.
  if (!session && location.pathname !== '/login') {
    return <Navigate to="/login" replace />
  }
  if (location.pathname === '/login') {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Auth />
      </Suspense>
    )
  }

  // 3. Signed in — resolving role + which stores this user owns.
  if (scopeLoading) return <RouteFallback />

  // 4. A merchant with no store yet → one-step onboarding.
  if (needsStore) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Onboarding />
      </Suspense>
    )
  }

  return shell
}
