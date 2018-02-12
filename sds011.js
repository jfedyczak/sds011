"use strict"

const EventEmitter = require('events')
const SerialPort = require('serialport')

const PM_GRADES = ['very good', 'good', 'moderate', 'acceptable', 'bad', 'very bad']
const PM10_LIMITS = [20, 60, 100, 140, 200, Infinity]
const PM25_LIMITS = [12, 36, 60, 84, 120, Infinity]

const scale = (v, scale) => {
	for (let i = 0; i < scale.length; i++) {
		if (v < scale[i]) return PM_GRADES[i]
	}
}

class SDS011 extends EventEmitter {
	constructor(device, baud) {
		super()
		this.buffer = Buffer.from('')
		this.sp = new SerialPort(device, {
			baudRate: 9600,
		}).on('data', (data) => {
			this.parseResponse(data)
		}).on('open', () => {
			this.ready()
		})
	}
	checksum(data) {
		let cs = 0
		for (let i = 0; i < data.length; i++)
			cs += data[i]
		return cs % 256
	}
	sendCommand(payload) {
		let buf = Buffer.allocUnsafe(payload.length + 3)
		buf[0] = 0xaa
		buf[buf.length - 1] = 0xab
		buf[buf.length - 2] = this.checksum(payload.slice(1))
		payload.copy(buf, 1)
		this.sp.write(buf)
	}
	parseResponse(data) {
		if (data.length < 5) return
		if (data[0] !== 0xaa || data[data.length - 1] !== 0xab) return
		if (this.checksum(data.slice(2, data.length - 2)) !== data[data.length - 2]) return
		if (data[1] === 0xc0 && data.length === 10) {
			// readout
			let resp = {
				type: 'readout',
				ts: +new Date(),
				pm10: ((data[3] << 8) + data[2]) / 10,
				pm25: ((data[5] << 8) + data[4]) / 10,
				id: data.slice(6, 8).toString('hex'),
			}
			this.emit('response', resp)
		} else if (data[1] === 0xc5 && data[2] === 0x07) {
			// firmware version
			let resp = {
				type: 'version',
				y: data[3],
				m: data[4],
				d: data[5],
				id: data.slice(6, 8).toString('hex'),
			}
			this.emit('response', resp)
		} else if (data[1] === 0xc5 && data[2] === 0x02) {
			// reporting mode
			let resp = {
				type: 'repmode',
				active: data[4] === 0,
			}
			this.emit('response', resp)
		} else if (data[1] === 0xc5 && data[2] === 0x05) {
			// id changed
			let resp = {
				type: 'newid',
				id: data.slice(6,8).toString('hex'),
			}
			this.emit('response', resp)
		} else if (data[1] === 0xc5 && data[2] === 0x06) {
			// power mode
			let resp = {
				type: 'power',
				sleep: data[4] === 0,
			}
			this.emit('response', resp)
		} else if (data[1] === 0xc5 && data[2] === 0x08) {
			// interval
			let resp = {
				type: 'cycle',
				interval: data[4],
			}
			this.emit('response', resp)
		} else {
			console.log(` -- unknown command: ${data.toString('hex').replace(/(..)/g, '$1 ')}`)
		}
	}
	cmdVersion() {
		this.sendCommand(Buffer.from([0xb4, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff]))
	}
	cmdSetReportingMode(active) {
		this.sendCommand(Buffer.from([
			0xb4, 2, 1, (active ? 0 : 1),
			0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff]))
	}
	cmdQueryData() {
		this.sendCommand(Buffer.from([
			0xb4, 4,
			0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff,
		]))
	}
	cmdSetDeviceId(id /* abcd */) {
		let b = Buffer.from(id, 'hex')
		this.sendCommand(Buffer.from([
			0xb4, 5,
			0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
			b[0],
			b[1],
			0xff, 0xff,
		]))
	}
	cmdPower(sleep) {
		this.sendCommand(Buffer.from([
			0xb4, 6, 1,
			sleep ? 0 : 1,
			0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
			0xff, 0xff,
		]))
	}
	cmdCycle(interval) { // 0 = non-stop
		this.sendCommand(Buffer.from([
			0xb4, 8, 1,
			interval,
			0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
			0xff, 0xff,
		]))
	}
	ready() {
		this.emit('ready')
	}
}

module.exports = SDS011

if (!module.parent) {
	let m = new SDS011(process.argv[2], 9600)
	m.on('ready', () => {
		console.log(' -- setting reporting mode to active')
		m.cmdSetReportingMode(true)
	})
	m.on('response', (r) => {
		if (r.type === 'repmode') {
			console.log(' -- setiing duty cycle')
			m.cmdCycle(2)
		} else if (r.type === 'cycle') {
			console.log(' -- ready - awaiting readings')
		} else if (r.tpye === 'readout') {
			console.log(r)
		}
	})
}
