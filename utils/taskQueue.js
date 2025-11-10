/**
 * Task Queue Utility
 * Manages task queuing and processing
 */

class TaskQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  /**
   * Add task to queue
   */
  enqueue(task) {
    this.queue.push({
      ...task,
      id: this.generateId(),
      createdAt: new Date().toISOString()
    });
    return this.queue[this.queue.length - 1].id;
  }

  /**
   * Process next task in queue
   */
  async dequeue() {
    if (this.queue.length === 0) {
      return null;
    }
    return this.queue.shift();
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      pending: this.queue.length,
      processing: this.processing,
      queue: this.queue.map(t => ({
        id: t.id,
        task: t.task,
        createdAt: t.createdAt
      }))
    };
  }

  /**
   * Generate unique task ID
   */
  generateId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clear queue
   */
  clear() {
    this.queue = [];
    return { message: 'Queue cleared' };
  }
}

// Singleton instance
const taskQueue = new TaskQueue();

module.exports = taskQueue;

