import React, { useRef, useState } from 'react'
import clsx from 'clsx'
import Highlighter from 'react-highlight-words'
import { useSwipeable } from 'react-swipeable'
import { useLongPress } from 'use-long-press'
import Button from 'components/Button/Button'
import ButtonStar from 'components/ButtonStar/ButtonStar'
import Buttons from 'components/Buttons/Buttons'
import Icon from 'components/Icon/Icon'
import ToggleAnimation from 'components/ToggleAnimation/ToggleAnimation'
import { formatDuration } from 'lib/dateTime'
import styles from './SongItem.css'
import RenameSongModal from './RenameSongModal'

let ignoreMouseup = false

interface SongItemProps {
  songId: number
  artist?: string
  author: string
  title: string
  duration: number
  onSongQueue(songId: number): void
  onSongStarClick(songId: number): void
  onSongInfo(songId: number): void
  isPlayed: boolean
  isStarred: boolean
  isUpcoming: boolean
  isAdmin: boolean
  isManagedDownload?: boolean
  hasSingleAudioTrack?: boolean
  numStars: number
  numMedia: number
  filterKeywords: string[]
}

const SongItem = ({
  songId,
  artist,
  author,
  title,
  duration,
  onSongQueue,
  onSongStarClick,
  onSongInfo,
  isPlayed,
  isStarred,
  isUpcoming,
  isAdmin,
  isManagedDownload,
  hasSingleAudioTrack,
  numStars,
  numMedia,
  filterKeywords,
}: SongItemProps) => {
  const [isExpanded, setExpanded] = useState(false)
  const [isRenameOpen, setRenameOpen] = useState(false)
  const longPressActiveRef = useRef(false)
  const canRename = isAdmin

  const handleClick = () => {
    if (longPressActiveRef.current) {
      longPressActiveRef.current = false
      return
    }
    if (ignoreMouseup) {
      ignoreMouseup = false
      return
    }
    if (isUpcoming) return
    onSongQueue(songId)
  }
  const handleContextMenu = (event: React.MouseEvent) => {
    if (!canRename) return
    event.preventDefault()
    setRenameOpen(true)
  }
  const handleInfoClick = () => onSongInfo(songId)
  const handleStarClick = () => onSongStarClick(songId)
  const bindRenamePressHandlers = useLongPress(() => {
    longPressActiveRef.current = true
    setRenameOpen(true)
  }, { threshold: 600, cancelOnMovement: true })

  const swipeHandlers = useSwipeable({
    onSwipedLeft: ({ event }) => {
      ignoreMouseup = event.type === 'mouseup'
      setExpanded(isAdmin)
    },
    onSwipedRight: ({ event }) => {
      ignoreMouseup = event.type === 'mouseup'
      setExpanded(false)
    },
    preventScrollOnSwipe: true,
    trackMouse: true,
  })

  return (
    <>
      <div
        {...swipeHandlers}
        className={clsx(
          styles.container,
          isPlayed && styles.played,
          isUpcoming && styles.upcoming,
          isStarred && styles.starred,
          isExpanded && styles.expanded,
          artist && styles.withArtist,
        )}
      >
        <ToggleAnimation toggle={isUpcoming} className={styles.animateGlow}>
          <div className={styles.duration}>
            {formatDuration(duration)}
          </div>
          <div
            {...(canRename ? bindRenamePressHandlers() : {})}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            className={styles.primary}
            title={canRename ? 'Right-click or long-press to rename' : undefined}
          >
            <div className={styles.title}>
              {filterKeywords?.length ? <Highlighter autoEscape textToHighlight={title} searchWords={filterKeywords} /> : title}
              {isManagedDownload && <span className={styles.source}>YouTube download</span>}
              {hasSingleAudioTrack && <span className={styles.singleTrack}>Single audio track</span>}
              {isAdmin && numMedia > 1 && (
                <i>
                  {' '}
                  (
                  {numMedia}
                  )
                </i>
              )}
              {artist && <div className={styles.artist}>{artist}</div>}
            </div>
          </div>
        </ToggleAnimation>

        <Buttons btnWidth={56} isExpanded={isExpanded}>
          <ButtonStar
            className={styles.btn}
            onClick={handleStarClick}
            isStarred={isStarred}
            count={numStars}
          />
          <Button onClick={handleInfoClick} className={clsx(styles.btn, styles.info)} data-hide>
            <Icon icon='INFO_OUTLINE' />
          </Button>
        </Buttons>
      </div>
      {isRenameOpen && (
        <RenameSongModal
          songId={songId}
          title={title}
          artist={author}
          onClose={() => setRenameOpen(false)}
        />
      )}
    </>
  )
}

export default SongItem
