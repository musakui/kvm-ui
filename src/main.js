const canvas = document.querySelector('canvas')
const kbInput = document.querySelector('input')
const statusEl = document.getElementById('status')

if (!canvas || !statusEl || !kbInput) {
	throw new Error('required DOM element missing')
}
