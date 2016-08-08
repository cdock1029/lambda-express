'use strict';

const http = require('http')


/*
* Split one of API Gateway's param strings into a real javascript object
* @param {string} paramString Looks like {key1=val1, key2=val2}
*/
function parseParamString(paramString) {
	const obj = {}

	if (typeof paramString !== 'undefined') {
		paramString
		.substring(1, paramString.length - 1) // strip off { and }
		.split(', ')
		.forEach(keyVal => {
			const pieces = keyVal.split('=')
			const key = pieces[0]
			let val = pieces[1]

			// Force 'true' and 'false' into Boolean
			if (val === 'true') val = true
			if (val === 'false') val = false

			obj[key] = val
		})
	}

	return obj
}


/*
* Generate a somewhat normal path
*/
function reconstructUrl(pathParameter, request) {
	let path = pathParameter
	// Append query string

	const str = []

	Object.keys(request.queryParams).forEach(p => {
		if (p) str.push(`${p}=${request.queryParams[p]}`)
	})

	if (str.length) path += `?${str.join('&')}`

	// Fix path parameters
	Object.keys(request.pathParams).forEach(param => {
		path = path.replace(`{${param}}`, request.pathParams[param])
	})

	return path
}
function mapEvent(event) {
	const request = {}

	request.queryParams = event.queryParams
	request.pathParams = event.pathParams
	request.headers = event.headers
	request.headers['user-agent'] = event['user-agent']
	request.headers['x-real-ip'] = event['source-ip']
	request.headers.host = event['api-id']

	request.method = event.method
	request.url = reconstructUrl(event['resource-path'], request)

	delete request.allParams

	const fakeSock = {
		remoteAddress: event.remoteAddress,
		destroy: () => { console.log('** fake_sock destroy()') },
	}

	request.socket = fakeSock
	request.connection = fakeSock

	return request
}
const done = (err, req, res, next) => {
	console.log('*** final error handler ***')
	if (res.headersSent) {
		console.log('*** not handling - header already sent!')
		next(err)
	} else {
		console.log('*** handling with 500 error')
		res.status(500).send({ message: err.toString() })
	}
}
exports.appHandler = app => {
	app.use(done)
	return (event, context) => {
		context.callbackWaitsForEmptyEventLoop = false
		console.log(`** event=[
			${JSON.stringify(event, null, 2)}
		],
		context=[
			${JSON.stringify(context, null, 2)}
		]`)

		const req = mapEvent(event)
		// console.log(`** req=[${req}]\n`)

		const res = new http.ServerResponse(req)

		res.original_end = res.end
		res.end = function (chunk, encoding, callback) {
			res.original_end(chunk, encoding, callback)
			const statusCode = res.statusCode
			const output = res.output[1]

			console.log(res)
			/* Object.keys(res).forEach((key, index) => {
				console.log(`key: ${key}, value: ${res[key]}\n`)
			}) */
			const headers = res._headers
			if (statusCode === 302) {
				// const location = res.get('Location')
				context.fail(JSON.stringify({ headers }))
			} else if (statusCode > 399) {
				const outputString = output.toString('utf8')
				const json = JSON.parse(outputString)
				json.code = statusCode
				json.headers = headers
				context.fail(JSON.stringify(json))
			} else {
				// const contentType = res.getHeader('content-type')
				const payload = output.toString('base64')
				const result = {}
				result.payload = payload
				result.headers = headers
				context.succeed(result)
			}
		}
		// setup and call express
		app.handle(req, res)
	}
}
