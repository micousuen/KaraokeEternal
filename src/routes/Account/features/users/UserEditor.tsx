import React from 'react'
import { useAppDispatch } from 'store/hooks'
import { createUser, removeUser, updateUser } from './model'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import AccountForm from '../../components/AccountForm/AccountForm'
import { UserWithRole } from 'shared/types'
import styles from './UserEditor.css'

interface UserEditorProps {
  user?: UserWithRole
  onClose: () => void
}

const UserEditor = ({ user, onClose }: UserEditorProps) => {
  const dispatch = useAppDispatch()

  const handleSubmit = (data: FormData) => {
    if (user) void dispatch(updateUser({ userId: user.userId, data })).unwrap().then(onClose).catch(() => {})
    else void dispatch(createUser(data)).unwrap().then(onClose).catch(() => {})
  }

  const handleRemoveClick = () => {
    if (user && confirm(`Remove user "${user.username}"?\n\nTheir queued songs will also be removed.`)) {
      void dispatch(removeUser(user.userId)).unwrap().then(onClose).catch(() => {})
    }
  }

  return (
    <Modal
      className={styles.modal}
      onClose={onClose}
      title={user ? user.username : 'Create User'}
    >
      <AccountForm user={user} onSubmit={handleSubmit} showRole autoFocus={!user}>
        <div className={styles.btnContainer}>
          {!user && (
            <Button type='submit' className={styles.btn} variant='primary'>
              Create User
            </Button>
          )}

          {user && (
            <Button type='submit' className={styles.btn} variant='primary'>
              Update User
            </Button>
          )}

          {user && (
            <Button onClick={handleRemoveClick} className={styles.btn} variant='danger'>
              Remove User
            </Button>
          )}

          <Button onClick={onClose} variant='default'>
            Cancel
          </Button>
        </div>
      </AccountForm>
    </Modal>
  )
}

export default UserEditor
