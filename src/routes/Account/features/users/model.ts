import { createAction, createAsyncThunk, createReducer } from '@reduxjs/toolkit'
import HttpApi from 'lib/HttpApi'
import { User } from 'shared/types'
import {
  USERS_CREATE,
  USERS_FILTER_ONLINE,
  USERS_FILTER_ROOM_ID,
  USERS_REMOVE,
  USERS_REQUEST,
  USERS_UPDATE,
} from 'shared/actionTypes'

const api = new HttpApi('')

export interface UserWithRoomsAndRole extends User {
  rooms: number[] // roomIds
  role: string
}

// ------------------------------------
// Actions
// ------------------------------------
export const fetchUsers = createAsyncThunk(
  USERS_REQUEST,
  async () => await api.get('users'),
)

export const createUser = createAsyncThunk(
  USERS_CREATE,
  async (data: FormData, thunkAPI) => {
    await api.post('user', {
      body: data,
    })

    return await thunkAPI.dispatch(fetchUsers()).unwrap()
  },
)

export const updateUser = createAsyncThunk(
  USERS_UPDATE,
  async ({
    userId,
    data,
  }: {
    userId: number
    data: FormData
  }, thunkAPI) => {
    await api.put(`user/${userId}`, {
      body: data,
    })

    return await thunkAPI.dispatch(fetchUsers()).unwrap()
  },
)

export const removeUser = createAsyncThunk(
  USERS_REMOVE,
  async (userId: number, thunkAPI) => {
    await api.delete(`user/${userId}`)

    return await thunkAPI.dispatch(fetchUsers()).unwrap()
  },
)

export const filterByOnline = createAction<boolean>(USERS_FILTER_ONLINE)
export const filterByRoom = createAction<number>(USERS_FILTER_ROOM_ID)

// ------------------------------------
// Reducer
// ------------------------------------
interface UsersState {
  result: number[]
  entities: Record<number, UserWithRoomsAndRole>
  filterOnline: boolean
  filterRoomId: number | null
}

const initialState: UsersState = {
  result: [],
  entities: {},
  filterOnline: false,
  filterRoomId: null,
}

const usersReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(fetchUsers.fulfilled, (state, { payload }) => ({
      ...state,
      ...payload,
    }))
    .addCase(filterByOnline, (state, { payload }) => ({
      ...state,
      filterOnline: payload,
      filterRoomId: null,
    }))
    .addCase(filterByRoom, (state, { payload }) => ({
      ...state,
      filterOnline: false,
      filterRoomId: payload,
    }))
})

export default usersReducer
