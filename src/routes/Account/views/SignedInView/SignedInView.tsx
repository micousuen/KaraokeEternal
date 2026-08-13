import React, { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { fetchAccount } from 'store/modules/user'
import About from '../../components/About/About'
import ProfilePanel from '../../features/profile/ProfilePanel'

const SettingsPanel = React.lazy(() => import('../../features/settings/SettingsPanel'))
const RoomsPanel = React.lazy(() => import('../../features/rooms/RoomsPanel'))
const UsersPanel = React.lazy(() => import('../../features/users/UsersPanel'))
const ProcessingPanel = React.lazy(() => import('../../features/processing/ProcessingPanel'))

const SignedInView = () => {
  const { isAdmin } = useAppSelector(state => state.user)
  const dispatch = useAppDispatch()

  // once per mount
  useEffect(() => {
    (async () => dispatch(fetchAccount()))()
  }, [dispatch])

  return (
    <>
      {isAdmin
        && <RoomsPanel />}

      {isAdmin
        && <UsersPanel />}

      {isAdmin
        && <SettingsPanel />}

      {isAdmin
        && <ProcessingPanel />}

      <ProfilePanel />

      <About />
    </>
  )
}

export default SignedInView
