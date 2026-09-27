import { makeChannel } from './channel.js'

/** @import { ClientAction } from './types' */

const KEY = 0x01
const BUTTON = 0x02

const SENSITIVITY = 1.5
const TAP_MAX_MS = 300
const TAP_MAX_PX = 8
const HOLD_MS = 400

const MOD_REGEX = /^(Control|Shift|Alt|Meta)(Left|Right)$/

/** @type {Record<string, string>} */
const KEY_TO_CODE = {
	Alt: 'AltLeft',
	Meta: 'MetaLeft',
	Shift: 'ShiftLeft',
	Control: 'ControlLeft',
}

/** @type {Record<string, string>} */
const PLAIN_CHARS = {
	' ': 'Space',
	'\n': 'Enter',
	'\r': 'Enter',
	'-': 'Minus',
	'=': 'Equal',
	'[': 'BracketLeft',
	']': 'BracketRight',
	'\\': 'Backslash',
	';': 'Semicolon',
	"'": 'Quote',
	',': 'Comma',
	'.': 'Period',
	'/': 'Slash',
	'`': 'Backquote',
}

/** @type {Record<string, string>} */
const SHIFT_CHARS = {
	'!': 'Digit1',
	'@': 'Digit2',
	'#': 'Digit3',
	$: 'Digit4',
	'%': 'Digit5',
	'^': 'Digit6',
	'&': 'Digit7',
	'*': 'Digit8',
	'(': 'Digit9',
	')': 'Digit0',
	_: 'Minus',
	'+': 'Equal',
	'{': 'BracketLeft',
	'}': 'BracketRight',
	'|': 'Backslash',
	':': 'Semicolon',
	'"': 'Quote',
	'<': 'Comma',
	'>': 'Period',
	'?': 'Slash',
	'~': 'Backquote',
}

/** @type {ClientAction | undefined} */
const cat = undefined

/** @param {HTMLInputElement} el */
export function attachInput(el) {
	const controller = new AbortController()
	const ch = makeChannel({ controller, type: cat })
	const opts = { signal: controller.signal }

	function releaseActiveMods() {
		for (const btn of document.querySelectorAll('[data-active]')) {
			const code = /** @type {HTMLElement} */ (btn).dataset.key
			if (code) ch.push({ type: 'key', code, up: true })
			btn.removeAttribute('data-active')
		}
	}

	el.addEventListener(
		'keydown',
		(evt) => {
			const code = resolveKeyCode(evt)
			if (code) ch.push({ type: 'key', code, up: false })
		},
		opts,
	)

	el.addEventListener(
		'keyup',
		(evt) => {
			const code = resolveKeyCode(evt)
			if (code) ch.push({ type: 'key', code, up: true })
			releaseActiveMods()
		},
		opts,
	)

	el.addEventListener(
		'input',
		(evt) => {
			if (evt.inputType === 'insertLineBreak')
				return ch.push({ type: 'key', code: 'Enter' })
			if (!evt.data) return
			el.value = ''
			ch.push({ type: 'text', data: evt.data })
		},
		opts,
	)

	el.addEventListener(
		'command',
		(cmdEvt) => {
			const evt = /** @type {CommandEvent} */ (cmdEvt)
			if (evt.command === '--f') {
				if (el.toggleAttribute('data-focus')) {
					el.focus()
				} else {
					releaseActiveMods()
					el.blur()
				}
				return
			}
			if (evt.command !== '--k') return
			const src = /** @type {HTMLElement} */ (evt.source)
			const code = src.dataset.key
			if (!code) return
			if (MOD_REGEX.test(code)) {
				ch.push({ type: 'key', code, up: !src.toggleAttribute('data-active') })
			} else {
				ch.push({ type: 'key', code })
				releaseActiveMods()
			}
			el.focus()
		},
		opts,
	)

	return {
		stop() {
			controller.abort()
		},
		[Symbol.asyncIterator]: ch.run,
	}
}

