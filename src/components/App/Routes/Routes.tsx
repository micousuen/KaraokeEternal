import React from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router'
import { useAppSelector } from 'store/hooks'

const AccountView = React.lazy(() => import('routes/Account/views/AccountView'))
const LibraryView = React.lazy(() => import('routes/Library/views/LibraryView'))
const QueueView = React.lazy(() => import('routes/Queue/views/QueueView'))
const PlayerView = React.lazy(() => import('routes/Player/views/PlayerView'))

const AppRoutes = () => (
  <Routes>
    <Route path='/account' element={<AccountView />} />
    <Route
      path='/library'
      element={(
        <RequireRoom path='/library' redirectTo='/account'>
          <LibraryView />
        </RequireRoom>
      )}
    />
    <Route
      path='/queue'
      element={(
        <RequireRoom path='/queue' redirectTo='/account'>
          <QueueView />
        </RequireRoom>
      )}
    />
    <Route
      path='/player'
      element={(
        <RequireRoom path='/player' redirectTo='/account'>
          <PlayerView />
        </RequireRoom>
      )}
    />
    <Route
      path='/'
      element={(
        <Navigate
          to={{
            pathname: '/account',
            search: window.location.search, // pass through search params (e.g. roomId)
          }}
          replace
        />
      )}
    />
  </Routes>
)

export default AppRoutes

interface RequireRoomProps {
  children: React.ReactNode
  path: string
  redirectTo: string
}

const RequireRoom = ({
  children,
  path,
  redirectTo,
}: RequireRoomProps) => {
  const { isAdmin, roomId, userId } = useAppSelector(state => state.user)
  const location = useLocation()

  if (path === '/player' && !isAdmin) {
    return <Navigate to='/' replace />
  }

  if (userId === null) {
    // set their originally-desired location in query parameter
    const params = new URLSearchParams(location.search)
    params.set('redirect', path)

    return <Navigate to={redirectTo + '?' + params.toString()} replace />
  }

  if (typeof roomId !== 'number') {
    return <Navigate to={redirectTo} replace />
  }

  return children
}
