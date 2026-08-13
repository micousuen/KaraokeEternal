import React from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import SongItem from '../SongItem/SongItem'
import { queueSong } from 'routes/Queue/modules/queue'
import { showSongInfo } from 'store/modules/songInfo'
import { toggleSongStarred } from 'store/modules/userStars'
import getSongsStatus from '../../selectors/getSongsStatus'
import getStarredSongSet from '../../selectors/getStarredSongSet'

interface SongListProps {
  filterKeywords?: string[]
  showArtist: boolean
  songIds: number[]
}

const SongList = (props: SongListProps) => {
  const dispatch = useAppDispatch()
  const artists = useAppSelector(state => state.artists.entities)
  const songs = useAppSelector(state => state.songs.entities)
  const starredSongs = useAppSelector(getStarredSongSet)
  const starredSongCounts = useAppSelector(state => state.starCounts.songs)
  const isAdmin = useAppSelector(state => state.user.isAdmin)
  const { played, queued } = useAppSelector(getSongsStatus)

  const handleSongQueue = (songId: number) => dispatch(queueSong(songId))
  const handleSongInfo = (songId: number) => dispatch(showSongInfo(songId))
  const handleSongStar = (songId: number) => dispatch(toggleSongStarred(songId))

  return props.songIds.map(songId => (
    <SongItem
      {...songs[songId]}
      artist={props.showArtist ? artists[songs[songId].artistId].name : ''}
      author={artists[songs[songId].artistId].name}
      filterKeywords={props.filterKeywords}
      isPlayed={played.has(songId)}
      isUpcoming={queued.has(songId)}
      isStarred={starredSongs.has(songId)}
      isAdmin={isAdmin}
      key={songId}
      numStars={starredSongCounts[songId] || 0}
      onSongQueue={handleSongQueue}
      onSongStarClick={handleSongStar}
      onSongInfo={handleSongInfo}
    />
  ))
}

export default SongList
