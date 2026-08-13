import { AnyAction, createSlice, type PayloadAction } from '@reduxjs/toolkit'

const MAX_CONTENT_WIDTH = 768
let scrollLockTimer: ReturnType<typeof setTimeout> | null

// does not dispatch anything (only affects the DOM)
export const lockScrolling = (lock: boolean) => {
  if (lock) {
    clearTimeout(scrollLockTimer)
    scrollLockTimer = null
    document.body.classList.add('scroll-lock')
  } else if (!scrollLockTimer) {
    scrollLockTimer = setTimeout(() => {
      scrollLockTimer = null
      document.body.classList.remove('scroll-lock')
    }, 200)
  }
}

// ------------------------------------
// Reducer
// ------------------------------------
export interface UIState {
  isErrored: boolean
  errorMessage: string | null
  footerHeight: number
  headerHeight: number
  innerWidth: number
  innerHeight: number
  contentWidth: number
}

const initialState: UIState = {
  isErrored: false,
  errorMessage: null,
  footerHeight: 0,
  headerHeight: 0,
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
  contentWidth: Math.min(window.innerWidth, MAX_CONTENT_WIDTH),
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setHeaderHeight: (state, { payload }: PayloadAction<number>) => {
      state.headerHeight = payload ?? 0
    },
    setFooterHeight: (state, { payload }: PayloadAction<number>) => {
      state.footerHeight = payload ?? 0
    },
    showErrorMessage: (state, { payload }: PayloadAction<string>) => {
      state.isErrored = true
      state.errorMessage = payload
    },
    clearErrorMessage: (state) => {
      state.isErrored = false
    },
    windowResize: {
      reducer: (state, { payload }: PayloadAction<{ innerWidth: number, innerHeight: number }>) => {
        state.innerWidth = payload.innerWidth
        state.innerHeight = payload.innerHeight
        state.contentWidth = Math.min(payload.innerWidth, MAX_CONTENT_WIDTH)
      },
      prepare: (window: { innerWidth: number, innerHeight: number }) => ({
        payload: window,
        meta: { throttle: { wait: 200, leading: false } },
      }),
    },
  },
  extraReducers: builder => builder.addMatcher(
    (action): action is AnyAction => !!action.error,
    (state, { error }) => {
      state.isErrored = true
      state.errorMessage = error.message ?? error
    },
  ),
})

export const {
  clearErrorMessage,
  setFooterHeight,
  setHeaderHeight,
  showErrorMessage,
  windowResize,
} = uiSlice.actions

export default uiSlice.reducer
