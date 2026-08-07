import React from 'react'
import clsx from 'clsx'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { Routes, Route, useLocation } from 'react-router'

import { requestScanStop } from 'store/modules/prefs'
import LibraryHeader from 'routes/Library/components/LibraryHeader/LibraryHeader'
import PlaybackCtrl from './PlaybackCtrl/PlaybackCtrl'
import ProgressBar from './ProgressBar/ProgressBar'
import styles from './Header.css'

// component
const Header = React.forwardRef<HTMLDivElement>((_, ref) => {
  const isAdmin = useAppSelector(state => state.user.isAdmin)
  const isInRoom = useAppSelector(state => typeof state.user.roomId === 'number')
  const isScanning = useAppSelector(state => state.prefs.isScanning)
  const scannerText = useAppSelector(state => state.prefs.scannerText)
  const scannerPct = useAppSelector(state => state.prefs.scannerPct)

  const location = useLocation()
  const isPlayer = location.pathname.replace(/\/$/, '').endsWith('/player')

  const dispatch = useAppDispatch()
  const cancelScan = () => dispatch(requestScanStop())

  return (
    <div className={clsx(styles.container, 'bg-blur')} ref={ref}>
      {isInRoom
        && <PlaybackCtrl />}

      {isAdmin && !isPlayer
        && (
          <ProgressBar
            isActive={isScanning}
            onCancel={cancelScan}
            pct={scannerPct}
            text={scannerText}
          />
        )}

      <Routes>
        <Route path='/library' element={<LibraryHeader />} />
      </Routes>
    </div>
  )
})

Header.displayName = 'Header'

export default Header
