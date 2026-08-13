import { RootState } from 'store/store'
const getPlayerHistory = (state: RootState): number[] => state.status.history

export default getPlayerHistory
