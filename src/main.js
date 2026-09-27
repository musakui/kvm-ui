import {
	createClient,
	handleView,
	handleInput,
	handleTrackpad,
} from '#/index.js'

const PASS_KEY = 'kvm_pass'

const canvas = document.querySelector('canvas')
const kbInput = document.querySelector('input')
const statusEl = document.getElementById('status')

if (!canvas || !statusEl || !kbInput) {
	throw new Error('required DOM element missing')
}

const client = createClient({
	view: handleView(canvas),
	onStatus(state) {
		statusEl.dataset.state = state
	},
})

client.pipe(handleInput(kbInput))
client.pipe(handleTrackpad(canvas))
canvas.addEventListener('mousedown', () => kbInput.focus())

async function connect(error = '') {
	client.disconnect()
	const saved = !error && sessionStorage.getItem(PASS_KEY)
	const passwd = saved || prompt(error || 'Password:')
	if (passwd === null) return
	try {
		await client.connect({ user: 'admin', passwd })
		if (!saved) sessionStorage.setItem(PASS_KEY, passwd)
	} catch {
		sessionStorage.removeItem(PASS_KEY)
		connect('Invalid credentials')
	}
}

connect()
