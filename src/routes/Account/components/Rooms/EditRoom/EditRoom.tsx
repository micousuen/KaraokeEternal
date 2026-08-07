import React, { useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { createRoom, removeRoom, updateRoom, requestPrefsPush } from 'store/modules/rooms'
import { joinRoomAsAdmin, leaveRoomAsAdmin } from 'store/modules/user'
import { getFormData } from 'lib/util'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import UserPrefs from './UserPrefs/UserPrefs'
import QRPrefs from './QRPrefs/QRPrefs'
import type { Room, IRoomPrefs } from 'shared/types'
import styles from './EditRoom.css'

interface EditRoomProps {
  room?: Room
  onClose: () => void
}

const EditRoom = ({ onClose, room }: EditRoomProps) => {
  const formRef = useRef(null)
  const [prefs, setPrefs] = useState<IRoomPrefs>(room?.prefs || {} as IRoomPrefs)
  const [prevRoom, setPrevRoom] = useState(room)
  const currentRoomId = useAppSelector(state => state.user.roomId)
  const dispatch = useAppDispatch()

  if (room !== prevRoom) {
    setPrevRoom(room)
    if (room?.prefs) setPrefs(room.prefs)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const data = getFormData(new FormData(formRef.current)) as Record<string, string | IRoomPrefs>
    data.prefs = prefs

    if (room) {
      dispatch(updateRoom({ roomId: room.roomId, data }))
    } else {
      dispatch(createRoom(data))
    }
  }

  const handleRemoveClick = () => {
    if (room && currentRoomId !== room.roomId && confirm(`Remove room "${room.name}" and its queue?`)) {
      dispatch(removeRoom(room.roomId))
    }
  }

  const handleJoinClick = () => {
    if (room) dispatch(joinRoomAsAdmin(room.roomId))
  }

  const handleLeaveClick = () => dispatch(leaveRoomAsAdmin())

  const handlePrefsChange = (newPrefs: IRoomPrefs) => {
    setPrefs(newPrefs)
    if (room) {
      dispatch(requestPrefsPush(room.roomId, newPrefs))
    }
  }

  const handleClose = () => {
    // emit initial prefs
    if (room) {
      dispatch(requestPrefsPush(room.roomId, room.prefs))
    }
    onClose()
  }

  return (
    <Modal
      className={styles.modal}
      onClose={handleClose}
      title={room ? 'Edit Room' : 'Create Room'}
    >
      <form onSubmit={handleSubmit} ref={formRef} className={styles.form}>
        <div className={styles.fieldContainer}>
          <input
            type='text'
            autoComplete='off'
            defaultValue={room ? room.name : ''}
            name='name'
            placeholder='room name'
            // https://github.com/facebook/react/issues/23301
            ref={r => typeof room === 'undefined' ? r?.setAttribute('autofocus', 'true') : undefined}
          />

          <select
            name='status'
            defaultValue={room?.status ?? 'open'}
          >
            <option value='open'>Open</option>
            <option value='closed'>Closed</option>
          </select>
        </div>

        <div className={styles.prefsContainer}>
          <UserPrefs prefs={prefs} onChange={handlePrefsChange} />
          <QRPrefs prefs={prefs} onChange={handlePrefsChange} />
        </div>

        <div className={styles.btnContainer}>
          <Button type='submit' variant='primary' className={styles.btn}>
            {room ? 'Update Room' : 'Create Room'}
          </Button>
          {room && currentRoomId !== room.roomId && (
            <Button onClick={handleJoinClick} className={styles.btn} variant='primary'>
              Join Room
            </Button>
          )}
          {room && currentRoomId === room.roomId && (
            <Button onClick={handleLeaveClick} className={styles.btn} variant='default'>
              Leave Room
            </Button>
          )}
          {room && (
            <Button
              onClick={handleRemoveClick}
              className={styles.btn}
              variant='danger'
              disabled={currentRoomId === room.roomId}
              title={currentRoomId === room.roomId ? 'Leave this room before removing it' : undefined}
            >
              Remove Room
            </Button>
          )}
          <Button onClick={handleClose} variant='default'>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default EditRoom
