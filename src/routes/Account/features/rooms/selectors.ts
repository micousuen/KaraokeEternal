import { RootState } from 'store/store'
import { createSelector } from '@reduxjs/toolkit'

const getResult = (state: RootState) => state.rooms.result
const getEntities = (state: RootState) => state.rooms.entities
const getRoomList = createSelector(
  [getResult, getEntities],
  (result, entities) => ({
    result,
    entities,
  }))

export default getRoomList
