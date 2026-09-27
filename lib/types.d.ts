export type ClientAction =
	| { type: 'text'; data: string }
	| { type: 'key'; code: string; up?: boolean }
	| { type: 'button'; button: string; up?: boolean }
	| { type: 'mouse'; dx: number; dy: number; scroll?: boolean }
