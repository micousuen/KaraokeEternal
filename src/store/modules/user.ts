import { createAction, createAsyncThunk, createReducer, type ThunkDispatch, type UnknownAction } from '@reduxjs/toolkit'
import { persistReducer } from 'redux-persist'
import storage from 'redux-persist/lib/storage'
import socket from 'lib/socket'
import AppRouter from 'lib/AppRouter'
import { RootState } from 'store/store'
import HttpApi from 'lib/HttpApi'
import Persistor from 'store/Persistor'
import { fetchPrefs } from './prefs'
import {
  ACCOUNT_RECEIVE,
  ACCOUNT_REQUEST,
  ACCOUNT_CREATE,
  ACCOUNT_UPDATE,
  LOGIN,
  LOGOUT,
  SOCKET_AUTH_ERROR,
  SOCKET_REQUEST_CONNECT,
} from 'shared/actionTypes'

const api = new HttpApi('')
const basename = new URL(document.baseURI).pathname
const appPath = (path: string) => basename.replace(/\/$/, '') + path

interface SessionUser {
  roomId?: number | null
}

export const receiveAccount = createAction<object>(ACCOUNT_RECEIVE)

// ------------------------------------
// Login
// ------------------------------------
export const login = createAsyncThunk<unknown, object, { state: RootState }>(
  LOGIN,
  async (creds: object, thunkAPI) => {
    // calls api endpoint that should set an httpOnly cookie with
    // our JWT, then establish the sockiet.io connection
    const user = await api.post('login', {
      body: creds,
    })

    startSession(user, thunkAPI.dispatch)
  },
)

// ------------------------------------
// Logout
// ------------------------------------
const logout = createAction(LOGOUT)

export const requestLogout = createAsyncThunk(
  LOGOUT,
  async (_, thunkAPI) => {
    try {
      // server response should clear our cookie
      await api.get('logout')
    } catch {
      // ignore errors
    }

    thunkAPI.dispatch(logout())
    Persistor.get().purge()
    socket.close()
  },
)

// ------------------------------------
// Create account
// ------------------------------------
export const createAccount = createAsyncThunk<void, FormData, { state: RootState }>(
  ACCOUNT_CREATE,
  async (data: FormData, thunkAPI) => {
    const isFirstRun = thunkAPI.getState().prefs.isFirstRun

    const user = await api.post(isFirstRun ? 'setup' : 'user', {
      body: data,
    })

    startSession(user, thunkAPI.dispatch)
  },
)

// ------------------------------------
// Update account
// ------------------------------------
export const updateAccount = createAsyncThunk<void, FormData, { state: RootState }>(
  ACCOUNT_UPDATE,
  async (data: FormData, thunkAPI) => {
    const { userId } = thunkAPI.getState().user

    const user = await api.put(`user/${userId}`, {
      body: data,
    })

    thunkAPI.dispatch(receiveAccount(user))
    alert('Account updated successfully.')
  },
)

// ------------------------------------
// Request account (does not refresh JWT)
// ------------------------------------
export const fetchAccount = createAsyncThunk(
  ACCOUNT_REQUEST,
  async (_, thunkAPI) => {
    try {
      const user = await api.get('user')
      thunkAPI.dispatch(receiveAccount(user))
    } catch {
      // ignore errors
    }
  },
)

// ------------------------------------
// Admin room switching
// ------------------------------------
export const joinRoomAsAdmin = createAsyncThunk<
  unknown,
  number | { roomId: number, destination: 'library' | 'player' },
  { state: RootState }
>(
  'user/JOIN_ROOM_AS_ADMIN',
  async (input, thunkAPI) => {
    const roomId = typeof input === 'number' ? input : input.roomId
    const destination = typeof input === 'number' ? 'library' : input.destination
    const user = await api.post(`rooms/${roomId}/join`)

    await replaceSession(user, thunkAPI.dispatch)
    AppRouter.navigate(appPath(`/${destination}`))
  },
)

export const leaveRoomAsAdmin = createAsyncThunk<unknown, void, { state: RootState }>(
  'user/LEAVE_ROOM_AS_ADMIN',
  async (_, thunkAPI) => {
    const user = await api.post('rooms/leave')

    await replaceSession(user, thunkAPI.dispatch)
    AppRouter.navigate(appPath('/account'))
  },
)

// ------------------------------------
// Socket actions
// ------------------------------------
const requestSocketConnect = createAction<object>(SOCKET_REQUEST_CONNECT)

export const connectSocket = createAsyncThunk<void, void, { state: RootState }>(
  'user/SOCKET_CONNECT',
  async (_, { dispatch, getState }) => {
    const versions = {
      library: getState().library.version,
      stars: getState().starCounts.version,
    }

    dispatch(requestSocketConnect(versions))
    socket.io.opts.query = versions
  },
)

type SessionDispatch = ThunkDispatch<RootState, unknown, UnknownAction>

function startSession (user: SessionUser, dispatch: SessionDispatch): void {
  // New lazy reducers must not rehydrate data from the previous account.
  void Persistor.get().purge()
  dispatch(receiveAccount(user))
  dispatch(fetchPrefs())
  dispatch(connectSocket())
  socket.open()

  const redirect = new URLSearchParams(window.location.search).get('redirect')
  if (redirect) AppRouter.navigate(appPath(redirect))
  else if (typeof user.roomId === 'number') AppRouter.navigate(appPath('/library'))
}

async function replaceSession (user: SessionUser, dispatch: SessionDispatch): Promise<void> {
  socket.close()
  dispatch(receiveAccount(user))
  await dispatch(connectSocket())
  socket.open()
}

// ------------------------------------
// Reducer
// ------------------------------------
interface UserState {
  userId: number | null
  username: string | null
  name: string | null
  roomId: number | null
  isAdmin: boolean
  isGuest: boolean
  dateCreated: number
  dateUpdated: number
}

const initialState: UserState = {
  userId: null,
  username: null,
  name: null,
  roomId: null,
  isAdmin: false,
  isGuest: false,
  dateCreated: 0,
  dateUpdated: 0,
}

const userReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(receiveAccount, (state, { payload }) => ({
      ...state,
      ...payload,
    }))
    .addCase(LOGOUT, () => ({
      ...initialState,
    }))
    .addCase(SOCKET_AUTH_ERROR, () => ({
      ...initialState,
    }))
})

export default persistReducer({
  key: 'user',
  storage,
}, userReducer)
