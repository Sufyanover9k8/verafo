import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/shell/app-shell'
import { Skeleton } from './components/primitives/Skeleton'
import { useSession } from './lib/session'
import { useStoreScope } from './lib/store'

// Dashboard pulls in recharts (charts) — lazy-load it like every other route so
// the initial bundle every user downloads (including on the login screen)
// doesn't carry chart-library weight before we even know they're signed in.
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const Auth = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Auth })))
const ResetPassword = lazy(() =>
  import('./pages/ResetPassword').then((m) => ({ default: m.ResetPassword })),
)
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

export function App() {
  const location = useLocation()
  const { session, loading: sessionLoading, isPasswordRecovery } = useSession()
  const { role, loading: scopeLoading, needsStore } = useStoreScope()

  const isAdmin = role === 'admin'

  const shell = (
    <AppShell>
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
    </AppShell>
  )

  // 1. Still confirming whether anyone is signed in.
  if (sessionLoading) return <RouteFallback />

  // A "reset your password" email link creates a real session, so without
  // this check step 2 below would just drop the user straight onto the
  // dashboard instead of letting them set a new password.
  if (isPasswordRecovery) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <ResetPassword />
      </Suspense>
    )
  }

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
