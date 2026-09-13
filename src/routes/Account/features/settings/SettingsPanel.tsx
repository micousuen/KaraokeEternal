import React from 'react'
import Panel from 'components/Panel/Panel'
import PathPrefs from './PathPrefs/PathPrefs'
import PlayerPrefs from './PlayerPrefs/PlayerPrefs'
import TranscriptionPrefs from './TranscriptionPrefs/TranscriptionPrefs'
import SongNamingPrefs from './SongNamingPrefs/SongNamingPrefs'
import styles from './SettingsPanel.css'

const SettingsPanel = () => (
  <Panel title='Preferences' contentClassName={styles.content}>
    <>
      <PathPrefs />
      <PlayerPrefs />
      <TranscriptionPrefs />
      <SongNamingPrefs />
    </>
  </Panel>
)

export default SettingsPanel
