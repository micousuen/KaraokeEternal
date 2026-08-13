import HttpApi from '../lib/HttpApi'
import { LIBRARY_PUSH } from 'shared/actionTypes'
import type { MiddlewareAPI } from '@reduxjs/toolkit'

const api = new HttpApi('library')
let request: Promise<void> | undefined

export function syncLibrary (store: Pick<MiddlewareAPI, 'dispatch'>): Promise<void> {
  if (request) return request
  request = api.get('')
    .then((payload): void => {
      store.dispatch({ type: LIBRARY_PUSH, payload })
      return undefined
    })
    .catch((error): void => {
      store.dispatch({ type: 'library/SYNC_ERROR', error })
      return undefined
    })
    .finally(() => { request = undefined })
  return request
}
