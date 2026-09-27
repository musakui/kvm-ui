import { makeChannel } from './channel.js'

/**
 * @param {object} opts
 * @param {(state: 'connecting'|'connected'|'disconnected') => void} [opts.onStatus]
 * @param {{ render: (frame: VideoFrame) => void, clear: () => void }} [opts.view]
 */
export function createClient(opts) {
	/** @type {WebSocket | null} */
	let ws = null

	let sessionId = 0

	/** @type {AbortController | null} */
	let mediaAc = null

	/** @param {BufferSource} data */
	function send(data) {
		if (ws?.readyState === WebSocket.OPEN) ws.send(data)
	}

	/** @param {{ user: string, passwd: string }} creds */
	async function connect(creds) {
		const myId = ++sessionId
		const res = await fetch('/api/auth/login', {
			method: 'POST',
			credentials: 'include',
			body: new URLSearchParams(creds),
		})
		if (myId !== sessionId) return
		if (!res.ok) throw new Error('auth')

		opts.onStatus?.('connecting')

		const newWs = new WebSocket(`wss://${location.host}/api/ws`)
		newWs.binaryType = 'arraybuffer'

		newWs.onopen = async () => {
			if (myId !== sessionId) return
			fetch('/api/hid/set_params?mouse_output=usb_rel', {
				method: 'POST',
				credentials: 'include',
			})
			mediaAc = new AbortController()
			opts.onStatus?.('connected')
			if (!opts.view) return
			const { signal } = mediaAc
			while (!signal.aborted) {
				try {
					for await (const frame of mediaStream(signal)) {
						opts.view.render(frame)
					}
				} catch (err) {
					console.error('mediaStream:', err)
				}
			}
		}

		newWs.onclose = () => {
			mediaAc?.abort()
			mediaAc = null
			if (myId !== sessionId) return
			opts.view?.clear()
			opts.onStatus?.('disconnected')
			setTimeout(() => {
				if (myId === sessionId) connect(creds)
			}, 3000)
		}

		ws = newWs
	}

	return {
		connect,
		send,

		/** @param {AsyncIterable<BufferSource>} events */
		async pipe(events) {
			for await (const data of events) send(data)
		},

		disconnect() {
			++sessionId
			mediaAc?.abort()
			mediaAc = null
			if (ws) {
				ws.close()
				ws = null
			}
		},
	}
}

/** @param {AbortSignal} signal */
async function* mediaStream(signal) {
	let codec = ''
	let missedPings = 0

	/** @type {VideoDecoder | null} */
	let decoder = null

	/** @type {number | undefined} */
	let pingTimer

	const ws = new WebSocket(`wss://${location.host}/api/media/ws`)
	ws.binaryType = 'arraybuffer'

	const ch = makeChannel({
		type: /** @type {VideoFrame | undefined} */ (undefined),
	})

	function makeDecoder() {
		const d = new VideoDecoder({
			error: (err) => console.error('VideoDecoder:', err),
			output: (frame) => ch.push(frame),
		})
		d.configure({ codec, optimizeForLatency: true })
		return d
	}

	function closeDecoder() {
		if (decoder && decoder.state !== 'closed') decoder.close()
	}

	ws.onerror = () => ws.close()
	ws.onclose = () => {
		closeDecoder()
		ch.close()
	}
	ws.onopen = () => {
		missedPings = 0
		pingTimer = setInterval(() => {
			if (++missedPings > 10) return ws.close()
			if (ws.readyState === WebSocket.OPEN) ws.send(new Uint8Array([0]))
		}, 1000)
	}

	/** @param {MessageEvent<string | ArrayBuffer>} e */
	ws.onmessage = (e) => {
		if (typeof e.data === 'string') {
			const msg = JSON.parse(e.data)
			if (msg.event_type !== 'media') return
			codec = ''
			/** @type {Record<string, Record<string, string>>} */
			const formats = msg.event.video
			const format = formats.h264 ? 'h264' : 'h265'
			const m = formats[format]
			if (!m) return
			const c =
				m.codec ??
				`${format === 'h264' ? 'avc1' : 'hvc1'}.${m.profile_level_id}`
			if (!c) return
			codec = c
			closeDecoder()
			decoder = makeDecoder()
			ws.send(
				JSON.stringify({
					event_type: 'start',
					event: { type: 'video', format },
				}),
			)
		} else if (e.data.byteLength > 2) {
			const header = new Uint8Array(e.data, 0, 2)
			if (header[0] === 0xff) {
				missedPings = 0
			} else if (header[0] === 0x01 && codec) {
				const isKey = header[1] === 1
				if (!decoder || decoder.state === 'closed') {
					if (!isKey) return
					decoder = makeDecoder()
				}
				const chunk = new EncodedVideoChunk({
					timestamp: (performance.now() + performance.timeOrigin) * 1000,
					type: isKey ? 'key' : 'delta',
					data: new Uint8Array(e.data, 2),
				})
				decoder.decode(chunk)
			}
		}
	}

	signal.addEventListener('abort', () => ws.close(), { once: true })

	try {
		yield* ch.run()
	} finally {
		clearInterval(pingTimer)
		closeDecoder()
		if (
			ws.readyState !== WebSocket.CLOSED &&
			ws.readyState !== WebSocket.CLOSING
		) {
			ws.close()
		}
	}
}
