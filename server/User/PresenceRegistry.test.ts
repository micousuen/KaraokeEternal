import { describe, expect, it } from 'vitest'
import { countRoomUsers, getUserRooms, registerPresence, releasePresence } from './PresenceRegistry.js'

describe('presence registry', () => {
  it('counts users once across devices and removes their final presence', () => {
    registerPresence('presence-a', 101, 201)
    registerPresence('presence-b', 101, 201)
    registerPresence('presence-c', 102, 201)

    expect(countRoomUsers(201)).toBe(2)
    expect(getUserRooms(101)).toEqual([201])
    releasePresence('presence-a')
    expect(countRoomUsers(201)).toBe(2)
    releasePresence('presence-b')
    expect(countRoomUsers(201)).toBe(1)
    releasePresence('presence-c')
  })
})
