import React, { useRef } from 'react'
import { RootState } from 'store/store'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { toggleArtistResultExpanded } from '../../modules/library'
import getSearchResults from '../../selectors/getSearchResults'
import getSongsStatus from '../../selectors/getSongsStatus'
import getStarredSongSet from '../../selectors/getStarredSongSet'
import PaddedList from 'components/PaddedList/PaddedList'
import ArtistItem from '../ArtistItem/ArtistItem'
import SongList from '../SongList/SongList'
import type { ListImperativeAPI, RowComponentProps } from 'react-window'
import styles from './SearchResults.css'

const ROW_HEIGHT_RESULT_HEADING = 24
const ROW_HEIGHT_ARTIST = 48
const ROW_HEIGHT_SONG = 56 // 52px + 4px margin
const ROW_HEIGHT_SONG_WITH_ARTIST = 68 // 64px + 4px margin

interface SearchResultsProps {
  // starredArtistCounts: Record<number, number> // @todo
  ui: RootState['ui']
}

interface CustomRowProps {
  artists: RootState['artists']
  dispatch: ReturnType<typeof useAppDispatch>
  filterKeywords: string[]
  filterStarred: boolean
  artistsResult: number[]
  songsResult: number[]
  expandedArtistResults: number[]
  queuedSongs: ReadonlySet<number>
  starredSongs: ReadonlySet<number>
}

// this is outside the SearchResults component to keep the reference as stable as possible,
// as react-window will re-render the list (breaking animations) when RowComponent changes
const RowComponent = ({
  index,
  style,
  // below are also used in SearchResults and passed via rowProps to avoid duplicate effort
  dispatch,
  artists,
  filterKeywords,
  filterStarred,
  artistsResult,
  songsResult,
  expandedArtistResults,
  queuedSongs,
  starredSongs,
}: RowComponentProps<CustomRowProps>) => {
  // # artist results heading
  if (index === 0) {
    return (
      <div key='artistsHeading' style={style} className={styles.artistsHeading}>
        {artistsResult.length}
        {' '}
        {filterStarred ? 'starred ' : ''}
        {artistsResult.length === 1 ? 'artist' : 'artists'}
      </div>
    )
  }

  // artist results
  if (index > 0 && index < artistsResult.length + 1) {
    const artistId = artistsResult[index - 1]
    const artist = artists.entities[artistId]

    return (
      <ArtistItem
        artistSongIds={artist.songIds}
        // numStars={props.starredArtistCounts[artistId] || 0}
        filterKeywords={filterKeywords}
        isExpanded={expandedArtistResults.includes(artistId)}
        key={artistId}
        name={artist.name}
        numStars={0}
        onArtistClick={() => dispatch(toggleArtistResultExpanded(artistId))}
        upcomingSongs={queuedSongs}
        starredSongs={starredSongs}
        style={style}
      />
    )
  }

  // # song results heading
  if (index === artistsResult.length + 1) {
    return (
      <div key='songsHeading' style={style} className={styles.songsHeading}>
        {songsResult.length}
        {' '}
        {filterStarred ? 'starred ' : ''}
        {songsResult.length === 1 ? 'song' : 'songs'}
      </div>
    )
  }

  // song results
  const songId = songsResult[index - artistsResult.length - 2]
  return (
    <div style={style} key={songId}>
      <SongList
        songIds={[songId]}
        showArtist
        filterKeywords={filterKeywords}
      />
    </div>
  )
}

const SearchResults = ({ ui }: SearchResultsProps) => {
  const dispatch = useAppDispatch()
  const artists = useAppSelector(state => state.artists)
  const expandedArtistResults = useAppSelector(state => state.library.expandedArtistResults)
  const { filterStr, filterStarred } = useAppSelector(state => state.library)
  const { artistsResult, songsResult } = useAppSelector(getSearchResults)
  const starredSongs = useAppSelector(getStarredSongSet)
  const { queued: queuedSongs } = useAppSelector(getSongsStatus)

  const listRef = useRef<ListImperativeAPI | null>(null)
  const filterKeywords = filterStr.trim() ? filterStr.trim().toLowerCase().split(' ') : []

  const rowHeight = (index: number) => {
    // artists heading
    if (index === 0) return ROW_HEIGHT_RESULT_HEADING

    // artist results
    if (index > 0 && index < artistsResult.length + 1) {
      const artistId = artistsResult[index - 1]
      let height = ROW_HEIGHT_ARTIST

      if (expandedArtistResults.includes(artistId)) {
        height += artists.entities[artistId].songIds.length * ROW_HEIGHT_SONG
      }

      return height
    }

    // songs heading
    if (index === artistsResult.length + 1) return ROW_HEIGHT_RESULT_HEADING

    // song results
    return ROW_HEIGHT_SONG_WITH_ARTIST
  }

  const handleRef = (ref: ListImperativeAPI) => {
    if (ref) {
      listRef.current = ref
      // listRef.current.scrollToRow({ index: props.scrollRow, align: 'start' })
    }
  }

  return (
    <PaddedList
      rowComponent={RowComponent}
      rowProps={{
        dispatch,
        artists,
        filterStarred,
        filterKeywords,
        artistsResult,
        songsResult,
        expandedArtistResults,
        queuedSongs,
        starredSongs,
      }}
      rowHeight={rowHeight}
      numRows={artistsResult.length + songsResult.length + 2}
      paddingTop={ui.headerHeight}
      paddingRight={4}
      paddingBottom={ui.footerHeight}
      height={ui.innerHeight}
      onRef={handleRef}
    />
  )
}

export default SearchResults
