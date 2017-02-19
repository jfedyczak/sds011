"use strict"

const fs = require('fs')
const EventEmitter = require('events')
const exec = require('child_process').exec

const PM_GRADES = ['very good', 'good', 'moderate', 'acceptable', 'bad', 'very bad']
const PM10_LIMITS = [20, 60, 100, 140, 200, Infinity]
const PM25_LIMITS = [12, 36, 60, 84, 120, Infinity]

const scale = (v, scale) => {
	for (let i = 0; i < scale.length; i++) {
		if (v < scale[i]) return PM_GRADES[i]
	}
}


const _sds011 = module.exports = {
	init: (filename, callback) => {
		let ee = new EventEmitter()

		const parseLine = (line) => {
			let readout = {
				pm10: ((line[1] << 8) + line[0]) / 10,
				pm25: ((line[3] << 8) + line[2]) / 10
			}
			readout.pm10_grade = scale(readout.pm10, PM10_LIMITS)
			readout.pm25_grade = scale(readout.pm25, PM25_LIMITS)
			ee.emit('readout', readout)
		}

		let buffer = new Buffer(0)

		exec(`stty -F ${filename} 9600 raw`, (err) => {
			if (err) return callback(err)
			fs.createReadStream(filename)
				.on('data', (data) => {
					buffer = Buffer.concat([buffer, data])
					while (1) {
						let i = buffer.indexOf('aac0', 'hex')
						if (i == -1) break
						buffer = buffer.slice(i)
						if (buffer.length < 10) break
						let line = buffer.slice(2, 10)
						buffer = buffer.slice(10)
						parseLine(line)
					}
				})
			callback(null, ee)
		})
	}
}


if (!module.parent) {
	_sds011.init(process.argv[2], (err, sds) => {
		if (err) console.log(err)
		sds.on('readout', (readout) => {
			console.log('--');
			console.log(`PM10: ${readout.pm10} (${readout.pm10_grade})`)
			console.log(`PM2.5: ${readout.pm25} (${readout.pm25_grade})`)
		})
	})
}
