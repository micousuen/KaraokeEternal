import React, { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { fetchAccount } from 'store/modules/user'
import About from '../../components/About/About'
import ProfilePanel from '../../features/profile/ProfilePanel'
import SettingsPanel from '../../features/settings/SettingsPanel'
import RoomsPanel from '../../features/rooms/RoomsPanel'
import UsersPanel from '../../features/users/UsersPanel'
import ProcessingPanel from '../../features/processing/ProcessingPanel'

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
