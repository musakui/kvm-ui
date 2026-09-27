/** @param {HTMLCanvasElement} canvas */
export function handleView(canvas) {
	/** @type {number | null} */
	let rafId = null

	/** @type {VideoFrame | null} */
	let lastFrame = null

	/** @type {VideoFrame | null} */
	let pendingFrame = null

	const ctx = canvas.getContext('2d')

	const ro = new ResizeObserver(() => {
		const dpr = window.devicePixelRatio
		const w = Math.round(canvas.clientWidth * dpr)
		const h = Math.round(canvas.clientHeight * dpr)
		if (canvas.width === w && canvas.height === h) return
		canvas.width = w
		canvas.height = h
		if (lastFrame) draw(lastFrame)
	})

	ro.observe(canvas)

	/** @param {VideoFrame} frame */
	function draw(frame) {
		if (!ctx) return
		const { width: cw, height: ch } = canvas
		const scale = Math.min(cw / frame.displayWidth, ch / frame.displayHeight)
		const w = frame.displayWidth * scale
		const h = frame.displayHeight * scale
		ctx.clearRect(0, 0, cw, ch)
		ctx.drawImage(frame, (cw - w) / 2, (ch - h) / 2, w, h)
	}

	return {
		/** @param {VideoFrame} frame */
		render(frame) {
			pendingFrame?.close()
			pendingFrame = frame
			if (rafId !== null) return
			rafId = requestAnimationFrame(() => {
				rafId = null
				const frame = pendingFrame
				if (!frame) return
				pendingFrame = null
				draw(frame)
				lastFrame?.close()
				lastFrame = frame
			})
		},
		clear() {
			if (rafId !== null) cancelAnimationFrame(rafId)
			rafId = null
			pendingFrame?.close()
			pendingFrame = null
			lastFrame?.close()
			lastFrame = null
			ctx?.clearRect(0, 0, canvas.width, canvas.height)
		},
	}
}
