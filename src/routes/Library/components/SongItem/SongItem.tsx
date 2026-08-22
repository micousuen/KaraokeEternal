import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
import RegenerateSongModal, { type RegenerateOutput } from './RegenerateSongModal'

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
  isProcessing?: boolean
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
  isProcessing,
  numStars,
  numMedia,
  filterKeywords,
}: SongItemProps) => {
  const [isExpanded, setExpanded] = useState(false)
  const [isRenameOpen, setRenameOpen] = useState(false)
  const [regenerateOutput, setRegenerateOutput] = useState<RegenerateOutput | null>(null)
  const [actionMenu, setActionMenu] = useState<{ x: number, y: number } | null>(null)
  const actionMenuRef = useRef<HTMLDivElement>(null)
  const longPressActiveRef = useRef(false)
  const ignoreMouseupRef = useRef(false)
  const canManage = isAdmin

  useEffect(() => {
    if (!actionMenu) return
    actionMenuRef.current?.querySelector('button')?.focus()
    const close = () => setActionMenu(null)
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!actionMenuRef.current?.contains(event.target as Node)) setActionMenu(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionMenu(null)
    }
    window.addEventListener('pointerdown', closeOnOutsidePress, true)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePress, true)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [actionMenu])

  const closeActionMenu = () => setActionMenu(null)
  const openActionMenu = (x: number, y: number) => {
    const menuWidth = 240
    const menuHeight = 132
    setActionMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    })
  }

  const handleClick = () => {
    if (longPressActiveRef.current) {
      longPressActiveRef.current = false
      return
    }
    if (ignoreMouseupRef.current) {
      ignoreMouseupRef.current = false
      return
    }
    if (isUpcoming || isProcessing) return
    onSongQueue(songId)
  }
  const handleContextMenu = (event: React.MouseEvent) => {
    if (!canManage) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    openActionMenu(event.clientX || rect.left + 16, event.clientY || rect.top + 16)
  }
  const handleInfoClick = () => onSongInfo(songId)
  const handleStarClick = () => onSongStarClick(songId)
  const bindActionPressHandlers = useLongPress<HTMLDivElement>((event) => {
    longPressActiveRef.current = true
    const point = 'touches' in event ? event.touches[0] : event
    openActionMenu(point?.clientX ?? window.innerWidth / 2, point?.clientY ?? window.innerHeight / 2)
  }, { threshold: 600, cancelOnMovement: true })

  const handleRename = () => {
    closeActionMenu()
    setRenameOpen(true)
  }

  const handleRegenerate = (output: RegenerateOutput) => {
    closeActionMenu()
    setRegenerateOutput(output)
  }

  const swipeHandlers = useSwipeable({
    onSwipedLeft: ({ event }) => {
      ignoreMouseupRef.current = event.type === 'mouseup'
      setExpanded(isAdmin)
    },
    onSwipedRight: ({ event }) => {
      ignoreMouseupRef.current = event.type === 'mouseup'
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
          isProcessing && styles.processing,
          artist && styles.withArtist,
        )}
        onContextMenu={handleContextMenu}
      >
        <ToggleAnimation toggle={isUpcoming} className={styles.animateGlow}>
          <div className={styles.duration}>
            {formatDuration(duration)}
          </div>
          <div
            {...(canManage ? bindActionPressHandlers() : {})}
            onClick={handleClick}
            className={styles.primary}
            aria-disabled={isProcessing || undefined}
            title={isProcessing
              ? 'Preparing instrumental track before queueing'
              : canManage ? 'Right-click or long-press for song actions' : undefined}
          >
            <div className={styles.title}>
              {filterKeywords?.length ? <Highlighter autoEscape textToHighlight={title} searchWords={filterKeywords} /> : title}
              {isManagedDownload && <span className={styles.source}>YouTube download</span>}
              {isProcessing && <span className={styles.processingBadge}>Preparing</span>}
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
      {actionMenu && createPortal(
        <div
          ref={actionMenuRef}
          className={styles.actionMenu}
          role='menu'
          aria-label='Song actions'
          style={{ left: actionMenu.x, top: actionMenu.y }}
        >
          <button type='button' role='menuitem' onClick={handleRename}>Rename</button>
          <button type='button' role='menuitem' onClick={() => handleRegenerate('instrumental')}>
            Regenerate instrumental
          </button>
          <button type='button' role='menuitem' onClick={() => handleRegenerate('script')}>
            Regenerate script
          </button>
        </div>,
        document.body,
      )}
      {isRenameOpen && (
        <RenameSongModal
          songId={songId}
          title={title}
          artist={author}
          onClose={() => setRenameOpen(false)}
        />
      )}
      {regenerateOutput && (
        <RegenerateSongModal
          songId={songId}
          output={regenerateOutput}
          onClose={() => setRegenerateOutput(null)}
        />
      )}
    </>
  )
}

export default SongItem
