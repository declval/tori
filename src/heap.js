export class Heap {
    #values = [];

    add(value) {
        this.#values.push(value);
        this.#bubbleUp(this.#values.length - 1);
    }

    pop() {
        const value = this.#values[0];

        this.#values[0] = this.#values[this.#values.length - 1];
        this.#values.pop();
        this.#bubbleDown(0);

        return value;
    }

    get size() {
        return this.#values.length;
    }

    #bubbleDown(parent) {
        let child = this.#child(parent);

        while (
            child < this.#values.length &&
            this.#values[parent].priority > this.#values[child].priority
        ) {
            [this.#values[parent], this.#values[child]] = [
                this.#values[child],
                this.#values[parent],
            ];
            parent = child;
            child = this.#child(parent);
        }
    }

    #bubbleUp(child) {
        let parent = Math.floor((child - 1) / 2);

        while (
            parent >= 0 &&
            this.#values[parent].priority > this.#values[child].priority
        ) {
            [this.#values[parent], this.#values[child]] = [
                this.#values[child],
                this.#values[parent],
            ];
            child = parent;
            parent = Math.floor((child - 1) / 2);
        }
    }

    #child(parent) {
        const leftChild = parent * 2 + 1;
        const rightChild = parent * 2 + 2;

        let child;

        if (
            leftChild >= this.#values.length ||
            rightChild >= this.#values.length ||
            this.#values[leftChild].priority < this.#values[rightChild].priority
        ) {
            child = leftChild;
        } else {
            child = rightChild;
        }

        return child;
    }
}
