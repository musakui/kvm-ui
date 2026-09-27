export { createClient } from './client.js'
export { handleView } from './view.js'
import { attachInput, attachTrackpad, parseActions } from './input.js'

/** @param {HTMLInputElement} el */
export const handleInput = (el) => parseActions(attachInput(el))

/** @param {HTMLElement} el */
export const handleTrackpad = (el) => parseActions(attachTrackpad(el))
