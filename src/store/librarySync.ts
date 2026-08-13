import HttpApi from '../lib/HttpApi'
import { LIBRARY_PUSH } from 'shared/actionTypes'
import type { MiddlewareAPI } from '@reduxjs/toolkit'

const api = new HttpApi('library')
let request: Promise<void> | undefined
let requestedVersion = 0
let requestGeneration = 0

export function syncLibrary (store: Pick<MiddlewareAPI, 'dispatch'>, version = 0): Promise<void> {
  const targetVersion = Number.isFinite(version) ? version : 0
  if (targetVersion !== requestedVersion) {
    requestedVersion = targetVersion
    requestGeneration++
  }
  if (request) return request
  request = fetchLatestLibrary(store)
    .catch((error): void => {
      store.dispatch({ type: 'library/SYNC_ERROR', error })
      return undefined
    })
    .finally(() => { request = undefined })
  return request
}

async function fetchLatestLibrary (store: Pick<MiddlewareAPI, 'dispatch'>): Promise<void> {
  while (true) {
    const generation = requestGeneration
    const payload = await api.get('') as { version?: number }
    store.dispatch({ type: LIBRARY_PUSH, payload })
    if (generation === requestGeneration || payload.version === requestedVersion) return
  }
}
