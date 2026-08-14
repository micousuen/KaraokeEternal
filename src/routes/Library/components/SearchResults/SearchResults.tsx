import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RootState } from 'store/store'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { toggleArtistResultExpanded } from '../../modules/library'
import getSearchResults from '../../selectors/getSearchResults'
import getSongsStatus from '../../selectors/getSongsStatus'
import getStarredSongSet from '../../selectors/getStarredSongSet'
import HttpApi from 'lib/HttpApi'
import Button from 'components/Button/Button'
import PaddedList from 'components/PaddedList/PaddedList'
import ArtistItem from '../ArtistItem/ArtistItem'
import SongList from '../SongList/SongList'
import type { YouTubeSearchResult } from 'shared/types'
import type { ListImperativeAPI, RowComponentProps } from 'react-window'
import styles from './SearchResults.css'

const ROW_HEIGHT_RESULT_HEADING = 24
const ROW_HEIGHT_ARTIST = 48
const ROW_HEIGHT_SONG = 56 // 52px + 4px margin
const ROW_HEIGHT_SONG_WITH_ARTIST = 68 // 64px + 4px margin
const ROW_HEIGHT_SOURCE_ACTION = 64
const ROW_HEIGHT_STATUS = 48
const ROW_HEIGHT_YOUTUBE_RESULT = 116
const ROW_HEIGHT_YOUTUBE_RESULT_MOBILE = 156
const api = new HttpApi('youtube')

type SearchRow
  = { type: 'heading', key: string, label: string }
    | { type: 'artist', artistId: number }
    | { type: 'song', songId: number }
    | { type: 'direct-url', url: string }
    | { type: 'youtube-search', query: string }
    | { type: 'status', key: string, message: string, isError?: boolean }
    | { type: 'youtube-result', result: YouTubeSearchResult }
    | { type: 'youtube-preview', result: YouTubeSearchResult }

interface SearchResultsProps {
  ui: RootState['ui']
}

interface CustomRowProps {
  artists: RootState['artists']
  dispatch: ReturnType<typeof useAppDispatch>
  expandedArtistResults: number[]
  filterKeywords: string[]
  rows: SearchRow[]
  queuedSongs: ReadonlySet<number>
  starredSongs: ReadonlySet<number>
  previewId: string | null
  downloadingId: string | null
  isYouTubeSearching: boolean
  onDownload(url: string, id: string): void
  onPreview(id: string): void
  onSearchYouTube(query: string): void
}

const looksLikeUrl = (value: string) => /^https?:\/\//i.test(value)

