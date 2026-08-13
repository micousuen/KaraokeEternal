import React, { useEffect, useCallback } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import Player from '../Player/Player'
import PlayerTextOverlay from '../PlayerTextOverlay/PlayerTextOverlay'
import PlayerQR from '../PlayerQR/PlayerQR'
import getActiveQueue from 'routes/Queue/selectors/getActiveQueue'
import { playerClaim, playerLeave, playerError, playerLoad, playerPlay, playerStatus, type PlayerState } from '../../modules/player'
import getRoomPrefs from '../../selectors/getRoomPrefs'
import type { QueueItem } from 'shared/types'
import ScriptOverlay from '../ScriptOverlay/ScriptOverlay'
import { advanceStatus, findNextUserId, replayStatus, selectPlaybackItems } from '../../lib/playbackQueue'
import useMediaPrecache from '../../hooks/useMediaPrecache'
import socket from 'lib/socket'

interface PlayerControllerProps {
  width: number
  height: number
}

const PlayerController = (props: PlayerControllerProps) => {
  const queue = useAppSelector(getActiveQueue)
  const player = useAppSelector(state => state.player)
  const playerVisualizer = useAppSelector(state => state.playerVisualizer)
  const prefs = useAppSelector(state => state.prefs)
  const roomPrefs = useAppSelector(getRoomPrefs)
  const { current: queueItem, next: nextQueueItem, priority: priorityQueueItem } = selectPlaybackItems(queue, player)

  const dispatch = useAppDispatch()
  const handleStatus = useCallback((status?: Partial<PlayerState>) => dispatch(playerStatus(status)), [dispatch])
  const handleLoad = () => dispatch(playerLoad())
  const handlePlay = () => dispatch(playerPlay())
  const handleError = (msg: string) => {
    dispatch(playerError(msg))
    handleStatus()
  }

  const handleReplay = useCallback((queueId: number) => {
    const nextItem = queue.entities[queueId]
    if (!nextItem) return
    handleStatus(replayStatus(player, nextItem))
  }, [handleStatus, player, queue.entities])

  // Claim ownership once when this player screen opens. Playback status
  // updates (including Play Next) do not affect ownership.
  useEffect(() => {
    const claim = () => {
      dispatch(playerClaim())
      handleStatus()
    }
    claim()
    socket.on('connect', claim)
    return () => {
      socket.off('connect', claim)
    }
  }, [dispatch, handleStatus])

  const handleLoadNext = useCallback(() => {
    handleStatus(advanceStatus(player, queueItem, nextQueueItem))
  }, [handleStatus, nextQueueItem, player, queueItem])

  // "lock in" the next user that isn't the currently up user, if possible
  useEffect(() => {
    if (!player.nextUserId || queueItem?.userId === nextQueueItem?.userId) {
      const nextUserId = findNextUserId(queue, queueItem)
      if (nextUserId !== null) handleStatus({ nextUserId })
    }
  }, [handleStatus, nextQueueItem, player.nextUserId, queue, queueItem])

  // always emit status when any of these change
  useEffect(() => handleStatus({ isVideoKeyingEnabled: queueItem?.isVideoKeyingEnabled }), [
    handleStatus,
    player.audioTrack,
    player.isPlaying,
    player.videoAlpha,
    player.showScript,
    player.volume,
    playerVisualizer,
    queueItem?.isVideoKeyingEnabled,
  ])

  // on unmount
  useEffect(() => () => dispatch(playerLeave()), [dispatch])

  // playing for first time or playing next?
  useEffect(() => {
    if ((player.isPlaying && !queue.result.includes(player.queueId)) || player._isPlayingNext) {
      handleLoadNext()
    }
  }, [handleLoadNext, player.isPlaying, player.queueId, player._isPlayingNext, queue.result])

  // replaying?
  useEffect(() => {
    if (player._isReplayingQueueId !== null) {
      handleReplay(player._isReplayingQueueId)
    }
  }, [handleReplay, player._isReplayingQueueId])

  // queue was exhausted, but is no longer?
  useEffect(() => {
    if (player.isAtQueueEnd && nextQueueItem && player.isPlaying) {
      handleLoadNext()
    }
  }, [handleLoadNext, player.isPlaying, player.isAtQueueEnd, nextQueueItem])

  // retrying after error?
  useEffect(() => {
    if (player.isErrored && player.isPlaying) {
      handleStatus({ isErrored: false })
    }
  }, [handleStatus, player.isErrored, player.isPlaying])

  useMediaPrecache(queue, queueItem, priorityQueueItem, player.isPlaying)

  return (
    <>
      <Player
        audioTrack={player.audioTrack}
        isPlaying={player.isPlaying}
        isVisible={!!queueItem && !player.isErrored && !player.isAtQueueEnd}
        isReplayGainEnabled={prefs.isReplayGainEnabled}
        isVideoKeyingEnabled={!!queueItem?.isVideoKeyingEnabled}
        isWebGLSupported={player.isWebGLSupported}
        mediaId={queueItem ? queueItem.mediaId : null}
        mediaKey={queueItem ? queueItem.queueId : null}
        mediaReplayKey={player._lastReplayTime}
        mediaSeekKey={player._lastSeekTime}
        videoAlpha={player.videoAlpha}
        seekPosition={player._seekPosition}
        onEnd={handleLoadNext}
        onError={handleError}
        onLoad={handleLoad}
        onPlay={handlePlay}
        onStatus={handleStatus}
        rgTrackGain={queueItem ? queueItem.rgTrackGain : null}
        rgTrackPeak={queueItem ? queueItem.rgTrackPeak : null}
        visualizer={playerVisualizer}
        volume={player.volume}
        width={props.width}
        height={props.height}
      />
      <PlayerTextOverlay
        queueItem={queueItem as QueueItem}
        nextQueueItem={nextQueueItem as QueueItem}
        isAtQueueEnd={player.isAtQueueEnd}
        isQueueEmpty={!queue.result.length}
        isErrored={player.isErrored}
        width={props.width}
        height={props.height}
      />
      {queueItem && player.showScript && (
        <ScriptOverlay
          mediaId={queueItem.mediaId}
          mediaKey={queueItem.queueId}
          position={player.position}
        />
      )}
      {roomPrefs?.qr?.password && (
        <PlayerQR
          height={props.height}
          prefs={roomPrefs.qr}
          queueItem={queueItem}
        />
      )}
    </>
  )
}

export default PlayerController
