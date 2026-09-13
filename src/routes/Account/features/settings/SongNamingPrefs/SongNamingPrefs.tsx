import React, { useState } from 'react'
import Accordion from 'components/Accordion/Accordion'
import Button from 'components/Button/Button'
import Icon from 'components/Icon/Icon'
import HttpApi from 'lib/HttpApi'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { receivePrefs } from 'store/modules/prefs'
import type { Prefs } from 'shared/types'
import styles from './SongNamingPrefs.css'

const api = new HttpApi('prefs/deepseek')

const SongNamingPrefs = () => {
  const configured = useAppSelector(state => state.prefs.isDeepSeekApiKeyConfigured)
  const dispatch = useAppDispatch()
  const [apiKey, setApiKey] = useState('')
  const [isSaving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const save = async (value: string) => {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const prefs = await api.put<Prefs>('', { body: { apiKey: value } })
      dispatch(receivePrefs(prefs))
      setApiKey('')
      setMessage(value.trim() ? 'DeepSeek API key saved.' : 'DeepSeek API key removed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (apiKey.trim()) void save(apiKey)
  }

  return (
    <Accordion
      className={styles.container}
      headingComponent={(
        <div className={styles.heading}>
          <Icon icon='LABEL' size={32} className={styles.icon} />
          <div className={styles.title}>Song Naming</div>
        </div>
      )}
    >
      <form className={styles.content} onSubmit={handleSubmit}>
        <p>
          YouTube downloads are automatically renamed to the Artist-Title format used across the
          library, using DeepSeek. The saved key is stored in the server database and is never sent
          back to the browser.
        </p>
        <label htmlFor='deepseek-api-key'>DeepSeek API key</label>
        <input
          id='deepseek-api-key'
          type='password'
          autoComplete='new-password'
          value={apiKey}
          disabled={isSaving}
          placeholder={configured ? 'Configured — enter a new key to replace it' : 'Enter API key'}
          onChange={event => setApiKey(event.currentTarget.value)}
        />
        <small className={configured ? styles.configured : styles.missing}>
          {configured ? 'API key configured' : 'API key not configured'}
        </small>
        {message && <div className={styles.message} role='status'>{message}</div>}
        {error && <div className={styles.error} role='alert'>{error}</div>}
        <div className={styles.actions}>
          <Button type='submit' variant='primary' disabled={isSaving || !apiKey.trim()}>
            {isSaving ? 'Saving…' : configured ? 'Replace API key' : 'Save API key'}
          </Button>
          {configured && (
            <Button
              type='button'
              variant='danger'
              disabled={isSaving}
              onClick={() => confirm('Remove the saved DeepSeek API key?') && void save('')}
            >
              Remove API key
            </Button>
          )}
        </div>
      </form>
    </Accordion>
  )
}

export default SongNamingPrefs