/** @param {HTMLElement} el */
export function attachTrackpad(el) {
	const controller = new AbortController()
	const ch = makeChannel({ controller, type: cat })
	const opts = { passive: false, signal: controller.signal }

	let startX = 0
	let startY = 0
	let startT = 0
	let mouseX = 0
	let mouseY = 0
	let zoom = 1
	let panX = 0
	let panY = 0
	let lastX = 0
	let lastY = 0
	let lastTapT = 0
	let holding = false
	let dragging = false
	let twoFingerT = 0
	let twoFingerMoved = false
	let prev2 = { dist: 0, midX: 0, midY: 0 }

	/** @type {number | undefined} */
	let holdTimer

	/**
	 * @param {{ clientX: number, clientY: number }} pt
	 * @param {number} prevX
	 * @param {number} prevY
	 */
	function pushMove(pt, prevX, prevY) {
		const dx = clamp(Math.round((pt.clientX - prevX) * SENSITIVITY), -127, 127)
		const dy = clamp(Math.round((pt.clientY - prevY) * SENSITIVITY), -127, 127)
		const moved = !!(dx || dy)
		if (moved) ch.push({ type: 'mouse', dx, dy })
		return moved
	}

	function applyTransform() {
		if (zoom === 1) {
			el.style.transform = ''
		} else {
			el.style.transformOrigin = '0 0'
			el.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`
		}
	}

	function resetTouch() {
		clearTimeout(holdTimer)
		const wasHolding = holding
		if (holding) {
			ch.push({ type: 'button', button: 'left', up: true })
			holding = false
		}
		dragging = false
		return wasHolding
	}

	el.addEventListener(
		'touchstart',
		(evt) => {
			evt.preventDefault()
			if (evt.touches.length === 1) {
				const t = evt.touches[0]
				startX = lastX = t.clientX
				startY = lastY = t.clientY
				startT = Date.now()
				resetTouch()
				holdTimer = setTimeout(() => {
					if (dragging) return
					holding = true
					ch.push({ type: 'button', button: 'left', up: false })
				}, HOLD_MS)
			} else if (evt.touches.length === 2) {
				resetTouch()
				twoFingerT = Date.now()
				twoFingerMoved = false
				prev2 = twoFingers(evt.touches)
			}
		},
		opts,
	)

	el.addEventListener(
		'touchmove',
		(evt) => {
			evt.preventDefault()
			if (evt.touches.length === 1) {
				const t = evt.touches[0]
				if (pushMove(t, lastX, lastY) && !holding) dragging = true
				lastX = t.clientX
				lastY = t.clientY
			} else if (evt.touches.length === 2) {
				twoFingerMoved = true
				const two = twoFingers(evt.touches)
				const newZoom = clamp((zoom * two.dist) / prev2.dist, 1, 5)
				panX = two.midX - ((prev2.midX - panX) / zoom) * newZoom
				panY = two.midY - ((prev2.midY - panY) / zoom) * newZoom
				zoom = newZoom
				if (zoom === 1) {
					panX = 0
					panY = 0
				} else {
					panX = clamp(panX, el.offsetWidth * (1 - zoom), 0)
					panY = clamp(panY, el.offsetHeight * (1 - zoom), 0)
				}
				applyTransform()
				prev2 = two
			}
		},
		opts,
	)

	el.addEventListener(
		'touchend',
		(evt) => {
			evt.preventDefault()
			if (resetTouch()) {
				twoFingerT = 0
				return
			}
			if (evt.touches.length) return
			const now = Date.now()
			if (twoFingerT && !twoFingerMoved && now - twoFingerT < TAP_MAX_MS) {
				ch.push({ type: 'button', button: 'right' })
				twoFingerT = 0
				return
			}
			if (dragging || now - startT > TAP_MAX_MS) return
			const dist = Math.hypot(lastX - startX, lastY - startY)
			if (dist > TAP_MAX_PX) return
			if (zoom > 1 && now - lastTapT < TAP_MAX_MS) {
				zoom = 1
				panX = 0
				panY = 0
				applyTransform()
			} else {
				ch.push({ type: 'button', button: 'left' })
			}
			lastTapT = now
		},
		opts,
	)

	el.addEventListener(
		'touchcancel',
		(evt) => {
			evt.preventDefault()
			resetTouch()
		},
		opts,
	)

	el.addEventListener(
		'mousedown',
		(evt) => {
			evt.preventDefault()
			mouseX = evt.clientX
			mouseY = evt.clientY
			ch.push({
				type: 'button',
				button: evt.button === 2 ? 'right' : 'left',
				up: false,
			})
		},
		opts,
	)

	el.addEventListener(
		'mousemove',
		(evt) => {
			pushMove(evt, mouseX, mouseY)
			mouseX = evt.clientX
			mouseY = evt.clientY
		},
		opts,
	)

	el.addEventListener(
		'mouseup',
		(evt) => {
			evt.preventDefault()
			ch.push({
				type: 'button',
				button: evt.button === 2 ? 'right' : 'left',
				up: true,
			})
		},
		opts,
	)

	el.addEventListener(
		'wheel',
		(evt) => {
			evt.preventDefault()
			const sc = evt.deltaMode === WheelEvent.DOM_DELTA_LINE ? 8 : 1
			const dx = clamp(Math.round(evt.deltaX * sc), -127, 127)
			const dy = clamp(Math.round(evt.deltaY * sc), -127, 127)
			if (dx || dy) ch.push({ type: 'mouse', dx, dy, scroll: true })
		},
		opts,
	)

	el.addEventListener('contextmenu', (evt) => evt.preventDefault(), opts)

	return {
		stop() {
			controller.abort()
		},
		[Symbol.asyncIterator]: ch.run,
	}
}

/** @param {AsyncIterable<ClientAction>} actions */
export async function* parseActions(actions) {
	for await (const act of actions) {
		switch (act.type) {
			case 'key':
				if (act.up == null) {
					yield* press(KEY, act.code)
				} else {
					yield encode(KEY, act.code, !act.up)
				}
				break
			case 'text':
				for (const char of act.data) {
					const m = charToHid(char)
					if (!m) continue
					const pp = press(KEY, m.code)
					yield* m.shift ? press(KEY, 'ShiftLeft', pp) : pp
				}
				break
			case 'button':
				if (act.up == null) {
					yield* press(BUTTON, act.button)
				} else {
					yield encode(BUTTON, act.button, !act.up)
				}
				break
			case 'mouse':
				yield new Int8Array([act.scroll ? 0x05 : 0x04, 1, act.dx, act.dy])
				break
		}
	}
}

/** @param {KeyboardEvent} evt */
function resolveKeyCode(evt) {
	if (evt.isComposing) return
	evt.preventDefault()
	return evt.code || KEY_TO_CODE[evt.key] || (evt.key.length > 1 ? evt.key : '')
}

/** @param {TouchList} t */
function twoFingers(t) {
	const ax = t[0].clientX
	const ay = t[0].clientY
	const bx = t[1].clientX
	const by = t[1].clientY
	return {
		dist: Math.hypot(bx - ax, by - ay),
		midX: (ax + bx) / 2,
		midY: (ay + by) / 2,
	}
}

/** @param {string} char */
function charToHid(char) {
	if (char >= 'a' && char <= 'z') return { code: 'Key' + char.toUpperCase() }
	if (char >= 'A' && char <= 'Z') return { code: 'Key' + char, shift: true }
	if (char >= '0' && char <= '9') return { code: 'Digit' + char }
	if (PLAIN_CHARS[char]) return { code: PLAIN_CHARS[char] }
	if (SHIFT_CHARS[char]) return { code: SHIFT_CHARS[char], shift: true }
	return null
}

/**
 * @param {number} type
 * @param {string} code
 * @param {boolean} down
 */
function encode(type, code, down) {
	const buf = new Uint8Array(2 + code.length)
	buf[0] = type
	buf[1] = down ? 1 : 0
	for (let i = 0; i < code.length; i++) {
		buf[2 + i] = code.charCodeAt(i)
	}
	return buf
}

/**
 * @param {number} type
 * @param {string} code
 * @param {AsyncIterable<BufferSource>} [inner]
 */
async function* press(type, code, inner) {
	const down = encode(type, code, true)
	const up = new Uint8Array(down)
	up[1] = 0
	yield down
	if (inner) {
		yield* inner
	} else {
		await new Promise((r) => setTimeout(r, 50))
	}
	yield up
}

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 */
function clamp(n, lo, hi) {
	return Math.max(lo, Math.min(hi, n))
}
