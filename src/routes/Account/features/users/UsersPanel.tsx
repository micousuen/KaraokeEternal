import React, { useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { fetchUsers, filterByOnline, filterByRoom, type UserWithRoomsAndRole } from './model'
import { formatDateTime } from 'lib/dateTime'
import Panel from 'components/Panel/Panel'
import Button from 'components/Button/Button'
import AdminTable from '../../components/AdminTable/AdminTable'
import UserEditor from './UserEditor'
import getUsers from './selectors'
import styles from './UsersPanel.css'

const UsersPanel = () => {
  const [editorUser, setEditorUser] = useState<UserWithRoomsAndRole | null | undefined>(undefined)

  const curUserId = useAppSelector(state => state.user.userId)
  const { filterOnline, filterRoomId } = useAppSelector(state => state.users)
  const rooms = useAppSelector(state => state.rooms)
  const users = useAppSelector(getUsers)

  const dispatch = useAppDispatch()
  const handleClose = () => setEditorUser(undefined)
  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === 'all') dispatch(filterByOnline(false))
    else if (e.target.value === 'online') dispatch(filterByOnline(true))
    else dispatch(filterByRoom(parseInt(e.target.value, 10)))
  }

  const handleEdit = (e: React.MouseEvent<HTMLElement>) => {
    setEditorUser(users.entities[parseInt(e.currentTarget.dataset.userId)])
  }
  const handleCreate = () => setEditorUser(null)

  // once per mount
  useEffect(() => {
    dispatch(fetchUsers())
  }, [dispatch])

  const rows = users.result.map((userId) => {
    const user = users.entities[userId]

    return (
      <tr key={userId}>
        {userId === curUserId && (
          <td translate='no'>
            <strong>{user.username}</strong>
            {' '}
            (
            {user.name}
            )
          </td>
        )}
        {userId !== curUserId && (
          <td>
            <a data-user-id={userId} onClick={handleEdit}>{user.username}</a>
            {' '}
            (
            {user.name}
            )
          </td>
        )}
        <td>{user.role}</td>
        <td>{formatDateTime(new Date(user.dateCreated * 1000))}</td>
      </tr>
    )
  })

  const roomOpts = rooms.result
    .filter(roomId => !!rooms.entities[roomId].numUsers)
    .map(roomId => <option key={roomId} value={roomId}>{rooms.entities[roomId].name}</option>)

  const userFilter = (
    <select className={styles.usersFilter} onChange={handleFilterChange} value={filterOnline ? 'online' : filterRoomId || 'all'}>
      <option key='all' value='all'>All</option>
      <option key='online' value='online'>Online</option>
      <optgroup label='Online in...'>
        {roomOpts}
      </optgroup>
    </select>
  )

  return (
    <Panel
      title='Users'
      titleComponent={userFilter}
    >
      <>
        <AdminTable>
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows}
          </tbody>
        </AdminTable>

        <br />
        <Button onClick={handleCreate} variant='primary'>
          Create User
        </Button>

        {editorUser !== undefined && (
          <UserEditor onClose={handleClose} user={editorUser ?? undefined} />
        )}
      </>
    </Panel>
  )
}

export default UsersPanel
