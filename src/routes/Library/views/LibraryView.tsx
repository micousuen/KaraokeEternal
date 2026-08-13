import React from 'react'
import { useAppSelector } from 'store/hooks'
import { Link } from 'react-router'
import ArtistList from '../components/ArtistList/ArtistList'
import SearchResults from '../components/SearchResults/SearchResults'
import TextOverlay from 'components/TextOverlay/TextOverlay'
import Spinner from 'components/Spinner/Spinner'
import styles from './LibraryView.css'

const LibraryView = () => {
  const { isAdmin } = useAppSelector(state => state.user)
  const { isLoading, filterStr, filterStarred } = useAppSelector(state => state.library)
  const songsResult = useAppSelector(state => state.songs.result)
  const ui = useAppSelector(state => state.ui)

  const isSearching = !!filterStr.trim().length || filterStarred
  // Wait for the shared layout measurement before restoring the virtualized
  // list position. This must not set React state while rendering.
  if (!ui.headerHeight) return null

  return (
    <>
      {!isSearching && <ArtistList ui={ui} />}

      {isSearching && <SearchResults ui={ui} />}

      {isLoading && <Spinner />}

      {!isLoading && songsResult.length === 0 && (
        <TextOverlay className={styles.empty}>
          <h1>Library Empty</h1>
          {isAdmin && (
            <p>
              <Link to='/account'>Add media folders</Link>
              {' '}
              to get started.
            </p>
          )}
        </TextOverlay>
      )}
    </>
  )
}

export default LibraryView
