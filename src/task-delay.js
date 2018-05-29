

export default class TaskDelay {
    constructor() {
        this.timeout = null;
        this.running = false;
        this.nextTask = null;
    }

    cancel() {
        if (this.timeout != null) {
            clearTimeout(this.timeout)
            this.timeout = null;
        }
        this.nextTask = null;
    }

    delay(task, delay) {
        this.cancel()
        this.nextTask = task
        if (!this.running) {
            this.timeout = setTimeout(this.runNext.bind(this), delay)
        }
    }

    onTaskDone() {
        this.running = false;
        this.runNext();
    }

    async runNext() {
        if (!this.nextTask) {
            this.running = false;
        } else {
            let task = this.nextTask;
            this.nextTask = null;
            this.running = true;
            await task();
            this.onTaskDone();
        }
    }

}