const formatDuration = (duration: number | null) => {
  if (duration === null) return 'Duration unavailable'
  const totalSeconds = Math.round(duration)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

// Kept outside SearchResults so react-window does not remount every visible row.
const RowComponent = ({
  index,
  style,
  artists,
  dispatch,
  expandedArtistResults,
  filterKeywords,
  rows,
  queuedSongs,
  starredSongs,
  previewId,
  downloadingId,
  isYouTubeSearching,
  onDownload,
  onPreview,
  onSearchYouTube,
}: RowComponentProps<CustomRowProps>) => {
  const row = rows[index]

  switch (row.type) {
    case 'heading':
      return <div style={style} className={styles.resultHeading}>{row.label}</div>

    case 'artist': {
      const artist = artists.entities[row.artistId]
      return (
        <ArtistItem
          artistSongIds={artist.songIds}
          filterKeywords={filterKeywords}
          isExpanded={expandedArtistResults.includes(row.artistId)}
          name={artist.name}
          numStars={0}
          onArtistClick={() => dispatch(toggleArtistResultExpanded(row.artistId))}
          upcomingSongs={queuedSongs}
          starredSongs={starredSongs}
          style={style}
        />
      )
    }

    case 'song':
      return (
        <div style={style}>
          <SongList songIds={[row.songId]} showArtist filterKeywords={filterKeywords} />
        </div>
      )

    case 'direct-url': {
      const isDownloading = downloadingId === 'direct-url'
      return (
        <div style={style} className={styles.sourceAction}>
          <button
            type='button'
            disabled={downloadingId !== null}
            onClick={() => onDownload(row.url, 'direct-url')}
          >
            <strong>{isDownloading ? 'Adding to download queue…' : 'Download video from this URL'}</strong>
            <span>{row.url}</span>
          </button>
        </div>
      )
    }

    case 'youtube-search':
      return (
        <div style={style} className={styles.sourceAction}>
          <button
            type='button'
            disabled={isYouTubeSearching || row.query.length < 2}
            onClick={() => onSearchYouTube(row.query)}
          >
            <strong>{isYouTubeSearching ? 'Searching YouTube…' : 'Search YouTube'}</strong>
            <span>{row.query ? `Find videos for “${row.query}”` : 'Enter at least two characters above'}</span>
          </button>
        </div>
      )

    case 'status':
      return (
        <div style={style} className={row.isError ? styles.errorStatus : styles.status} role='status'>
          {row.message}
        </div>
      )

    case 'youtube-result': {
      const { result } = row
      const isPreviewing = previewId === result.id
      const isDownloading = downloadingId === result.id
      return (
        <div style={style} className={styles.youtubeResult}>
          <div className={styles.youtubeCard}>
            <img src={result.thumbnailUrl} alt='' loading='lazy' referrerPolicy='no-referrer' />
            <div className={styles.youtubeMetadata}>
              <strong>{result.title}</strong>
              <span>{[result.channel, formatDuration(result.duration)].filter(Boolean).join(' · ')}</span>
            </div>
            <div className={styles.youtubeButtons}>
              <Button
                variant='default'
                aria-expanded={isPreviewing}
                aria-controls={`youtube-preview-${result.id}`}
                disabled={downloadingId !== null}
                onClick={() => onPreview(result.id)}
              >
                {isPreviewing ? 'Close preview' : 'Preview'}
              </Button>
              <Button
                variant='primary'
                disabled={downloadingId !== null}
                onClick={() => onDownload(result.url, result.id)}
              >
                {isDownloading ? 'Adding…' : 'Download'}
              </Button>
            </div>
          </div>
        </div>
      )
    }

    case 'youtube-preview':
      return (
        <div style={style} className={styles.youtubePreviewRow}>
          <div className={styles.youtubePreview} id={`youtube-preview-${row.result.id}`}>
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${row.result.id}?autoplay=1`}
              title={`Preview ${row.result.title}`}
              allow='autoplay; encrypted-media; picture-in-picture; fullscreen'
              allowFullScreen
              referrerPolicy='strict-origin-when-cross-origin'
            />
          </div>
        </div>
      )
  }
}

const SearchResults = ({ ui }: SearchResultsProps) => {
  const dispatch = useAppDispatch()
  const artists = useAppSelector(state => state.artists)
  const expandedArtistResults = useAppSelector(state => state.library.expandedArtistResults)
  const { filterStr, filterStarred } = useAppSelector(state => state.library)
  const { artistsResult, songsResult } = useAppSelector(getSearchResults)
  const starredSongs = useAppSelector(getStarredSongSet)
  const { queued: queuedSongs } = useAppSelector(getSongsStatus)
  const [youtubeResults, setYouTubeResults] = useState<YouTubeSearchResult[]>([])
  const [youtubeQuery, setYouTubeQuery] = useState('')
  const [youtubeError, setYouTubeError] = useState('')
  const [downloadMessage, setDownloadMessage] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [isYouTubeSearching, setYouTubeSearching] = useState(false)
  const activeQuery = useRef('')
  const searchRequestId = useRef(0)
  const listRef = useRef<ListImperativeAPI | null>(null)
  const query = filterStr.trim()
  const filterKeywords = query ? query.toLowerCase().split(' ') : []

  useEffect(() => {
    activeQuery.current = query
    searchRequestId.current++
    setYouTubeResults([])
    setYouTubeQuery('')
    setYouTubeError('')
    setDownloadMessage('')
    setPreviewId(null)
    setDownloadingId(null)
    setYouTubeSearching(false)
  }, [query])

  const searchYouTube = useCallback(async (searchQuery: string) => {
    const requestId = ++searchRequestId.current
    setYouTubeSearching(true)
    setYouTubeQuery(searchQuery)
    setYouTubeError('')
    setDownloadMessage('')
    setYouTubeResults([])
    setPreviewId(null)
    try {
      const results = await api.get<YouTubeSearchResult[]>(`/search?q=${encodeURIComponent(searchQuery)}`)
      if (searchRequestId.current !== requestId) return
      setYouTubeResults(results)
      if (!results.length) setYouTubeError('No downloadable YouTube videos matched that search.')
    } catch (err) {
      if (searchRequestId.current === requestId) setYouTubeError(err instanceof Error ? err.message : String(err))
    } finally {
      if (searchRequestId.current === requestId) setYouTubeSearching(false)
    }
  }, [])

  const download = useCallback(async (url: string, id: string) => {
    const requestQuery = activeQuery.current
    setDownloadingId(id)
    setDownloadMessage('')
    setYouTubeError('')
    try {
      await api.post('/', { body: { url } })
      if (activeQuery.current === requestQuery) setDownloadMessage('Added to the YouTube download queue.')
    } catch (err) {
      if (activeQuery.current === requestQuery) setYouTubeError(err instanceof Error ? err.message : String(err))
    } finally {
      if (activeQuery.current === requestQuery) setDownloadingId(null)
    }
  }, [])

  const togglePreview = useCallback((id: string) => {
    setPreviewId(current => current === id ? null : id)
  }, [])

  const rows = useMemo<SearchRow[]>(() => {
    const resultRows: SearchRow[] = [
      {
        type: 'heading',
        key: 'artists',
        label: `${artistsResult.length} ${filterStarred ? 'starred ' : ''}${artistsResult.length === 1 ? 'artist' : 'artists'}`,
      },
      ...artistsResult.map(artistId => ({ type: 'artist' as const, artistId })),
      {
        type: 'heading',
        key: 'songs',
        label: `${songsResult.length} ${filterStarred ? 'starred ' : ''}${songsResult.length === 1 ? 'song' : 'songs'}`,
      },
      ...songsResult.map(songId => ({ type: 'song' as const, songId })),
    ]
    if (looksLikeUrl(query)) resultRows.push({ type: 'direct-url', url: query })
    resultRows.push({ type: 'youtube-search', query })
    if (downloadMessage) resultRows.push({ type: 'status', key: 'download', message: downloadMessage })
    if (youtubeError) resultRows.push({ type: 'status', key: 'youtube-error', message: youtubeError, isError: true })
    if (youtubeQuery && youtubeResults.length) {
      resultRows.push({
        type: 'heading',
        key: 'youtube',
        label: `${youtubeResults.length} YouTube ${youtubeResults.length === 1 ? 'video' : 'videos'}`,
      })
      for (const result of youtubeResults) {
        resultRows.push({ type: 'youtube-result', result })
        if (previewId === result.id) resultRows.push({ type: 'youtube-preview', result })
      }
    }
    return resultRows
  }, [artistsResult, downloadMessage, filterStarred, previewId, query, songsResult, youtubeError, youtubeQuery, youtubeResults])

  useEffect(() => {
    if (isYouTubeSearching || (!youtubeError && !youtubeResults.length)) return
    const index = rows.findIndex(row => row.type === 'heading' && row.key === 'youtube')
    const fallbackIndex = rows.findIndex(row => row.type === 'status' && row.key === 'youtube-error')
    listRef.current?.scrollToRow({ index: Math.max(index, fallbackIndex), align: 'start' })
  }, [isYouTubeSearching, rows, youtubeError, youtubeResults.length])

  useEffect(() => {
    if (!previewId) return
    const index = rows.findIndex(row => row.type === 'youtube-preview' && row.result.id === previewId)
    if (index >= 0) listRef.current?.scrollToRow({ index, align: 'smart' })
  }, [previewId, rows])

  const rowHeight = (index: number) => {
    const row = rows[index]
    if (row.type === 'heading') return ROW_HEIGHT_RESULT_HEADING
    if (row.type === 'artist') {
      const songRows = expandedArtistResults.includes(row.artistId)
        ? artists.entities[row.artistId].songIds.length * ROW_HEIGHT_SONG
        : 0
      return ROW_HEIGHT_ARTIST + songRows
    }
    if (row.type === 'song') return ROW_HEIGHT_SONG_WITH_ARTIST
    if (row.type === 'status') return ROW_HEIGHT_STATUS
    if (row.type === 'youtube-preview') {
      return Math.round(ui.contentWidth * 9 / 16) + 8
    }
    if (row.type !== 'youtube-result') return ROW_HEIGHT_SOURCE_ACTION

    return ui.innerWidth <= 500 ? ROW_HEIGHT_YOUTUBE_RESULT_MOBILE : ROW_HEIGHT_YOUTUBE_RESULT
  }

  const handleRef = (ref: ListImperativeAPI) => {
    if (ref) listRef.current = ref
  }

  return (
    <PaddedList
      rowComponent={RowComponent}
      rowProps={{
        artists,
        dispatch,
        downloadingId,
        expandedArtistResults,
        filterKeywords,
        isYouTubeSearching,
        onDownload: download,
        onPreview: togglePreview,
        onSearchYouTube: searchYouTube,
        previewId,
        queuedSongs,
        rows,
        starredSongs,
      }}
      rowHeight={rowHeight}
      numRows={rows.length}
      paddingTop={ui.headerHeight}
      paddingRight={4}
      paddingBottom={ui.footerHeight}
      height={ui.innerHeight}
      width={ui.innerWidth}
      onRef={handleRef}
    />
  )
}

export default SearchResults
