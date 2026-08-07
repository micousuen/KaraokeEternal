import React from 'react'
import clsx from 'clsx'
import { NavLink } from 'react-router'
import Button from 'components/Button/Button'
import { useAppSelector } from 'store/hooks'
import styles from './Navigation.css'

const Navigation = React.forwardRef<HTMLDivElement>((_, ref) => {
  const hasRoom = useAppSelector(state => typeof state.user.roomId === 'number')

  return (
    <div className={clsx(styles.container, 'bg-blur')} ref={ref}>
      {hasRoom && (
        <NavLink to='/library' replace className={({ isActive }) => clsx(isActive && styles.active)}>
          {({ isActive }) => (
            <Button
              icon='NAV_LIBRARY'
              as='span'
              animateClassName={styles.btnAnimate}
              cancelAnimation={!isActive}
            />
          )}
        </NavLink>
      )}
      {hasRoom && (
        <NavLink to='/queue' replace className={({ isActive }) => clsx(isActive && styles.active)}>
          {({ isActive }) => (
            <Button
              icon='NAV_SUBSCRIPTIONS'
              as='span'
              animateClassName={styles.btnAnimate}
              cancelAnimation={!isActive}
            />
          )}
        </NavLink>
      )}
      <NavLink to='/account' replace className={({ isActive }) => clsx(isActive && styles.active)}>
        {({ isActive }) => (
          <Button
            icon={isActive ? 'NAV_ACCOUNT_ACTIVE' : 'NAV_ACCOUNT'}
            as='span'
            animateClassName={styles.btnAnimate}
            cancelAnimation={!isActive}
          />
        )}
      </NavLink>
    </div>
  )
})

Navigation.displayName = 'Navigation'

export default Navigation
