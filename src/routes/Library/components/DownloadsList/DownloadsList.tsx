import React from 'react'
import { RootState } from 'store/store'
import { useAppSelector } from 'store/hooks'
import PaddedList from 'components/PaddedList/PaddedList'
import TextOverlay from 'components/TextOverlay/TextOverlay'
import SongList from '../SongList/SongList'
import getDownloads from '../../selectors/getDownloads'
import type { RowComponentProps } from 'react-window'

const ROW_HEIGHT_SONG_WITH_ARTIST = 68

interface DownloadsListProps {
  ui: RootState['ui']
}

interface CustomRowProps {
  songIds: number[]
}

const RowComponent = ({ index, style, songIds }: RowComponentProps<CustomRowProps>) => (
  <div style={style}>
    <SongList songIds={[songIds[index]]} showArtist />
  </div>
)

const DownloadsList = ({ ui }: DownloadsListProps) => {
  const songIds = useAppSelector(getDownloads)

  if (songIds.length === 0) {
    return (
      <TextOverlay>
        <h1>No downloads yet</h1>
        <p>YouTube downloads will appear here, newest first.</p>
      </TextOverlay>
    )
  }

  return (
    <PaddedList
      rowComponent={RowComponent}
      rowProps={{ songIds }}
      rowHeight={() => ROW_HEIGHT_SONG_WITH_ARTIST}
      numRows={songIds.length}
      paddingTop={ui.headerHeight}
      paddingRight={4}
      paddingBottom={ui.footerHeight}
      width={ui.innerWidth}
      height={ui.innerHeight}
    />
  )
}

export default DownloadsList
