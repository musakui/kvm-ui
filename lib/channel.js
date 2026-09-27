/**
 * @template T
 * @param {object} [opts]
 * @param {T} [opts.type]
 * @param {AbortController} [opts.controller]
 */
export function makeChannel(opts) {
	/** @type {T[]} */
	const q = []

	/** @type {((v: T | null) => void) | null} */
	let wake = null

	let done = false

	function close() {
		if (done) return
		done = true
		if (wake) {
			const w = wake
			wake = null
			w(null)
		}
	}

	opts?.controller?.signal.addEventListener('abort', close, { once: true })

	return {
		/** @param {T} value */
		push(value) {
			if (done) return
			if (wake) {
				const w = wake
				wake = null
				w(value)
			} else {
				q.push(value)
			}
		},
		close,
		async *run() {
			while (!done) {
				const a = q.shift()
				if (a != null) {
					yield a
				} else {
					const v = await new Promise((r) => {
						wake = r
					})
					if (v === null) return
					yield /** @type {T} */ (v)
				}
			}
		},
	}
}
