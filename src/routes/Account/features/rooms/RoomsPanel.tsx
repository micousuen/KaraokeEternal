import React, { useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { formatDateTime } from 'lib/dateTime'
import Panel from 'components/Panel/Panel'
import Button from 'components/Button/Button'
import AdminTable from '../../components/AdminTable/AdminTable'
import RoomEditor from './RoomEditor'
import { fetchRooms } from 'store/modules/rooms'
import { joinRoomAsAdmin } from 'store/modules/user'
import { filterByRoom } from '../users/model'
import getRoomList from './selectors'
import styles from './RoomsPanel.css'
import type { Room } from 'shared/types'

const RoomsPanel = () => {
  const [editorRoom, setEditorRoom] = useState<Room | null | undefined>(undefined)

  const rooms = useAppSelector(getRoomList)

  const dispatch = useAppDispatch()
  const handleClose = () => setEditorRoom(undefined)
  const handleFilterUsers = (e: React.MouseEvent<HTMLElement>) => dispatch(filterByRoom(parseInt(e.currentTarget.dataset.roomId)))
  const handleEdit = (e: React.MouseEvent<HTMLElement>) => {
    setEditorRoom(rooms.entities[parseInt(e.currentTarget.dataset.roomId || '0')])
  }
  const handleCreate = () => setEditorRoom(null)
  const handleJoin = (roomId: number, destination: 'library' | 'player') => {
    dispatch(joinRoomAsAdmin({ roomId, destination }))
  }

  useEffect(() => {
    dispatch(fetchRooms())
  }, [dispatch])

  const rows = rooms.result.map((roomId) => {
    const room = rooms.entities[roomId]
    return (
      <tr key={String(roomId)}>
        <td translate='no'>
          <div className={styles.roomCell}>
            <a className={styles.roomName} data-room-id={roomId} onClick={handleEdit}>{room.name}</a>
            <div className={styles.roomActions}>
              <Button className={styles.roomButton} variant='primary' onClick={() => handleJoin(roomId, 'library')}>
                Join Room
              </Button>
              <Button
                className={styles.roomButton}
                variant='primary'
                onClick={() => handleJoin(roomId, 'player')}
              >
                Join as Player
              </Button>
            </div>
          </div>
        </td>
        <td>
          {room.numUsers > 0 && (
            <a data-room-id={roomId} onClick={handleFilterUsers}>{room.numUsers}</a>
          )}
        </td>
        <td>{formatDateTime(new Date(room.dateCreated * 1000))}</td>
      </tr>
    )
  })

  return (
    <Panel title='Rooms'>
      <>
        <AdminTable className={styles.roomTable}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Users</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows}
          </tbody>
        </AdminTable>

        <br />
        <Button onClick={handleCreate} variant='primary'>
          Create Room
        </Button>

        {editorRoom !== undefined && <RoomEditor onClose={handleClose} room={editorRoom ?? undefined} />}
      </>
    </Panel>
  )
}

export default RoomsPanel
