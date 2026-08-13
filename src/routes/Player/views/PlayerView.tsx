import React, { useEffect } from 'react'
import screenfull from 'screenfull'
import combinedReducer from 'store/reducers'
import store from 'store/store'
import { useAppSelector, useAppDispatch } from 'store/hooks'
import Button from 'components/Button/Button'
import playerReducer, { playerClaim } from '../modules/player'
import playerVisualizerReducer from '../modules/playerVisualizer'
import PlayerController from '../components/PlayerController/PlayerController'
import { fetchCurrentRoom } from 'store/modules/rooms'
import styles from './PlayerView.css'

combinedReducer.inject({ reducerPath: 'player', reducer: playerReducer })
combinedReducer.inject({ reducerPath: 'playerVisualizer', reducer: playerVisualizerReducer })
// replaceReducer dispatches Redux's init action so the injected state exists
// before this route's first render.
store.replaceReducer(combinedReducer)

const PlayerView = () => {
  const { innerWidth, innerHeight, headerHeight, footerHeight } = useAppSelector(state => state.ui)
  const viewportHeight = innerHeight - headerHeight - footerHeight
  const dispatch = useAppDispatch()

  const isSuperseded = useAppSelector(state => state.player._isSuperseded)

  // once per mount
  useEffect(() => {
    dispatch(fetchCurrentRoom())
  }, [dispatch])

  // set page title
  useEffect(() => {
    document.title = 'Karaoke Eternal | Player'
  }, [])

  return (
    <div style={{ overflow: 'hidden' }}>
      <div
        id='player-fs-container'
        className={styles.container}
        style={{
          top: screenfull.isFullscreen ? 0 : headerHeight,
          width: innerWidth,
          height: screenfull.isFullscreen ? innerHeight : viewportHeight,
          overflow: 'hidden',
        }}
      >
        {isSuperseded
          ? (
              <div className={styles.takeover}>
                <h1>Player taken over</h1>
                <p>Another screen is now playing for this room.</p>
                <Button variant='primary' onClick={() => dispatch(playerClaim())}>
                  Take Over Again
                </Button>
              </div>
            )
          : (
              <PlayerController
                width={innerWidth}
                height={screenfull.isFullscreen ? innerHeight : viewportHeight}
              />
            )}
      </div>
    </div>
  )
}

export default PlayerView
