import React, { useState, useRef } from 'react'
import clsx from 'clsx'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { setFilterStr, resetFilterStr, toggleFilterStarred, toggleLibrarySort } from '../../modules/library'
import Button from 'components/Button/Button'
import styles from './LibraryHeader.css'

const SORT_MODES = {
  requested: {
    active: true,
    label: 'Top',
    next: 'downloads',
    description: 'most requested',
  },
  alphabetical: {
    active: false,
    label: 'A–Z',
    next: 'requested',
    description: 'alphabetical',
  },
  downloads: {
    active: true,
    label: 'New',
    next: 'alphabetical',
    description: 'YouTube downloads, newest first',
  },
} as const

const LibraryHeader = () => {
  const dispatch = useAppDispatch()
  const { filterStr, filterStarred, sortMode } = useAppSelector(state => state.library)
  const mode = SORT_MODES[sortMode]

  const searchInput = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(filterStr)

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value)
    dispatch(setFilterStr(event.target.value))
  }

  const clearSearch = () => {
    setValue('')
    dispatch(resetFilterStr())
  }

  const handleMagnifierClick = () => {
    if (value.trim()) clearSearch()
    else searchInput.current?.focus()
  }

  return (
    <div className={styles.container}>
      <Button
        className={clsx(styles.btnMagnifier, filterStr && styles.active)}
        icon='MAGNIFIER'
        onClick={handleMagnifierClick}
      />
      <input
        type='search'
        className={styles.searchInput}
        placeholder='search'
        value={value}
        onChange={handleChange}
        ref={searchInput}
      />
      {filterStr && (
        <Button
          icon='CLEAR'
          onClick={clearSearch}
          className={clsx(styles.btnClear, styles.active)}
        />
      )}
      <Button
        className={clsx(styles.btnStar, filterStarred && styles.active)}
        icon='STAR_FULL'
        onClick={() => dispatch(toggleFilterStarred())}
      />
      <Button
        aria-label={`Currently ${mode.description}; switch to ${SORT_MODES[mode.next].description}`}
        className={clsx(styles.btnSort, mode.active && styles.active)}
        icon='TUNE'
        onClick={() => dispatch(toggleLibrarySort())}
        title={`Currently ${mode.description}; switch to ${SORT_MODES[mode.next].description}`}
      >
        <span>{mode.label}</span>
      </Button>
    </div>
  )
}

export default LibraryHeader
