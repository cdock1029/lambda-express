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

	request.queryParams = {}

	if (typeof event.queryString !== 'undefined') {
		request.queryParams = parseParamString(event.queryString)
	}

	if (typeof event.headers !== 'undefined') {
		request.headers = parseParamString(event.headers)
		request.headers['user-agent'] = event['user-agent']

		request.headers['x-real-ip'] = event['source-ip']
		request.headers.host = event['api-id']
	}
	request.pathParams = parseParamString(event.pathParams)

	request.method = event['http-method']
	request.url = reconstructUrl(event['resource-path'], request)

	delete request.allParams
	delete request.queryString

	const fakeSock = {
		remoteAddress: event.remoteAddress,
		destroy: () => { console.log('** fake_sock destroy()') },
	}

	request.socket = fakeSock
	request.connection = fakeSock

	return request
}

exports.appHandler = app => (event, context) => {
	context.callbackWaitsForEmptyEventLoop = false

	const req = mapEvent(event)
	const res = new http.ServerResponse(req)

	res.original_end = res.end
	res.end = function (chunk, encoding, callback) {
		res.original_end(chunk, encoding, callback)
		const statusCode = res.statusCode
		const output = res.output[1]

		if (statusCode === 302) {
			const location = output.toString('utf8')
			console.log('*** 302 location: ', location)
			context.fail(location)
		} else if (statusCode > 399) {
			context.fail(output.toString('utf8'))
		} else {
			const contentType = res.getHeader('content-type')
			const payload = output.toString('base64')
			context.succeed({ payload, contentType })
		}
	}

	// setup and call express
	app.handle(req, res)
}
