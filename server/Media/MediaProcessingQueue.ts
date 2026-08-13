export interface PrioritizedMediaJob {
  mediaId: number
  prioritized?: boolean
}

export class MediaProcessingQueue<Job extends PrioritizedMediaJob> {
  #items: Job[] = []
  #scheduled = new Set<number>()

  get length (): number { return this.#items.length }

  has (mediaId: number): boolean {
    return this.#scheduled.has(mediaId)
  }

  enqueue (job: Job, prioritize = false): boolean {
    if (this.#scheduled.has(job.mediaId)) return false
    job.prioritized = prioritize
    this.#scheduled.add(job.mediaId)
    if (!prioritize) {
      this.#items.push(job)
      return true
    }
    const firstNormal = this.#items.findIndex(item => !item.prioritized)
    this.#items.splice(firstNormal === -1 ? this.#items.length : firstNormal, 0, job)
    return true
  }

  dequeue (): Job | undefined {
    return this.#items.shift()
  }

  complete (mediaId: number): void {
    this.#scheduled.delete(mediaId)
  }

  list (): readonly Job[] {
    return this.#items
  }
}
