import React, { useEffect, useRef } from 'react'
import { RootState } from 'store/store'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { scrollArtists, toggleArtistExpanded } from '../../modules/library'
import getAlphaPickerMap from '../../selectors/getAlphaPickerMap'
import getSongsStatus from '../../selectors/getSongsStatus'
import getStarredSongSet from '../../selectors/getStarredSongSet'
import PaddedList from 'components/PaddedList/PaddedList'
import AlphaPicker from '../AlphaPicker/AlphaPicker'
import ArtistItem from '../ArtistItem/ArtistItem'
import type { ListImperativeAPI, RowComponentProps } from 'react-window'
import getOrderedArtistIds from '../../selectors/getOrderedArtistIds'

const ROW_HEIGHT_ARTIST = 48
const ROW_HEIGHT_SONG = 56

interface ArtistListProps {
  ui: RootState['ui']
}

interface CustomRowProps {
  dispatch: ReturnType<typeof useAppDispatch>
  artists: RootState['artists']
  artistIds: number[]
  expandedArtists: number[]
  queuedSongs: ReadonlySet<number>
  starredSongs: ReadonlySet<number>
}

// this is outside the ArtistList component to keep the reference as stable as possible,
// as react-window will re-render the list (breaking animations) when RowComponent changes
const RowComponent = ({
  index,
  style,
  // below are also used in ArtistList and passed via rowProps to avoid duplicate effort
  dispatch,
  artists,
  artistIds,
  expandedArtists,
  queuedSongs,
  starredSongs,
}: RowComponentProps<CustomRowProps>) => {
  const starredArtistCounts = useAppSelector(state => state.starCounts.artists)

  const artist = artists.entities[artistIds[index]]

  return (
    <ArtistItem
      artistSongIds={artist.songIds} // "children"
      isExpanded={expandedArtists.includes(artist.artistId)}
      key={artist.artistId}
      name={artist.name}
      numStars={starredArtistCounts[artist.artistId] || 0}
      onArtistClick={() => dispatch(toggleArtistExpanded(artist.artistId))}
      upcomingSongs={queuedSongs}
      starredSongs={starredSongs}
      style={style}
    />
  )
}

const ArtistList = ({
  ui,
}: ArtistListProps) => {
  const dispatch = useAppDispatch()
  const { expandedArtists, sortMode } = useAppSelector(state => state.library)
  const scrollRow = useAppSelector(state => state.library.scrollRow)
  const alphaPickerMap = useAppSelector(getAlphaPickerMap)
  const artists = useAppSelector(state => state.artists)
  const artistIds = useAppSelector(getOrderedArtistIds)
  const starredSongs = useAppSelector(getStarredSongSet)
  const { queued: queuedSongs } = useAppSelector(getSongsStatus)

  const lastScrollRow = useRef(scrollRow)
  const list = useRef<ListImperativeAPI | null>(null)

  useEffect(() => {
    return () => {
      dispatch(scrollArtists(lastScrollRow.current))
    }
  }, [dispatch])

  const previousSortMode = useRef(sortMode)
  useEffect(() => {
    if (previousSortMode.current === sortMode) return
    previousSortMode.current = sortMode
    lastScrollRow.current = 0
    list.current?.scrollToRow({ index: 0, align: 'start', behavior: 'instant' })
  }, [sortMode])

  const rowHeight = (index: number) => {
    const artistId = artistIds[index]
    let height = ROW_HEIGHT_ARTIST

    if (expandedArtists.includes(artistId)) {
      height += artists.entities[artistId].songIds.length * ROW_HEIGHT_SONG
    }

    return height
  }

  const handleRowsRendered = ({ startIndex }: { startIndex: number }) => {
    // console.log('rendered rows: ', { startIndex })
    lastScrollRow.current = startIndex
  }

  const handleAlphaPick = (char: string) => {
    const row = alphaPickerMap[char]

    if (typeof row !== 'undefined' && list.current) {
      list.current.scrollToRow({ index: row > 0 ? row - 1 : row, align: 'start' })
    }
  }

  const handleRef = (ref: ListImperativeAPI | null) => {
    if (ref) {
      list.current = ref

      if (lastScrollRow.current) {
      // console.log(`handleRef: scrolling to ${lastScrollRow.current}`)
        list.current.scrollToRow({ index: lastScrollRow.current, align: 'start', behavior: 'instant' })
      }
    }
  }

  if (artistIds.length === 0) return null

  return (
    <div>
      <PaddedList
        rowComponent={RowComponent}
        rowProps={{ dispatch, artists, artistIds, expandedArtists, queuedSongs, starredSongs }}
        rowHeight={rowHeight}
        numRows={artistIds.length}
        onRowsRendered={handleRowsRendered}
        onRef={handleRef}
        paddingTop={ui.headerHeight}
        paddingRight={sortMode === 'alphabetical' ? 30 : 4}
        paddingBottom={ui.footerHeight}
        width={ui.innerWidth}
        height={ui.innerHeight}
      />
      {sortMode === 'alphabetical' && (
        <AlphaPicker
          onPick={handleAlphaPick}
          height={ui.innerHeight - ui.headerHeight - ui.footerHeight}
          top={ui.headerHeight}
        />
      )}
    </div>
  )
}

export default ArtistList
