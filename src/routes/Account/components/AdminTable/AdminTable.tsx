import React from 'react'
import clsx from 'clsx'
import styles from './AdminTable.css'

interface AdminTableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  className?: string
}

const AdminTable = ({ className, ...props }: AdminTableProps) => (
  <table {...props} className={clsx(styles.table, className)} />
)

export default AdminTable
